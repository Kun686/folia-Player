import Foundation

// NativeTrackStems.swift — main-thread queue intent; one decode/inference pipeline, parked complete-cache misses.
final class NativeTrackStems {
    private struct Request {
        let identity: NativeProfileIdentity, role: NativeStemRole
        var selection: NativeStemCache.Selection { .init(identity: identity, role: role) }
    }
    private let cache: NativeStemCache, preparation: NativeStemPreparation
    private let profilesIdle: () -> Bool
    private let providerBarrier: (String) -> Task<Void, Error>?
    private var wanted: [Request] = []
    private var ready: [NativeStemCache.Selection: NativeStemWindow] = [:]
    private var attempted = Set<NativeStemCache.Selection>()
    private var failures: [NativeStemCache.Selection: String] = [:]
    private var model: URL?
    private var task: Task<Void, Never>?, barrier: Task<Void, Never>?
    private var running: NativeStemCache.Selection?
    private var stamp = UUID()
    private var pressure = false
    private(set) var revision = 0
    var changed: (() -> Void)?

    init(local: LocalMediaLibrary, mediaCache: NativeMediaCache, cache: NativeStemCache = NativeStemCache(),
         separator: any NativeStemSeparating = NativeStemInference(), profilesIdle: @escaping () -> Bool = { true },
         providerBarrier: @escaping (String) -> Task<Void, Error>? = { _ in nil }) {
        self.cache = cache; preparation = NativeStemPreparation(local: local, mediaCache: mediaCache, cache: cache, separator: separator)
        self.profilesIdle = profilesIdle; self.providerBarrier = providerBarrier
    }
    deinit { task?.cancel() }
    func value(_ song: [String: Any], role: NativeStemRole) -> NativeStemWindow? {
        NativeProfileIdentity(song).flatMap { ready[.init(identity: $0, role: role)] }
    }
    func phase(_ song: [String: Any], role: NativeStemRole) -> String {
        guard let identity = NativeProfileIdentity(song) else { return "unavailable" }
        let selection = NativeStemCache.Selection(identity: identity, role: role)
        if ready[selection] != nil { return "ready" }
        if failures[selection] != nil { return "failed" }
        if running == selection { return "preparing" }
        if pressure { return "suspended" }
        if model == nil { return "disabled" }
        if !profilesIdle() { return "waiting-profiles" }
        return attempted.contains(selection) ? "waiting-media" : "waiting"
    }
    func failure(_ song: [String: Any], role: NativeStemRole) -> String? {
        NativeProfileIdentity(song).flatMap { failures[.init(identity: $0, role: role)] }
    }
    func useModel(_ next: URL?) {
        guard next != model else { return }
        model = next; invalidate(where: { _ in true }) { await $0.clear() }
    }
    func update(outgoing: [String: Any], incoming: [String: Any]) {
        let next = [(outgoing, NativeStemRole.tail), (incoming, .head)].compactMap { song, role in
            NativeProfileIdentity(song).map { Request(identity: $0, role: role) }
        }
        let selections = next.map(\.selection)
        if selections != wanted.map(\.selection) {
            wanted = next
            ready = ready.filter { selections.contains($0.key) }
            attempted.formIntersection(selections); failures = failures.filter { selections.contains($0.key) }
            if let running, !selections.contains(running) { stamp = UUID(); task?.cancel() }
            revision += 1; synchronizeWanted()
        }
        kick()
    }
    // A seek/queue edit drops pending work, retaining the original cache's Previous/replay pair.
    func cancel() {
        wanted.removeAll(); ready.removeAll(); attempted.removeAll(); failures.removeAll()
        stamp = UUID(); task?.cancel(); revision += 1; synchronizeWanted()
    }
    func mediaAvailable(_ source: String) {
        invalidate(where: { $0.source == source }) { await $0.remove(source: source) }
    }
    func remove(provider: String) {
        wanted.removeAll { $0.identity.provider == provider }
        invalidate(where: { $0.provider == provider }) { await $0.remove(provider: provider) }
    }
    func remove(localID: String) {
        wanted.removeAll { $0.identity.localID == localID }
        invalidate(where: { $0.localID == localID }) { await $0.remove(localID: localID) }
    }
    func localMediaChanged() { invalidate(where: { $0.localID != nil }) { await $0.removeLocal() } }
    func clearOnline() { invalidate(where: { $0.provider != nil }) { await $0.removeOnline() } }
    func resourcePressure(_ active: Bool) {
        guard active != pressure else { return }
        pressure = active
        if active { invalidate(where: { _ in true }) { await $0.clear() } } else { kick() }
    }
    private func invalidate(where matches: (NativeStemCache.Selection) -> Bool,
                            operation: @escaping (NativeStemCache) async -> Void) {
        ready = ready.filter { !matches($0.key) }; attempted = attempted.filter { !matches($0) }
        failures = failures.filter { !matches($0.key) }
        if let running, matches(running) { stamp = UUID(); task?.cancel() }
        let previous = barrier, cache = cache, selections = wanted.map(\.selection)
        barrier = Task { await previous?.value; await operation(cache); await cache.setWantedSources(selections) }
        revision += 1; kick()
    }
    private func synchronizeWanted() {
        let previous = barrier, cache = cache, selections = wanted.map(\.selection)
        barrier = Task { await previous?.value; await cache.setWantedSources(selections) }
    }
    private func kick() {
        guard task == nil, let model, !pressure, profilesIdle(),
              let request = wanted.first(where: { ready[$0.selection] == nil && !attempted.contains($0.selection) }) else { return }
        let selected = request.selection, token = UUID(), previous = barrier, preparation = preparation
        let purge = request.identity.provider.flatMap(providerBarrier)
        stamp = token; running = selected; attempted.insert(selected)
        task = Task(priority: .utility) { @MainActor [weak self] in
            var result: NativeStemWindow?, failure: String?
            do {
                await previous?.value; try await purge?.value; try Task.checkCancellation()
                if self?.profilesIdle() == true {
                    result = try await preparation.prepare(request.identity, role: request.role, model: model)
                } else {
                    self?.attempted.remove(selected)
                }
                try Task.checkCancellation()
            } catch {
                if !(error is CancellationError) { failure = (error as? MobileFailure)?.code ?? "stem-unavailable" }
            }
            guard let self else { return }
            if self.stamp == token, !Task.isCancelled, self.wanted.contains(where: { $0.selection == selected }) {
                self.ready[selected] = result; self.failures[selected] = failure
                if result != nil || failure != nil { self.revision += 1 }
            }
            // A replacement waits for the cancelled pipeline to release its decoder, model and PCM first.
            self.task = nil; self.running = nil; self.kick(); self.changed?()
        }
    }
}
