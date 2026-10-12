import XCTest
import AVFoundation
import AudioStreaming
@testable import App

// NativeExpansionGraphTests.swift — prepared original build through real decoders, cancellation and final mute.
@MainActor extension NativeTests {
    func testExpansionReachesSharedOutputAndCancelsWithStemBus() async throws {
        let fixture = try await StemClockFixture(seconds: 1.6, expansion: 1)
        let plan = try XCTUnwrap(fixture.gesture.expansion)
        let expanded = try await NativeExpansionRenderer().render(fixture.outPCM, plan: plan)
        let file = try sharedConstantFile(seconds: 4), other = try sharedConstantFile(seconds: 4, stereo: true)
        defer { try? FileManager.default.removeItem(at: file); try? FileManager.default.removeItem(at: other) }
        let first = try await preparedExternalPlayer(file), next = try await preparedExternalPlayer(other)
        defer { first.stop(); next.stop() }
        let output = try await StreamMixOutput.make(); defer { output.close() }
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512)!
        try output.engine.enableManualRenderingMode(.realtime, format: format, maximumFrameCount: 512)
        try output.attach(first); try output.attach(next)
        XCTAssertTrue(first.startPreparedPlayback()); XCTAssertTrue(next.startPreparedPlayback()); try output.start()
        let block = output.engine.manualRenderingBlock
        func render() {
            buffer.frameLength = 512; var error: OSStatus = noErr
            XCTAssertEqual(block(512, buffer.mutableAudioBufferList, &error), .success); XCTAssertEqual(error, noErr)
        }
        var stable = 0
        for _ in 0..<100 {
            render()
            stable = abs(buffer.floatChannelData![0][0] - 0.25) < 1e-6 ? stable + 1 : 0
            if stable >= 2 { break }; try await Task.sleep(nanoseconds: 10_000_000)
        }
        guard stable >= 2 else { XCTFail("Real decoders did not become audible"); return }
        let reference = try NativeStemMixer(outgoing: fixture.outPCM, incoming: fixture.inPCM, gesture: fixture.gesture,
            bus: fixture.bus, expansion: expanded), expected = StemClockFixture.buffer(512)
        let gain = output.transitionGain
        XCTAssertTrue(try output.scheduleStems(outgoing: first, incoming: next, outPCM: fixture.outPCM, inPCM: fixture.inPCM,
            gesture: fixture.gesture, bus: fixture.bus, hold: 0, generation: gain.cancel(), expansion: expanded))
        var maximum: Float = 0
        for chunk in 0..<25 {
            render(); XCTAssertTrue(reference.render(expected.mutableAudioBufferList, frames: 512))
            for i in 0..<512 { for c in 0..<2 {
                let frame = chunk * 512 + i
                let raw = Float(0.125) * Float(1 - min(1, Double(frame) / (0.008 * 44100)))
                maximum = max(maximum, abs(buffer.floatChannelData![c][i] - (expected.floatChannelData![0][i * 2 + c] + raw)))
            } }
        }
        XCTAssertLessThan(maximum, 0.000005)
        gain.cancel()
        for _ in 0..<8 { render() }
        for i in 0..<512 {
            XCTAssertEqual(buffer.floatChannelData![0][i], 0.25, accuracy: 1e-6)
            XCTAssertEqual(buffer.floatChannelData![1][i], 0.0625, accuracy: 1e-6)
        }
        output.engine.mainMixerNode.outputVolume = 0; for _ in 0..<8 { render() }
        for c in 0..<2 { XCTAssertTrue(UnsafeBufferPointer(start: buffer.floatChannelData![c], count: 512).allSatisfy { $0 == 0 }) }
        print("FOLIA_EXPANSION_SHARED_GRAPH maxPCM=\(maximum) cancelledMasterRestored=true")
    }
}
