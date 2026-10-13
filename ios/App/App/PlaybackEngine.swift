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
    lazy var playbackFade: NativePlaybackFade? = makePlaybackFade()
    var playbackFadeToken: Int?
    var preparingPlaybackFade = false
    var audioSettings = NativeAudioSettings()
    let audioRules = NativeTransitionPlanner()
    var transitionSettings = NativeTransitionSettings()
    var lyricSettings = NativeLyricSettings()
    let gateway: GatewayClient
    let personalFM = NativePersonalFM()
    let listening: NativeListeningReporter
    let storage: UserDefaults
    let sleepTimer: NativeSleepTimer
    let local: LocalMediaLibrary
    let mediaCache: NativeMediaCache
    let coverCache: NativeCoverCache
    let lyricCache: NativeLyricCache
    let artwork: PlaybackArtwork
    var mediaCacheEpoch = 0
    var mediaCacheChanged: (() -> Void)?
    var mediaCachePurges: [String: Task<Void, Error>] = [:]
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
    var listeningSeek: UUID?
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
    var localMetadata: [String: [String: Any]] = [:]
    var localMetadataRequest = 0
    var libraryRefreshTask: Task<Void, Never>?

    init(gateway: GatewayClient, storage: UserDefaults = .standard, local: LocalMediaLibrary = LocalMediaLibrary(),
         usesStereoOutput: Bool = false, mediaNetworkConfiguration: URLSessionConfiguration? = nil, mediaCache: NativeMediaCache? = nil,
         coverCache: NativeCoverCache? = nil, lyricCache: NativeLyricCache = NativeLyricCache(), sleepTimer: NativeSleepTimer? = nil) {
        self.usesStereoOutput = usesStereoOutput
        self.mediaNetworkConfiguration = mediaNetworkConfiguration?.copy() as? URLSessionConfiguration
        let cacheSettings = storage.data(forKey: "folia.media-cache").flatMap { try? JSONDecoder().decode(NativeMediaCacheSettings.self, from: $0) } ?? NativeMediaCacheSettings()
        self.mediaCache = mediaCache ?? NativeMediaCache(configuration: mediaNetworkConfiguration ?? .ephemeral, settings: cacheSettings)
        self.gateway = gateway
        self.listening = NativeListeningReporter(gateway: gateway)
        self.storage = storage
        self.sleepTimer = sleepTimer ?? NativeSleepTimer(storage: storage)
        self.local = local
        let covers = coverCache ?? NativeCoverCache(configuration: mediaNetworkConfiguration ?? .ephemeral)
        self.coverCache = covers; self.artwork = PlaybackArtwork(cache: covers, local: local)
        self.lyricCache = lyricCache
        artwork.changed = { [weak self] in self?.updateNowPlaying() }
        player.actionAtItemEnd = .advance
        player.automaticallyWaitsToMinimizeStalling = true
        personalFM.engine = self
        restore()
        libraryRefreshTask = Task { @MainActor [weak self] in
            guard let self else { return }
            _ = try? await self.refreshLocalLibrary()
        }
        restoreAudioSettings()
        listening.changed = { [weak self] in self?.publish() }
        listening.refresh()
        crossfade = NativeCrossfade(owner: self)
        restoreLyricSettings()
        restoreTransitionSettings()
        self.sleepTimer.expired = { [weak self] in try? self?.command("pause") }
        Task { @MainActor [weak self, cache = self.mediaCache] in
            await cache.onChange { [weak self] identity in
                self?.mediaCacheChanged?()
                if let identity { self?.crossfade?.mediaAvailable(identity) }
            }
        }
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
    func setQueue(_ songs: [[String: Any]], at position: Int, preservingFM: Bool = false) throws {
        guard !songs.isEmpty, songs.count <= 1000, songs.indices.contains(position) else { throw MobileFailure("invalid-queue") }
        sleepTimer.reconcile()
        let validated = try songs.map(Self.sanitizedSong).map(canonicalLocalSong)
        if !preservingFM { personalFM.leave() }
        queue = validated; failures = 0; intentToPlay = true
        select(position)
    }
    func nextIndex(_ delta: Int = 1, automatic: Bool = false) -> Int? {
        guard !queue.isEmpty else { return nil }
        if !personalFM.active && automatic && repeatMode == "one" { return index }
        let target = index + delta
        if queue.indices.contains(target) { return target }
        if !personalFM.active && repeatMode == "all" { return delta < 0 ? queue.count - 1 : 0 }
        return nil
    }
    func move(_ delta: Int, automatic: Bool = false) {
        if let next = nextIndex(delta, automatic: automatic) {
            if !automatic { intentToPlay = true }
            select(next)
        } else if delta > 0 && personalFM.active { personalFM.waitForNext(automatic: automatic) }
        else if automatic { intentToPlay = false; pauseOutput(); publish() }
    }
    // Every new playback intent invalidates previous resolves and preloads.
    func select(_ target: Int, refresh: Bool = false, position: Double = 0) {
        guard queue.indices.contains(target) || (target == -1 && detachedSong != nil) else { return }
        playbackFade?.flush(); playbackFadeToken = nil
        listeningSeek = nil
        if !refresh { listening.finishOccurrence() } else { listening.discontinuity() }
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
        personalFM.refill()
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
            if code == "gateway-auth-required" || (code == "auth-required" &&
                (currentSong?["sourceRef"] as? [String: Any])?["providerId"] as? String == "netease") {
                listening.authenticationFailed(code)
            }
            stop(code); return
        }
        if !retried { retried = true; select(index, refresh: true, position: playbackPosition); return }
        failures += 1
        if failures >= 3 || nextIndex() == nil { stop(code); return }
        if let next = nextIndex() { select(next) }
    }
    func stop(_ code: String? = nil) {
        // A stopped AVPlayer seek can no longer clear its marker through the old generation callback.
        listeningSeek = nil
        personalFM.cancelPending()
        crossfade?.cancel()
        generation += 1; task?.cancel(); discardPrepared(); stalledRecovery?.cancel(); stalledRecovery = nil; networkResume = nil
        statusObservation = nil; observedItem = nil
        stream?.clearEvents()
        intentToPlay = false; pauseOutput(); error = code; persist(); publish()
    }
    func invalidateProvider(_ provider: String) {
        if provider == "netease" { listening.invalidate(); personalFM.leave() }
        mediaCacheEpoch += 1
        let previous = mediaCachePurges[provider]
        mediaCachePurges[provider] = Task { [mediaCache, coverCache, lyricCache] in
            _ = try? await previous?.value
            // One failed filesystem deletion must not prevent the other category from being invalidated.
            var failure: Error?
            do { try await coverCache.clear(provider: provider) } catch { failure = error }
            do { try await lyricCache.clear(provider: provider) } catch { failure = failure ?? error }
            do { try await mediaCache.clear(provider: provider) } catch { failure = failure ?? error }
            if let failure { throw failure }
        }
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
    func pauseOutput(preservingFade: Bool = false) {
        playbackFadeToken = nil
        listening.discontinuity()
        crossfade?.cancel()
        if usesStereoOutput { stream?.pause(); streamOutput?.pause() } else { player.pause() }
        if !preservingFade { playbackFade?.cancel() }
    }
    func clearOutput() {
        playbackFade?.cancel(); playbackFadeToken = nil
        streamOutput?.unit.transportGain.ramp(to: 1, seconds: 0)
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
         "duration": playbackDuration, "playing": intentToPlay && outputIsPlaying,
         "repeat": repeatMode, "error": error ?? "", "revision": revision, "personalFM": personalFM.snapshot,
         "listening": listening.snapshot,
         "transitionCue": crossfade?.cueSnapshot as Any? ?? NSNull(),
         "audioProcessingAvailable": meter?.processingAvailable() ?? false,
         "audioEffects": meter?.effectState() ?? ["available": false, "pending": false, "error": ""]]
    }
    var lyricsChanged: (([String: Any]) -> Void)?
    var localCatalogChanged: (() -> Void)?
    func publish() {
        crossfade?.updateLyrics()
        finishPlaybackFadeIn()
        listening.observe(song: currentSong, position: playbackPosition, duration: playbackDuration,
            playing: outputIsPlaying && stream?.seeking != true && listeningSeek == nil, quality: audioSettings.audioQuality)
        revision += 1; updateNowPlaying()
        var event = snapshot()
        if !queueDirty { event.removeValue(forKey: "queue"); event.removeValue(forKey: "currentSong") }
        queueDirty = false; emit?(event)
        if Date().timeIntervalSince(lastSave) > 5 { persist() }
    }
    func persist() {
        lastSave = Date()
        if let data = try? JSONSerialization.data(withJSONObject: ["queue": queue, "index": index, "currentSong": currentSong as Any? ?? NSNull(),
            "position": playbackPosition, "repeat": repeatMode, "personalFM": personalFM.selection as Any? ?? NSNull()]) {
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
        if !queue.isEmpty { personalFM.restore(saved["personalFM"]) }
        // Restore paused; no network traffic or unexpected audio until the user presses play.
    }
    deinit {
        personalFM.cancelPending()
        crossfade?.cancel()
        libraryRefreshTask?.cancel()
        task?.cancel(); preload?.cancel(); stalledRecovery?.cancel(); network.cancel()
        streamTimer?.cancel(); stream?.dispose(); preparedStream?.entry.dispose()
        streamOutput?.close()
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        remoteTargets.forEach { $0.0.removeTarget($0.1) }
    }
}
