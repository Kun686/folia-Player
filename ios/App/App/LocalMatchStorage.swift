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
    func displayedSong(_ id: String, base: [String: Any]? = nil) throws -> [String: Any] {
        var song = try base ?? importedSong(id)
        if let doc = try matchDocument(lyricSource(id)) {
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
    func readLocalMatch(_ id: String) async throws -> [String: Any] {
        _ = try await readLyricSources(id)
        let record = try lyricSource(id) ?? LyricSource(content: "", fileName: nil)
        let lyrics = lyricSnapshot(record, id: id), base = try importedSong(id)
        let fileName = try base["importedFileName"] as? String ?? resolve(id).lastPathComponent
        var result: [String: Any] = ["base": base, "fileName": fileName, "lyrics": lyrics]
        if let document = try matchDocument(record) { result["document"] = document }
        if let data = try cover(id) { result["embeddedCover"] = "data:image/jpeg;base64," + data.base64EncodedString() }
        return result
    }
    func writeLocalMatch(_ id: String, token: String, document: [String: Any], source: String?) async throws -> [String: Any] {
        guard source == nil || ["local", "embedded", "online"].contains(source!) else { throw MobileFailure("invalid-lyrics-source") }
        _ = try resolve(id)
        guard lyricToken(id) == token else { throw MobileFailure("local-lyrics-changed") }
        let text = try await lyricImportParser.localMatchDocument(document)
        try Task.checkCancellation()
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
        try writeLyricSources(record, id: id)
        lyricEditTokens[id] = UUID().uuidString
        return try displayedSong(id)
    }
}
