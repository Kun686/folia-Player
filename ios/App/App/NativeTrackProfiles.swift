import Foundation

// NativeTrackProfiles.swift — current/next representations; expiring source URLs remain in memory, never cache identity.
final class NativeTrackProfiles {
    private struct Value { let fields: [String: Any]? }
    private let local: LocalMediaLibrary
    private let profiler: NativeTrackProfiler
    private let configuration: URLSessionConfiguration
    private var wanted: [String: String] = [:]
    private var purges: [String: Task<Void, Never>] = [:]
    private var tasks: [String: (UUID, Task<Void, Never>)] = [:]
    private var values: [String: Value] = [:]
    private var order: [String] = []
    private(set) var revision = 0
    var changed: (() -> Void)?
    init(local: LocalMediaLibrary, profiler: NativeTrackProfiler = NativeTrackProfiler(), configuration: URLSessionConfiguration = .ephemeral) {
        self.local = local; self.profiler = profiler; self.configuration = configuration
    }
    deinit { tasks.values.forEach { $0.1.cancel() } }
    func value(_ song: [String: Any]) -> [String: Any]? { NativeProfileIdentity(song).flatMap { values[$0.key]?.fields } }
    func cancel() { wanted.removeAll(); tasks.values.forEach { $0.1.cancel() }; tasks.removeAll() }
    func invalidateProvider(_ provider: String) {
        let prefix = "online:" + provider + ":"
        for key in Array(tasks.keys) where key.hasPrefix(prefix) { tasks.removeValue(forKey: key)?.1.cancel() }
        values = values.filter { !$0.key.hasPrefix(prefix) }; wanted = wanted.filter { !$0.key.hasPrefix(prefix) }
        order.removeAll { $0.hasPrefix(prefix) }; revision += 1
        let previous = purges[provider]
        // Account replacement cannot read the old disk record while logout cleanup is still queued.
        purges[provider] = Task { [profiler] in await previous?.value; await profiler.invalidateProvider(provider) }
    }
    func update(_ songs: [[String: Any]], sources: [String: URL] = [:]) {
        let ordered = songs.compactMap(NativeProfileIdentity.init).filter {
            $0.localID != nil || sources[$0.key].flatMap { try? NativeProfilePrefix.request($0) } != nil
        }
        var next: [String: String] = [:]
        for identity in ordered { next[identity.key] = sources[identity.key]?.absoluteString ?? identity.key }
        guard next != wanted else { return }
        wanted = next
        // A refreshed URL is a new attempt, even when the song identity did not change.
        for key in Array(tasks.keys) { tasks.removeValue(forKey: key)?.1.cancel() }
        for identity in ordered where tasks[identity.key] == nil && values[identity.key] == nil {
            let key = identity.key, source = sources[identity.key], purge = identity.provider.flatMap { purges[$0] }
            let stamp = UUID()
            let task = Task(priority: .utility) { @MainActor [weak self, profiler, local, configuration] in
                do {
                    await purge?.value
                    try Task.checkCancellation()
                    let data: Data?
                    if let id = identity.localID { data = try await profiler.profile(file: local.resolve(id)) }
                    else if let source { data = try await profiler.profile(remote: source, identity: identity, configuration: configuration) }
                    else { return }
                    guard let self, !Task.isCancelled, self.wanted[key] != nil, self.tasks[key]?.0 == stamp else { return }
                    let fields = data.flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] }
                    self.values[key] = Value(fields: fields); self.order.append(key)
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
