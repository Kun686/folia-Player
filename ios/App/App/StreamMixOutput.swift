import AVFoundation
import AudioStreaming

// StreamMixOutput.swift — one hardware output, original effect chain and master gain for native queue decks.
final class StreamMixOutput {
    let engine = AVAudioEngine()
    let mixer = AVAudioMixerNode()
    let node: AVAudioUnit
    let unit: AudioEffectUnit
    let transitionGain: TransitionGain
    private let stems: NativeStemSource
    private struct Deck {
        let input: AVAudioMixerNode, node: AVAudioUnit, processor: TransitionDeckProcessor
    }
    private let decks: [Deck]
    private let analysis = NativeDeckAnalysis()
    var meter: AudioMeter { unit.meter }
    var configurationChanged: (() -> Void)?
    private var sources: [ObjectIdentifier: (bus: AVAudioNodeBus, source: StreamRenderSource)] = [:]
    private var observer: NSObjectProtocol?
    private var closed = false
    private var replayGainMode = "off"
    var attachedCount: Int { sources.count }
    var running: Bool { !closed && engine.isRunning }

    private init(node: AVAudioUnit, unit: AudioEffectUnit, gain: TransitionGain, decks: [Deck]) {
        self.node = node; self.unit = unit; transitionGain = gain; self.decks = decks
        stems = NativeStemSource(gain: gain)
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        engine.attach(mixer); engine.attach(node)
        for (index, deck) in decks.enumerated() {
            engine.attach(deck.input); engine.attach(deck.node)
            engine.connect(deck.input, to: deck.node, format: format)
            engine.connect(deck.node, to: mixer, fromBus: 0, toBus: AVAudioNodeBus(index), format: format)
        }
        engine.attach(stems.node)
        engine.connect(stems.node, to: mixer, fromBus: 0, toBus: 2, format: stems.format)
        engine.connect(mixer, to: node, format: format)
        engine.connect(node, to: engine.mainMixerNode, format: format)
        observer = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange,
            object: engine, queue: .main) { [weak self] _ in
                guard let self, !self.closed else { return }
                self.transitionGain.cancel()
                self.analysis.configure(running: false)
                for entry in self.sources.values { entry.source.capture.reset(); entry.source.tempo?.invalidateMediaClock() }
                self.configurationChanged?()
            }
    }

    @MainActor static func make() async throws -> StreamMixOutput {
        let node = try await AudioEffectUnit.makeNode()
        try Task.checkCancellation()
        guard let unit = node.auAudioUnit as? AudioEffectUnit else { throw MobileFailure("audio-failed") }
        let gain = TransitionGain()
        var decks: [Deck] = []
        for _ in 0..<2 {
            let deckNode = try await AudioEffectUnit.makeNode()
            try Task.checkCancellation()
            guard let deckUnit = deckNode.auAudioUnit as? AudioEffectUnit else { throw MobileFailure("audio-failed") }
            let processor = TransitionDeckProcessor(gain: gain)
            try deckUnit.useDeck(processor)
            decks.append(Deck(input: AVAudioMixerNode(), node: deckNode, processor: processor))
        }
        return StreamMixOutput(node: node, unit: unit, gain: gain, decks: decks)
    }

    // Only sounding decks join the graph. Prepared/cancelled network work never changes audible routing.
    func attach(_ player: AudioPlayer, allowsTempo: Bool = false, replayGain: NativeReplayGainLevels = .neutral) throws {
        guard !closed else { throw MobileFailure("audio-failed") }
        let identity = ObjectIdentifier(player)
        if let entry = sources[identity] {
            guard !allowsTempo || entry.source.tempo != nil else { throw MobileFailure("tempo-unavailable") }
            return
        }
        let occupied = Set(sources.values.map(\.bus))
        guard let bus = (0..<2).map({ AVAudioNodeBus($0) }).first(where: { !occupied.contains($0) }) else {
            throw MobileFailure("audio-decks-full")
        }
        let source = try StreamRenderSource(player: player, allowsTempo: allowsTempo, replayGain: replayGain, mode: replayGainMode)
        let deck = decks[Int(bus)]
        deck.processor.source(source.identity)
        engine.attach(source.node)
        engine.connect(source.node, to: deck.input, fromBus: 0, toBus: 0, format: source.format)
        sources[identity] = (bus, source)
        analysis.add(source.capture)
    }
    func requestTempo(_ player: AudioPlayer, rate: Double) throws {
        guard !closed, let tempo = sources[ObjectIdentifier(player)]?.source.tempo else { throw MobileFailure("tempo-unavailable") }
        try tempo.request(rate: rate)
    }
    func tempoState(_ player: AudioPlayer) -> NativeTempoHandover.State? { sources[ObjectIdentifier(player)]?.source.tempo?.snapshot() }
    func mediaClock(_ player: AudioPlayer) -> NativeMediaClock? {
        guard running, let clock = tempoState(player)?.mediaClock,
              let end = transitionGain.clock.renderedEnd, clock.isCurrent(at: end) else { return nil }
        return clock
    }
    func observeTempo(_ player: AudioPlayer, changed: @escaping (Bool) -> Void) throws {
        guard !closed, let tempo = sources[ObjectIdentifier(player)]?.source.tempo else { throw MobileFailure("tempo-unavailable") }
        tempo.changed = changed
    }
    func resetTempo(_ player: AudioPlayer) throws {
        guard !closed, !engine.isRunning, let source = sources[ObjectIdentifier(player)]?.source,
              let tempo = source.tempo else { throw MobileFailure("tempo-unavailable") }
        try tempo.reset(); source.capture.reset()
    }

    func start() throws {
        guard !closed, !sources.isEmpty else { throw MobileFailure("audio-failed") }
        if !engine.isRunning {
            for entry in sources.values { entry.source.tempo?.invalidateMediaClock() }
            engine.prepare(); try engine.start()
        }
        analysis.configure(running: true)
    }
    func pause() {
        transitionGain.cancel(); engine.pause(); analysis.configure(running: false)
        for entry in sources.values { entry.source.tempo?.invalidateMediaClock() }
    }
    func setAnalysisEnabled(_ enabled: Bool) { analysis.configure(enabled: enabled) }
    func resetAnalysis(_ player: AudioPlayer) { sources[ObjectIdentifier(player)]?.source.capture.reset() }
    func replayGainDb(_ player: AudioPlayer) -> Double {
        20 * log10(max(sources[ObjectIdentifier(player)]?.source.replayGain.amplitude ?? 1, 1e-6))
    }
    @MainActor func deckState(_ player: AudioPlayer, history: Bool = false) async -> NativeDeckState? {
        guard let capture = sources[ObjectIdentifier(player)]?.source.capture else { return nil }
        let epoch = capture.currentEpoch()
        let state = await analysis.snapshot(capture, history: history)
        guard sources[ObjectIdentifier(player)]?.source.capture === capture,
              capture.currentEpoch() == epoch else { return nil }
        return state
    }
    // Original envelopes are supplied by NativeTransitionPlanner; no platform rules live in this graph.
    func scheduleGain(outgoing: AudioPlayer, incoming: AudioPlayer, envelope: NativeTransitionEnvelope,
                      generation: UInt64) throws -> Bool {
        guard !closed, let out = sources[ObjectIdentifier(outgoing)]?.source,
              let next = sources[ObjectIdentifier(incoming)]?.source else { throw MobileFailure("audio-failed") }
        guard out.format.sampleRate == next.format.sampleRate,
              out.format.sampleRate == mixer.outputFormat(forBus: 0).sampleRate else {
            throw MobileFailure("unsupported-audio-format")
        }
        let curve = try TransitionGainCurve(outgoing: out.identity, incoming: next.identity,
            out: envelope.gain.out, input: envelope.gain.in, rate: out.format.sampleRate,
            seconds: envelope.overlap, hold: envelope.hold, bands: envelope.bands, echo: envelope.echo)
        return transitionGain.schedule(curve, generation: generation)
    }
    // Prepared/aligned windows only. Model work and media-position selection stay outside the audio graph.
    func scheduleStems(outgoing: AudioPlayer, incoming: AudioPlayer, windows: NativeStemWindowPair,
                       gesture: NativeStemGesture, bus: NativeStemBusParameters, hold: Double,
                       generation: UInt64, expansion: NativeExpansionPCM? = nil) throws -> Bool {
        guard windows.seconds == gesture.schedule.windowSec else { throw MobileFailure("invalid-stem-alignment") }
        return try scheduleStems(outgoing: outgoing, incoming: incoming, outPCM: windows.outgoing, inPCM: windows.incoming,
                                 gesture: gesture, bus: bus, hold: hold, generation: generation, expansion: expansion)
    }
    func scheduleStems(outgoing: AudioPlayer, incoming: AudioPlayer, outPCM: NativeStemPCM, inPCM: NativeStemPCM,
                       gesture: NativeStemGesture, bus: NativeStemBusParameters, hold: Double,
                       generation: UInt64, expansion: NativeExpansionPCM? = nil) throws -> Bool {
        guard !closed, let out = sources[ObjectIdentifier(outgoing)]?.source,
              let next = sources[ObjectIdentifier(incoming)]?.source else { throw MobileFailure("audio-failed") }
        guard out.format.sampleRate == NativeStemPCM.rate, next.format.sampleRate == NativeStemPCM.rate,
              mixer.outputFormat(forBus: 0).sampleRate == NativeStemPCM.rate else {
            throw MobileFailure("unsupported-audio-format")
        }
        let pcm = try NativeStemMixer(outgoing: outPCM, incoming: inPCM, gesture: gesture, bus: bus,
            outLevel: out.replayGain.amplitude, inLevel: next.replayGain.amplitude, expansion: expansion)
        let schedule = try NativeStemTransition(outgoing: out.identity, incoming: next.identity, mixer: pcm,
            seconds: gesture.schedule.windowSec, hold: hold, splice: bus.spliceSec)
        return transitionGain.scheduleStems(schedule, generation: generation)
    }
    func remove(_ player: AudioPlayer) {
        guard let entry = sources.removeValue(forKey: ObjectIdentifier(player)) else { return }
        transitionGain.removeStemSource(entry.source.identity)
        analysis.remove(entry.source.capture)
        engine.disconnectNodeOutput(entry.source.node)
        engine.detach(entry.source.node)
        entry.source.close()
        if sources.isEmpty { engine.pause(); analysis.configure(running: false); unit.requestDiscontinuity() }
    }
    func apply(_ settings: NativeAudioSettings) {
        replayGainMode = settings.replayGainMode
        for entry in sources.values { entry.source.replayGain.configure(replayGainMode) }
        engine.mainMixerNode.outputVolume = settings.isMuted ? 0 : Float(settings.volume)
        meter.setOutputGain(volume: settings.volume, muted: settings.isMuted)
        meter.equalizer.configure(enabled: settings.equalizer.enabled, gains: settings.equalizer.gains)
        meter.effects.configure(settings.equalizer.enabled ? settings.equalizer.effects : NativeEqualizerSettings.neutral)
    }
    func close() {
        guard !closed else { return }
        closed = true; configurationChanged = nil
        if let observer { NotificationCenter.default.removeObserver(observer) }; observer = nil
        engine.stop(); analysis.close()
        transitionGain.closeWhileStopped()
        for entry in sources.values { engine.detach(entry.source.node); entry.source.close() }
        sources.removeAll()
    }
    deinit { close() }
}
