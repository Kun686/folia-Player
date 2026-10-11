import AVFoundation

// LocalLyricSources.swift — retain imported and embedded payloads in one atomic record, with revocable edits.
extension LocalMediaLibrary {
    static func embeddedLyricText(_ metadata: [AVMetadataItem]) async throws -> String? {
        for item in metadata where item.identifier == .id3MetadataUnsynchronizedLyric || item.identifier == .iTunesMetadataLyrics {
            let value = try await item.load(.stringValue)
            try Task.checkCancellation()
            if let value, !value.isEmpty {
                guard value.utf8.count <= 2_000_000 else { throw MobileFailure("lyrics-too-large") }
                return value
            }
        }
        return nil
    }
    func lyricToken(_ id: String) -> String {
        if let token = lyricEditTokens[id] { return token }
        let token = UUID().uuidString; lyricEditTokens[id] = token; return token
    }
    private func lyricSnapshot(_ record: LyricSource, id: String) -> [String: Any] {
        var result: [String: Any] = ["content": record.contentIsEmbedded == true ? "" : record.content, "token": lyricToken(id)]
        if let name = record.fileName { result["fileName"] = name }
        if let text = record.embeddedContent { result["embeddedContent"] = text }
        if let source = record.lyricsSource { result["lyricsSource"] = source }
        return result
    }
    // Legacy lyrics.txt has no provenance. Only an exact match to the retained audio tag is classified as embedded.
    func readLyricSources(_ id: String) async throws -> [String: Any] {
        let audio = try resolve(id), expected = lyricToken(id)
        var record = try lyricSource(id) ?? LyricSource(content: "", fileName: nil)
        if record.embeddedScanned != true {
            let embedded: String?
            do {
                let metadata = try await AVURLAsset(url: audio).load(.metadata)
                embedded = try await Self.embeddedLyricText(metadata)
            } catch {
                // Optional tag failures must not hide saved imports or prevent replacing them.
                // Leave the scan pending so a transient metadata failure can recover on the next read.
                try Task.checkCancellation()
                _ = try resolve(id)
                guard lyricToken(id) == expected else { throw MobileFailure("local-lyrics-changed") }
                return lyricSnapshot(record, id: id)
            }
            try Task.checkCancellation()
            _ = try resolve(id)
            guard lyricToken(id) == expected else { throw MobileFailure("local-lyrics-changed") }
            let legacy = !FileManager.default.fileExists(atPath: try directory(id).appendingPathComponent("lyrics.json").path)
            // Keep the compatibility text intact so a previous build can still read migrated embedded lyrics.
            if legacy && !record.content.isEmpty && record.content == embedded { record.contentIsEmbedded = true }
            record.embeddedContent = embedded; record.embeddedScanned = true
            try writeLyricSources(record, id: id)
        }
        return lyricSnapshot(record, id: id)
    }
    func writeLyricSources(_ record: LyricSource, id: String) throws {
        _ = try resolve(id)
        let data = try JSONEncoder().encode(record)
        guard data.count <= 24_300_000 else { throw MobileFailure("lyrics-too-large") }
        try data.write(to: directory(id).appendingPathComponent("lyrics.json"),
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func selectLyricSource(_ source: String, id: String, token: String) async throws -> [String: Any] {
        guard ["local", "embedded"].contains(source) else { throw MobileFailure("invalid-lyrics-source") }
        _ = try await readLyricSources(id)
        guard lyricToken(id) == token, var record = try lyricSource(id) else { throw MobileFailure("local-lyrics-changed") }
        let available = source == "local" ? (record.contentIsEmbedded == true ? "" : record.content) : record.embeddedContent ?? ""
        guard !available.isEmpty else { throw MobileFailure("lyrics-source-unavailable") }
        record.lyricsSource = source
        try Task.checkCancellation()
        try writeLyricSources(record, id: id)
        lyricEditTokens[id] = UUID().uuidString
        return lyricSnapshot(record, id: id)
    }
}
