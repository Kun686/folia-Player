import Foundation
import ImageIO
import UIKit

// NativeCoverCache.swift — one credential-free, bounded cover store for the WebView and lock screen.
actor NativeCoverCache {
    private struct Job { let token: UUID; let provider: String; let task: Task<Data, Error> }
    private let root: URL
    private let configuration: URLSessionConfiguration
    private let limit: Int
    private var jobs: [String: Job] = [:]
    private var generations: [String: Int] = [:]
    init(root: URL? = nil, configuration: URLSessionConfiguration = .ephemeral, limit: Int = 64 * 1024 * 1024) {
        self.root = root ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("FoliaCovers", isDirectory: true)
        self.configuration = configuration.copy() as! URLSessionConfiguration
        self.limit = max(0, limit)
    }
    deinit { jobs.values.forEach { $0.task.cancel() } }

    // NativeProfileIdentity includes provider and source variant, never an expiring URL.
    private func path(_ identity: NativeProfileIdentity) -> URL {
        root.appendingPathComponent(identity.provider!).appendingPathComponent(
            NativeProfileCache.digest(Data(("cover-v2|" + identity.key).utf8)) + ".jpg")
    }
    private func cached(_ url: URL) -> Data? {
        guard let values = try? url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey]),
              values.isRegularFile == true, values.isSymbolicLink != true,
              let count = values.fileSize, count > 0, count <= 2_000_000,
              let data = try? Data(contentsOf: url), (try? Self.thumbnail(data)) != nil else { return nil }
        try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
        return data
    }
    func cover(_ song: [String: Any], local: LocalMediaLibrary, allowNetwork: Bool = true) async throws -> Data? {
        try Task.checkCancellation()
        guard let identity = NativeProfileIdentity(song) else { throw MobileFailure("invalid-cover-identity") }
        if let id = identity.localID {
            if let matched = try await local.onlineCoverSong(id),
               let data = try? await cover(matched, local: local, allowNetwork: allowNetwork) { return data }
            try Task.checkCancellation()
            return try await local.cover(id)
        }
        // This path accepts public provider artwork URLs only, never Subsonic credentials from JS.
        guard identity.provider != "navidrome" else { return nil }
        let destination = path(identity)
        if let data = cached(destination) { return data }
        guard allowNetwork else { return nil }
        guard let raw = (song["album"] as? [String: Any])?["coverUrl"] as? String, raw.count <= 4096,
              let url = URL(string: raw) else { return nil }
        _ = try NativeMediaTransport.request(url)
        let key = identity.key, provider = identity.provider!, epoch = generations[identity.provider!, default: 0]
        let job: Job
        if let existing = jobs[key] { job = existing }
        else {
            guard jobs.count < 4 else { throw MobileFailure("cover-busy") }
            let task = Task { [configuration] in
                let download = try await NativeMediaDownload(configuration: configuration, maximumBytes: 8_000_000,
                                                              resourceTimeout: 30).read(url)
                defer { try? FileManager.default.removeItem(at: download.url) }
                try Task.checkCancellation()
                return try Self.thumbnail(Data(contentsOf: download.url))
            }
            job = Job(token: UUID(), provider: identity.provider!, task: task); jobs[key] = job
        }
        defer { if jobs[key]?.token == job.token { jobs.removeValue(forKey: key) } }
        let data = try await job.task.value
        // Clear/logout invalidates the shared job, even if a completed network reply is already queued.
        guard generations[provider, default: 0] == epoch else { throw CancellationError() }
        try Task.checkCancellation()
        // Optional persistence must not hide an otherwise valid image when storage is full.
        // Each live waiter may publish identical bytes, so one cancelled consumer cannot prevent caching.
        try? FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        try? data.write(to: destination, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        try? prune()
        return data
    }
    static func thumbnail(_ data: Data) throws -> Data {
        guard !data.isEmpty, data.count <= 8_000_000,
              let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Double,
              let height = properties[kCGImagePropertyPixelHeight] as? Double,
              width > 0, height > 0, width <= 16384, height <= 16384, width * height <= 40_000_000,
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 1024, kCGImageSourceShouldCacheImmediately: true] as CFDictionary),
              let jpeg = UIImage(cgImage: image).jpegData(compressionQuality: 0.85), jpeg.count <= 2_000_000 else {
            throw MobileFailure("invalid-cover")
        }
        return jpeg
    }
    private var files: NativeResourceFiles { NativeResourceFiles(root: root, fileExtension: "jpg") }
    private func prune() throws { try files.prune(limit: limit) }
    func summary() -> [String: Int] { files.summary() }
    func clear(provider: String? = nil) throws {
        guard provider == nil || ["qq", "netease", "kugou"].contains(provider!) else { throw MobileFailure("invalid-provider") }
        for provider in provider.map({ [$0] }) ?? ["qq", "netease", "kugou"] { generations[provider, default: 0] += 1 }
        for (key, job) in jobs where provider == nil || job.provider == provider { job.task.cancel(); jobs.removeValue(forKey: key) }
        try files.clear(provider: provider)
    }
}
