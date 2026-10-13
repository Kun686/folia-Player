import Foundation

// LocalFolderStoreIO.swift — all paths are derived from validated native identities, never bridge-supplied paths.
extension LocalFolderStore {
    func requireDirectory(_ url: URL) throws {
        let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard values.isDirectory == true, values.isSymbolicLink != true else { throw MobileFailure("invalid-folder-storage") }
    }
    func createDirectory(_ url: URL) throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        try requireDirectory(url)
    }
    func read(_ url: URL, limit: Int) throws -> Data {
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true, let size = values.fileSize, size <= limit
        else { throw MobileFailure("invalid-folder-storage") }
        let data = try Data(contentsOf: url)
        guard data.count <= limit else { throw MobileFailure("folder-too-large") }
        return data
    }
    func validateTransaction(_ url: URL) throws {
        guard url.standardizedFileURL.deletingLastPathComponent() == staging.standardizedFileURL,
              UUID(uuidString: url.lastPathComponent) != nil else { throw MobileFailure("invalid-folder-transaction") }
        try requireDirectory(staging)
    }
    func validateMedia(_ directory: URL, id: String, rootID: String, path: String) throws {
        try requireDirectory(directory)
        guard let song = try JSONSerialization.jsonObject(with: read(directory.appendingPathComponent("song.json"), limit: 131_072)) as? [String: Any],
              song["id"] as? String == id, let ref = song["sourceRef"] as? [String: String], ref["kind"] == "local", ref["mediaId"] == id,
              song["folderRootID"] as? String == rootID, song["folderRelativePath"] as? String == path,
              let title = song["name"] as? String, title.utf8.count <= 4096,
              let artists = song["artists"] as? [[String: Any]], artists.count <= 128,
              artists.allSatisfy({ (($0["name"] as? String)?.utf8.count ?? Int.max) <= 4096 }),
              let album = song["album"] as? [String: Any], let albumName = album["name"] as? String, albumName.utf8.count <= 4096,
              let duration = song["durationMs"] as? Double, duration.isFinite, duration > 0,
              let media = try JSONSerialization.jsonObject(with: read(directory.appendingPathComponent("media.json"), limit: 1024)) as? [String: String],
              let name = media["file"], name.range(of: "^audio\\.[a-z0-9]{1,8}$", options: .regularExpression) != nil
        else { throw MobileFailure("invalid-folder-media") }
        let audio = try directory.appendingPathComponent(name).resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard audio.isRegularFile == true, audio.isSymbolicLink != true, let size = audio.fileSize, size > 0 else { throw MobileFailure("invalid-folder-media") }
        if let original = media["original"] {
            guard original == "audio.ogg", name == "audio.caf" else { throw MobileFailure("invalid-folder-media") }
            let source = try directory.appendingPathComponent(original).resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
            guard source.isRegularFile == true, source.isSymbolicLink != true, (source.fileSize ?? 0) > 0 else { throw MobileFailure("invalid-folder-media") }
        }
        let lyrics = try JSONDecoder().decode(LocalMediaLibrary.LyricSource.self,
            from: read(directory.appendingPathComponent("lyrics.json"), limit: 37_000_000)).validated()
        if let text = lyrics.matchJSON {
            guard try JSONSerialization.jsonObject(with: Data(text.utf8)) is [String: Any] else { throw MobileFailure("invalid-local-match") }
        }
        if let text = lyrics.libraryMetadataJSON {
            guard let input = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any], input["songId"] as? String == id
            else { throw MobileFailure("invalid-local-library") }
        }
    }
}
