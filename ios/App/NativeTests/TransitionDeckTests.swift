import XCTest
import AVFoundation
import AudioStreaming
@testable import App

// TransitionDeckTests.swift — decoder release must not end a persistent deck's audible echo return.
@MainActor extension NativeTests {
    func testPersistentDeckEchoSurvivesDecoderReleaseAndSlotReuse() async throws {
        let mono = try sharedConstantFile(seconds: 4), stereo = try sharedConstantFile(seconds: 4, stereo: true)
        defer { try? FileManager.default.removeItem(at: mono); try? FileManager.default.removeItem(at: stereo) }
        var outgoing: AudioPlayer? = try await preparedExternalPlayer(mono)
        weak var released = outgoing
        let incoming = try await preparedExternalPlayer(stereo), replacement = try await preparedExternalPlayer(mono)
        defer { outgoing?.stop(); incoming.stop(); replacement.stop() }
        let output = try await StreamMixOutput.make()
        defer { output.close() }
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512)!
        try output.engine.enableManualRenderingMode(.realtime, format: format, maximumFrameCount: 512)
        try output.attach(outgoing!); try output.attach(incoming)
        XCTAssertTrue(outgoing!.startPreparedPlayback()); XCTAssertTrue(incoming.startPreparedPlayback())
        try output.start()
        let attachedNodes = output.engine.attachedNodes.count
        func render() {
            buffer.frameLength = 512
            var error: OSStatus = noErr
            XCTAssertEqual(output.engine.manualRenderingBlock(512, buffer.mutableAudioBufferList, &error), .success)
            XCTAssertEqual(error, noErr)
        }
        var stable = 0
        for _ in 0..<100 {
            render()
            let left = buffer.floatChannelData![0], right = buffer.floatChannelData![1]
            let audible = abs(left[0] - 0.25) < 1e-6 && abs(left[511] - 0.25) < 1e-6
                && abs(right[0] - 0.0625) < 1e-6 && abs(right[511] - 0.0625) < 1e-6
            stable = audible ? stable + 1 : 0
            if stable == 2 { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        guard stable == 2 else { XCTFail("Real decoders did not reach audible stereo baseline"); return }
        // Deliberately replace the source while the OLD send would still be open. Graph/lifecycle
        // expectations use the separately WebKit-verified executor, not a second DSP accuracy claim.
        let echo = NativeEchoSchedule(delay: 0.08, opensAt: 0.001, peaksAt: 0.02, closesAt: 0.18,
                                      send: 0.6, feedback: 0.45, defaultDelay: 0.25)
        let envelope = NativeTransitionEnvelope(style: "plainBlend", hold: 0, overlap: 0.18,
            crossover: 0.09, together: 0, shapeBands: false, sweepOut: false, snappedToBeat: false,
            gain: .init(out: [1, 0], in: [0, 1]), bands: nil, echo: echo)
        let generation = output.transitionGain.cancel()
        XCTAssertTrue(try output.scheduleGain(outgoing: outgoing!, incoming: incoming, envelope: envelope, generation: generation))
        let reference = TransitionEcho(rate: 44100)
        let anchor = Double(output.engine.manualRenderingSampleTime)
        reference.adopt(echo, generation: generation, anchor: anchor, sampleTime: anchor, immediate: false)
        let curve = try TransitionGainCurve(outgoing: UUID(), incoming: UUID(), out: [1, 0], input: [0, 1], rate: 44100, seconds: 0.18)
        var maximum: Float = 0, detachedWet: Float = 0, replacementWet: Float = 0
        for block in 0..<100 {
            let at = Double(output.engine.manualRenderingSampleTime)
            XCTAssertEqual(at, anchor + Double(block * 512), accuracy: 1e-6, "Graph edits must preserve the shared clock")
            if block == 4 {
                output.remove(outgoing!); outgoing!.stop(); outgoing = nil
                XCTAssertEqual(output.attachedCount, 1); XCTAssertTrue(output.running)
                XCTAssertEqual(output.engine.attachedNodes.count, attachedNodes - 1)
                for _ in 0..<100 {
                    if released == nil { break }
                    try await Task.sleep(nanoseconds: 10_000_000)
                }
                XCTAssertNil(released, "Release the decoder before rendering its remaining echo")
            }
            if block == 9 {
                try output.attach(replacement); XCTAssertTrue(replacement.startPreparedPlayback())
                reference.stopSending(at: at, immediate: true)
                XCTAssertEqual(output.engine.attachedNodes.count, attachedNodes)
                XCTAssertEqual(output.attachedCount, 2)
            }
            render()
            for frame in 0..<512 {
                let time = at + Double(frame), elapsed = time - anchor
                let wet = reference.next(left: block < 4 ? 0.125 : 0, right: block < 4 ? 0.125 : 0, frame: time)
                if block >= 4 && block < 9 { detachedWet = max(detachedWet, abs(wet.0)) }
                if block >= 9 { replacementWet = max(replacementWet, abs(wet.0)) }
                let old = block < 4 ? Float(0.125) * curve.value(incoming: false, elapsed: elapsed) : 0
                let new: Float = block >= 9 ? 0.125 : 0
                let gain = curve.value(incoming: true, elapsed: elapsed)
                maximum = max(maximum, abs(buffer.floatChannelData![0][frame] - (old + new + 0.125 * gain + wet.0)),
                              abs(buffer.floatChannelData![1][frame] - (old + new - 0.0625 * gain + wet.1)))
            }
        }
        XCTAssertLessThan(maximum, 1e-6)
        XCTAssertGreaterThan(detachedWet, 0.001, "The empty deck mixer must keep rendering the return")
        XCTAssertGreaterThan(replacementWet, 0.001, "A replacement must inherit wet history without entering the old send")
        XCTAssertNil(released, "Echo buffers must not retain the old decoder or its network owner")
        output.close()
        XCTAssertFalse(output.running); XCTAssertEqual(output.attachedCount, 0)
        XCTAssertThrowsError(try output.attach(replacement))
        print("FOLIA_DECK_LIFETIME maxPCM=\(maximum) detachedWet=\(detachedWet) replacementWet=\(replacementWet) decoderReleased=\(released == nil)")
    }

    func testPersistentDeckResourceReallocationPreservesEchoAndStereo() throws {
        let gain = TransitionGain(), original = UUID(), replacement = UUID()
        let processor = TransitionDeckProcessor(gain: gain)
        let schedule = NativeEchoSchedule(delay: 0.08, opensAt: 0.001, peaksAt: 0.02, closesAt: 0.18,
                                          send: 0.6, feedback: 0.45, defaultDelay: 0.25)
        let curve = try TransitionGainCurve(outgoing: original, incoming: UUID(), out: [1, 0], input: [0, 1],
                                           rate: 44100, seconds: 0.18, echo: schedule)
        let generation = gain.cancel()
        XCTAssertTrue(gain.schedule(curve, generation: generation))
        processor.source(original); try processor.prepare(rate: 44100, capacity: 512)
        let reference = TransitionEcho(rate: 44100)
        reference.adopt(schedule, generation: generation, anchor: 0, sampleTime: 0, immediate: false)
        let buffer = AVAudioPCMBuffer(pcmFormat: AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!, frameCapacity: 512)!
        buffer.frameLength = 512
        var maximum: Float = 0, wetPeak: Float = 0
        for block in 0..<60 {
            let at = Double(block * 512)
            if block == 4 {
                // Host resource growth at the same rate cannot recreate the delay. Identity replaces
                // pending source changes before rendering; only the final request may be adopted.
                try processor.prepare(rate: 44100, capacity: 1024)
                processor.source(UUID()); processor.source(replacement)
                reference.stopSending(at: at, immediate: true)
            }
            let left: Float = block < 4 ? 0.125 : -0.0625, right: Float = block < 4 ? -0.0625 : 0.125
            buffer.floatChannelData![0].update(repeating: left, count: 512)
            buffer.floatChannelData![1].update(repeating: right, count: 512)
            XCTAssertTrue(processor.process(buffer.mutableAudioBufferList, frames: 512, sampleTime: at))
            for frame in 0..<512 {
                let time = at + Double(frame)
                let wet = reference.next(left: left, right: right, frame: time)
                let dry: Float = block < 4 ? curve.value(incoming: false, elapsed: time) : 1
                maximum = max(maximum, abs(buffer.floatChannelData![0][frame] - (left * dry + wet.0)),
                              abs(buffer.floatChannelData![1][frame] - (right * dry + wet.1)))
                if block >= 4 { wetPeak = max(wetPeak, abs(wet.0)) }
            }
        }
        XCTAssertLessThan(maximum, 1e-6); XCTAssertGreaterThan(wetPeak, 0.001)
        XCTAssertThrowsError(try processor.prepare(rate: .nan, capacity: 512))
        XCTAssertThrowsError(try processor.prepare(rate: 44100, capacity: 65537))
    }
}
