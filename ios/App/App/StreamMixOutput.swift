import AVFoundation
import AudioStreaming

// StreamMixOutput.swift — one hardware output, original effect chain and master gain for native queue decks.
final class StreamMixOutput {
    let engine = AVAudioEngine()
    let mixer = AVAudioMixerNode()
    let node: AVAudioUnit
    let unit: AudioEffectUnit
    var meter: AudioMeter { unit.meter }
    var configurationChanged: (() -> Void)?
    private var sources: [ObjectIdentifier: (bus: AVAudioNodeBus, source: StreamRenderSource)] = [:]
    private var observer: NSObjectProtocol?
    private var closed = false
    var attachedCount: Int { sources.count }
    var running: Bool { !closed && engine.isRunning }

    private init(node: AVAudioUnit, unit: AudioEffectUnit) {
        self.node = node; self.unit = unit
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        engine.attach(mixer); engine.attach(node)
        engine.connect(mixer, to: node, format: format)
        engine.connect(node, to: engine.mainMixerNode, format: format)
        observer = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange,
            object: engine, queue: .main) { [weak self] _ in
                guard let self, !self.closed else { return }
                self.configurationChanged?()
            }
    }

    @MainActor static func make() async throws -> StreamMixOutput {
        let node = try await AudioEffectUnit.makeNode()
        try Task.checkCancellation()
        guard let unit = node.auAudioUnit as? AudioEffectUnit else { throw MobileFailure("audio-failed") }
        return StreamMixOutput(node: node, unit: unit)
    }

    // Only sounding decks join the graph. Prepared/cancelled network work never changes audible routing.
    func attach(_ player: AudioPlayer) throws {
        guard !closed else { throw MobileFailure("audio-failed") }
        let identity = ObjectIdentifier(player)
        if sources[identity] != nil { return }
        let occupied = Set(sources.values.map(\.bus))
        guard let bus = (0..<2).map({ AVAudioNodeBus($0) }).first(where: { !occupied.contains($0) }) else {
            throw MobileFailure("audio-decks-full")
        }
        let source = try StreamRenderSource(player: player)
        engine.attach(source.node)
        engine.connect(source.node, to: mixer, fromBus: 0, toBus: bus, format: source.format)
        sources[identity] = (bus, source)
    }

    func start() throws {
        guard !closed, !sources.isEmpty else { throw MobileFailure("audio-failed") }
        if !engine.isRunning { engine.prepare(); try engine.start() }
    }
    func pause() { engine.pause() }
    func remove(_ player: AudioPlayer) {
        guard let entry = sources.removeValue(forKey: ObjectIdentifier(player)) else { return }
        engine.disconnectNodeOutput(entry.source.node)
        engine.detach(entry.source.node)
        if sources.isEmpty { engine.pause(); unit.requestDiscontinuity() }
    }
    func apply(_ settings: NativeAudioSettings) {
        engine.mainMixerNode.outputVolume = settings.isMuted ? 0 : Float(settings.volume)
        meter.setOutputGain(volume: settings.volume, muted: settings.isMuted)
        meter.equalizer.configure(enabled: settings.equalizer.enabled, gains: settings.equalizer.gains)
        meter.effects.configure(settings.equalizer.enabled ? settings.equalizer.effects : NativeEqualizerSettings.neutral)
    }
    func close() {
        guard !closed else { return }
        closed = true; configurationChanged = nil
        if let observer { NotificationCenter.default.removeObserver(observer) }; observer = nil
        engine.stop()
        for entry in sources.values { engine.detach(entry.source.node) }
        sources.removeAll()
    }
    deinit { close() }
}
