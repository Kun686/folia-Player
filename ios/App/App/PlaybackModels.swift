import Foundation

// PlaybackModels.swift — one model store per player; native queue capability survives WebView suspension.
@MainActor final class PlaybackModels {
    private let store: NativeModelStore
    private weak var engine: PlaybackEngine?
    private var startup: Task<Void, Never>?
    private var latest: NativeModelStore.Snapshot?
    private var suspended: Set<NativeModelManifest.Name> = []
    private var removing = false
    private var revision = 0
    private(set) var ready = false
    var changed: (() -> Void)?
    init(engine: PlaybackEngine, store: NativeModelStore? = nil) throws {
        self.engine = engine; self.store = try store ?? NativeModelStore()
    }
    func start() {
        guard startup == nil else { return }
        startup = Task { [weak self, store] in
            await store.onChange { [weak self] in Task { await self?.refresh() } }
            await store.restore()
            guard let self, !Task.isCancelled else { return }
            await self.refresh(markReady: true)
        }
    }
    deinit { startup?.cancel() }
    func refresh(markReady: Bool = false) async {
        let next = await store.snapshot()
        guard next.revision >= (latest?.revision ?? -1) else { return }
        if markReady { ready = true }
        latest = next; apply(); publish()
    }
    private func publish() { revision += 1; changed?() }
    private func apply() {
        let beat = ready && !suspended.contains(.beatThis) ? latest?.paths[.beatThis] : nil
        let stems = ready && !suspended.contains(.htdemucs) ? latest?.paths[.htdemucs] : nil
        engine?.crossfade?.modelsChanged(beat: beat, stems: stems)
    }
    func snapshot() -> [String: Any] {
        let models = latest?.models.map { value -> [String: Any] in
            ["name": value.entry.name.rawValue, "bytes": value.entry.bytes, "enables": value.entry.enables,
             "installed": value.installed, "phase": value.phase, "received": value.received,
             "host": value.host, "failures": value.failures]
        } ?? []
        return ["ready": ready, "revision": revision, "models": models,
                "analysisAvailable": ready && engine?.usesStereoOutput == true,
                // Stem playback is under independent QA; storing weights does not clear device acceptance.
                "capabilities": ["beatGrid": ready && !suspended.contains(.beatThis) && latest?.paths[.beatThis] != nil,
                                 "stems": false, "full": false, "desktop": false]]
    }
    func download(_ name: NativeModelManifest.Name) async throws {
        guard ready, !removing else { throw MobileFailure("model-busy") }
        do { try await store.download(name); await refresh() }
        catch { await refresh(); throw error }
    }
    func cancel(_ name: NativeModelManifest.Name) async { await store.cancel(name); await refresh() }
    func removeAll() async throws {
        guard ready, !removing else { throw MobileFailure("model-busy") }
        removing = true
        suspended = Set(NativeModelManifest.Name.allCases); apply(); publish()
        defer { removing = false; suspended.removeAll(); apply(); publish() }
        var failed = false
        for name in NativeModelManifest.Name.allCases {
            do { try await store.remove(name) } catch { failed = true }
        }
        await refresh()
        if failed { throw MobileFailure("model-remove-failed") }
    }
    // Match by size then verify the original hash, so renamed downloads can be imported too.
    func install(_ source: URL) async throws {
        guard ready, !removing else { throw MobileFailure("model-busy") }
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        guard source.isFileURL,
              let bytes = try FileManager.default.attributesOfItem(atPath: source.path)[.size] as? NSNumber,
              let entry = try NativeModelManifest().entries.first(where: { $0.bytes == bytes.int64Value }) else {
            throw MobileFailure("model-hash-mismatch")
        }
        do { try await store.install(entry.name, from: source); await refresh() }
        catch { await refresh(); throw error }
    }
}
