import XCTest
import AVFoundation
import AudioStreaming
@testable import App

// NativeStemGraphTests.swift — actual two-decoder + stem graph, shared clock and existing final effects.
@MainActor extension NativeTests {
    func testStemBusAndTwoRealDecodersShareSplicesAndFinalOutput() async throws {
        let fixture = try await StemClockFixture()
        let mono = try sharedConstantFile(seconds: 4), stereo = try sharedConstantFile(seconds: 4, stereo: true)
        defer { try? FileManager.default.removeItem(at: mono); try? FileManager.default.removeItem(at: stereo) }
        let first = try await preparedExternalPlayer(mono), second = try await preparedExternalPlayer(stereo)
        defer { first.stop(); second.stop() }
        let output = try await StreamMixOutput.make()
        defer { output.close() }
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512)!
        try output.engine.enableManualRenderingMode(.realtime, format: format, maximumFrameCount: 512)
        try output.attach(first); try output.attach(second)
        XCTAssertTrue(first.startPreparedPlayback()); XCTAssertTrue(second.startPreparedPlayback()); try output.start()
        let renderBlock = output.engine.manualRenderingBlock
        func render() {
            buffer.frameLength = 512
            var error: OSStatus = noErr
            XCTAssertEqual(renderBlock(512, buffer.mutableAudioBufferList, &error), .success); XCTAssertEqual(error, noErr)
        }
        var stable = 0
        for _ in 0..<100 {
            render()
            let matches = abs(buffer.floatChannelData![0][0] - 0.25) < 1e-6
                && abs(buffer.floatChannelData![1][511] - 0.0625) < 1e-6
            stable = matches ? stable + 1 : 0
            if stable >= 2 { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        guard stable >= 2 else { XCTFail("Real decoders did not become audible"); return }
        let expectedBuffer = StemClockFixture.buffer(35280), reference = try fixture.mixer()
        XCTAssertTrue(reference.render(expectedBuffer.mutableAudioBufferList, frames: 35280))
        let expectedPCM = expectedBuffer.floatChannelData![0], gain = output.transitionGain
        let generation = gain.cancel(), before = output.engine.manualRenderingSampleTime
        XCTAssertTrue(try output.scheduleStems(outgoing: first, incoming: second, outPCM: fixture.outPCM, inPCM: fixture.inPCM,
            gesture: fixture.gesture, bus: fixture.bus, hold: 384.25 / 44100, generation: generation))
        var maximum: Float = 0
        for _ in 0..<74 {
            let at = output.engine.manualRenderingSampleTime
            render()
            let start = try XCTUnwrap(gain.clock.curveStart)
            XCTAssertEqual(start, Double(before) + 385); XCTAssertFalse(gain.clock.stemFailed)
            for frame in 0..<512 {
                let elapsed = Double(at) + Double(frame) - start
                let out = Float(1 - min(1, max(0, elapsed / (0.008 * 44100))))
                let incoming = Float(min(1, max(0, (elapsed - (0.8 - 0.008) * 44100) / (0.008 * 44100))))
                for channel in 0..<2 {
                    let stems = elapsed >= 0 && elapsed < 35280 ? expectedPCM[Int(elapsed) * 2 + channel] : 0
                    let expected = Float(0.125) * out + (channel == 0 ? Float(0.125) : -0.0625) * incoming + stems
                    maximum = max(maximum, abs(buffer.floatChannelData![channel][frame] - expected))
                }
            }
        }
        XCTAssertLessThan(maximum, 0.000005)
        XCTAssertEqual(gain.clock.generation, generation)
        output.engine.mainMixerNode.outputVolume = 0
        for _ in 0..<8 { render() }
        for channel in 0..<2 { XCTAssertTrue(UnsafeBufferPointer(start: buffer.floatChannelData![channel], count: 512).allSatisfy { $0 == 0 }) }
        output.remove(first); XCTAssertEqual(output.attachedCount, 1)
        output.close(); XCTAssertNil(gain.clock.curveStart); XCTAssertEqual(output.attachedCount, 0)
        XCTAssertThrowsError(try output.scheduleStems(outgoing: first, incoming: second, outPCM: fixture.outPCM, inPCM: fixture.inPCM,
            gesture: fixture.gesture, bus: fixture.bus, hold: 0, generation: generation))
        print("FOLIA_STEM_SHARED_GRAPH maxPCM=\(maximum) window=0.8 rate=44100")
    }

    func testStemSourceRejectsInvalidBuffersWithoutConsumingPlan() async throws {
        let fixture = try await StemClockFixture(), gain = TransitionGain(), out = UUID(), incoming = UUID()
        let buffer = StemClockFixture.buffer(128), data = buffer.floatChannelData![0]
        XCTAssertTrue(gain.scheduleStems(try fixture.schedule(out: out, incoming: incoming), generation: gain.cancel()))
        data.update(repeating: 0.25, count: 256)
        for time in [Double.nan, .infinity, 0.5, 4_503_599_627_370_496] {
            XCTAssertFalse(gain.processStems(buffer.mutableAudioBufferList, frames: 128, sampleTime: time))
        }
        XCTAssertFalse(gain.processStems(buffer.mutableAudioBufferList, frames: 129, sampleTime: 0))
        XCTAssertEqual(data[0], 0.25); XCTAssertNil(gain.clock.curveStart)
        XCTAssertTrue(gain.processStems(buffer.mutableAudioBufferList, frames: 128, sampleTime: 1000))
        XCTAssertEqual(gain.clock.curveStart, 1000); XCTAssertGreaterThan(data[254], 0)
    }
}
