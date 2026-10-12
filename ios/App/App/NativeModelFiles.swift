import Foundation

// NativeModelFiles.swift — private, excluded-from-backup weights; only a verified snapshot can be published.
struct NativeModelFiles: Sendable {
    let directory: URL
    init(directory: URL? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("FoliaModels", isDirectory: true)
    }
    func url(_ entry: NativeModelManifest.Entry) -> URL { directory.appendingPathComponent(entry.sha256 + ".onnx") }
    func exists(_ entry: NativeModelManifest.Entry) -> Bool { FileManager.default.fileExists(atPath: url(entry).path) }
    func remove(_ entry: NativeModelManifest.Entry) throws {
        if exists(entry) { try FileManager.default.removeItem(at: url(entry)) }
    }
    static func verify(_ source: URL, entry: NativeModelManifest.Entry) throws -> NativeStemSnapshot {
        guard source.isFileURL else { throw MobileFailure("model-file-unavailable") }
        let attributes = try FileManager.default.attributesOfItem(atPath: source.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular,
              (attributes[.size] as? NSNumber)?.int64Value == entry.bytes else { throw MobileFailure("model-hash-mismatch") }
        let snapshot = try NativeStemSnapshot.capture(source, deadline: ProcessInfo.processInfo.systemUptime + 60) { bytes in
            guard bytes <= entry.bytes else { throw MobileFailure("model-hash-mismatch") }
        }
        guard snapshot.bytes == entry.bytes, snapshot.digest == entry.sha256 else { throw MobileFailure("model-hash-mismatch") }
        return snapshot
    }
    func commit(_ snapshot: NativeStemSnapshot, entry: NativeModelManifest.Entry) throws {
        guard snapshot.bytes == entry.bytes, snapshot.digest == entry.sha256 else { throw MobileFailure("model-hash-mismatch") }
        var root = directory
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try root.setResourceValues(values)
        // rename() atomically replaces the previous generation on the same app data volume. Never unlink first.
        guard rename(snapshot.url.path, url(entry).path) == 0 else { throw MobileFailure("model-install-failed") }
    }
}
