import XCTest
import AVFoundation
@testable import App

// TransitionGainTests.swift — compare actual WebKit output, callback boundaries and cancellation generations.
private struct TransitionGainReference: Decodable {
    struct Case: Decodable {
        let rate: Double, start: Double, duration: Double
        let cancel: Int?
        let indices: [Int], outCurve: [Double], inCurve: [Double], outSamples: [Float], inSamples: [Float]
    }
    let frames: Int, cases: [Case]
}

@MainActor extension NativeTests {
    func testTransitionGainsMatchOriginalWebKitScheduleAndCancel() throws {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "TransitionGainReference", withExtension: "json"))
        let reference = try JSONDecoder().decode(TransitionGainReference.self, from: Data(contentsOf: url))
        XCTAssertEqual(reference.cases.count, 48)
        var maximum: Float = 0
        for row in reference.cases {
            for blocks in [[128], [7, 255, 31, 512, 3, 89]] {
                let gain = TransitionGain(), out = UUID(), next = UUID()
                let curve = try TransitionGainCurve(outgoing: out, incoming: next, out: row.outCurve, input: row.inCurve,
                    rate: row.rate, seconds: row.duration / row.rate, hold: row.start / row.rate)
                XCTAssertTrue(gain.schedule(curve, generation: gain.cancel()))
                let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: row.rate, channels: 2, interleaved: true)!
                let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512)!
                var frame = 0, block = 0, sample = 0
                var difference: Float = 0
                while frame < reference.frames {
                    if row.cancel == frame { gain.cancel() }
                    var count = min(blocks[block % blocks.count], reference.frames - frame)
                    if let cancel = row.cancel, frame < cancel { count = min(count, cancel - frame) }
                    buffer.frameLength = AVAudioFrameCount(count)
                    // Reverse callback order on alternating blocks; both halves must use the same command.
                    for incoming in block % 2 == 0 ? [false, true] : [true, false] {
                        let data = buffer.floatChannelData![0]
                        for i in 0..<count { data[i * 2] = 1; data[i * 2 + 1] = -0.5 }
                        XCTAssertTrue(gain.process(buffer.mutableAudioBufferList, frames: count,
                            sampleTime: 1_000_000_000 + Double(frame), rate: row.rate, source: incoming ? next : out))
                        var cursor = sample
                        while cursor < row.indices.count && row.indices[cursor] < frame + count {
                            let offset = row.indices[cursor] - frame
                            let expected = incoming ? row.inSamples[cursor] : row.outSamples[cursor]
                            difference = max(difference, abs(data[offset * 2] - expected), abs(data[offset * 2 + 1] + expected * 0.5))
                            cursor += 1
                        }
                    }
                    while sample < row.indices.count && row.indices[sample] < frame + count { sample += 1 }
                    frame += count; block += 1
                }
                XCTAssertEqual(sample, row.indices.count)
                maximum = max(maximum, difference)
                XCTAssertLessThan(difference, 0.000008, "rate=\(row.rate) start=\(row.start) cancel=\(row.cancel ?? -1) blocks=\(blocks)")
            }
        }
        print("FOLIA_TRANSITION_GAIN WebKitCases=48 blockPatterns=2 maxSampleError=\(maximum)")
    }

    func testTransitionGainRejectsOldIntentAndRestoresAfterPausedClockJump() throws {
        let gain = TransitionGain(), out = UUID(), next = UUID()
        let curve = try TransitionGainCurve(outgoing: out, incoming: next, out: [1, 0], input: [0, 1], rate: 44100, seconds: 1)
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 44100, channels: 2, interleaved: true)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 128)!
        buffer.frameLength = 128
        func render(_ source: UUID, _ at: Double) -> Float {
            buffer.floatChannelData![0].update(repeating: 1, count: 256)
            XCTAssertTrue(gain.process(buffer.mutableAudioBufferList, frames: 128, sampleTime: at, rate: 44100, source: source))
            return buffer.floatChannelData![0][0]
        }
        let epoch = gain.cancel()
        XCTAssertTrue(gain.schedule(curve, generation: epoch))
        XCTAssertEqual(render(out, 0), 1); XCTAssertEqual(render(next, 0), 0)
        XCTAssertEqual(render(next, 22050), 0.5, accuracy: 0.000001)
        gain.cancel()
        XCTAssertFalse(gain.schedule(curve, generation: epoch), "Late planning must not revive the fade")
        // Same quantum: a control command arriving between source pulls cannot split their schedule.
        XCTAssertEqual(render(out, 22050), 0.5, accuracy: 0.000001)
        let held = Float((22050.0 + 127) / 44100)
        XCTAssertEqual(render(next, 441000), held, accuracy: 0.000001)
        XCTAssertEqual(render(out, 441000), 1 - held, accuracy: 0.000001)
        XCTAssertEqual(render(next, 442323), 1)
        XCTAssertEqual(render(UUID(), 442451), 1, "A replacement source never inherits an old zero gain")
    }

    func testTransitionGainValidatesCurvesAndBuffersWithoutAdvancing() throws {
        let gain = TransitionGain(), out = UUID(), next = UUID()
        for values in [[Double.nan, 0], [-0.1, 0], [1.1, 0], [1]] {
            XCTAssertThrowsError(try TransitionGainCurve(outgoing: out, incoming: next, out: values, input: values, rate: 44100, seconds: 1))
        }
        for seconds in [Double.nan, .infinity, 0, -1, 30, (25 / 0.879999).nextUp] {
            XCTAssertThrowsError(try TransitionGainCurve(outgoing: out, incoming: next, out: [1, 0], input: [0, 1], rate: 44100, seconds: seconds))
        }
        let curve = try TransitionGainCurve(outgoing: out, incoming: next, out: [1, 0], input: [0, 1], rate: 44100, seconds: 1)
        XCTAssertTrue(gain.schedule(curve, generation: gain.cancel()))
        let buffer = AVAudioPCMBuffer(pcmFormat: AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 44100, channels: 2, interleaved: true)!, frameCapacity: 128)!
        buffer.frameLength = 128; buffer.floatChannelData![0].update(repeating: 1, count: 256)
        XCTAssertFalse(gain.process(buffer.mutableAudioBufferList, frames: 129, sampleTime: 0, rate: 44100, source: next))
        XCTAssertFalse(gain.process(buffer.mutableAudioBufferList, frames: 128, sampleTime: .nan, rate: 44100, source: next))
        XCTAssertEqual(buffer.floatChannelData![0][0], 1)
        XCTAssertTrue(gain.process(buffer.mutableAudioBufferList, frames: 128, sampleTime: 1000, rate: 44100, source: next))
        XCTAssertEqual(buffer.floatChannelData![0][0], 0, "Invalid buffers cannot consume a pending start")
    }

    func testOriginalTransitionEnvelopeControlsTwoRealDecodersInSharedOutput() async throws {
        try await verifyRealDecoderTransition(style: "plainBlend")
    }
    func testOriginalBandHandoverRunsBeforeFadeInTwoRealDecoders() async throws {
        try await verifyRealDecoderTransition(style: "bassSwap")
    }
    func testOriginalEchoThrowRunsBeforeFadeInTwoRealDecoders() async throws {
        try await verifyRealDecoderTransition(style: "bassSwap", echoThrow: true)
    }
    private func verifyRealDecoderTransition(style: String, echoThrow: Bool = false) async throws {
        let monoURL = try sharedConstantFile(seconds: 4), stereoURL = try sharedConstantFile(seconds: 4, stereo: true)
        defer { try? FileManager.default.removeItem(at: monoURL); try? FileManager.default.removeItem(at: stereoURL) }
        let first = try await preparedExternalPlayer(monoURL), second = try await preparedExternalPlayer(stereoURL)
        defer { first.stop(); second.stop() }
        let output = try await StreamMixOutput.make()
        defer { output.close() }
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        try output.engine.enableManualRenderingMode(.realtime, format: format, maximumFrameCount: 512)
        try output.attach(first); try output.attach(second)
        XCTAssertTrue(first.startPreparedPlayback()); XCTAssertTrue(second.startPreparedPlayback())
        try output.start()
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512)!
        let renderBlock = output.engine.manualRenderingBlock
        func pcm(_ channel: Int, _ frame: Int) -> Float {
            let list = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
            return list[channel].mData!.assumingMemoryBound(to: Float.self)[frame]
        }
        func render() throws {
            buffer.frameLength = 512
            var error: OSStatus = noErr
            XCTAssertEqual(renderBlock(512, buffer.mutableAudioBufferList, &error), .success)
            XCTAssertEqual(error, noErr)
        }
        var stable = 0
        for _ in 0..<100 {
            try render()
            let audible = abs(pcm(0, 0) - 0.25) < 0.000001 && abs(pcm(0, 511) - 0.25) < 0.000001
                && abs(pcm(1, 0) - 0.0625) < 0.000001 && abs(pcm(1, 511) - 0.0625) < 0.000001
            stable = audible ? stable + 1 : 0
            if stable == 2 { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        // Media progress can advance during the system graph's initial silent buffers.
        // This test isolates automation after real PCM is audible; startup latency is a separate acceptance item.
        guard stable == 2 else { XCTFail("Two decoded channels never reached their known baseline"); return }
        XCTAssertGreaterThanOrEqual(first.progress, 1024.0 / 44100)
        XCTAssertGreaterThanOrEqual(second.progress, 1024.0 / 44100)
        let request = try JSONSerialization.data(withJSONObject: ["version": 1,
            "plan": ["style": style, "minOverlap": 0, "tiltDb": [2.0, -2.0], "echoThrow": echoThrow],
            "timing": ["overlap": 0.1, "remaining": 0.1, "outgoingDb": NSNull(),
                       "nextBeatIn": NSNull(), "periodSec": NSNull(), "incomingLeadIn": NSNull()]])
        let envelope = try await NativeTransitionPlanner().envelope(request)
        XCTAssertGreaterThan(envelope.overlap, 0)
        XCTAssertEqual(envelope.bands != nil, style == "bassSwap")
        XCTAssertEqual(envelope.echo != nil, echoThrow)
        let referenceTone = [TransitionTone(), TransitionTone()]
        let referenceEcho = TransitionEcho(rate: 44100)
        let referenceFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 44100, channels: 2, interleaved: true)!
        let referencePCM = (0..<2).map { _ in AVAudioPCMBuffer(pcmFormat: referenceFormat, frameCapacity: 512)! }
        let bandCurve = try envelope.bands.map(TransitionBandCurve.init)
        for deck in 0..<2 {
            let data = referencePCM[deck].floatChannelData![0]
            for frame in 0..<512 { data[frame * 2] = 0.125; data[frame * 2 + 1] = deck == 0 ? 0.125 : -0.0625 }
            referenceTone[deck].consumeNeutral(data, frames: 512)
        }
        let epoch = output.transitionGain.cancel()
        XCTAssertTrue(try output.scheduleGain(outgoing: first, incoming: second, envelope: envelope, generation: epoch))
        let curve = try TransitionGainCurve(outgoing: UUID(), incoming: UUID(), out: envelope.gain.out,
            input: envelope.gain.in, rate: 44100, seconds: envelope.overlap, hold: envelope.hold)
        let scheduledAt = Double(output.engine.manualRenderingSampleTime)
        var maximum: Float = 0, maximumWet: Float = 0
        let blocks = Int(ceil((envelope.overlap + envelope.hold + (echoThrow ? 1.2 : 0)) * 44100 / 512)) + 4
        XCTAssertLessThan(blocks, 160)
        for _ in 0..<min(160, blocks) {
            let at = Double(output.engine.manualRenderingSampleTime)
            try render()
            let start = try XCTUnwrap(output.transitionGain.clock.curveStart)
            XCTAssertEqual(start, scheduledAt + envelope.hold * 44100, accuracy: 0.000001)
            referenceEcho.adopt(envelope.echo, generation: epoch, anchor: scheduledAt, sampleTime: at, immediate: false)
            for deck in 0..<2 {
                let data = referencePCM[deck].floatChannelData![0]
                for frame in 0..<512 { data[frame * 2] = 0.125; data[frame * 2 + 1] = deck == 0 ? 0.125 : -0.0625 }
                // DSP correctness is checked independently against WebKit in TransitionToneTests.
                // Here the oracle checks graph ordering, source roles, real decoder routing and the common clock.
                referenceTone[deck].process(data, frames: 512, sampleTime: at, rate: 44100, curve: bandCurve,
                    incoming: deck == 1, start: start, duration: envelope.overlap * 44100, generation: epoch, immediate: false)
            }
            for index in 0..<512 {
                let elapsed = at + Double(index) - start
                let outgoing = curve.value(incoming: false, elapsed: elapsed), incoming = curve.value(incoming: true, elapsed: elapsed)
                let wet = referenceEcho.next(left: referencePCM[0].floatChannelData![0][index * 2],
                    right: referencePCM[0].floatChannelData![0][index * 2 + 1], frame: at + Double(index))
                maximumWet = max(maximumWet, abs(wet.0), abs(wet.1))
                for channel in 0..<2 {
                    let a = referencePCM[0].floatChannelData![0][index * 2 + channel] * outgoing + (channel == 0 ? wet.0 : wet.1)
                    let b = referencePCM[1].floatChannelData![0][index * 2 + channel] * incoming
                    maximum = max(maximum, abs(pcm(channel, index) - (a + b)))
                }
            }
        }
        XCTAssertNotNil(output.transitionGain.clock.curveStart)
        XCTAssertLessThan(maximum, 0.000001)
        if echoThrow { XCTAssertGreaterThan(maximumWet, 0.001, "A zero dry fade must not silence the echo return") }
        // Removing a finished tail must leave the incoming deck at full gain and keep output running.
        output.remove(first); first.stop(); try render()
        XCTAssertTrue(output.running); XCTAssertEqual(output.attachedCount, 1)
        XCTAssertEqual(pcm(0, 511), 0.125, accuracy: 0.000001)
        XCTAssertEqual(pcm(1, 511), -0.0625, accuracy: 0.000001)
        print("FOLIA_TRANSITION_PCM maxSampleError=\(maximum)")
    }
}
