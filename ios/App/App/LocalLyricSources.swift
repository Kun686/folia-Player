import AVFoundation

// LocalLyricSources.swift — retain imported and embedded payloads in one atomic record, with revocable edits.
extension LocalMediaLibrary {
    func lyricToken(_ id: String) -> String {
        if let token = lyricEditTokens[id] { return token }
        let token = UUID().uuidString; lyricEditTokens[id] = token; return token
    }
    func lyricSnapshot(_ record: LyricSource, id: String) -> [String: Any] {
        var result: [String: Any] = ["content": record.contentIsEmbedded == true ? "" : record.content, "token": lyricToken(id)]
        if let name = record.fileName { result["fileName"] = name }
        if let text = record.embeddedContent { result["embeddedContent"] = text }
        if let translation = record.embeddedTranslation { result["embeddedTranslation"] = translation }
        if let source = record.lyricsSource { result["lyricsSource"] = source }
        if let match = record.matchJSON, let data = match.data(using: .utf8) { result["matched"] = try? JSONSerialization.jsonObject(with: data) }
        return result
    }
    // Legacy lyrics.txt has no provenance. Only an exact match to the retained audio tag is classified as embedded.
    func readLyricSources(_ id: String) async throws -> [String: Any] {
        let audio = try resolve(id), expected = lyricToken(id)
        var record = try lyricSource(id) ?? LyricSource(content: "", fileName: nil)
        if (record.embeddedScanVersion ?? 0) < Self.embeddedScanVersion {
            let embedded: EmbeddedLyrics
            do {
                let metadata = try await AVURLAsset(url: audio).load(.metadata)
                embedded = try await Self.embeddedLyrics(metadata, parser: lyricImportParser)
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
            if legacy && !record.content.isEmpty && record.content == embedded.legacyContent { record.contentIsEmbedded = true }
            record.embeddedContent = embedded.lyrics; record.embeddedTranslation = embedded.translationLyrics
            record.embeddedScanned = true; record.embeddedScanVersion = Self.embeddedScanVersion
            try writeLyricSources(record, id: id)
        }
        return lyricSnapshot(record, id: id)
    }
    func writeLyricSources(_ record: LyricSource, id: String) throws {
        _ = try resolve(id)
        let data = try JSONEncoder().encode(record)
        guard data.count <= 37_000_000 else { throw MobileFailure("lyrics-too-large") }
        try data.write(to: directory(id).appendingPathComponent("lyrics.json"),
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func selectLyricSource(_ source: String, id: String, token: String) async throws -> [String: Any] {
        guard ["local", "embedded", "online"].contains(source) else { throw MobileFailure("invalid-lyrics-source") }
        _ = try await readLyricSources(id)
        guard lyricToken(id) == token, var record = try lyricSource(id) else { throw MobileFailure("local-lyrics-changed") }
        if source == "online" {
            let match = try matchDocument(record)
            guard match?["matchedLyrics"] is [String: Any] || match?["matchedIsPureMusic"] as? Bool == true else { throw MobileFailure("lyrics-source-unavailable") }
        } else {
            let available = source == "local" ? (record.contentIsEmbedded == true ? "" : record.content) : record.embeddedContent ?? ""
            guard !available.isEmpty else { throw MobileFailure("lyrics-source-unavailable") }
        }
        record.lyricsSource = source
        try Task.checkCancellation()
        try writeLyricSources(record, id: id)
        lyricEditTokens[id] = UUID().uuidString
        return lyricSnapshot(record, id: id)
    }
}
