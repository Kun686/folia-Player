import XCTest
import AVFoundation
@testable import App

// NativeTempoTests.swift — compare the bounded adapter to a real system graph, including EOF and rate changes.
private final class TempoTone {
    let rate = 44100.0
    var cursor = 0
    var length = 44100
    var constant = false
    var silentFlag = false
    var failure: OSStatus = noErr
    func fill(_ flags: UnsafeMutablePointer<AudioUnitRenderActionFlags>, _ frames: UInt32,
              _ output: UnsafeMutablePointer<AudioBufferList>) -> OSStatus {
        if failure != noErr { return failure }
        if silentFlag { flags.pointee.insert(.unitRenderAction_OutputIsSilence); return noErr }
        flags.pointee.remove(.unitRenderAction_OutputIsSilence)
        let list = UnsafeMutableAudioBufferListPointer(output)
        guard list.count == 2 else { return kAudioUnitErr_FormatNotSupported }
        for channel in 0..<2 {
            let data = list[channel].mData!.assumingMemoryBound(to: Float.self)
            for frame in 0..<Int(frames) {
                let at = cursor + frame
                let frequency = channel == 0 ? 440.0 : 659.25
                let signal: Float = constant ? (channel == 0 ? 0.125 : -0.0625)
                    : Float(0.2 * sin(Double(at) * 2 * .pi * frequency / rate))
                data[frame] = at < length ? signal : 0
            }
        }
        cursor += Int(frames)
        return noErr
    }
    var pull: AURenderPullInputBlock { { [self] flags, _, frames, _, output in fill(flags, frames, output) } }
}

@MainActor extension NativeTests {
    func testNativeTempoMatchesSystemGraphAcrossRatesChangesAndEOF() throws {
        try verifyNativeTempoGraph(constant: false)
    }
    func testNativeTempoStepResponseAndLongerTailMatchSystemGraph() throws {
        try verifyNativeTempoGraph(constant: true)
    }
    private func verifyNativeTempoGraph(constant: Bool) throws {
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        var maximum: Float = 0
        for speed in [0.88, 0.95, 1, 1.05, 1.12] {
            for change in [false, true] {
                let actualInput = TempoTone(), referenceInput = TempoTone()
                actualInput.constant = constant; referenceInput.constant = constant
                let processor = try NativeTempoProcessor(format: format, rate: speed, input: actualInput.pull)
                defer { processor.close() }
                let engine = AVAudioEngine(), pitch = AVAudioUnitTimePitch()
                let source = AVAudioSourceNode(format: format) { silence, _, frames, output in
                    var flags: AudioUnitRenderActionFlags = []
                    let status = referenceInput.fill(&flags, frames, output)
                    silence.pointee = ObjCBool(flags.contains(.unitRenderAction_OutputIsSilence))
                    return status
                }
                pitch.pitch = 0; pitch.rate = Float(speed)
                engine.attach(source); engine.attach(pitch)
                engine.connect(source, to: pitch, format: format)
                engine.connect(pitch, to: engine.mainMixerNode, format: format)
                try engine.enableManualRenderingMode(.realtime, format: format, maximumFrameCount: 4096)
                engine.prepare(); try engine.start()
                defer { engine.stop() }
                let actual = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096)!
                let reference = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096)!
                var maxError: Float = 0, audibleTail: Float = 0
                for block in 0..<120 {
                    let frames: UInt32 = [128, 512, 1024, 257][block % 4]
                    if change && block == 30 {
                        try processor.request(rate: 0.91); try processor.request(rate: 1.07)
                        pitch.rate = 1.07
                    }
                    if change && block == 60 { try processor.request(rate: 1); pitch.rate = 1 }
                    actual.frameLength = frames; reference.frameLength = frames
                    var error: OSStatus = noErr
                    XCTAssertEqual(engine.manualRenderingBlock(frames, reference.mutableAudioBufferList, &error), .success)
                    XCTAssertEqual(error, noErr)
                    let status = processor.render(actual.mutableAudioBufferList, frames: frames)
                    guard status == noErr else { XCTFail("Tempo render failed: \(status)"); return }
                    XCTAssertEqual(actualInput.cursor, referenceInput.cursor, "Input requests must retain the system's ratio and rounding")
                    for channel in 0..<2 {
                        for frame in 0..<Int(frames) {
                            maxError = max(maxError, abs(actual.floatChannelData![channel][frame] - reference.floatChannelData![channel][frame]))
                            if actualInput.cursor > actualInput.length {
                                audibleTail = max(audibleTail, abs(actual.floatChannelData![channel][frame]))
                            }
                        }
                    }
                    XCTAssertEqual(processor.renderedFrames, engine.manualRenderingSampleTime)
                }
                // The comparison intentionally runs past EOF. A short tone makes the drain observable
                // in a bounded test; no completion decision is inferred from a decoder callback.
                XCTAssertGreaterThan(actualInput.cursor, actualInput.length)
                XCTAssertGreaterThan(audibleTail, 0.01)
                XCTAssertLessThan(maxError, 1e-6, "rate=\(speed), changes=\(change)")
                XCTAssertEqual(processor.latency, pitch.auAudioUnit.latency, accuracy: 1e-8)
                maximum = max(maximum, maxError)
            }
        }
        print("FOLIA_NATIVE_TEMPO constant=\(constant) systemGraphCases=10 variableBlocks=PASS rateChanges=PASS eofTail=PASS maxPCM=\(maximum)")
    }

    func testNativeTempoValidatesBeforeConsumingAndResetClearsOldAudio() throws {
        let input = TempoTone(), format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        var processor: NativeTempoProcessor? = try NativeTempoProcessor(format: format, input: input.pull)
        weak var released = processor
        let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 8192)!
        pcm.frameLength = 8192
        for rate in [Double.nan, .infinity, 0.879, 1.121] { XCTAssertThrowsError(try processor!.request(rate: rate)) }
        XCTAssertNotEqual(processor!.render(pcm.mutableAudioBufferList, frames: 8192), noErr)
        XCTAssertEqual(input.cursor, 0); XCTAssertEqual(processor!.renderedFrames, 0)
        for _ in 0..<12 {
            XCTAssertEqual(processor!.render(pcm.mutableAudioBufferList, frames: 512), noErr)
        }
        XCTAssertGreaterThan(abs(pcm.floatChannelData![0][511]), 0.01)
        try processor!.request(rate: 1.12)
        try processor!.reset()
        input.silentFlag = true
        for _ in 0..<12 {
            pcm.floatChannelData![0].update(repeating: 9, count: 512)
            pcm.floatChannelData![1].update(repeating: 9, count: 512)
            XCTAssertEqual(processor!.render(pcm.mutableAudioBufferList, frames: 512), noErr)
            for channel in 0..<2 { for frame in 0..<512 { XCTAssertEqual(pcm.floatChannelData![channel][frame], 0) } }
        }
        input.silentFlag = false; input.failure = kAudioUnitErr_CannotDoInCurrentContext
        XCTAssertEqual(processor!.render(pcm.mutableAudioBufferList, frames: 512), input.failure)
        for channel in 0..<2 { for frame in 0..<512 { XCTAssertEqual(pcm.floatChannelData![channel][frame], 0) } }
        processor!.close()
        XCTAssertThrowsError(try processor!.request(rate: 1))
        XCTAssertThrowsError(try processor!.reset())
        XCTAssertNotEqual(processor!.render(pcm.mutableAudioBufferList, frames: 512), noErr)
        processor = nil; XCTAssertNil(released)
    }

    func testNativeTempoPreservesStreamedToneDurationAndDrainsItsTail() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        defer { try? FileManager.default.removeItem(at: url) }
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        // A DC step has no musical period; the system's window adds an approximately 75ms response
        // tail. Its exact samples are covered above. Measure duration using an actual pitched tone.
        do {
            let data = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 88200)!
            data.frameLength = data.frameCapacity
            for frame in 0..<88200 {
                let sample = Float(0.2 * sin(Double(frame) * 2 * .pi * 440 / 44100))
                data.floatChannelData![0][frame] = sample; data.floatChannelData![1][frame] = -0.5 * sample
            }
            let file = try AVAudioFile(forWriting: url, settings: format.settings); try file.write(from: data)
        }
        for speed in [0.88, 1, 1.12] {
            let decoder = try await preparedExternalPlayer(url)
            defer { decoder.stop() }
            for _ in 0..<100 {
                if decoder.bufferedDuration > 1.99 { break }
                try await Task.sleep(nanoseconds: 10_000_000)
            }
            XCTAssertGreaterThan(decoder.bufferedDuration, 1.99)
            let processor = try NativeTempoProcessor(format: decoder.externalOutputFormat, rate: speed) { _, _, frames, _, output in
                decoder.renderExternalAudio(frames: frames, output: output)
            }
            defer { processor.close() }
            XCTAssertTrue(decoder.startPreparedPlayback())
            let frames: UInt32 = speed == 1.12 ? NativeTempoProcessor.maximumFrames : 512
            let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
            var first: Int?, last: Int?, exhaustedAt: Int?, tailPeak: Float = 0
            for block in 0..<Int(ceil((2 / speed + 0.5) * 44100 / Double(frames))) {
                pcm.frameLength = frames
                let status = processor.render(pcm.mutableAudioBufferList, frames: frames)
                guard status == noErr else { XCTFail("Real decoder tempo render failed: \(status)"); return }
                if exhaustedAt == nil && decoder.bufferedDuration == 0 { exhaustedAt = (block + 1) * Int(frames) }
                for frame in 0..<Int(frames) {
                    let at = block * Int(frames) + frame, left = pcm.floatChannelData![0][frame], right = pcm.floatChannelData![1][frame]
                    XCTAssertEqual(right, -0.5 * left, accuracy: 1e-5, "Both decoded channels must survive the converter")
                    if abs(left) > 0.01 { if first == nil { first = at }; last = at }
                    if let exhaustedAt, at >= exhaustedAt { tailPeak = max(tailPeak, abs(left)) }
                }
                if block % 8 == 0 { try await Task.sleep(nanoseconds: 1_000_000) }
            }
            let start = try XCTUnwrap(first), end = try XCTUnwrap(last), eof = try XCTUnwrap(exhaustedAt)
            XCTAssertEqual(Double(end - start + 1) / 44100, 2 / speed, accuracy: 0.04)
            XCTAssertGreaterThan(end, eof, "Decoder EOF must not remove still-audible output")
            XCTAssertGreaterThan(tailPeak, 0.01)
            for _ in 0..<100 {
                if decoder.stopReason == .eof { break }
                try await Task.sleep(nanoseconds: 5_000_000)
            }
            XCTAssertEqual(decoder.stopReason, .eof)
            print("FOLIA_STREAM_TEMPO rate=\(speed) block=\(frames) first=\(start) last=\(end) decoderEOF=\(eof) postEOFPeak=\(tailPeak)")
        }
    }

    func testExternalStereoDecoderRetainsEveryFinalFrameAtEOF() async throws {
        let url = try sharedConstantFile(seconds: 2, stereo: true)
        defer { try? FileManager.default.removeItem(at: url) }
        XCTAssertEqual(try AVAudioFile(forReading: url).length, 88200)
        let decoder = try await preparedExternalPlayer(url)
        defer { decoder.stop() }
        for _ in 0..<100 {
            if decoder.bufferedDuration >= 2 { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(decoder.bufferedDuration, 2, accuracy: 1e-9)
        XCTAssertTrue(decoder.startPreparedPlayback())
        let buffer = AVAudioPCMBuffer(pcmFormat: decoder.externalOutputFormat, frameCapacity: 8192)!
        var offset = 0, block = 0, maximum: Float = 0
        while offset < 96000 {
            let count: UInt32 = [4096, 512, 257, 8192][block % 4]
            buffer.frameLength = count
            XCTAssertEqual(decoder.renderExternalAudio(frames: count, output: buffer.mutableAudioBufferList), noErr)
            for frame in 0..<Int(count) {
                let playing = offset + frame < 88200
                maximum = max(maximum, abs(buffer.floatChannelData![0][frame * 2] - (playing ? 0.125 : 0)),
                              abs(buffer.floatChannelData![0][frame * 2 + 1] - (playing ? -0.0625 : 0)))
            }
            offset += Int(count); block += 1
        }
        XCTAssertEqual(maximum, 0)
        print("FOLIA_STEREO_EOF expectedFrames=88200 bufferedFrames=88200 allFramesExact=\(maximum == 0)")
    }

    func testNativeTempoCloseReleasesInputOwner() throws {
        weak var released: TempoTone?
        var processor: NativeTempoProcessor?
        try autoreleasepool {
            var owner: TempoTone? = TempoTone(); released = owner
            processor = try NativeTempoProcessor(format: AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!, input: owner!.pull)
            owner = nil; XCTAssertNotNil(released)
            processor!.close()
        }
        XCTAssertNil(released, "A closed converter cannot retain the decoder's input closure")
        XCTAssertNotNil(processor)
    }
}
