import AVFoundation
import UIKit

// LocalMediaLibrary.swift — imported bytes belong to the app; queue identities never contain paths.
actor LocalMediaLibrary {
    struct LyricSource: Codable { let content: String; let fileName: String? }
    let root: URL
    var lyricEditTokens: [String: String] = [:]
    let lyricImportParser = NativeLyricParser()
    init(root: URL? = nil) {
        self.root = root ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("FoliaMedia", isDirectory: true)
    }
    static func validID(_ id: String) -> Bool { UUID(uuidString: id) != nil }
    func directory(_ id: String) throws -> URL {
        guard Self.validID(id) else { throw MobileFailure("invalid-local-identity") }
        return root.appendingPathComponent(id, isDirectory: true)
    }
    func catalog() throws -> [[String: Any]] {
        guard FileManager.default.fileExists(atPath: root.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
            .filter { Self.validID($0.lastPathComponent) }
            .compactMap { url -> [String: Any]? in
                guard let data = try? Data(contentsOf: url.appendingPathComponent("song.json")) else { return nil }
                return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            }.sorted { ($0["name"] as? String ?? "").localizedStandardCompare($1["name"] as? String ?? "") == .orderedAscending }
    }
    func resolve(_ id: String) throws -> URL {
        let folder = try directory(id)
        // The only playable filename is written by importAudio, never supplied by the WebView.
        let data = try Data(contentsOf: folder.appendingPathComponent("media.json"))
        guard let info = try JSONSerialization.jsonObject(with: data) as? [String: String], let name = info["file"],
              name.range(of: "^audio\\.[a-z0-9]{1,8}$", options: .regularExpression) != nil else { throw MobileFailure("local-file-missing") }
        let url = folder.appendingPathComponent(name)
        guard FileManager.default.fileExists(atPath: url.path), !((try url.resourceValues(forKeys: [.isSymbolicLinkKey])).isSymbolicLink ?? false) else {
            throw MobileFailure("local-file-missing")
        }
        return url
    }
    func audioSource(_ id: String) async throws -> NativeAudioSource {
        let url: URL
        do { url = try resolve(id) } catch { throw MobileFailure("local-file-missing") }
        let songURL = try directory(id).appendingPathComponent("song.json")
        guard let data = try? Data(contentsOf: songURL),
              var song = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            return NativeAudioSource(url: url)
        }
        // Older imports are upgraded lazily; no reimport and no repeated scans for untagged songs.
        if song["replayGainScanned"] as? Bool != true {
            guard let metadata = try? await AVURLAsset(url: url).load(.metadata) else {
                try Task.checkCancellation()
                return NativeAudioSource(url: url, replayGain: NativeReplayGainInfo(song["replayGain"]))
            }
            let info = await NativeReplayGainInfo.read(metadata)
            try Task.checkCancellation()
            _ = try resolve(id) // A concurrent delete must not resurrect its metadata.
            if let info { song["replayGain"] = info.dictionary }
            song["replayGainScanned"] = true
            // A full/read-only disk may delay the upgrade, but must not prevent playback.
            try? JSONSerialization.data(withJSONObject: song).write(to: songURL, options: .atomic)
        }
        return NativeAudioSource(url: url, replayGain: NativeReplayGainInfo(song["replayGain"]))
    }
    func lyricSource(_ id: String) throws -> LyricSource? {
        _ = try resolve(id)
        let folder = try directory(id), document = folder.appendingPathComponent("lyrics.json")
        let hasDocument = FileManager.default.fileExists(atPath: document.path)
        let url = hasDocument ? document : folder.appendingPathComponent("lyrics.txt")
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isSymbolicLinkKey])
        // JSON escaping can expand a 2MB UTF-8 text sixfold. Legacy/embedded text keeps its original limit.
        let limit = hasDocument ? 12_100_000 : 2_000_000
        guard values.isSymbolicLink != true, let size = values.fileSize, size <= limit else { throw MobileFailure("lyrics-too-large") }
        let data = try Data(contentsOf: url)
        guard data.count <= limit else { throw MobileFailure("lyrics-too-large") }
        let source: LyricSource
        if hasDocument { source = try JSONDecoder().decode(LyricSource.self, from: data) }
        else {
            guard let text = String(data: data, encoding: .utf8) else { throw MobileFailure("invalid-lyrics") }
            source = LyricSource(content: text, fileName: nil)
        }
        guard source.content.utf8.count <= 2_000_000, (source.fileName?.utf8.count ?? 0) <= 1024 else { throw MobileFailure("lyrics-too-large") }
        return source
    }
    func details(_ id: String) throws -> [String: Any] {
        _ = try resolve(id)
        var result: [String: Any] = [:]
        if let source = try? lyricSource(id) {
            result["content"] = source.content
            if let fileName = source.fileName { result["fileName"] = fileName }
        }
        if let data = try? cover(id) { result["cover"] = "data:image/jpeg;base64," + data.base64EncodedString() }
        return result
    }
    func cover(_ id: String) throws -> Data? {
        _ = try resolve(id)
        let url = try directory(id).appendingPathComponent("cover.jpg")
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true, let bytes = values.fileSize, bytes <= 2_000_000 else {
            throw MobileFailure("invalid-cover")
        }
        return try Data(contentsOf: url)
    }
    func remove(_ id: String) throws {
        try FileManager.default.removeItem(at: directory(id))
        lyricEditTokens.removeValue(forKey: id)
    }

    // Copy before inspecting metadata so cloud/security-scoped documents can be released promptly.
    func importAudio(_ source: URL) async throws -> [String: Any] {
        let ext = source.pathExtension.lowercased()
        guard ["mp3", "m4a", "aac", "wav", "aiff", "aif", "flac", "caf", "mp4"].contains(ext) else { throw MobileFailure("unsupported-audio") }
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        let id = UUID().uuidString
        let folder = try directory(id), target = folder.appendingPathComponent("audio." + ext)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        do {
            var coordinationError: NSError?, copyError: Error?
            NSFileCoordinator().coordinate(readingItemAt: source, options: [], error: &coordinationError) { readable in
                do { try FileManager.default.copyItem(at: readable, to: target) } catch { copyError = error }
            }
            if let error = coordinationError ?? copyError as NSError? { throw error }
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: target.path)
            let asset = AVURLAsset(url: target)
            guard try await asset.load(.isPlayable), !(try await asset.loadTracks(withMediaType: .audio)).isEmpty else { throw MobileFailure("unsupported-audio") }
            let duration = try await asset.load(.duration).seconds
            guard duration.isFinite, duration > 0 else { throw MobileFailure("unsupported-audio") }
            let metadata = try await asset.load(.commonMetadata)
            func string(_ key: AVMetadataKey) async -> String? {
                guard let item = metadata.first(where: { $0.commonKey == key }) else { return nil }
                return try? await item.load(.stringValue)
            }
            let title = await string(.commonKeyTitle) ?? source.deletingPathExtension().lastPathComponent
            let artist = await string(.commonKeyArtist) ?? ""
            let album = await string(.commonKeyAlbumName) ?? ""
            var song: [String: Any] = ["id": id, "name": String(title.prefix(512)),
                "artists": [["id": "", "name": String(artist.prefix(256))]], "album": ["id": "", "name": String(album.prefix(512))],
                "durationMs": duration * 1000, "sourceRef": ["kind": "local", "mediaId": id]]
            if let art = metadata.first(where: { $0.commonKey == .commonKeyArtwork }),
               let data = try? await art.load(.dataValue), data.count <= 20_000_000,
               let image = UIImage(data: data), image.size.width > 0, image.size.height > 0 {
                let scale = min(1, 512 / max(image.size.width, image.size.height))
                let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
                let format = UIGraphicsImageRendererFormat(); format.scale = 1
                let thumb = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
                if let jpeg = thumb.jpegData(compressionQuality: 0.8) { try jpeg.write(to: folder.appendingPathComponent("cover.jpg"), options: .atomic) }
            }
            let allMetadata = try await asset.load(.metadata)
            if let info = await NativeReplayGainInfo.read(allMetadata) { song["replayGain"] = info.dictionary }
            song["replayGainScanned"] = true
            if let item = allMetadata.first(where: { $0.identifier == .id3MetadataUnsynchronizedLyric }),
               let text = try? await item.load(.stringValue), text.utf8.count <= 2_000_000 {
                try Data(text.utf8).write(to: folder.appendingPathComponent("lyrics.txt"), options: .atomic)
            }
            try JSONSerialization.data(withJSONObject: ["file": target.lastPathComponent]).write(to: folder.appendingPathComponent("media.json"), options: .atomic)
            try JSONSerialization.data(withJSONObject: song).write(to: folder.appendingPathComponent("song.json"), options: .atomic)
            return song
        } catch { try? FileManager.default.removeItem(at: folder); throw error }
    }
    func importLyrics(_ source: URL, for id: String) throws -> [String: Any] {
        _ = try resolve(id)
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        guard let size = try source.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 2_000_000 else { throw MobileFailure("lyrics-too-large") }
        let data = try Data(contentsOf: source)
        guard data.count <= 2_000_000 else { throw MobileFailure("lyrics-too-large") }
        guard let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .utf16), !text.isEmpty else { throw MobileFailure("invalid-lyrics") }
        guard text.utf8.count <= 2_000_000, source.lastPathComponent.utf8.count <= 1024 else { throw MobileFailure("lyrics-too-large") }
        // Keep content and its format hint in one atomic record; a later LRC import cannot inherit a stale YRC hint.
        let record = LyricSource(content: text, fileName: source.lastPathComponent)
        try JSONEncoder().encode(record).write(to: directory(id).appendingPathComponent("lyrics.json"), options: .atomic)
        lyricEditTokens[id] = UUID().uuidString
        return try details(id)
    }
}
