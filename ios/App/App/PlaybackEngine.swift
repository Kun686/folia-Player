import AVFoundation
import MediaPlayer
import UIKit
import Network

// PlaybackEngine.swift — native song identities survive WebView suspension and URL expiry.
final class PlaybackEngine {
    let player = AVQueuePlayer()
    let gateway: GatewayClient
    let storage: UserDefaults
    let network = NWPathMonitor()
    var networkResume: (index: Int, position: Double)?
    var stalledRecovery: DispatchWorkItem?
    var queueDirty = true
    var queue: [[String: Any]] = [] { didSet { queueDirty = true } }
    var index = -1
    var repeatMode = "off"
    var intentToPlay = false
    var error: String?
    var revision = 0
    var generation = 0
    var failures = 0
    var retried = false
    var task: Task<Void, Never>?
    var preload: Task<Void, Never>?
    var prepared: (index: Int, item: AVPlayerItem, at: Date)?
    var observers: [NSObjectProtocol] = []
    var observedItem: AVPlayerItem?
    var statusObservation: NSKeyValueObservation?
    var rateObservation: NSKeyValueObservation?
    var itemObservation: NSKeyValueObservation?
    var timeObserver: Any?
    var remoteTargets: [(MPRemoteCommand, Any)] = []
    var emit: (([String: Any]) -> Void)?
    var lastSave = Date.distantPast
    var resumeAfterInterruption = false
    var restoredPosition: Double = 0

    init(gateway: GatewayClient, storage: UserDefaults = .standard) {
        self.gateway = gateway
        self.storage = storage
        player.actionAtItemEnd = .advance
        player.automaticallyWaitsToMinimizeStalling = true
        restore()
        setupSystem()
        setupNetwork()
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.25, preferredTimescale: 600),
                                                      queue: .main) { [weak self] _ in self?.publish() }
        itemObservation = player.observe(\.currentItem, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.promotePreparedItem() }
        }
        rateObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.publish() }
        }
    }
    func setQueue(_ songs: [[String: Any]], at position: Int) throws {
        guard !songs.isEmpty, songs.count <= 1000, songs.indices.contains(position),
              songs.allSatisfy({ song in
                  guard let ref = song["sourceRef"] as? [String: Any],
                        let provider = ref["providerId"] as? String, let id = ref["mediaId"] as? String else { return false }
                  return ref["kind"] as? String == "online" && ["netease", "qq", "kugou"].contains(provider) && !id.isEmpty && id.count <= 128
              }) else { throw MobileFailure("invalid-queue") }
        queue = try songs.map(Self.sanitizedSong); failures = 0; intentToPlay = true
        select(position)
    }
    func nextIndex(_ delta: Int = 1, automatic: Bool = false) -> Int? {
        guard !queue.isEmpty else { return nil }
        if automatic && repeatMode == "one" { return index }
        let target = index + delta
        if queue.indices.contains(target) { return target }
        if repeatMode == "all" { return (target + queue.count) % queue.count }
        return nil
    }
    func move(_ delta: Int, automatic: Bool = false) {
        if let next = nextIndex(delta, automatic: automatic) { select(next) }
        else { intentToPlay = false; player.pause(); publish() }
    }
    // Every new playback intent invalidates previous resolves and preloads.
    func select(_ target: Int, refresh: Bool = false, position: Double = 0) {
        guard queue.indices.contains(target) else { return }
        generation += 1; let epoch = generation
        task?.cancel(); preload?.cancel(); stalledRecovery?.cancel(); networkResume = nil
        // Detach before removing items: their queued completion events belong to the old intent.
        player.pause(); statusObservation = nil; observedItem = nil; player.removeAllItems()
        index = target; error = nil
        if !refresh { retried = false }
        let cached = !refresh && prepared?.index == target && Date().timeIntervalSince(prepared!.at) < 120 ? prepared?.item : nil
        prepared = nil
        let song = queue[target]
        publish()
        task = Task { @MainActor [weak self] in
            guard let self else { return }
            let background = UIApplication.shared.beginBackgroundTask(withName: "Folia resolve") { [weak self] in
                if self?.generation == epoch { self?.stop("network-timeout") }
            }
            defer { if background != .invalid { UIApplication.shared.endBackgroundTask(background) } }
            do {
                let item: AVPlayerItem
                if let cached { item = cached }
                else { item = AVPlayerItem(url: try await self.gateway.resolve(song)) }
                guard epoch == self.generation, !Task.isCancelled else { return }
                self.player.insert(item, after: nil)
                self.observeStatus(item, epoch: epoch)
                if position > 0 { await self.player.seek(to: CMTime(seconds: position, preferredTimescale: 600)) }
                guard epoch == self.generation else { return }
                if self.intentToPlay { try self.activate(); self.player.play() }
                self.prefetch()
                self.persist(); self.publish()
            } catch { if !Task.isCancelled { self.failed(error, epoch: epoch) } }
        }
    }
    func prefetch() {
        guard let next = nextIndex(automatic: true) else { return }
        let epoch = generation, song = queue[next]
        preload = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let url = try await self.gateway.resolve(song)
                let asset = AVURLAsset(url: url)
                let playable = try await asset.load(.isPlayable)
                guard playable, epoch == self.generation, !Task.isCancelled else { return }
                let item = AVPlayerItem(asset: asset)
                self.prepared = (next, item, Date())
                if self.player.canInsert(item, after: self.player.currentItem) {
                    self.player.insert(item, after: self.player.currentItem)
                }
            } catch { /* Current playback remains intact; next selection resolves afresh. */ }
        }
    }
    func failed(_ cause: Error, epoch: Int) {
        guard epoch == generation else { return }
        let code = (cause as? MobileFailure)?.code ?? "network"
        if ["auth-required", "gateway-auth-required", "rate-limited"].contains(code) {
            stop(code); return
        }
        if !retried { retried = true; select(index, refresh: true, position: finiteTime(player.currentTime())); return }
        failures += 1
        if failures >= 3 || nextIndex() == nil { stop(code); return }
        move(1)
    }
    func stop(_ code: String? = nil) {
        generation += 1; task?.cancel(); discardPrepared(); stalledRecovery?.cancel(); networkResume = nil
        statusObservation = nil; observedItem = nil
        intentToPlay = false; player.pause(); error = code; persist(); publish()
    }
    func invalidateProvider(_ provider: String) {
        stop()
        queue.removeAll { ($0["sourceRef"] as? [String: Any])?["providerId"] as? String == provider }
        index = -1; player.removeAllItems(); persist(); publish()
    }
    func activate() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .default, policy: .longFormAudio)
        try session.setActive(true)
    }
    func finiteTime(_ time: CMTime) -> Double { let value = time.seconds; return value.isFinite ? max(0, value) : 0 }
    func snapshot() -> [String: Any] {
        ["queue": queue, "index": index, "position": finiteTime(player.currentTime()),
         "duration": finiteTime(player.currentItem?.duration ?? .zero), "playing": player.timeControlStatus == .playing,
         "repeat": repeatMode, "error": error ?? "", "revision": revision]
    }
    func publish() {
        revision += 1; updateNowPlaying()
        var event = snapshot()
        if !queueDirty { event.removeValue(forKey: "queue") }
        queueDirty = false; emit?(event)
        if Date().timeIntervalSince(lastSave) > 5 { persist() }
    }
    func persist() {
        lastSave = Date()
        if let data = try? JSONSerialization.data(withJSONObject: ["queue": queue, "index": index,
            "position": player.currentItem == nil ? restoredPosition : finiteTime(player.currentTime()), "repeat": repeatMode]) {
            storage.set(data, forKey: "folia.queue")
        }
    }
    func restore() {
        guard let data = storage.data(forKey: "folia.queue"),
              let saved = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let songs = saved["queue"] as? [[String: Any]], songs.count <= 1000 else { return }
        restoredPosition = saved["position"] as? Double ?? 0
        queue = songs; index = saved["index"] as? Int ?? -1; repeatMode = saved["repeat"] as? String ?? "off"
        // Restore paused; no network traffic or unexpected audio until the user presses play.
    }
    deinit {
        task?.cancel(); preload?.cancel(); stalledRecovery?.cancel(); network.cancel()
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        remoteTargets.forEach { $0.0.removeTarget($0.1) }
    }
}
