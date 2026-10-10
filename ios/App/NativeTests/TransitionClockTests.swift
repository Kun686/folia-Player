import XCTest
import AVFoundation
@testable import App

// TransitionClockTests.swift — inspect actual engine timestamps before choosing a native automation clock.
private final class RenderClockProbe {
    private let lock = NSLock()
    private var samples: [(host: UInt64, start: Double, frames: UInt32)] = []
    func record(_ time: AudioTimeStamp, frames: UInt32) {
        lock.lock(); defer { lock.unlock() }
        if samples.count == 256 { samples.removeFirst(128) }
        samples.append((time.mHostTime, time.mSampleTime, frames))
    }
    func read() -> [(host: UInt64, start: Double, frames: UInt32)] {
        lock.lock(); defer { lock.unlock() }; return samples
    }
}

@MainActor extension NativeTests {
    func testIsolateDecoderAndSystemTimePitchStartupLatency() async throws {
        let rate = 44100.0
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 2, interleaved: true)!
        // Match the dependency's input-node/manual-render graph; only the system TimePitch differs.
        func systemLatency(withTimePitch: Bool) throws -> Int {
            let engine = AVAudioEngine(), pitch = AVAudioUnitTimePitch()
            let input = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512)!
            input.frameLength = 512; input.floatChannelData![0].update(repeating: 0.125, count: 1024)
            try engine.enableManualRenderingMode(.realtime, format: format, maximumFrameCount: 512)
            XCTAssertTrue(engine.inputNode.setManualRenderingInputPCMFormat(format) { _ in input.audioBufferList })
            if withTimePitch {
                pitch.overlap = 4; pitch.pitch = 0; pitch.bypass = true
                engine.attach(pitch)
                engine.connect(engine.inputNode, to: pitch, format: nil)
                engine.connect(pitch, to: engine.mainMixerNode, format: nil)
            } else { engine.connect(engine.inputNode, to: engine.mainMixerNode, format: nil) }
            engine.prepare(); try engine.start()
            defer { engine.stop() }
            let render = engine.manualRenderingBlock
            let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512)!
            for block in 0..<32 {
                output.frameLength = 512
                var error: OSStatus = noErr
                XCTAssertEqual(render(512, output.mutableAudioBufferList, &error), .success)
                XCTAssertEqual(error, noErr)
                for frame in 0..<512 where abs(output.floatChannelData![0][frame * 2]) > 0.01 {
                    return block * 512 + frame
                }
            }
            XCTFail("System graph did not produce PCM"); return -1
        }
        let plain = try systemLatency(withTimePitch: false), bypass = try systemLatency(withTimePitch: true)
        let url = try sharedConstantFile(seconds: 4)
        defer { try? FileManager.default.removeItem(at: url) }
        let decoder = try await preparedExternalPlayer(url)
        defer { decoder.stop() }
        for _ in 0..<100 {
            if decoder.bufferedDuration > 3.9 { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertGreaterThan(decoder.bufferedDuration, 3.9)
        XCTAssertTrue(decoder.startPreparedPlayback())
        let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512)!
        var first = -1, last = -1, audible = 0
        for block in 0..<360 {
            output.frameLength = 512
            XCTAssertEqual(decoder.renderExternalAudio(frames: 512, output: output.mutableAudioBufferList), noErr)
            for frame in 0..<512 where abs(output.floatChannelData![0][frame * 2]) > 0.01 {
                let at = block * 512 + frame
                if first < 0 { first = at }; last = at; audible += 1
            }
        }
        XCTAssertEqual(plain, 0)
        XCTAssertGreaterThan(bypass, 0, "Bypass retains the system TimePitch latency")
        XCTAssertEqual(first, 0, "External PCM must not inherit TimePitch startup silence")
        XCTAssertEqual(audible, 176400, "The last partial buffer must retain every decoded frame")
        XCTAssertEqual(last, 176399)
        print("FOLIA_STARTUP_LATENCY plain=\(plain) bypassedTimePitch=\(bypass) decoderFirst=\(first) decoderLast=\(last) audibleFrames=\(audible) consumedFrames=\(decoder.framesPlayed)")
    }

    func testNativeSourceClockAcrossLateAttachPauseAndRestart() async throws {
        try AVAudioSession.sharedInstance().setCategory(.playback)
        try AVAudioSession.sharedInstance().setActive(true)
        let engine = AVAudioEngine(), mix = AVAudioMixerNode()
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        let first = RenderClockProbe(), second = RenderClockProbe()
        func source(_ probe: RenderClockProbe) -> AVAudioSourceNode {
            AVAudioSourceNode(format: format) { silence, time, frames, output in
                probe.record(time.pointee, frames: frames)
                for buffer in UnsafeMutableAudioBufferListPointer(output) {
                    if let data = buffer.mData { memset(data, 0, Int(buffer.mDataByteSize)) }
                }
                silence.pointee = true
                return noErr
            }
        }
        let outgoing = source(first), incoming = source(second)
        engine.attach(mix); engine.attach(outgoing)
        engine.connect(outgoing, to: mix, fromBus: 0, toBus: 0, format: format)
        engine.connect(mix, to: engine.mainMixerNode, format: format)
        engine.prepare(); try engine.start()
        defer { engine.stop() }
        try await Task.sleep(nanoseconds: 150_000_000)
        engine.attach(incoming)
        engine.connect(incoming, to: mix, fromBus: 0, toBus: 1, format: format)
        try await Task.sleep(nanoseconds: 150_000_000)
        let before = try XCTUnwrap(first.read().last)
        let joined = try XCTUnwrap(second.read().first)
        engine.pause()
        let stopped = try XCTUnwrap(first.read().last)
        try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertEqual(first.read().last?.host, stopped.host)
        try engine.start()
        try await Task.sleep(nanoseconds: 150_000_000)
        let resumed = try XCTUnwrap(first.read().first { $0.host > stopped.host })
        engine.stop(); let reset = try XCTUnwrap(first.read().last)
        engine.prepare(); try engine.start()
        try await Task.sleep(nanoseconds: 150_000_000)
        let restarted = try XCTUnwrap(first.read().first { $0.host > reset.host })
        let a = first.read(), b = second.read()
        let pairs = b.compactMap { point -> Double? in
            guard let match = a.first(where: { $0.host == point.host }) else { return nil }
            return abs(point.start - match.start)
        }
        XCTAssertFalse(pairs.isEmpty)
        XCTAssertEqual(pairs.max() ?? -1, 0, accuracy: 0.000001)
        XCTAssertTrue(a.allSatisfy { $0.start.isFinite && $0.frames > 0 })
        print("FOLIA_NATIVE_CLOCK lateJoinFirst=\(joined.start) beforePause=\(before.start) pausedEnd=\(stopped.start + Double(stopped.frames)) resumeStart=\(resumed.start) stoppedEnd=\(reset.start + Double(reset.frames)) restartStart=\(restarted.start) commonHostPairs=\(pairs.count) maximumSampleDifference=\(pairs.max() ?? -1)")
    }

    func testSystemTempoPitchDurationAndInputLatencyAcrossOriginalRange() throws {
        let rate = 44100.0, length = 132300
        let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2)!
        for speed: Float in [0.88, 0.95, 1, 1.05, 1.12] {
            let engine = AVAudioEngine(), pitch = AVAudioUnitTimePitch()
            var supplied = 0
            let source = AVAudioSourceNode(format: format) { silence, _, frames, output in
                let buffers = UnsafeMutableAudioBufferListPointer(output)
                for channel in 0..<2 {
                    let data = buffers[channel].mData!.assumingMemoryBound(to: Float.self)
                    let frequency = channel == 0 ? 440.0 : 659.25
                    for frame in 0..<Int(frames) {
                        let index = supplied + frame
                        data[frame] = index < length ? Float(0.2 * sin(Double(index) * 2 * .pi * frequency / rate)) : 0
                    }
                }
                supplied += Int(frames); silence.pointee = false
                return noErr
            }
            pitch.pitch = 0; pitch.rate = speed
            engine.attach(source); engine.attach(pitch)
            engine.connect(source, to: pitch, format: format)
            engine.connect(pitch, to: engine.mainMixerNode, format: format)
            try engine.enableManualRenderingMode(.realtime, format: format, maximumFrameCount: 512)
            engine.prepare(); try engine.start()
            defer { engine.stop() }
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512)!
            var pcm = [[Float](), [Float]()], checkpoints = [Int]()
            for block in 0..<Int(ceil((3 / Double(speed) + 0.5) * rate / 512)) {
                buffer.frameLength = 512
                var error: OSStatus = noErr
                XCTAssertEqual(engine.manualRenderingBlock(512, buffer.mutableAudioBufferList, &error), .success)
                XCTAssertEqual(error, noErr)
                for channel in 0..<2 {
                    pcm[channel].append(contentsOf: UnsafeBufferPointer(start: buffer.floatChannelData![channel], count: 512))
                }
                if block == 0 || block == 85 || block == 171 { checkpoints.append(supplied) }
            }
            let first = try XCTUnwrap(pcm[0].firstIndex(where: { abs($0) > 0.01 }))
            let last = try XCTUnwrap(pcm[0].lastIndex(where: { abs($0) > 0.01 }))
            // Pitch is measured in a settled one-second window using interpolated positive crossings.
            // This verifies preservation of BOTH channel frequencies, not equality to another stretcher.
            var frequencies = [Double]()
            for channel in 0..<2 {
                var crossings = [Double]()
                for index in 22050..<66150 where pcm[channel][index - 1] <= 0 && pcm[channel][index] > 0 {
                    let a = Double(pcm[channel][index - 1]), b = Double(pcm[channel][index])
                    crossings.append(Double(index - 1) - a / (b - a))
                }
                let measured = Double(crossings.count - 1) * rate / (try XCTUnwrap(crossings.last) - XCTUnwrap(crossings.first))
                frequencies.append(measured)
                XCTAssertEqual(measured, channel == 0 ? 440 : 659.25, accuracy: 1)
            }
            let audible = Double(last - first + 1) / rate
            XCTAssertEqual(audible, 3 / Double(speed), accuracy: 0.12, "System window boundaries are not a zero-latency clock")
            print("FOLIA_SYSTEM_TEMPO speed=\(speed) latency=\(pitch.auAudioUnit.latency) tail=\(pitch.auAudioUnit.tailTime) first=\(first) last=\(last) supplied=\(checkpoints) frequencies=\(frequencies) audible=\(audible)")
        }
    }
}
