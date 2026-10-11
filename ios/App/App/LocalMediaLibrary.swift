import AVFoundation
import UIKit

// LocalMediaLibrary.swift — imported bytes belong to the app; queue identities never contain paths.
actor LocalMediaLibrary {
    struct LyricSource: Codable {
        var content: String
        var fileName: String?
        var embeddedContent: String? = nil
        var embeddedTranslation: String? = nil
        var embeddedScanned: Bool? = nil
        var embeddedScanVersion: Int? = nil
        var lyricsSource: String? = nil
        var contentIsEmbedded: Bool? = nil
        var matchJSON: String? = nil
        var libraryMetadataJSON: String? = nil
        var translationContent: String? = nil
        var contentOrigin: String? = nil
        var translationOrigin: String? = nil
    }
    let root: URL
    let folderStore: LocalFolderStore
    var folderTransaction: LocalFolderTransaction?
    var mediaEpoch = UUID()
    lazy var libraryStore = NativeLibraryStore(root: root)
    lazy var folderScanner = LocalFolderScanner()
    var lyricEditTokens: [String: String] = [:]
    let lyricImportParser = NativeLyricParser()
    init(root: URL? = nil) {
        self.root = root ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("FoliaMedia", isDirectory: true)
        folderStore = LocalFolderStore(root: self.root)
        // Failed recovery retains files; catalog reads still surface an invalid index instead of resetting it.
        try? folderStore.recoverBeforePlayback()
    }
    static func validID(_ id: String) -> Bool { UUID(uuidString: id) != nil }
    func directory(_ id: String) throws -> URL {
        guard Self.validID(id) else { throw MobileFailure("invalid-local-identity") }
        let legacy = root.appendingPathComponent(id, isDirectory: true)
        if FileManager.default.fileExists(atPath: legacy.path) {
            try folderStore.requireDirectory(legacy)
            return legacy
        }
        if let track = try folderStore.snapshot().tracks[id] { return try folderStore.location(track) }
        return legacy
    }
    func catalog(requireComplete: Bool = false) throws -> [[String: Any]] {
        do { return try librarySnapshot()["songs"] as? [[String: Any]] ?? [] }
        catch {
            if requireComplete { throw error }
            // Damaged or in-flight imports must not rewrite relationships or prevent access to playable files.
            return try rawCatalog(requireComplete: false)
        }
    }
    func rawCatalog(requireComplete: Bool) throws -> [[String: Any]] {
        if !requireComplete && !FileManager.default.fileExists(atPath: root.path) { return [] }
        let directories: [URL]
        do { directories = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) }
        catch let error as CocoaError where error.code == .fileReadNoSuchFile || error.code == .fileNoSuchFile { return [] }
        var locations = directories.filter { Self.validID($0.lastPathComponent) }.map { (id: $0.lastPathComponent, url: $0) }
        do {
            for track in try folderStore.snapshot(refresh: true).tracks.values {
                do { locations.append((id: track.id, url: try folderStore.location(track))) }
                catch { if requireComplete { throw error } }
            }
        } catch { if requireComplete { throw error } }
        // Playlist repair must never interpret unreadable metadata as a deleted song.
        return try locations
            .compactMap { location throws -> [String: Any]? in
                let (id, url) = location
                guard let data = try? Data(contentsOf: url.appendingPathComponent("song.json")),
                      let base = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                    if requireComplete { throw MobileFailure("local-library-incomplete") }
                    return nil
                }
                if requireComplete {
                    let ref = base["sourceRef"] as? [String: String]
                    guard ref?["kind"] == "local", ref?["mediaId"] == id else {
                        throw MobileFailure("local-library-incomplete")
                    }
                }
                if requireComplete { return try matchedSong(id, base: base) }
                return (try? matchedSong(id, base: base)) ?? base
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
            if (try? JSONSerialization.data(withJSONObject: song).write(to: songURL, options: .atomic)) != nil { mediaEpoch = UUID() }
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
        // JSON escaping can expand each 2MB UTF-8 payload sixfold. Legacy text keeps its original limit.
        let limit = hasDocument ? 37_000_000 : 2_000_000
        guard values.isSymbolicLink != true, let size = values.fileSize, size <= limit else { throw MobileFailure("lyrics-too-large") }
        let data = try Data(contentsOf: url)
        guard data.count <= limit else { throw MobileFailure("lyrics-too-large") }
        let source: LyricSource
        if hasDocument { source = try JSONDecoder().decode(LyricSource.self, from: data) }
        else {
            guard let text = String(data: data, encoding: .utf8) else { throw MobileFailure("invalid-lyrics") }
            source = LyricSource(content: text, fileName: nil)
        }
        return try source.validated()
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
        let folders = try folderStore.snapshot(refresh: true)
        if folders.tracks[id] != nil {
            var document = folders.document
            for index in document.roots.indices { document.roots[index].tracks.removeAll { $0.id == id } }
            _ = try folderStore.commit(document, expectedRevision: folders.revision)
        } else { try FileManager.default.removeItem(at: directory(id)) }
        lyricEditTokens.removeValue(forKey: id)
        mediaEpoch = UUID()
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
            var song: [String: Any] = ["importedFileName": String(source.lastPathComponent.prefix(1024)), "id": id, "name": String(title.prefix(512)),
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
            if let embedded = try? await Self.embeddedLyrics(allMetadata, parser: lyricImportParser, fileURL: target), let text = embedded.lyrics {
                let lyrics = LyricSource(content: text, fileName: nil, embeddedContent: text,
                    embeddedTranslation: embedded.translationLyrics, embeddedScanned: true,
                    embeddedScanVersion: Self.embeddedScanVersion, contentIsEmbedded: true)
                try JSONEncoder().encode(lyrics).write(to: folder.appendingPathComponent("lyrics.json"), options: .atomic)
            }
            try Task.checkCancellation()
            try JSONSerialization.data(withJSONObject: ["file": target.lastPathComponent]).write(to: folder.appendingPathComponent("media.json"), options: .atomic)
            try JSONSerialization.data(withJSONObject: song).write(to: folder.appendingPathComponent("song.json"), options: .atomic)
            mediaEpoch = UUID()
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
        var record = try lyricSource(id) ?? LyricSource(content: "", fileName: nil)
        record.content = text; record.fileName = source.lastPathComponent; record.lyricsSource = "local"; record.contentIsEmbedded = false
        record.contentOrigin = "upload"
        try JSONEncoder().encode(record).write(to: directory(id).appendingPathComponent("lyrics.json"), options: .atomic)
        mediaEpoch = UUID()
        lyricEditTokens[id] = UUID().uuidString
        return try details(id)
    }
}
