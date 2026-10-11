import AVFoundation

// LocalEmbeddedLyrics.swift — collect bounded system tags, then reuse the original JS candidate selector.
struct EmbeddedLyrics: Decodable {
    var lyrics: String?
    var translationLyrics: String?
    var legacyContent: String?
}
extension LocalMediaLibrary {
    static let embeddedScanVersion = 3

    static func embeddedLyrics(_ metadata: [AVMetadataItem], parser: NativeLyricParser, fileURL: URL? = nil) async throws -> EmbeddedLyrics {
        var tags: [[String: String]] = [], bytes = 0
        var legacy: String?
        for item in metadata {
            try Task.checkCancellation()
            let unsynced = item.identifier == .id3MetadataUnsynchronizedLyric, itunes = item.identifier == .iTunesMetadataLyrics
            let sylt = item.identifier == .id3MetadataSynchronizedLyric
            let key = (item.key as? String)?.lowercased() ?? ""
            // Observed AVFoundation Vorbis keyspace; no SDK constant is exposed for this keyspace.
            let vorbis = item.keySpace?.rawValue == "vorb" && (key.contains("lyric") || key.contains("uslt") || key.contains("sylt"))
            guard unsynced || itunes || sylt || vorbis else { continue }
            var tag = ["id": item.identifier?.rawValue ?? key, "tagFormat": vorbis ? "vorbis" : itunes ? "itunes" : "id3"]
            if sylt {
                guard let data = try await item.load(.dataValue), !data.isEmpty else { continue }
                guard data.count <= 262144 else { throw MobileFailure("lyrics-too-large") }
                bytes += data.count; tag["value"] = data.base64EncodedString(); tag["representation"] = "sylt"
            } else {
                guard let value = try await item.load(.stringValue), !value.isEmpty else { continue }
                guard value.utf8.count <= 2_000_000 else { throw MobileFailure("lyrics-too-large") }
                bytes += value.utf8.count; tag["value"] = value
                if legacy == nil && (unsynced || itunes) { legacy = value }
                if itunes || (vorbis && ["lyrics", "unsyncedlyrics"].contains(key)) { tag["representation"] = "lrc" }
                else if vorbis { tag["fallback"] = "native" }
            }
            guard bytes <= 4_000_000, tags.count < 64 else { throw MobileFailure("lyrics-too-large") }
            if let language = item.extendedLanguageTag ?? item.locale?.identifier {
                // AVFoundation uses BCP-47; music-metadata exposes the ID3 ISO-639-2 language code.
                tag["language"] = Locale.Language(identifier: language).languageCode?.identifier(.alpha3) ?? language
            }
            if let descriptor = try await item.load(.extraAttributes)?[.info] as? String { tag["descriptor"] = descriptor }
            guard tag.filter({ $0.key != "value" }).values.allSatisfy({ $0.utf8.count <= 1024 }) else { throw MobileFailure("invalid-lyrics") }
            tags.append(tag)
        }
        try Task.checkCancellation()
        var result: EmbeddedLyrics
        // iOS 18 omits ordinary Vorbis lyric tags; newer systems hide them behind a leading ID3 tag.
        // Use the original file parser for every FLAC so tag precedence is independent of the OS.
        if let fileURL, fileURL.pathExtension.lowercased() == "flac" {
            result = try await parser.flacTags(fileURL)
        } else {
            guard !tags.isEmpty else { return EmbeddedLyrics() }
            result = try await parser.embeddedTags(tags)
        }
        result.legacyContent = legacy
        return result
    }
}
