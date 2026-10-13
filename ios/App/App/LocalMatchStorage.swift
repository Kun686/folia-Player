import Foundation

// LocalMatchStorage.swift — match metadata and lyrics commit together; imported song/audio/cover remain intact.
extension LocalMediaLibrary {
    func matchDocument(_ record: LyricSource?) throws -> [String: Any]? {
        guard let text = record?.matchJSON, let data = text.data(using: .utf8) else { return nil }
        guard let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw MobileFailure("invalid-local-match") }
        return result
    }
    func importedSong(_ id: String) throws -> [String: Any] {
        _ = try resolve(id)
        let data = try Data(contentsOf: directory(id).appendingPathComponent("song.json"))
        guard let base = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw MobileFailure("invalid-local-identity") }
        return base
    }
    func matchedSong(_ id: String, base: [String: Any]? = nil, record: LyricSource? = nil) throws -> [String: Any] {
        var song = try base ?? importedSong(id)
        if let doc = try matchDocument(record ?? lyricSource(id)) {
            if let title = doc["title"] as? String { song["name"] = title }
            if let names = doc["artistNames"] as? [String] { song["artists"] = names.map { ["id": "", "name": $0] } }
            var album = song["album"] as? [String: Any] ?? [:]
            album["name"] = doc["albumName"] as? String ?? ""
            if doc["useOnlineCover"] as? Bool == true,
               let online = doc["onlineMetadata"] as? [String: Any] { album["coverUrl"] = online["coverUrl"] }
            else { album.removeValue(forKey: "coverUrl") }
            song["album"] = album
        }
        return song
    }
    func onlineCoverSong(_ id: String) throws -> [String: Any]? {
        guard let doc = try matchDocument(lyricSource(id)), doc["useOnlineCover"] as? Bool == true,
              let online = doc["onlineMetadata"] as? [String: Any], let provider = online["source"] as? String,
              let cover = online["coverUrl"] as? String else { return nil }
        // Distinct URL versions cannot reuse stale artwork; this identity is only used by the cover cache.
        return ["id": id, "name": "", "artists": [], "album": ["id": "", "name": "", "coverUrl": cover],
            "sourceRef": ["kind": "online", "providerId": provider,
                "mediaId": NativeProfileCache.digest(Data(("local-cover|" + id + "|" + cover).utf8))]]
    }
    func readLocalMatch(_ id: String, includeCover: Bool = true) async throws -> [String: Any] {
        _ = try await readLyricSources(id)
        return try localMatchSnapshot(id, includeCover: includeCover)
    }
    // A song receipt excludes unrelated catalog revisions and binary artwork, but includes manual entity display/assignment.
    private func localMatchSnapshot(_ id: String, includeCover: Bool, library: [String: Any]? = nil) throws -> [String: Any] {
        let record = try lyricSource(id) ?? LyricSource(content: "", fileName: nil)
        let lyrics = lyricSnapshot(record, id: id), base = try importedSong(id)
        let fileName = try base["importedFileName"] as? String ?? resolve(id).lastPathComponent
        var result: [String: Any] = ["base": base, "fileName": fileName, "lyrics": lyrics]
        if let document = try matchDocument(record) { result["document"] = document }
        let library = try library ?? librarySnapshot()
        result["libraryRevision"] = library["revision"]
        result["assignment"] = (library["assignments"] as? [[String: Any]])?.first { $0["songId"] as? String == id }
        result["display"] = (library["songs"] as? [[String: Any]])?.first { $0["id"] as? String == id }
        if let data = try cover(id) {
            result["hasLocalCover"] = true
            result["coverToken"] = NativeProfileCache.digest(data)
            if includeCover { result["embeddedCover"] = "data:image/jpeg;base64," + data.base64EncodedString() }
        }
        var context = result
        context.removeValue(forKey: "libraryRevision"); context.removeValue(forKey: "embeddedCover")
        result["contextToken"] = NativeProfileCache.digest(try JSONSerialization.data(withJSONObject: context, options: [.sortedKeys]))
        return result
    }
    func writeLocalMatch(_ id: String, token: String, document: [String: Any], source: String?,
                         libraryRevision: String? = nil, metadata: String = "online", updateArtists: Bool = true,
                         updateAlbum: Bool = true, protectOrigins: [String] = [], contextToken: String? = nil,
                         validate: () throws -> Void = {}) async throws -> [String: Any] {
        try validate()
        guard source == nil || ["local", "embedded", "online"].contains(source!) else { throw MobileFailure("invalid-lyrics-source") }
        guard ["keep", "online", "imported"].contains(metadata),
              protectOrigins.allSatisfy({ ["import", "auto-match", "manual-match", "manual", "split"].contains($0) })
        else { throw MobileFailure("invalid-local-match") }
        _ = try resolve(id)
        guard lyricToken(id) == token else { throw MobileFailure("local-lyrics-changed") }
        let text = try await lyricImportParser.localMatchDocument(document)
        try Task.checkCancellation()
        try validate()
        _ = try resolve(id)
        guard lyricToken(id) == token else { throw MobileFailure("local-lyrics-changed") }
        var record = try lyricSource(id) ?? LyricSource(content: "", fileName: nil)
        record.matchJSON = text; record.lyricsSource = source
        if source == "online" {
            let match = try matchDocument(record)
            guard match?["matchedLyrics"] is [String: Any] || match?["matchedIsPureMusic"] as? Bool == true else { throw MobileFailure("lyrics-source-unavailable") }
        } else if let source {
            let available = source == "local" ? (record.contentIsEmbedded == true ? "" : record.content) : record.embeddedContent ?? ""
            guard !available.isEmpty else { throw MobileFailure("lyrics-source-unavailable") }
        }
        let current = try librarySnapshot()
        if let contextToken {
            guard try localMatchSnapshot(id, includeCover: false, library: current)["contextToken"] as? String == contextToken
            else { throw MobileFailure("local-library-changed") }
        } else if let libraryRevision, current["revision"] as? String != libraryRevision { throw MobileFailure("local-library-changed") }
        let assignment = (current["assignments"] as? [[String: Any]])?.first { $0["songId"] as? String == id }
        let original = try importedSong(id), prior = try lyricSource(id)
        var input = try libraryInput(id, base: original, record: prior)
        if metadata != "keep" {
            let matched = try matchedSong(id, base: original, record: record)
            let origin = metadata == "imported" ? "import" : (document["titleOrigin"] as? String == "auto-match" ? "auto-match" : "manual-match")
            let revision = UUID().uuidString
            if metadata == "imported" || (updateArtists && !protectOrigins.contains(assignment?["artistOrigin"] as? String ?? "")) {
                input["artistNames"] = ((metadata == "imported" ? original : matched)["artists"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String }
                input["artistRevision"] = revision; input["artistOrigin"] = origin
            }
            if metadata == "imported" || (updateAlbum && !protectOrigins.contains(assignment?["albumOrigin"] as? String ?? "")) {
                input["albumName"] = ((metadata == "imported" ? original : matched)["album"] as? [String: Any])?["name"] as? String ?? ""
                input["albumRevision"] = revision; input["albumOrigin"] = origin
            }
        }
        record.libraryMetadataJSON = String(data: try JSONSerialization.data(withJSONObject: input), encoding: .utf8)
        // Compute and validate the new projection before the sole atomic commit; no two-file partial transaction.
        let projected = try librarySnapshot(overrides: [id: record])
        guard let song = (projected["songs"] as? [[String: Any]])?.first(where: { $0["id"] as? String == id })
        else { throw MobileFailure("invalid-local-identity") }
        try Task.checkCancellation()
        try validate()
        try writeLyricSources(record, id: id)
        lyricEditTokens[id] = UUID().uuidString
        return song
    }
}
