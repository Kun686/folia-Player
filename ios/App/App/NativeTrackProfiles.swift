import Foundation

// NativeTrackProfiles.swift — current/next representations; expiring source URLs remain in memory, never cache identity.
final class NativeTrackProfiles {
    private struct Value { let fields: [String: Any]? }
    private let local: LocalMediaLibrary
    private let profiler: NativeTrackProfiler
    private let mediaCache: NativeMediaCache?
    private var upgrades: Set<String> = []
    private let configuration: URLSessionConfiguration
    private var wanted: [String: String] = [:]
    private var purges: [String: Task<Void, Never>] = [:]
    private var tasks: [String: (UUID, Task<Void, Never>)] = [:]
    private var values: [String: Value] = [:]
    private var order: [String] = []
    private var beatModel: URL?
    private(set) var revision = 0
    var changed: (() -> Void)?
    init(local: LocalMediaLibrary, profiler: NativeTrackProfiler = NativeTrackProfiler(), configuration: URLSessionConfiguration = .ephemeral, mediaCache: NativeMediaCache? = nil) {
        self.local = local; self.profiler = profiler; self.configuration = configuration; self.mediaCache = mediaCache
    }
    deinit { tasks.values.forEach { $0.1.cancel() } }
    func value(_ song: [String: Any]) -> [String: Any]? { NativeProfileIdentity(song).flatMap { values[$0.key]?.fields } }
    func cancel() { wanted.removeAll(); tasks.values.forEach { $0.1.cancel() }; tasks.removeAll() }
    // A model change is a different analysis capability, even for the same song and signed media URL.
    @discardableResult func useBeatModel(_ model: URL?) -> Bool {
        guard beatModel != model else { return false }
        cancel(); beatModel = model; values.removeAll(); order.removeAll(); upgrades.removeAll(); revision += 1
        return true
    }
    func invalidateProvider(_ provider: String) {
        let prefix = "online:" + provider + ":"
        for key in Array(tasks.keys) where key.hasPrefix(prefix) { tasks.removeValue(forKey: key)?.1.cancel() }
        values = values.filter { !$0.key.hasPrefix(prefix) }; wanted = wanted.filter { !$0.key.hasPrefix(prefix) }
        upgrades = upgrades.filter { !$0.hasPrefix(prefix) }
        order.removeAll { $0.hasPrefix(prefix) }; revision += 1
        let previous = purges[provider]
        // Account replacement cannot read the old disk record while logout cleanup is still queued.
        purges[provider] = Task { [profiler] in await previous?.value; await profiler.invalidateProvider(provider) }
    }
    func mediaAvailable(_ key: String) {
        guard wanted[key] != nil || values[key] != nil else { return }
        if let fields = values[key]?.fields, fields["partial"] as? Bool != true { return }
        upgrades.insert(key)
        if values[key]?.fields?["partial"] as? Bool == true { values.removeValue(forKey: key); revision += 1 }
    }
    func resetOnline() {
        for key in Array(tasks.keys) where key.hasPrefix("online:") { tasks.removeValue(forKey: key)?.1.cancel() }
        values = values.filter { !$0.key.hasPrefix("online:") || $0.value.fields?["partial"] as? Bool != true }
        wanted = wanted.filter { !$0.key.hasPrefix("online:") }; revision += 1
    }
    func update(_ songs: [[String: Any]], sources: [String: URL] = [:]) {
        let ordered = songs.compactMap(NativeProfileIdentity.init).filter {
            $0.localID != nil || mediaCache != nil || sources[$0.key].flatMap { try? NativeProfilePrefix.request($0) } != nil
        }
        var next: [String: String] = [:]
        for identity in ordered { next[identity.key] = sources[identity.key]?.absoluteString ?? identity.key }
        guard next != wanted || ordered.contains(where: { upgrades.contains($0.key) && tasks[$0.key] == nil }) else { return }
        // Only obsolete representations are cancelled; adding a neighbour preserves current work.
        for key in Array(tasks.keys) where wanted[key] != next[key] { tasks.removeValue(forKey: key)?.1.cancel() }
        wanted = next
        for identity in ordered where tasks[identity.key] == nil && values[identity.key] == nil {
            upgrades.remove(identity.key)
            let key = identity.key, source = sources[identity.key], purge = identity.provider.flatMap { purges[$0] }, model = beatModel
            guard let song = songs.first(where: { NativeProfileIdentity($0)?.key == key }) else { continue }
            let stamp = UUID()
            let task = Task(priority: .utility) { @MainActor [weak self, profiler, local, configuration, mediaCache] in
                do {
                    await purge?.value
                    try Task.checkCancellation()
                    let data: Data?
                    if let id = identity.localID { data = try await profiler.profile(file: local.resolve(id), beatModel: model) }
                    else {
                        var complete = try await mediaCache?.cached(identity)
                        if complete == nil, let source, !source.isFileURL {
                            complete = try await mediaCache?.store(identity, song: song, source: source)
                        }
                        try Task.checkCancellation()
                        if let complete { data = try await profiler.profile(cached: complete, identity: identity, beatModel: model) }
                        else if let source, !source.isFileURL { data = try await profiler.profile(remote: source, identity: identity, configuration: configuration, beatModel: model) }
                        else { return }
                    }
                    guard let self, !Task.isCancelled, self.wanted[key] != nil, self.tasks[key]?.0 == stamp else { return }
                    let fields = data.flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] }
                    let needsUpgrade = self.upgrades.remove(key) != nil && fields?["partial"] as? Bool == true
                    if !needsUpgrade { self.values[key] = Value(fields: fields) } else { self.upgrades.insert(key) }
                    self.order.removeAll { $0 == key }; self.order.append(key)
                    while self.order.count > 200 { self.values.removeValue(forKey: self.order.removeFirst()) }
                    self.tasks.removeValue(forKey: key); self.revision += 1; self.changed?()
                } catch {
                    // No permanent failed profile: an unavailable source may become readable later.
                    if let self, self.tasks[key]?.0 == stamp { self.tasks.removeValue(forKey: key) }
                }
            }
            tasks[key] = (stamp, task)
        }
    }
}
