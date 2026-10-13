import Foundation

// NativeLyricExport.swift — bounded cache identity recovery and read-only export inventory.
enum NativeLyricExport {
    static func allowsNavidrome(_ song: [String: Any]?, scope: String) -> Bool {
        guard !scope.isEmpty, let ref = song?["sourceRef"] as? [String: Any] else { return false }
        return ref["kind"] as? String == "navidrome" && ref["scope"] as? String == scope
    }
    static func metadata(_ song: [String: Any]) throws -> [String: Any] {
        var clean = try PlaybackEngine.sanitizedSong(song)
        var album = clean["album"] as? [String: Any] ?? [:]; album.removeValue(forKey: "coverUrl")
        clean["album"] = album; clean.removeValue(forKey: "replayGain")
        return clean
    }
    static func url(_ key: String, root: URL) throws -> URL {
        let parts = key.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 2, NativeResourceFiles.providers.contains(String(parts[0])),
              NativeMediaFiles.validKey(String(parts[1])) else { throw MobileFailure("invalid-lyric-identity") }
        return root.appendingPathComponent(String(parts[0])).appendingPathComponent(String(parts[1]) + ".json")
    }
    static func record(_ file: URL) throws -> [String: Any] {
        let values = try file.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true, let size = values.fileSize, size <= 8_000_000 else {
            throw MobileFailure("invalid-lyric-cache")
        }
        let data = try Data(contentsOf: file)
        guard data.count <= 8_000_000, let raw = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              raw["version"] as? Int == 1, let identity = raw["identity"] as? String,
              identity.hasPrefix("online:" + file.deletingLastPathComponent().lastPathComponent + ":standard:"),
              NativeProfileCache.digest(Data(("lyrics-v1|" + identity).utf8)) == file.deletingPathExtension().lastPathComponent,
              raw["payload"] is [String: Any] else { throw MobileFailure("invalid-lyric-cache") }
        return raw
    }
    static func song(_ record: [String: Any]) -> [String: Any]? {
        guard let raw = record["song"] as? [String: Any], let clean = try? metadata(raw),
              NativeProfileIdentity(clean)?.key == record["identity"] as? String else { return nil }
        return clean
    }
    // Playback supplies the original identity again. Reload after the parser's await so a concurrent edit wins.
    static func recoverMetadata(_ rawSong: [String: Any], at file: URL) throws {
        var current = try record(file)
        guard song(current) == nil else { return }
        let clean = try metadata(rawSong)
        guard NativeProfileIdentity(clean)?.key == current["identity"] as? String else {
            throw MobileFailure("invalid-lyric-identity")
        }
        current["song"] = clean
        let data = try JSONSerialization.data(withJSONObject: current, options: .sortedKeys)
        guard data.count <= 8_000_000 else { throw MobileFailure("lyrics-too-large") }
        try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    static func inventory(root: URL, knownSongs: [[String: Any]]) throws -> [[String: Any]] {
        var known: [String: [String: Any]] = [:]
        for song in knownSongs {
            if let clean = try? metadata(song), let id = NativeProfileIdentity(clean), id.provider != nil { known[id.key] = clean }
        }
        var result: [[String: Any]] = []
        for provider in NativeResourceFiles.providers {
            let folder = root.appendingPathComponent(provider)
            guard FileManager.default.fileExists(atPath: folder.path) else { continue }
            // Unlike cache summary/pruning, a failed export inventory must not look like an empty cache.
            let files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
            for file in files.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) where file.pathExtension == "json" {
                try Task.checkCancellation()
                guard NativeMediaFiles.validKey(file.deletingPathExtension().lastPathComponent) else { continue }
                let raw = try record(file), key = provider + "/" + file.deletingPathExtension().lastPathComponent
                var item: [String: Any] = ["key": key]
                if let song = song(raw) ?? known[raw["identity"] as? String ?? ""] { item["song"] = song }
                result.append(item)
            }
        }
        return result
    }
}
