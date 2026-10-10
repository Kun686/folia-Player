import AVFoundation
import MediaPlayer
import UIKit
import Network

// PlaybackEngine.swift — native song identities survive WebView suspension and URL expiry.
final class PlaybackEngine {
    let player = AVQueuePlayer()
    // Keep the AVQueuePlayer path as the verified fallback while the stereo output is integrated.
    let usesStereoOutput: Bool
    var streamOutput: StreamMixOutput?
    var stream: StreamOccurrence?
    var preparedStream: (index: Int, entry: StreamOccurrence, at: Date)?
    var streamTimer: DispatchSourceTimer?
    var crossfade: NativeCrossfade?
    var audioSettings = NativeAudioSettings()
    var transitionSettings = NativeTransitionSettings()
    let gateway: GatewayClient
    let storage: UserDefaults
    let local: LocalMediaLibrary
    let mediaNetworkConfiguration: URLSessionConfiguration?
    let network = NWPathMonitor()
    var networkResume: Double?
    var stalledRecovery: DispatchWorkItem?
    var queueDirty = true
    var queueRevision = 0
    var queue: [[String: Any]] = [] { didSet { queueDirty = true; queueRevision += 1 } }
    var index = -1 { didSet { if oldValue != index { queueDirty = true; queueRevision += 1 } } }
    var detachedSong: [String: Any]?
    var currentSong: [String: Any]? { queue.indices.contains(index) ? queue[index] : detachedSong }
    var repeatMode = "off"
    var intentToPlay = false
    var error: String?
    var revision = 0
    var generation = 0
    var failures = 0
    var retried = false
    var task: Task<Void, Never>?
    var preload: Task<Void, Never>?
    var prepared: (index: Int, item: AVPlayerItem, at: Date, meter: AudioMeter?)?
    var meter: AudioMeter?
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

    init(gateway: GatewayClient, storage: UserDefaults = .standard, local: LocalMediaLibrary = LocalMediaLibrary(),
         usesStereoOutput: Bool = false, mediaNetworkConfiguration: URLSessionConfiguration? = nil) {
        self.usesStereoOutput = usesStereoOutput
        self.mediaNetworkConfiguration = mediaNetworkConfiguration?.copy() as? URLSessionConfiguration
        self.gateway = gateway
        self.storage = storage
        self.local = local
        player.actionAtItemEnd = .advance
        player.automaticallyWaitsToMinimizeStalling = true
        restore()
        restoreAudioSettings()
        crossfade = NativeCrossfade(owner: self)
        restoreTransitionSettings()
        setupSystem()
        setupNetwork()
        if usesStereoOutput {
            let timer = DispatchSource.makeTimerSource(queue: .main)
            timer.schedule(deadline: .now(), repeating: 0.25, leeway: .milliseconds(20))
            timer.setEventHandler { [weak self] in
                guard let self, self.intentToPlay else { return }
                self.crossfade?.tick()
                self.publish()
            }
            streamTimer = timer; timer.resume()
            return
        }
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
        guard !songs.isEmpty, songs.count <= 1000, songs.indices.contains(position) else { throw MobileFailure("invalid-queue") }
        queue = try songs.map(Self.sanitizedSong); failures = 0; intentToPlay = true
        select(position)
    }
    func nextIndex(_ delta: Int = 1, automatic: Bool = false) -> Int? {
        guard !queue.isEmpty else { return nil }
        if automatic && repeatMode == "one" { return index }
        let target = index + delta
        if queue.indices.contains(target) { return target }
        if repeatMode == "all" { return delta < 0 ? queue.count - 1 : 0 }
        return nil
    }
    func move(_ delta: Int, automatic: Bool = false) {
        if let next = nextIndex(delta, automatic: automatic) {
            if !automatic { intentToPlay = true }
            select(next)
        } else if automatic { intentToPlay = false; pauseOutput(); publish() }
    }
    // Every new playback intent invalidates previous resolves and preloads.
    func select(_ target: Int, refresh: Bool = false, position: Double = 0) {
        if usesStereoOutput { selectStream(target, refresh: refresh, position: position); return }
        guard let song = queue.indices.contains(target) ? queue[target] : (target == -1 ? detachedSong : nil) else { return }
        generation += 1; let epoch = generation
        task?.cancel(); preload?.cancel(); stalledRecovery?.cancel(); networkResume = nil
        // Detach before removing items: their queued completion events belong to the old intent.
        player.pause(); statusObservation = nil; observedItem = nil; player.removeAllItems()
        index = target; detachedSong = song; restoredPosition = position; error = nil
        if !refresh { retried = false }
        let cached = !refresh && prepared?.index == target && Date().timeIntervalSince(prepared!.at) < 120 ? prepared : nil
        meter = nil
        prepared = nil
        publish()
        task = Task { @MainActor [weak self] in
            guard let self else { return }
            let background = UIApplication.shared.beginBackgroundTask(withName: "Folia resolve") { [weak self] in
                if self?.generation == epoch { self?.stop("network-timeout") }
            }
            defer { if background != .invalid { UIApplication.shared.endBackgroundTask(background) } }
            do {
                let item: AVPlayerItem
                let meter: AudioMeter?
                if let cached { item = cached.item; meter = cached.meter }
                else {
                    item = AVPlayerItem(url: try await self.resolve(song))
                    meter = await AudioMeter.attach(to: item)
                }
                guard epoch == self.generation, !Task.isCancelled else { return }
                self.meter = meter
                self.configureMeter(meter)
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
        if usesStereoOutput { prefetchStream(); return }
        guard currentSong != nil, player.currentItem != nil, let next = nextIndex(automatic: true),
              let song = queue.indices.contains(next) ? queue[next] : detachedSong else { return }
        let epoch = generation
        preload = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let url = try await self.resolve(song)
                let asset = AVURLAsset(url: url)
                let playable = try await asset.load(.isPlayable)
                guard playable, epoch == self.generation, !Task.isCancelled else { return }
                let item = AVPlayerItem(asset: asset)
                let meter = await AudioMeter.attach(to: item)
                guard epoch == self.generation, !Task.isCancelled else { return }
                self.prepared = (next, item, Date(), meter)
                self.configureMeter(meter)
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
        if !retried { retried = true; select(index, refresh: true, position: playbackPosition); return }
        failures += 1
        if failures >= 3 || nextIndex() == nil { stop(code); return }
        if let next = nextIndex() { select(next) }
    }
    func stop(_ code: String? = nil) {
        crossfade?.cancel()
        generation += 1; task?.cancel(); discardPrepared(); stalledRecovery?.cancel(); stalledRecovery = nil; networkResume = nil
        statusObservation = nil; observedItem = nil
        stream?.clearEvents()
        intentToPlay = false; pauseOutput(); error = code; persist(); publish()
    }
    func invalidateProvider(_ provider: String) {
        crossfade?.invalidateProvider(provider)
        removeSongs { ($0["sourceRef"] as? [String: Any])?["providerId"] as? String == provider }
    }
    func activate() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .default, policy: .longFormAudio)
        try session.setActive(true)
    }
    func finiteTime(_ time: CMTime) -> Double { let value = time.seconds; return value.isFinite ? max(0, value) : 0 }
    var hasCurrentOutput: Bool { usesStereoOutput ? stream != nil : player.currentItem != nil }
    var outputIsPlaying: Bool { usesStereoOutput ? stream?.playing == true && streamOutput?.running == true : player.timeControlStatus == .playing }
    var playbackPosition: Double { usesStereoOutput ? (stream?.position ?? restoredPosition) : (player.currentItem == nil ? restoredPosition : finiteTime(player.currentTime())) }
    func pauseOutput() {
        crossfade?.cancel()
        if usesStereoOutput { stream?.pause(); streamOutput?.pause() } else { player.pause() }
    }
    func clearOutput() {
        crossfade?.cancel()
        if usesStereoOutput { stream?.dispose(); stream = nil; meter = nil }
        else { player.removeAllItems() }
    }
    var playbackDuration: Double {
        let loaded = usesStereoOutput ? (stream?.duration ?? 0) : finiteTime(player.currentItem?.duration ?? .zero)
        let metadata = (currentSong?["durationMs"] as? Double ?? 0) / 1000
        return loaded > 0 ? loaded : (metadata.isFinite ? max(0, metadata) : 0)
    }
    func snapshot() -> [String: Any] {
        ["queue": queue, "index": index, "currentSong": currentSong as Any? ?? NSNull(), "queueRevision": queueRevision,
         "position": playbackPosition,
         "duration": playbackDuration, "playing": outputIsPlaying,
         "repeat": repeatMode, "error": error ?? "", "revision": revision,
         "audioProcessingAvailable": meter?.processingAvailable() ?? false,
         "audioEffects": meter?.effectState() ?? ["available": false, "pending": false, "error": ""]]
    }
    func publish() {
        revision += 1; updateNowPlaying()
        var event = snapshot()
        if !queueDirty { event.removeValue(forKey: "queue"); event.removeValue(forKey: "currentSong") }
        queueDirty = false; emit?(event)
        if Date().timeIntervalSince(lastSave) > 5 { persist() }
    }
    func persist() {
        lastSave = Date()
        if let data = try? JSONSerialization.data(withJSONObject: ["queue": queue, "index": index, "currentSong": currentSong as Any? ?? NSNull(),
            "position": playbackPosition, "repeat": repeatMode]) {
            storage.set(data, forKey: "folia.queue")
        }
    }
    func restore() {
        guard let data = storage.data(forKey: "folia.queue"),
              let saved = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let songs = saved["queue"] as? [[String: Any]], songs.count <= 1000 else { return }
        let position = saved["position"] as? Double ?? 0
        restoredPosition = position.isFinite ? max(0, position) : 0
        guard let validated = try? songs.map(Self.sanitizedSong) else { return }
        queue = validated; index = saved["index"] as? Int ?? -1; repeatMode = saved["repeat"] as? String ?? "off"
        if !queue.indices.contains(index) { index = -1 }
        if let song = saved["currentSong"] as? [String: Any] { detachedSong = try? Self.sanitizedSong(song) }
        if !["off", "all", "one"].contains(repeatMode) { repeatMode = "off" }
        // Restore paused; no network traffic or unexpected audio until the user presses play.
    }
    deinit {
        crossfade?.cancel()
        task?.cancel(); preload?.cancel(); stalledRecovery?.cancel(); network.cancel()
        streamTimer?.cancel(); stream?.dispose(); preparedStream?.entry.dispose()
        streamOutput?.close()
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        remoteTargets.forEach { $0.0.removeTarget($0.1) }
    }
}
