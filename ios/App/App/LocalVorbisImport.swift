import AVFoundation
import UIKit

// LocalVorbisImport.swift — app-owned Ogg plus a seekable lossless PCM carrier, retaining original library/lyric semantics.
extension LocalMediaLibrary {
    func importVorbis(_ original: URL, sourceName: String, id: String, folder: URL) async throws -> [String: Any] {
        let carrier = folder.appendingPathComponent("audio.caf")
        let decoded = try await vorbisDecoder.decode(original, output: carrier)
        let metadata = try await lyricImportParser.vorbisMetadata(decoded.comments)
        let attributes = try original.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
        let title = metadata["title"] as? String ?? URL(fileURLWithPath: sourceName).deletingPathExtension().lastPathComponent
        let names = metadata["artists"] as? [String] ?? []
        guard names.count <= 128 else { throw MobileFailure("invalid-local-metadata") }
        var song: [String: Any] = ["id": id, "name": String(title.prefix(512)), "importedFileName": String(sourceName.prefix(1024)),
            "artists": names.map { ["id": "", "name": String($0.prefix(256))] },
            "album": ["id": "", "name": String((metadata["album"] as? String ?? "").prefix(512))],
            "durationMs": decoded.duration * 1000, "sourceRef": ["kind": "local", "mediaId": id],
            "trackOrderVersion": Self.trackOrderVersion, "replayGainScanned": true]
        song["fileLastModified"] = attributes.contentModificationDate.map { $0.timeIntervalSince1970 * 1000 }
        song["fileSize"] = attributes.fileSize
        for key in ["trackNumber", "discNumber"] { song[key] = metadata[key] }
        song["replayGain"] = NativeReplayGainInfo(metadata["replayGain"])?.dictionary
        if let base64 = metadata["cover"] as? String, let data = Data(base64Encoded: base64),
           let image = UIImage(data: data), image.size.width > 0, image.size.height > 0 {
            let scale = min(1, 512 / max(image.size.width, image.size.height))
            let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
            let format = UIGraphicsImageRendererFormat(); format.scale = 1
            let thumb = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
            if let jpeg = thumb.jpegData(compressionQuality: 0.8) {
                try jpeg.write(to: folder.appendingPathComponent("cover.jpg"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            }
        }
        let embedded = metadata["lyrics"] as? String
        let lyrics = try LyricSource(content: embedded ?? "", fileName: nil, embeddedContent: embedded,
            embeddedTranslation: metadata["translationLyrics"] as? String, embeddedScanned: true,
            embeddedScanVersion: Self.embeddedScanVersion, contentIsEmbedded: true).validated()
        try Task.checkCancellation()
        try JSONEncoder().encode(lyrics).write(to: folder.appendingPathComponent("lyrics.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        try JSONSerialization.data(withJSONObject: ["file": carrier.lastPathComponent, "original": original.lastPathComponent])
            .write(to: folder.appendingPathComponent("media.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        try JSONSerialization.data(withJSONObject: song).write(to: folder.appendingPathComponent("song.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return song
    }

    // Original tags remain available for later scan-version upgrades; the playback carrier contains only PCM.
    func metadataAudio(_ id: String) throws -> URL {
        let carrier = try resolve(id), folder = try directory(id)
        let value = try JSONSerialization.jsonObject(with: Data(contentsOf: folder.appendingPathComponent("media.json"))) as? [String: String]
        guard let original = value?["original"] else { return carrier }
        guard original == "audio.ogg", carrier.lastPathComponent == "audio.caf" else { throw MobileFailure("invalid-local-identity") }
        let url = folder.appendingPathComponent(original)
        let attributes = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard attributes.isRegularFile == true, attributes.isSymbolicLink != true else { throw MobileFailure("local-file-missing") }
        return url
    }
}
