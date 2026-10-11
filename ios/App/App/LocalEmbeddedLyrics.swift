import AVFoundation

// LocalEmbeddedLyrics.swift — collect bounded system tags, then reuse the original JS candidate selector.
struct EmbeddedLyrics: Decodable {
    var lyrics: String?
    var translationLyrics: String?
    var legacyContent: String?
}
extension LocalMediaLibrary {
    static let embeddedScanVersion = 2

    static func embeddedLyrics(_ metadata: [AVMetadataItem], parser: NativeLyricParser) async throws -> EmbeddedLyrics {
        var tags: [[String: String]] = [], bytes = 0
        var legacy: String?
        for item in metadata where item.identifier == .id3MetadataUnsynchronizedLyric || item.identifier == .iTunesMetadataLyrics {
            try Task.checkCancellation()
            guard let value = try await item.load(.stringValue), !value.isEmpty else { continue }
            bytes += value.utf8.count
            guard value.utf8.count <= 2_000_000, bytes <= 4_000_000, tags.count < 64 else { throw MobileFailure("lyrics-too-large") }
            if legacy == nil { legacy = value }
            var tag = ["value": value, "id": item.identifier!.rawValue]
            if let language = item.extendedLanguageTag ?? item.locale?.identifier {
                // AVFoundation uses BCP-47; music-metadata exposes the ID3 ISO-639-2 language code.
                tag["language"] = Locale.Language(identifier: language).languageCode?.identifier(.alpha3) ?? language
            }
            if let descriptor = try await item.load(.extraAttributes)?[.info] as? String { tag["descriptor"] = descriptor }
            guard tag.filter({ $0.key != "value" }).values.allSatisfy({ $0.utf8.count <= 1024 }) else { throw MobileFailure("invalid-lyrics") }
            tags.append(tag)
        }
        try Task.checkCancellation()
        guard !tags.isEmpty else { return EmbeddedLyrics() }
        var result = try await parser.embeddedTags(tags)
        result.legacyContent = legacy
        return result
    }
}
