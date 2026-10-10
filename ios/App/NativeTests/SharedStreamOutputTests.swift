import XCTest
import AVFoundation
import AudioStreaming
@testable import App

// SharedStreamOutputTests.swift — real decoder PCM pulled by one graph, without per-deck hardware or WebView.
private final class SharedStreamProbe {
    let engine = AVAudioEngine()
    let mix = AVAudioMixerNode()
    let sources: [StreamRenderSource]
    let players: [AudioPlayer]
    let effect: AVAudioUnit
    let unit: AudioEffectUnit
    let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
    let output: AVAudioPCMBuffer
    private var stopped = false

    init(players: [AudioPlayer], effect: AVAudioUnit, manual: Bool = true) throws {
        self.players = players; self.effect = effect
        unit = try XCTUnwrap(effect.auAudioUnit as? AudioEffectUnit)
        output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512)!
        sources = try players.map { try StreamRenderSource(player: $0) }
        engine.attach(mix); engine.attach(effect)
        for (index, source) in sources.enumerated() {
            engine.attach(source.node)
            engine.connect(source.node, to: mix, fromBus: 0, toBus: AVAudioNodeBus(index), format: source.format)
        }
        engine.connect(mix, to: effect, format: format)
        engine.connect(effect, to: engine.mainMixerNode, format: format)
        if manual { try engine.enableManualRenderingMode(.realtime, format: format, maximumFrameCount: 512) }
        engine.prepare(); try engine.start()
    }

    func render(blocks: Int = 8) throws -> Double {
        var total = 0.0
        for _ in 0..<blocks {
            output.frameLength = 512
            var error: OSStatus = noErr
            let status = engine.manualRenderingBlock(512, output.mutableAudioBufferList, &error)
            XCTAssertEqual(error, noErr); XCTAssertEqual(status, .success)
            for channel in 0..<2 {
                let pcm = output.floatChannelData![channel]
                for frame in 0..<512 { total += Double(pcm[frame]) }
            }
        }
        return total / Double(blocks * 512 * 2)
    }

    func stop() {
        guard !stopped else { return }
        stopped = true
        engine.stop()
        for source in sources { engine.detach(source.node) }
        players.forEach { $0.stop() }
    }
    deinit { stop() }
}

@MainActor extension NativeTests {
    func sharedConstantFile(seconds: Double = 3, stereo: Bool = false) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: stereo ? 2 : 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(seconds * 44100))!
        buffer.frameLength = buffer.frameCapacity
        buffer.floatChannelData![0].update(repeating: 0.125, count: Int(buffer.frameLength))
        if stereo { buffer.floatChannelData![1].update(repeating: -0.0625, count: Int(buffer.frameLength)) }
        let file = try AVAudioFile(forWriting: url, settings: format.settings)
        try file.write(from: buffer)
        return url
    }

    func preparedExternalPlayer(_ url: URL) async throws -> AudioPlayer {
        let player = AudioPlayer(configuration: AudioPlayerConfiguration(bufferSizeInSeconds: 4, enableLogs: false),
                                 externallyRendered: true)
        player.play(url: url)
        do {
            for _ in 0..<200 {
                try Task.checkCancellation()
                if player.bufferedDuration >= 0.75 { return player }
                if player.state == .error { throw MobileFailure("audio-failed") }
                try await Task.sleep(nanoseconds: 10_000_000)
            }
            throw MobileFailure("network-timeout")
        } catch { player.stop(); throw error }
    }

    func testExternalDecoderPreparationDoesNotConsumePCMAndValidatesBuffers() async throws {
        let url = try sharedConstantFile()
        defer { try? FileManager.default.removeItem(at: url) }
        let player = try await preparedExternalPlayer(url)
        defer { player.stop() }
        let buffer = AVAudioPCMBuffer(pcmFormat: player.externalOutputFormat, frameCapacity: 8192)!
        buffer.frameLength = 8192
        buffer.floatChannelData![0].update(repeating: 1, count: 8192 * 2)
        let before = player.bufferedDuration
        XCTAssertEqual(player.renderExternalAudio(frames: 512, output: buffer.mutableAudioBufferList), noErr)
        XCTAssertEqual(player.progress, 0); XCTAssertEqual(player.framesPlayed, 0)
        XCTAssertGreaterThanOrEqual(player.bufferedDuration, before)
        for i in 0..<1024 { XCTAssertEqual(buffer.floatChannelData![0][i], 0) }
        XCTAssertEqual(buffer.floatChannelData![0][1024], 1, "Only requested frames may be cleared")
        XCTAssertEqual(player.renderExternalAudio(frames: UInt32.max, output: buffer.mutableAudioBufferList), kAudioUnitErr_TooManyFramesToProcess)
        let mono = AVAudioPCMBuffer(pcmFormat: AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1)!, frameCapacity: 512)!
        mono.frameLength = 512
        XCTAssertEqual(player.renderExternalAudio(frames: 512, output: mono.mutableAudioBufferList), kAudioUnitErr_FormatNotSupported)
        let hardware = AudioPlayer(configuration: AudioPlayerConfiguration(enableLogs: false))
        defer { hardware.stop() }
        XCTAssertEqual(hardware.renderExternalAudio(frames: 512, output: buffer.mutableAudioBufferList), kAudioUnitErr_InvalidProperty)
    }

    func testTwoDecodedDecksSumBeforeOneEffectAndMasterGain() async throws {
        let url = try sharedConstantFile()
        defer { try? FileManager.default.removeItem(at: url) }
        let first = try await preparedExternalPlayer(url), second = try await preparedExternalPlayer(url)
        defer { first.stop(); second.stop() }
        let graph = try SharedStreamProbe(players: [first, second], effect: await AudioEffectUnit.makeNode())
        defer { graph.stop() }
        XCTAssertEqual(try graph.render(), 0)
        XCTAssertEqual(first.progress, 0); XCTAssertEqual(second.progress, 0)
        XCTAssertTrue(first.startPreparedPlayback())
        _ = try graph.render()
        XCTAssertEqual(try graph.render(), 0.125, accuracy: 0.00001)
        XCTAssertEqual(second.progress, 0, "Pending deck must retain its opening while mixer pulls it")
        XCTAssertTrue(second.startPreparedPlayback())
        _ = try graph.render()
        XCTAssertEqual(try graph.render(), 0.25, accuracy: 0.00001)
        second.pause()
        let paused = second.progress
        _ = try graph.render()
        XCTAssertEqual(try graph.render(), 0.125, accuracy: 0.00001)
        XCTAssertEqual(second.progress, paused)
        second.resume()
        _ = try graph.render()
        XCTAssertEqual(try graph.render(), 0.25, accuracy: 0.00001)
        graph.engine.mainMixerNode.outputVolume = 0
        _ = try graph.render()
        XCTAssertEqual(try graph.render(), 0, accuracy: 0.000001)
        graph.engine.mainMixerNode.outputVolume = 1
        _ = try graph.render()
        XCTAssertEqual(try graph.render(), 0.25, accuracy: 0.00001)
        second.stop()
        _ = try graph.render()
        XCTAssertEqual(try graph.render(), 0.125, accuracy: 0.00001)
        XCTAssertTrue(first.isEngineRunning)
    }

    func testExternallyRenderedDecoderSeeksAndEndsWithoutOwningHardware() async throws {
        let url = try sharedConstantFile(seconds: 1)
        defer { try? FileManager.default.removeItem(at: url) }
        let player = try await preparedExternalPlayer(url)
        let graph = try SharedStreamProbe(players: [player], effect: await AudioEffectUnit.makeNode())
        defer { graph.stop() }
        XCTAssertTrue(player.startPreparedPlayback())
        _ = try graph.render()
        player.pause(); player.seek(to: 0.6)
        player.resume()
        for _ in 0..<100 {
            if !player.isSeeking && player.bufferedDuration > 0 { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertFalse(player.isSeeking)
        _ = try graph.render()
        XCTAssertGreaterThanOrEqual(player.progress, 0.6)
        XCTAssertEqual(try graph.render(), 0.125, accuracy: 0.00001)
        for _ in 0..<20 {
            _ = try graph.render(blocks: 4)
            try await Task.sleep(nanoseconds: 5_000_000)
            if player.stopReason == .eof { break }
        }
        XCTAssertEqual(player.stopReason, .eof)
        XCTAssertEqual(try graph.render(), 0, accuracy: 0.000001)
    }

    func testSharedSourcePreservesDifferentLeftAndRightSamples() async throws {
        let url = try sharedConstantFile(stereo: true)
        defer { try? FileManager.default.removeItem(at: url) }
        let player = try await preparedExternalPlayer(url)
        let graph = try SharedStreamProbe(players: [player], effect: await AudioEffectUnit.makeNode())
        defer { graph.stop() }
        XCTAssertTrue(player.startPreparedPlayback())
        // Buffered PCM may still be below upstream's one-second start threshold. Yield to its decoder,
        // then require an advancing media clock before checking samples; never accept silence as proof.
        for _ in 0..<100 {
            _ = try graph.render(blocks: 1)
            if player.progress > 0.02 { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertGreaterThan(player.progress, 0.02)
        _ = try graph.render()
        for i in 0..<512 {
            XCTAssertEqual(graph.output.floatChannelData![0][i], 0.125, accuracy: 0.000001)
            XCTAssertEqual(graph.output.floatChannelData![1][i], -0.0625, accuracy: 0.000001)
        }
    }

    func testSharedHardwareOutputProcessesEffectsOnceAndMutesNoise() async throws {
        try AVAudioSession.sharedInstance().setCategory(.playback)
        try AVAudioSession.sharedInstance().setActive(true)
        let url = try streamingTone()
        defer { try? FileManager.default.removeItem(at: url) }
        let first = try await preparedExternalPlayer(url), second = try await preparedExternalPlayer(url)
        let graph = try SharedStreamProbe(players: [first, second], effect: await AudioEffectUnit.makeNode(), manual: false)
        let measured = OutputMeasurement()
        graph.engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { buffer, _ in measured.consume(buffer) }
        defer { graph.engine.mainMixerNode.removeTap(onBus: 0); graph.stop() }
        XCTAssertTrue(first.startPreparedPlayback()); XCTAssertTrue(second.startPreparedPlayback())
        for _ in 0..<100 {
            if first.progress > 0.2 && second.progress > 0.2 { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertGreaterThan(first.progress, 0.2); XCTAssertGreaterThan(second.progress, 0.2)
        measured.reset(); try await Task.sleep(nanoseconds: 200_000_000)
        let baseline = measured.read()
        XCTAssertEqual(baseline.channels, 2); XCTAssertGreaterThan(baseline.frames, 1000)
        XCTAssertGreaterThan(baseline.rms, 0.01)
        var effects = NativeEqualizerSettings.neutral
        effects["lowpass"] = 500
        XCTAssertTrue(graph.unit.meter.effects.configure(effects))
        for _ in 0..<100 {
            if !graph.unit.meter.effects.status.pending { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertFalse(graph.unit.meter.effects.status.pending)
        try await Task.sleep(nanoseconds: 250_000_000)
        measured.reset(); try await Task.sleep(nanoseconds: 200_000_000)
        let filtered = measured.read().rms
        XCTAssertLessThan(filtered, baseline.rms * 0.25)
        effects["lowpass"] = 20000; effects["noise"] = 0.5; effects["space"] = 0.2
        XCTAssertTrue(graph.unit.meter.effects.configure(effects))
        for _ in 0..<100 {
            if !graph.unit.meter.effects.status.pending { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertFalse(graph.unit.meter.effects.status.pending)
        try await Task.sleep(nanoseconds: 250_000_000)
        measured.reset(); try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertGreaterThan(measured.read().difference, 0.00001)
        graph.engine.mainMixerNode.outputVolume = 0
        try await Task.sleep(nanoseconds: 150_000_000)
        measured.reset(); try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertGreaterThan(measured.read().frames, 1000)
        XCTAssertLessThan(measured.read().rms, 0.000001)
        print("FOLIA_SHARED_OUTPUT twoDecoders=PASS postMixEffects=PASS baseline=\(baseline.rms) lowpass=\(filtered) finalMute=PASS")
    }
}
