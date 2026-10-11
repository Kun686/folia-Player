import AVFoundation
import AudioStreaming

// StreamOccurrence.swift — one cancellable decoder per native queue occurrence; URLs never identify songs.
final class StreamOccurrence: AudioPlayerDelegate {
    var cachedMedia: NativeCachedMedia?
    let sourceURL: URL
    private(set) var replayGain: NativeReplayGainInfo?
    private var replayGainLevels = NativeReplayGainLevels.neutral
    private(set) var audio: AudioPlayer
    let node: AVAudioUnit
    let unit: AudioEffectUnit
    private let output: StreamMixOutput?
    private let networkConfiguration: URLSessionConfiguration?
    let allowsTempo: Bool
    var meter: AudioMeter { unit.meter }
    var changed: (() -> Void)?
    var ended: (() -> Void)?
    var failed: (() -> Void)?
    private(set) var hasEnded = false
    private(set) var hasFailed = false
    private var disposed = false
    private var started = false
    private var wantsPlayback = false
    private var seekTask: Task<Void, Never>?
    private var seekGeneration: UInt64 = 0
    private var seekingPosition: Double?
    private var reloadingDecoder = false
    private var knownDuration = 0.0
    private var sourceSeekable = false
    private(set) var preparedPosition = 0.0
    private var endPosition: Double = 0
    var tempoState: NativeTempoHandover.State? { allowsTempo ? output?.tempoState(audio) : nil }
    var position: Double { seekingPosition ?? (hasEnded ? endPosition : tempoState?.position ?? Self.finite(audio.progress)) }
    var rate: Double { tempoState?.rate ?? 1 }
    var seeking: Bool { seekingPosition != nil || audio.isSeeking }
    var preparingOutput: Bool { seekTask != nil }
    var duration: Double {
        let observed = Self.finite(audio.duration)
        if observed > 0 { knownDuration = observed }
        return knownDuration
    }
    var playing: Bool {
        guard started, wantsPlayback, !disposed, !hasEnded, !hasFailed, seekingPosition == nil else { return false }
        if let state = tempoState, state.decoderEnded { return !state.drained }
        return audio.state == .playing
    }

    private init(url: URL, node: AVAudioUnit, unit: AudioEffectUnit, output: StreamMixOutput?, allowsTempo: Bool, networkConfiguration: URLSessionConfiguration?) {
        sourceURL = url
        self.node = node; self.unit = unit; self.output = output; self.allowsTempo = allowsTempo
        self.networkConfiguration = networkConfiguration?.copy() as? URLSessionConfiguration
        audio = Self.makeDecoder(external: output != nil, configuration: networkConfiguration)
        if output == nil { audio.attach(node: node) }
        audio.delegate = self
    }
    private static func makeDecoder(external: Bool, configuration: URLSessionConfiguration?) -> AudioPlayer {
        AudioPlayer(configuration: AudioPlayerConfiguration(flushQueueOnSeek: false, enableLogs: false),
                    automaticallyStartsOutput: false, externallyRendered: external, networkConfiguration: configuration)
    }

    @MainActor static func prepare(url: URL, position: Double = 0, output: StreamMixOutput? = nil,
                                   networkConfiguration: URLSessionConfiguration? = nil, allowsTempo: Bool = false,
                                   replayGain: NativeReplayGainInfo? = nil, replayGainLevels: NativeReplayGainLevels = .neutral) async throws -> StreamOccurrence {
        guard !allowsTempo || output != nil else { throw MobileFailure("tempo-unavailable") }
        let node: AVAudioUnit
        if let output { node = output.node } else { node = try await AudioEffectUnit.makeNode() }
        guard let unit = node.auAudioUnit as? AudioEffectUnit else { throw MobileFailure("audio-failed") }
        let entry = StreamOccurrence(url: url, node: node, unit: unit, output: output, allowsTempo: allowsTempo, networkConfiguration: networkConfiguration)
        entry.replayGain = replayGain; entry.replayGainLevels = replayGainLevels
        entry.audio.play(url: url)
        do {
            try await entry.waitForPCM()
            entry.knownDuration = Self.finite(entry.audio.duration)
            entry.sourceSeekable = entry.audio.isSeekable
            if position > 0 {
                guard entry.audio.isSeekable else { throw MobileFailure("unsupported-seek") }
                entry.preparedPosition = position
                entry.audio.seek(to: position)
                try await entry.waitForPCM()
            }
            return entry
        } catch { entry.dispose(); throw error }
    }

    @MainActor private func waitForPCM() async throws {
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline {
            try Task.checkCancellation()
            if hasFailed || disposed || hasEnded { throw MobileFailure("audio-failed") }
            if !audio.isSeeking && audio.bufferedDuration > 0 { return }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        throw MobileFailure("network-timeout")
    }

    // Moving an unstarted deck must not reset the shared audible DSP or release its PCM prematurely.
    @MainActor func preparePosition(_ position: Double) async throws {
        guard !started, !disposed, seekTask == nil, position.isFinite, position >= 0 else { throw MobileFailure("invalid-position") }
        if abs(position - preparedPosition) > 0.001 {
            guard audio.isSeekable else { throw MobileFailure("unsupported-seek") }
            if allowsTempo { output?.remove(audio) }
            // Record the intent before suspending: cancelling preparation cannot make a moved deck reusable at zero.
            preparedPosition = position
            audio.seek(to: position)
        }
        // A replacement plan may target the same pending seek; it still has to await usable PCM.
        try await waitForPCM()
        try Task.checkCancellation()
    }

    func play() throws {
        guard !disposed, !hasFailed, !hasEnded else { throw MobileFailure("audio-failed") }
        wantsPlayback = true
        guard seekTask == nil else { return }
        try attachOutput()
        audio.resume()
        if !started {
            guard audio.startPreparedPlayback() else { throw MobileFailure("audio-failed") }
            started = true
        }
        do { try output?.start() }
        catch { audio.pause(); throw error }
    }
    // Crossfade connects the prepared source before scheduling gain; keep that route consistent
    // with play(), including the optional tempo history and its native event subscription.
    func attachOutput() throws {
        guard !disposed, !hasFailed, !hasEnded, seekTask == nil else { throw MobileFailure("audio-failed") }
        try output?.attach(audio, allowsTempo: allowsTempo, replayGain: replayGainLevels)
        if allowsTempo {
            let stamp = seekGeneration
            try output?.observeTempo(audio) { [weak self] failed in
                guard let self, !self.disposed, self.seekGeneration == stamp, self.seekTask == nil else { return }
                if failed { self.fail() }
                else { self.reconcileTempo() }
            }
        }
    }
    func requestTempo(rate: Double) throws {
        guard allowsTempo, started, !disposed, !hasEnded, !hasFailed, !seeking,
              let output else { throw MobileFailure("tempo-unavailable") }
        try output.requestTempo(audio, rate: rate)
    }
    func pause() {
        wantsPlayback = false
        // During a seek only the decoder runs; the stopped host prevents audible playback.
        if started && !disposed && seekTask == nil { audio.pause() }
    }
    func seek(to position: Double) throws {
        guard !disposed, position.isFinite, position >= 0 else { throw MobileFailure("invalid-position") }
        let afterEOF = allowsTempo && (hasEnded || audio.stopReason == .eof || tempoState?.decoderEnded == true)
        guard afterEOF ? sourceSeekable : audio.isSeekable else { throw MobileFailure("unsupported-seek") }
        if allowsTempo { try seekTempo(to: position); return }
        unit.requestDiscontinuity()
        output?.resetAnalysis(audio)
        audio.seek(to: position)
    }
    // Stop pulls before invalidating a tempo source. A fresh source also permits seeking after the
    // decoder has ended but TimePitch still retains output. Only the latest intent may reattach it.
    private func seekTempo(to target: Double) throws {
        guard let output, output.attachedCount <= 1 else { throw MobileFailure("tempo-unavailable") }
        output.pause()
        let wasEnded = hasEnded || audio.stopReason == .eof || tempoState?.decoderEnded == true
        let seekAfterPreparation = wasEnded || reloadingDecoder
        let length = duration
        seekGeneration &+= 1; let stamp = seekGeneration
        seekTask?.cancel(); seekTask = nil
        output.remove(audio)
        unit.requestDiscontinuity(); hasEnded = false
        seekingPosition = target
        if length > 0 && target >= length {
            audio.stop(); seekingPosition = nil; finish(at: length); return
        }
        if wasEnded {
            // stop() retires its source asynchronously. Reusing that player immediately could let
            // the old stop clear a newly queued song; a distinct decoder isolates the new intent.
            audio.delegate = nil; audio.stop()
            audio = Self.makeDecoder(external: true, configuration: networkConfiguration)
            audio.delegate = self; audio.play(url: sourceURL); started = false; reloadingDecoder = true
        }
        else { audio.resume() }
        seekTask = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                guard !Task.isCancelled, !self.disposed, self.seekGeneration == stamp else { return }
                // The decoder has one mutable seek slot. Do not overwrite an in-flight seek's
                // target: its completion could clear the newer request. Wait, then submit only
                // the current intent. A newly opened decoder also needs its initial source first.
                if seekAfterPreparation || self.audio.isSeeking {
                    try await self.waitForPCM()
                    guard !Task.isCancelled, !self.disposed, self.seekGeneration == stamp else { return }
                }
                self.audio.seek(to: target)
                try await self.waitForPCM()
                guard !Task.isCancelled, !self.disposed, self.seekGeneration == stamp else { return }
                self.preparedPosition = target
                self.reloadingDecoder = false
                self.seekTask = nil; self.seekingPosition = nil
                try self.attachOutput()
                if self.wantsPlayback { try self.play() } else { self.audio.pause() }
                self.changed?()
            } catch {
                guard !Task.isCancelled, !self.disposed, self.seekGeneration == stamp else { return }
                // Preserve the requested position for the owner's existing resolve/retry policy.
                self.seekTask = nil; self.seekingPosition = target; self.fail()
            }
        }
    }
    // Completion here is output retirement. Automix starts the next song from its media-time plan,
    // never from the conservative drained flag. Ordinary non-tempo queue completion is unchanged.
    private func reconcileTempo() {
        guard !hasEnded, !hasFailed, let state = tempoState else { return }
        if state.drained { finish(at: state.position) } else { changed?() }
    }
    private func finish(at position: Double) {
        guard !hasEnded else { return }
        endPosition = Self.finite(position); hasEnded = true; ended?()
    }
    private func fail() {
        guard !disposed, !hasFailed else { return }
        hasFailed = true; seekTask?.cancel(); seekTask = nil; failed?()
    }
    func apply(_ settings: NativeAudioSettings) {
        if let output { output.apply(settings); return }
        // Upstream muted silences its INPUT, before noise/reverb. Master gain must silence all effects.
        audio.volume = settings.isMuted ? 0 : Float(settings.volume)
        meter.setOutputGain(volume: settings.volume, muted: settings.isMuted)
        meter.equalizer.configure(enabled: settings.equalizer.enabled, gains: settings.equalizer.gains)
        meter.effects.configure(settings.equalizer.enabled ? settings.equalizer.effects : NativeEqualizerSettings.neutral)
    }
    func clearEvents() { changed = nil; ended = nil; failed = nil }
    func dispose() {
        guard !disposed else { return }
        disposed = true; seekGeneration &+= 1; seekTask?.cancel(); seekTask = nil
        clearEvents(); audio.delegate = nil
        output?.remove(audio); audio.stop(); cachedMedia = nil
    }
    deinit { seekTask?.cancel(); audio.delegate = nil; output?.remove(audio); audio.stop() }
    private static func finite(_ value: Double) -> Double { value.isFinite ? max(0, value) : 0 }

    // AudioStreaming delivers all delegate events on main; callers never retain the decoder's source queue.
    func audioPlayerDidStartPlaying(player: AudioPlayer, with entryId: AudioEntryId) { if player === audio { changed?() } }
    func audioPlayerDidFinishBuffering(player: AudioPlayer, with entryId: AudioEntryId) { if player === audio { changed?() } }
    func audioPlayerStateChanged(player: AudioPlayer, with newState: AudioPlayerState, previous: AudioPlayerState) { if player === audio { changed?() } }
    func audioPlayerDidFinishPlaying(player: AudioPlayer, entryId: AudioEntryId, stopReason: AudioPlayerStopReason, progress: Double, duration: Double) {
        guard player === audio, !disposed, started, seekTask == nil, stopReason == .eof else { return }
        let duration = Self.finite(duration)
        if duration > 0 { knownDuration = duration }
        if allowsTempo { reconcileTempo(); return }
        finish(at: progress)
    }
    func audioPlayerUnexpectedError(player: AudioPlayer, error: AudioPlayerError) {
        if player === audio { fail() }
    }
    func audioPlayerDidCancel(player: AudioPlayer, queuedItems: [AudioEntryId]) {}
    func audioPlayerDidReadMetadata(player: AudioPlayer, metadata: [String: String]) {}
}
