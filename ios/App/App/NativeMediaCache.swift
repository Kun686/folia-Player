import Foundation

// NativeMediaCache.swift — original opt-in/5GB/LRU policy, with shared serial downloads and account-scoped cancellation.
struct NativeMediaCacheSettings: Codable {
    var enabled = false
    var limitGB = 5.0
    var maximumBytes: Double { limitGB == 0 ? .greatestFiniteMagnitude : limitGB * 1024 * 1024 * 1024 }
    func validate() throws {
        guard limitGB.isFinite, limitGB >= 0, maximumBytes.isFinite else { throw MobileFailure("invalid-cache-settings") }
    }
    var dictionary: [String: Any] { ["enabled": enabled, "limitGB": limitGB] }
}
actor NativeMediaCache {
    private struct Job { let stamp: UUID, provider: String, task: Task<Void, Error> }
    private let files: NativeMediaFiles, configuration: URLSessionConfiguration
    private var jobs: [String: Job] = [:]
    private var tail: Task<Void, Error>?
    private var revision = 0
    private var error: String?
    private var changed: (@MainActor @Sendable (String?) -> Void)?
    private(set) var settings: NativeMediaCacheSettings
    init(directory: URL? = nil, configuration: URLSessionConfiguration = .ephemeral, settings: NativeMediaCacheSettings = NativeMediaCacheSettings()) {
        files = NativeMediaFiles(directory: directory ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("FoliaMedia"))
        self.configuration = configuration; self.settings = (try? settings.validate()) == nil ? NativeMediaCacheSettings() : settings
    }
    deinit { jobs.values.forEach { $0.task.cancel() } }
    static func key(_ identity: NativeProfileIdentity) -> String { NativeProfileCache.digest(Data(identity.key.utf8)) }
    func onChange(_ callback: @escaping @MainActor @Sendable (String?) -> Void) { changed = callback }
    private func notify(_ identity: String? = nil) {
        revision += 1
        if let changed { Task { @MainActor in changed(identity) } }
    }
    func summary() -> [String: Any] {
        let records = files.records()
        return ["settings": settings.dictionary, "count": records.count, "bytes": records.reduce(0.0) { $0 + Double($1.1.bytes) },
                "pending": jobs.count, "revision": revision, "songs": catalog(), "error": error as Any? ?? NSNull()]
    }
    func catalog() -> [[String: Any]] { files.records().sorted { $0.1.used > $1.1.used }.compactMap { (try? JSONSerialization.jsonObject(with: $0.1.song)) as? [String: Any] } }
    func cached(_ identity: NativeProfileIdentity, touch: Bool = false) throws -> NativeCachedMedia? {
        guard identity.provider != nil else { return nil }
        return try files.lease(Self.key(identity), touch: touch)
    }
    func configure(_ next: NativeMediaCacheSettings) throws {
        try next.validate()
        jobs.values.forEach { $0.task.cancel() }; jobs.removeAll(); tail = nil
        try files.prune(limit: next.maximumBytes)
        settings = next; error = nil; notify()
    }
    func clear(provider: String? = nil) throws {
        for (key, job) in jobs where provider == nil || job.provider == provider { job.task.cancel(); jobs.removeValue(forKey: key) }
        if provider == nil { tail = nil }
        for (key, record) in files.records() where provider == nil || record.provider == provider { try files.remove(key) }
        try files.prune(limit: settings.maximumBytes)
        error = nil; notify()
    }
    func remove(_ identity: NativeProfileIdentity) throws {
        let key = Self.key(identity); jobs.removeValue(forKey: key)?.task.cancel()
        try files.remove(key); notify()
    }
    // Sharing a job does not transfer ownership to one caller: cancelling an analysis must not cancel an EOF cache write.
    func store(_ identity: NativeProfileIdentity, song: [String: Any], source: URL) async throws -> NativeCachedMedia? {
        if let hit = try cached(identity) { return hit }
        guard settings.enabled, let provider = identity.provider else { return nil }
        _ = try NativeMediaTransport.request(source)
        let key = Self.key(identity)
        if let job = jobs[key] { try await job.task.value; return try cached(identity) }
        var clean = try PlaybackEngine.sanitizedSong(song)
        guard NativeProfileIdentity(clean)?.key == identity.key else { throw MobileFailure("invalid-cache-identity") }
        if var album = clean["album"] as? [String: Any] { album.removeValue(forKey: "coverUrl"); clean["album"] = album }
        let data = try JSONSerialization.data(withJSONObject: clean, options: .sortedKeys)
        guard data.count <= 32768 else { throw MobileFailure("invalid-cache-identity") }
        let stamp = UUID(), previous = tail, maximum = settings.maximumBytes, configuration = configuration
        let task = Task<Void, Error> { [weak self] in
            _ = try? await previous?.value
            try Task.checkCancellation()
            let file = try await NativeMediaDownload(configuration: configuration, maximumBytes: maximum).read(source)
            defer { try? FileManager.default.removeItem(at: file.url) }
            try Task.checkCancellation()
            try await self?.commit(key, stamp: stamp, download: file, provider: provider, song: data, identity: identity.key)
        }
        jobs[key] = Job(stamp: stamp, provider: provider, task: task); tail = task; notify()
        do { try await task.value }
        catch {
            if jobs[key]?.stamp == stamp { jobs.removeValue(forKey: key); if jobs.isEmpty { tail = nil }; self.error = (error as? MobileFailure)?.code ?? "cache-write-failed"; notify() }
            throw error
        }
        return try cached(identity)
    }
    private func commit(_ key: String, stamp: UUID, download: DownloadedMedia, provider: String, song: Data, identity: String) throws {
        guard jobs[key]?.stamp == stamp, settings.enabled else { throw CancellationError() }
        guard Double(download.bytes) <= settings.maximumBytes else { throw MobileFailure("cache-limit") }
        try files.save(key, download: download, provider: provider, song: song)
        try files.prune(limit: settings.maximumBytes)
        jobs.removeValue(forKey: key); if jobs.isEmpty { tail = nil }; error = nil; notify(identity)
    }
}
