import AVFoundation

// LocalTrackOrder.swift — bounded system metadata collection and lazy upgrade of retained local audio; no provider calls.
extension LocalMediaLibrary {
    static let trackOrderVersion = 1

    static func trackOrder(_ metadata: [AVMetadataItem], parser: NativeLyricParser) async throws -> [String: Any] {
        var tags: [[String: String]] = []
        for item in metadata {
            try Task.checkCancellation()
            let field: String
            switch item.identifier {
            case .id3MetadataTrackNumber, .iTunesMetadataTrackNumber: field = "trackNumber"
            case .id3MetadataPartOfASet, .iTunesMetadataDiscNumber: field = "discNumber"
            default: continue
            }
            let itunes = item.identifier == .iTunesMetadataTrackNumber || item.identifier == .iTunesMetadataDiscNumber
            let value: String, format: String
            if itunes, let data = try await item.load(.dataValue) {
                guard (6...8).contains(data.count) else { throw MobileFailure("invalid-track-metadata") }
                value = data.base64EncodedString(); format = "itunes"
            } else if let text = try await item.load(.stringValue) {
                value = text; format = "text"
            } else { continue }
            guard value.utf8.count <= 1024, tags.count < 64 else { throw MobileFailure("invalid-track-metadata") }
            tags.append(["field": field, "value": value, "format": format])
        }
        return tags.isEmpty ? [:] : try await parser.trackOrder(tags)
    }

    // Backfill only missing ordering fields. A rescan/deletion or another upgrade wins over the suspended read.
    func refreshTrackOrder() async throws {
        let songs = try rawCatalog(requireComplete: false)
        for song in songs {
            try Task.checkCancellation()
            guard let id = (song["sourceRef"] as? [String: String])?["mediaId"], Self.validID(id) else { continue }
            do { try await refreshTrackOrder(id) }
            catch {
                try Task.checkCancellation()
                // Optional metadata or a file removed during scanning cannot hide the remaining catalog.
            }
        }
    }

    private func refreshTrackOrder(_ id: String) async throws {
        let location = try directory(id), file = location.appendingPathComponent("song.json")
        let before = try Data(contentsOf: file)
        guard var base = try JSONSerialization.jsonObject(with: before) as? [String: Any] else { throw MobileFailure("invalid-local-identity") }
        guard let identity = base["sourceRef"] as? [String: String], identity["kind"] == "local", identity["mediaId"] == id
        else { throw MobileFailure("invalid-local-identity") }
        if (base["trackOrderVersion"] as? Int ?? 0) >= Self.trackOrderVersion { return }
        let audio = try resolve(id), attributes = try audio.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
        let order: [String: Any]
        do {
            if audio.pathExtension.lowercased() == "flac" {
                let tags = try await lyricImportParser.flacTags(audio)
                var fields: [String: Any] = [:]
                fields["trackNumber"] = tags.trackNumber; fields["discNumber"] = tags.discNumber
                order = fields
            } else {
                let metadata = try await AVURLAsset(url: audio).load(.metadata)
                order = try await Self.trackOrder(metadata, parser: lyricImportParser)
            }
        } catch {
            try Task.checkCancellation()
            // Optional damaged tags retain the old playable catalog and are eligible for a later retry.
            return
        }
        try Task.checkCancellation()
        guard try directory(id) == location, (try? Data(contentsOf: file)) == before else { return }
        for key in ["trackNumber", "discNumber"] where base[key] == nil { base[key] = order[key] }
        if base["fileLastModified"] == nil { base["fileLastModified"] = attributes.contentModificationDate.map { $0.timeIntervalSince1970 * 1000 } }
        if base["fileSize"] == nil { base["fileSize"] = attributes.fileSize }
        base["trackOrderVersion"] = Self.trackOrderVersion
        try JSONSerialization.data(withJSONObject: base).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}
