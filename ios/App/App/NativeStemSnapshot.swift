import Foundation
import CryptoKit
import Darwin

// NativeStemSnapshot.swift — stable local bytes and a complete digest, never a URL or analysis prefix identity.
final class NativeStemSnapshot {
    let url: URL, digest: String, bytes: Int64
    private let directory: URL
    private init(url: URL, directory: URL, digest: String, bytes: Int64) {
        self.url = url; self.directory = directory; self.digest = digest; self.bytes = bytes
    }
    deinit { try? FileManager.default.removeItem(at: directory) }

    // Copying through one descriptor keeps a concurrent path replacement from mixing two representations.
    // Progress is control-side only; cancellation and source validation still run after the final callback.
    static func capture(_ source: URL, deadline: Double, progress: ((Int64) throws -> Void)? = nil) throws -> NativeStemSnapshot {
        try copy(source, deadline: deadline, checkChangeTime: true, progress: progress)
    }
    static func capture(cached: NativeCachedMedia, deadline: Double, progress: ((Int64) throws -> Void)? = nil) throws -> NativeStemSnapshot {
        // Cache generations are immutable. Other leases or eviction may change link count/ctime while
        // these same bytes remain valid; retain our lease and still check inode, size and modification time.
        try withExtendedLifetime(cached) { try copy(cached.url, deadline: deadline, checkChangeTime: false, progress: progress) }
    }
    private static func copy(_ source: URL, deadline: Double, checkChangeTime: Bool,
                             progress: ((Int64) throws -> Void)?) throws -> NativeStemSnapshot {
        guard source.isFileURL else { throw MobileFailure("stem-source-unavailable") }
        func check() throws {
            try Task.checkCancellation()
            guard ProcessInfo.processInfo.systemUptime <= deadline else { throw MobileFailure("stem-timeout") }
        }
        try check()
        let descriptor = open(source.path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK)
        guard descriptor >= 0 else { throw MobileFailure("stem-source-unavailable") }
        let input = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? input.close() }
        var before = stat()
        guard fstat(descriptor, &before) == 0, (before.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG), before.st_size > 0 else {
            throw MobileFailure("stem-source-unavailable")
        }
        let manager = FileManager.default
        let directory = manager.temporaryDirectory.appendingPathComponent("FoliaStem-" + UUID().uuidString, isDirectory: true)
        try manager.createDirectory(at: directory, withIntermediateDirectories: false,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var complete = false
        defer { if !complete { try? manager.removeItem(at: directory) } }
        let ext = NativeMediaTransport.extensions.contains(source.pathExtension.lowercased()) ? source.pathExtension.lowercased() : "audio"
        let url = directory.appendingPathComponent("media").appendingPathExtension(ext)
        guard manager.createFile(atPath: url.path, contents: nil,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]) else { throw MobileFailure("stem-snapshot-failed") }
        let output = try FileHandle(forWritingTo: url)
        defer { try? output.close() }
        var hash = SHA256(), copied: Int64 = 0
        while true {
            try check()
            let data = try input.read(upToCount: 1_048_576) ?? Data()
            if data.isEmpty { break }
            guard Int64(data.count) <= before.st_size - copied else { throw MobileFailure("stem-source-changed") }
            try output.write(contentsOf: data)
            hash.update(data: data); copied += Int64(data.count)
            try progress?(copied)
        }
        try check()
        var after = stat(), current = stat()
        guard copied == before.st_size, fstat(descriptor, &after) == 0, lstat(source.path, &current) == 0,
              unchanged(before, after, checkChangeTime), unchanged(before, current, checkChangeTime) else { throw MobileFailure("stem-source-changed") }
        try output.close()
        try manager.setAttributes([.posixPermissions: 0o400], ofItemAtPath: url.path)
        let digest = hash.finalize().map { String(format: "%02x", $0) }.joined()
        complete = true
        return NativeStemSnapshot(url: url, directory: directory, digest: digest, bytes: copied)
    }

    private static func unchanged(_ a: stat, _ b: stat, _ checkChangeTime: Bool) -> Bool {
        a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_size == b.st_size && a.st_mode == b.st_mode
            && a.st_mtimespec.tv_sec == b.st_mtimespec.tv_sec && a.st_mtimespec.tv_nsec == b.st_mtimespec.tv_nsec
            && (!checkChangeTime || (a.st_ctimespec.tv_sec == b.st_ctimespec.tv_sec && a.st_ctimespec.tv_nsec == b.st_ctimespec.tv_nsec))
    }
}
