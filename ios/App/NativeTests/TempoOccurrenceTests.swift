import XCTest
import AVFoundation
import AudioStreaming
@testable import App

// TempoOccurrenceTests.swift — real occurrence ownership across decoder EOF, pause, seek and cancellation.
@MainActor private final class TempoOccurrenceProbe {
    let output: StreamMixOutput
    let pcm: AVAudioPCMBuffer
    init() async throws {
        output = try await StreamMixOutput.make()
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512)!
        try output.engine.enableManualRenderingMode(.realtime, format: format, maximumFrameCount: 512)
    }
    func render() {
        pcm.frameLength = 512
        var error: OSStatus = noErr
        XCTAssertEqual(output.engine.manualRenderingBlock(512, pcm.mutableAudioBufferList, &error), .success)
        XCTAssertEqual(error, noErr)
    }
}

@MainActor extension NativeTests {
    func testTempoOccurrenceReportsOutputClockAndRetainsEOFUntilOutputRetires() async throws {
        let url = try sharedConstantFile(seconds: 4, stereo: true)
        defer { try? FileManager.default.removeItem(at: url) }
        let graph = try await TempoOccurrenceProbe()
        defer { graph.output.close() }
        let entry = try await StreamOccurrence.prepare(url: url, output: graph.output, allowsTempo: true)
        defer { entry.dispose() }
        try await waitForStream { entry.audio.bufferedDuration >= 4 }
        var ends = 0, failures = 0, changes = 0
        entry.ended = { ends += 1 }; entry.failed = { failures += 1 }; entry.changed = { changes += 1 }
        try entry.play()
        for _ in 0..<40 { graph.render() }
        try entry.requestTempo(rate: 1.12)
        graph.render(); graph.render()
        XCTAssertEqual(entry.tempoState?.phase, .active)
        XCTAssertEqual(entry.rate, Double(Float(1.12)))
        XCTAssertGreaterThan(entry.audio.progress - entry.position, 0.08)
        XCTAssertTrue(entry.playing)
        var sawRetainedOutput = false, tail: Float = 0
        for block in 0..<500 {
            graph.render()
            let state = try XCTUnwrap(entry.tempoState)
            XCTAssertEqual(entry.position, state.position)
            if state.decoderEnded && !state.drained {
                for frame in 0..<512 { tail = max(tail, abs(graph.pcm.floatChannelData![0][frame])) }
                if !sawRetainedOutput {
                    sawRetainedOutput = true
                    try await Task.sleep(nanoseconds: 10_000_000)
                    XCTAssertFalse(entry.hasEnded); XCTAssertEqual(ends, 0)
                    XCTAssertTrue(entry.playing, "Decoder EOF is not output EOF")
                    XCTAssertEqual(entry.duration, 4, accuracy: 0.001)
                    entry.pause(); graph.output.pause()
                    let position = entry.position
                    try await Task.sleep(nanoseconds: 20_000_000)
                    XCTAssertEqual(entry.position, position); XCTAssertFalse(entry.playing)
                    try entry.play(); XCTAssertTrue(entry.playing)
                }
            }
            if state.drained { break }
            if block % 16 == 0 { try await Task.sleep(nanoseconds: 1_000_000) }
        }
        try await waitForStream { entry.hasEnded }
        XCTAssertTrue(sawRetainedOutput); XCTAssertGreaterThan(tail, 0.01)
        XCTAssertEqual(entry.position, 4, accuracy: 0.001)
        XCTAssertFalse(entry.playing); XCTAssertEqual(ends, 1); XCTAssertEqual(failures, 0)
        XCTAssertGreaterThan(changes, 0)
        for _ in 0..<8 { graph.render() }
        try await Task.sleep(nanoseconds: 10_000_000)
        XCTAssertEqual(ends, 1)
        let oldDecoder = entry.audio
        try entry.seek(to: 0.5)
        try await waitForStream { !entry.seeking || entry.hasFailed }
        XCTAssertFalse(entry.hasFailed); XCTAssertFalse(entry.hasEnded)
        XCTAssertFalse(entry.audio === oldDecoder)
        // A library callback already enqueued before detachment still belongs to its old decoder.
        entry.audioPlayerUnexpectedError(player: oldDecoder, error: .audioSystemError(.engineFailure))
        XCTAssertFalse(entry.hasFailed); XCTAssertEqual(failures, 0)
        graph.render()
        XCTAssertGreaterThan(entry.position, 0.5); XCTAssertLessThan(entry.position, 0.55)
        XCTAssertTrue(entry.playing); XCTAssertEqual(ends, 1)
        print("FOLIA_TEMPO_OCCURRENCE retainedTail=\(tail) replayPosition=\(entry.position) completionCount=\(ends)")
    }

    func testTempoOccurrenceLatestSeekKeepsPauseAndCanSeekAfterEOF() async throws {
        let url = try sharedConstantFile(seconds: 4, stereo: true)
        defer { try? FileManager.default.removeItem(at: url) }
        let graph = try await TempoOccurrenceProbe()
        defer { graph.output.close() }
        let gain = try await NativeTransitionPlanner().replayGain(NativeReplayGainInfo(["trackGain": -6.0]))
        var settings = NativeAudioSettings(); settings.replayGainMode = "track"; graph.output.apply(settings)
        let entry = try await StreamOccurrence.prepare(url: url, output: graph.output, allowsTempo: true, replayGainLevels: gain)
        defer { entry.dispose() }
        try await waitForStream { entry.audio.bufferedDuration >= 4 }
        try entry.play()
        for _ in 0..<40 { graph.render() }
        try entry.requestTempo(rate: 0.88); graph.render(); graph.render()
        XCTAssertEqual(entry.tempoState?.phase, .active)
        try entry.requestTempo(rate: 1.12)
        try entry.seek(to: 0.75); try entry.seek(to: 1.5); entry.pause()
        XCTAssertEqual(entry.position, 1.5); XCTAssertFalse(graph.output.running)
        try await waitForStream { !entry.seeking || entry.hasFailed }
        XCTAssertFalse(entry.hasFailed); XCTAssertFalse(entry.playing); XCTAssertFalse(graph.output.running)
        XCTAssertEqual(entry.position, 1.5, accuracy: 0.001)
        XCTAssertEqual(entry.tempoState?.phase, .raw); XCTAssertEqual(entry.rate, 1)
        try entry.play()
        for _ in 0..<10 { graph.render() } // Original 100ms gain ramp after reattachment.
        for _ in 0..<25 {
            graph.render()
            for frame in 0..<512 {
                XCTAssertEqual(graph.pcm.floatChannelData![0][frame], Float(0.125 * gain.track), accuracy: 1e-6)
                XCTAssertEqual(graph.pcm.floatChannelData![1][frame], Float(-0.0625 * gain.track), accuracy: 1e-6)
            }
        }
        XCTAssertEqual(entry.tempoState?.phase, .raw)
        try entry.seek(to: 4)
        XCTAssertTrue(entry.hasEnded); XCTAssertEqual(entry.position, 4)
        try entry.seek(to: 0.1); try entry.seek(to: 0.25); entry.pause()
        try await waitForStream { !entry.seeking || entry.hasFailed }
        XCTAssertFalse(entry.hasFailed); XCTAssertFalse(entry.hasEnded); XCTAssertFalse(entry.playing)
        XCTAssertEqual(entry.position, 0.25, accuracy: 0.001)
        try entry.play(); for _ in 0..<12 { graph.render() }
        XCTAssertGreaterThan(entry.position, 0.25); XCTAssertTrue(entry.playing)
        XCTAssertEqual(graph.pcm.floatChannelData![0][511], Float(0.125 * gain.track), accuracy: 1e-6)
        XCTAssertEqual(graph.pcm.floatChannelData![1][511], Float(-0.0625 * gain.track), accuracy: 1e-6)
        print("FOLIA_TEMPO_SEEK latestPosition=1.5 paused=true oldRateCleared=true replayPosition=\(entry.position)")
    }

    func testDisposingTempoOccurrenceCancelsPendingSeekAndOutputNotices() async throws {
        let url = try sharedConstantFile(seconds: 4, stereo: true)
        defer { try? FileManager.default.removeItem(at: url) }
        let graph = try await TempoOccurrenceProbe()
        defer { graph.output.close() }
        var entry: StreamOccurrence? = try await StreamOccurrence.prepare(url: url, output: graph.output, allowsTempo: true)
        weak var decoder = entry?.audio
        weak var released = entry
        var callbacks = 0
        entry!.changed = { callbacks += 1 }; entry!.failed = { callbacks += 1 }; entry!.ended = { callbacks += 1 }
        try entry!.play()
        for _ in 0..<40 { graph.render() }
        try entry!.requestTempo(rate: 1.12); graph.render()
        try entry!.seek(to: 1)
        let previous = callbacks
        entry!.dispose(); entry = nil
        try await waitForStream { released == nil && decoder == nil }
        XCTAssertEqual(callbacks, previous)
        XCTAssertEqual(graph.output.attachedCount, 0); XCTAssertFalse(graph.output.running)
    }

    #if FOLIA_AUDIO_OUTPUT_PROBE
    func testHTTPTempoOccurrenceOwnsClockAndCancelsRepeatedSeekWithoutWebView() async throws {
        try AVAudioSession.sharedInstance().setCategory(.playback)
        try AVAudioSession.sharedInstance().setActive(true)
        let output = try await StreamMixOutput.make()
        let measured = OutputMeasurement()
        output.engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { buffer, _ in measured.consume(buffer) }
        defer { output.engine.mainMixerNode.removeTap(onBus: 0); output.close() }
        let entry = try await StreamOccurrence.prepare(url: URL(string: "http://127.0.0.1:18779/mono.wav")!,
                                                       output: output, allowsTempo: true)
        defer { entry.dispose() }
        try entry.play()
        try await waitForStream { entry.position > 0.25 }
        try entry.requestTempo(rate: 1.12)
        try await waitForStream { entry.rate == Double(Float(1.12)) }
        XCTAssertEqual(entry.tempoState?.phase, .active)
        try entry.seek(to: 8); try entry.seek(to: 11); entry.pause()
        XCTAssertFalse(output.running)
        try await waitForStream { !entry.seeking || entry.hasFailed }
        XCTAssertFalse(entry.hasFailed); XCTAssertFalse(entry.playing); XCTAssertFalse(output.running)
        XCTAssertEqual(entry.position, 11, accuracy: 0.04); XCTAssertEqual(entry.rate, 1)
        try entry.play()
        try await waitForStream { entry.position > 11.25 }
        try entry.requestTempo(rate: 0.88)
        try await waitForStream { entry.rate == Double(Float(0.88)) }
        measured.reset()
        let began = entry.position
        try await waitForStream { entry.position > began + 0.4 }
        let pcm = measured.read()
        XCTAssertEqual(pcm.channels, 2); XCTAssertGreaterThan(pcm.frames, 1000); XCTAssertGreaterThan(pcm.rms, 0.01)
        XCTAssertEqual(entry.position, try XCTUnwrap(entry.tempoState).position)
        print("FOLIA_HTTP_TEMPO_OCCURRENCE channels=\(pcm.channels) frames=\(pcm.frames) rms=\(pcm.rms) position=\(entry.position) rate=\(entry.rate)")
    }
    #endif
}
