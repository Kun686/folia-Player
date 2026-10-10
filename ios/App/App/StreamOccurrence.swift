import AVFoundation
import AudioStreaming

// StreamOccurrence.swift — one cancellable decoder per native queue occurrence; URLs never identify songs.
final class StreamOccurrence: AudioPlayerDelegate {
    let sourceURL: URL
    let audio: AudioPlayer
    let node: AVAudioUnit
    let unit: AudioEffectUnit
    private let output: StreamMixOutput?
    var meter: AudioMeter { unit.meter }
    var changed: (() -> Void)?
    var ended: (() -> Void)?
    var failed: (() -> Void)?
    private(set) var hasEnded = false
    private(set) var hasFailed = false
    private var disposed = false
    private var started = false
    private(set) var preparedPosition = 0.0
    private var endPosition: Double = 0
    var position: Double { hasEnded ? endPosition : Self.finite(audio.progress) }
    var duration: Double { Self.finite(audio.duration) }
    var playing: Bool { started && !disposed && !hasEnded && audio.state == .playing }

    private init(url: URL, node: AVAudioUnit, unit: AudioEffectUnit, output: StreamMixOutput?) {
        sourceURL = url
        self.node = node; self.unit = unit; self.output = output
        audio = AudioPlayer(configuration: AudioPlayerConfiguration(flushQueueOnSeek: false, enableLogs: false),
                            automaticallyStartsOutput: false, externallyRendered: output != nil)
        if output == nil { audio.attach(node: node) }
        audio.delegate = self
    }

    @MainActor static func prepare(url: URL, position: Double = 0, output: StreamMixOutput? = nil) async throws -> StreamOccurrence {
        let node: AVAudioUnit
        if let output { node = output.node } else { node = try await AudioEffectUnit.makeNode() }
        guard let unit = node.auAudioUnit as? AudioEffectUnit else { throw MobileFailure("audio-failed") }
        let entry = StreamOccurrence(url: url, node: node, unit: unit, output: output)
        entry.audio.play(url: url)
        do {
            try await entry.waitForPCM()
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
        guard !started, !disposed, position.isFinite, position >= 0 else { throw MobileFailure("invalid-position") }
        if abs(position - preparedPosition) > 0.001 {
            guard audio.isSeekable else { throw MobileFailure("unsupported-seek") }
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
        try output?.attach(audio)
        if started { audio.resume() }
        else {
            guard audio.startPreparedPlayback() else { throw MobileFailure("audio-failed") }
            started = true
        }
        do { try output?.start() }
        catch { audio.pause(); throw error }
    }
    func pause() { if started && !disposed { audio.pause() } }
    func seek(to position: Double) throws {
        guard !disposed, position.isFinite, position >= 0 else { throw MobileFailure("invalid-position") }
        guard audio.isSeekable else { throw MobileFailure("unsupported-seek") }
        unit.requestDiscontinuity()
        audio.seek(to: position)
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
        disposed = true; clearEvents(); audio.delegate = nil
        output?.remove(audio); audio.stop()
    }
    deinit { audio.delegate = nil; output?.remove(audio); audio.stop() }
    private static func finite(_ value: Double) -> Double { value.isFinite ? max(0, value) : 0 }

    // AudioStreaming delivers all delegate events on main; callers never retain the decoder's source queue.
    func audioPlayerDidStartPlaying(player: AudioPlayer, with entryId: AudioEntryId) { changed?() }
    func audioPlayerDidFinishBuffering(player: AudioPlayer, with entryId: AudioEntryId) { changed?() }
    func audioPlayerStateChanged(player: AudioPlayer, with newState: AudioPlayerState, previous: AudioPlayerState) { changed?() }
    func audioPlayerDidFinishPlaying(player: AudioPlayer, entryId: AudioEntryId, stopReason: AudioPlayerStopReason, progress: Double, duration: Double) {
        guard !disposed, started, stopReason == .eof else { return }
        endPosition = Self.finite(progress); hasEnded = true; ended?()
    }
    func audioPlayerUnexpectedError(player: AudioPlayer, error: AudioPlayerError) {
        guard !disposed else { return }; hasFailed = true; failed?()
    }
    func audioPlayerDidCancel(player: AudioPlayer, queuedItems: [AudioEntryId]) {}
    func audioPlayerDidReadMetadata(player: AudioPlayer, metadata: [String: String]) {}
}
