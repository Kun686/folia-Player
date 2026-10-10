import Foundation

// NativeTrackProfiles.swift — current/next local representations only; queue changes cancel obsolete serial analysis.
final class NativeTrackProfiles {
    private struct Value { let fields: [String: Any]? }
    private let local: LocalMediaLibrary
    private let profiler: NativeTrackProfiler
    private var wanted = Set<String>()
    private var tasks: [String: (UUID, Task<Void, Never>)] = [:]
    private var values: [String: Value] = [:]
    private var order: [String] = []
    private(set) var revision = 0
    var changed: (() -> Void)?
    init(local: LocalMediaLibrary, profiler: NativeTrackProfiler = NativeTrackProfiler()) { self.local = local; self.profiler = profiler }
    deinit { tasks.values.forEach { $0.1.cancel() } }
    private func localID(_ song: [String: Any]) -> String? {
        guard let ref = song["sourceRef"] as? [String: Any], ref["kind"] as? String == "local" else { return nil }
        return ref["mediaId"] as? String
    }
    func value(_ song: [String: Any]) -> [String: Any]? { localID(song).flatMap { values[$0]?.fields } }
    func cancel() { wanted.removeAll(); tasks.values.forEach { $0.1.cancel() }; tasks.removeAll() }
    func update(_ songs: [[String: Any]]) {
        let ordered = songs.compactMap(localID), next = Set(ordered)
        guard next != wanted else { return }
        wanted = next
        for key in Array(tasks.keys) where !next.contains(key) { tasks.removeValue(forKey: key)?.1.cancel() }
        for key in ordered where tasks[key] == nil && values[key] == nil {
            let stamp = UUID()
            let task = Task(priority: .utility) { @MainActor [weak self, profiler, local] in
                do {
                    let url = try await local.resolve(key)
                    try Task.checkCancellation()
                    let data = try await profiler.profile(file: url)
                    guard let self, !Task.isCancelled, self.wanted.contains(key), self.tasks[key]?.0 == stamp else { return }
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
