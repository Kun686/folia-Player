import Foundation

// NativeMediaFiles.swift — atomic cache records; hard-linked playback leases survive clearing and LRU eviction.
final class NativeCachedMedia: @unchecked Sendable {
    let url: URL, generation: String
    init(url: URL, generation: String) { self.url = url; self.generation = generation }
    deinit { try? FileManager.default.removeItem(at: url) }
}
struct NativeMediaFiles {
    struct Record: Codable {
        let version: Int, provider: String, generation: String, fileExtension: String, bytes: Int64, song: Data
        var used: Date
    }
    let directory: URL
    private let manager = FileManager.default
    static func validKey(_ key: String) -> Bool { key.count == 64 && key.allSatisfy { "0123456789abcdef".contains($0) } }
    func path(_ key: String, _ record: Record) -> URL { directory.appendingPathComponent(key + "." + record.generation + ".audio") }
    func read(_ key: String) -> Record? {
        let meta = directory.appendingPathComponent(key + ".json")
        guard Self.validKey(key), let metaValues = try? meta.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey]),
              metaValues.isRegularFile == true, metaValues.isSymbolicLink != true, (metaValues.fileSize ?? 65537) <= 65536,
              let data = try? Data(contentsOf: meta), let value = try? JSONDecoder().decode(Record.self, from: data),
              value.version == 1, ["qq", "netease", "kugou"].contains(value.provider), UUID(uuidString: value.generation) != nil,
              NativeMediaTransport.extensions.contains(value.fileExtension), value.bytes > 0, value.song.count <= 32768,
              let values = try? path(key, value).resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey]),
              values.isRegularFile == true, values.isSymbolicLink != true, Int64(values.fileSize ?? 0) == value.bytes else { return nil }
        return value
    }
    func records() -> [(String, Record)] {
        (try? manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil))?.compactMap { url in
            guard url.pathExtension == "json" else { return nil }
            let key = url.deletingPathExtension().lastPathComponent
            return read(key).map { (key, $0) }
        } ?? []
    }
    func lease(_ key: String, touch: Bool) throws -> NativeCachedMedia? {
        guard var record = read(key) else { return nil }
        let url = manager.temporaryDirectory.appendingPathComponent("FoliaPlayback-" + UUID().uuidString).appendingPathExtension(record.fileExtension)
        try manager.linkItem(at: path(key, record), to: url)
        if touch { record.used = Date(); try? write(key, record) }
        return NativeCachedMedia(url: url, generation: record.generation)
    }
    private func write(_ key: String, _ record: Record) throws {
        try JSONEncoder().encode(record).write(to: directory.appendingPathComponent(key + ".json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func save(_ key: String, download: DownloadedMedia, provider: String, song: Data) throws {
        guard Self.validKey(key), ["qq", "netease", "kugou"].contains(provider),
              NativeMediaTransport.extensions.contains(download.fileExtension), download.bytes > 0, song.count <= 32768 else { throw MobileFailure("invalid-cache-identity") }
        let old = read(key)
        let record = Record(version: 1, provider: provider, generation: UUID().uuidString,
                            fileExtension: download.fileExtension, bytes: download.bytes, song: song, used: Date())
        try manager.createDirectory(at: directory, withIntermediateDirectories: true,
                                    attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        let destination = path(key, record)
        try manager.moveItem(at: download.url, to: destination)
        do { try write(key, record) }
        catch { try? manager.removeItem(at: destination); throw error }
        if let old { try? manager.removeItem(at: path(key, old)) }
    }
    func remove(_ key: String) throws {
        guard Self.validKey(key) else { throw MobileFailure("invalid-cache-identity") }
        if let record = read(key) { try manager.removeItem(at: path(key, record)) }
        let meta = directory.appendingPathComponent(key + ".json")
        if manager.fileExists(atPath: meta.path) { try manager.removeItem(at: meta) }
    }
    func prune(limit: Double) throws {
        let records = records().sorted { $0.1.used < $1.1.used }
        var total = records.reduce(0.0) { $0 + Double($1.1.bytes) }
        for (key, value) in records where total > limit { try remove(key); total -= Double(value.bytes) }
        // A crash before atomic metadata publication may leave an unreferenced file. Only our own names qualify.
        let retained = Set(self.records().map { path($0.0, $0.1).lastPathComponent })
        for url in (try? manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? [] {
            let name = url.lastPathComponent, parts = name.split(separator: ".")
            if parts.count == 2, Self.validKey(String(parts[0])), parts[1] == "json", read(String(parts[0])) == nil { try manager.removeItem(at: url) }
            if parts.count == 3, Self.validKey(String(parts[0])), UUID(uuidString: String(parts[1])) != nil,
               parts[2] == "audio", !retained.contains(name) { try manager.removeItem(at: url) }
        }
    }
}
