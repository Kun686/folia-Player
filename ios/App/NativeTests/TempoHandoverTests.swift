import XCTest
import AVFoundation
import AudioStreaming
import QuartzCore
@testable import App

// TempoHandoverTests.swift — warm at unity before bending; neither reader may steal the other's PCM.
private final class WarmSystemReference {
    private let engine = AVAudioEngine(), pitch = AVAudioUnitTimePitch()
    private let pcm: AVAudioPCMBuffer
    private let supplied: ReferenceCursor
    private var rate: Float = 1
    private final class ReferenceCursor { var value: Int; init(_ value: Int) { self.value = value } }
    init(origin: Int, sample: @escaping (Int, Int) -> Float) throws {
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096)!
        let supplied = ReferenceCursor(origin); self.supplied = supplied
        let source = AVAudioSourceNode(format: format) { silence, _, frames, output in
            let list = UnsafeMutableAudioBufferListPointer(output)
            for channel in 0..<2 {
                let data = list[channel].mData!.assumingMemoryBound(to: Float.self)
                for frame in 0..<Int(frames) { data[frame] = sample(supplied.value + frame, channel) }
            }
            supplied.value += Int(frames); silence.pointee = false
            return noErr
        }
        pitch.pitch = 0; pitch.rate = 1
        engine.attach(source); engine.attach(pitch)
        engine.connect(source, to: pitch, format: format)
        engine.connect(pitch, to: engine.mainMixerNode, format: format)
        try engine.enableManualRenderingMode(.realtime, format: format, maximumFrameCount: 4096)
        engine.prepare(); try engine.start()
    }
    func render(frames: Int, rate: Float = 1) throws -> [Float] {
        if self.rate != rate { pitch.rate = rate; self.rate = rate }
        var result = [Float](), remaining = frames
        while remaining > 0 {
            let count = min(remaining, 4096); pcm.frameLength = UInt32(count)
            var error: OSStatus = noErr
            guard engine.manualRenderingBlock(UInt32(count), pcm.mutableAudioBufferList, &error) == .success,
                  error == noErr else { throw MobileFailure("audio-failed") }
            for frame in 0..<count { for channel in 0..<2 { result.append(pcm.floatChannelData![channel][frame]) } }
            remaining -= count
        }
        return result
    }
    deinit { engine.stop() }
}

private final class LimitedTempoFeed: NativeTempoFeed {
    let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 44100, channels: 2, interleaved: true)!
    var cursor = 0, available = 12000
    let length = 24000
    var closed = false
    var position: Double { Double(cursor) / 44100 }
    var isSeeking = false, isPaused = false
    static func sample(_ frame: Int, _ channel: Int) -> Float { Float((frame * 17 + channel * 71) % 997) / 4000 }
    func read(frames: AVAudioFrameCount, output: UnsafeMutablePointer<AudioBufferList>,
              observation: UnsafeMutablePointer<AudioPlayer.ExternalAudioRead>) -> OSStatus {
        guard !closed else { return kAudioUnitErr_Uninitialized }
        let count = min(Int(frames), max(0, min(available, length) - cursor))
        let data = output.pointee.mBuffers.mData!.assumingMemoryBound(to: Float.self)
        for frame in 0..<Int(frames) {
            for channel in 0..<2 { data[frame * 2 + channel] = frame < count ? Self.sample(cursor + frame, channel) : 0 }
        }
        cursor += count
        observation.pointee = AudioPlayer.ExternalAudioRead()
        observation.pointee.frames = AVAudioFrameCount(count)
        observation.pointee.position = position
        observation.pointee.endOfStream = cursor == length
        return noErr
    }
    func close() { closed = true }
}

@MainActor extension NativeTests {
    func testStemStartUsesNearestHostSampleWithoutRejectingTailEndingCoverage() async throws {
        let planner = NativeTransitionPlanner()
        for fractional in [0.0, 0.015625, 0.25, 0.5, 0.75, 0.984375] {
            let clock = NativeMediaClock(source: UUID(), epoch: 0, sampleRate: 44100,
                sampleEnd: 100000, mediaEnd: 9 + fractional / 44100, quantumFrames: 512)
            let hold = 10 - clock.mediaEnd
            let start = try XCTUnwrap(NativeStemAlignment.start(clock: clock, hold: hold))
            let position = try XCTUnwrap(clock.position(at: start))
            XCTAssertLessThanOrEqual(abs(position - 10) * 44100, 0.500001)
            let coverage = try await planner.stemWindow(JSONSerialization.data(withJSONObject: ["version": 1,
                "outAt": position, "outFrom": 0, "outFrames": 529200, "inAt": 1, "inFrom": 0,
                "inFrames": 529200, "seconds": 2, "lateBy": 0]))
            XCTAssertTrue(coverage.covered, "fractional media origin=\(fractional)")
        }
    }
    func testStemAlignmentValidatesBothRenderOrdersAndRejectsChangedMediaEpoch() throws {
        let a = LimitedTempoFeed(), b = LimitedTempoFeed()
        let outgoing = try NativeTempoHandover(source: a), incoming = try NativeTempoHandover(source: b)
        defer { outgoing.close(); incoming.close() }
        let pcm = StemClockFixture.buffer(128)
        func render(_ deck: NativeTempoHandover, _ frame: Double) {
            XCTAssertEqual(deck.render(pcm.mutableAudioBufferList, frames: 128, sampleTime: frame), noErr)
        }
        render(outgoing, 0); render(incoming, 0)
        let clocks = try XCTUnwrap(NativeStemClocks(outgoing: outgoing.snapshot().mediaClock, incoming: incoming.snapshot().mediaClock))
        let alignment = try NativeStemAlignment(clocks: clocks, plannedStart: 512, outFrom: 0, inFrom: 0,
            outgoing: outgoing, incoming: incoming)
        XCTAssertTrue(alignment.valid(at: 128, frames: 128))
        render(incoming, 128)
        XCTAssertTrue(alignment.valid(at: 128, frames: 128), "Incoming may render before the gate")
        render(outgoing, 128)
        XCTAssertTrue(alignment.valid(at: 128, frames: 128))
        XCTAssertEqual(try XCTUnwrap(alignment.offsets(at: 512)).outgoing, 512, accuracy: 1e-9)
        render(outgoing, 256)
        XCTAssertTrue(alignment.valid(at: 256, frames: 128), "Outgoing may render first as well")
        b.isPaused = true; render(incoming, 256)
        XCTAssertFalse(alignment.valid(at: 256, frames: 128))
        b.isPaused = false; render(incoming, 384); render(outgoing, 384)
        XCTAssertNotNil(incoming.renderMediaClock)
        XCTAssertFalse(alignment.valid(at: 384, frames: 128), "Resume cannot revive an anchor from before the pause")
        let replacement = try XCTUnwrap(NativeStemClocks(outgoing: outgoing.snapshot().mediaClock, incoming: incoming.snapshot().mediaClock))
        let fresh = try NativeStemAlignment(clocks: replacement, plannedStart: 512, outFrom: 0, inFrom: 0,
            outgoing: outgoing, incoming: incoming)
        XCTAssertTrue(fresh.valid(at: 512, frames: 128))
        b.available = b.cursor
        render(incoming, 512); render(outgoing, 512)
        XCTAssertFalse(fresh.valid(at: 512, frames: 128), "Underrun revokes the exact media projection")
    }
    func testExactMediaClockTracksHostFramesAndRejectsStaleOrDiscontinuousAnchors() throws {
        var tracker = NativeMediaClockTracker()
        let first = try XCTUnwrap(tracker.record(sampleTime: 100000, frames: 128, sampleRate: 44100,
            mediaEnd: 2 + 128 / 44100.0, complete: true))
        XCTAssertEqual(try XCTUnwrap(first.position(at: 100000)), 2, accuracy: 1e-12)
        XCTAssertEqual(try XCTUnwrap(first.position(at: 144100)), 3, accuracy: 1e-12)
        XCTAssertTrue(first.isCurrent(at: 100128)); XCTAssertFalse(first.isCurrent(at: 100256))
        XCTAssertFalse(first.isCurrent(at: 100127)); XCTAssertFalse(first.isCurrent(at: 100129))
        XCTAssertNil(first.position(at: .nan)); XCTAssertNil(first.position(at: 0.5))
        let continuous = try XCTUnwrap(tracker.record(sampleTime: 100128, frames: 257, sampleRate: 44100,
            mediaEnd: 2 + 385 / 44100.0, complete: true))
        XCTAssertEqual(first.source, continuous.source); XCTAssertEqual(first.epoch, continuous.epoch)
        let moved = try XCTUnwrap(tracker.record(sampleTime: 100385, frames: 128, sampleRate: 44100,
            mediaEnd: 5, complete: true))
        XCTAssertNotEqual(moved.epoch, continuous.epoch, "A media jump invalidates an earlier projection")
        let restarted = try XCTUnwrap(tracker.record(sampleTime: 0, frames: 128, sampleRate: 44100,
            mediaEnd: 5 + 128 / 44100.0, complete: true))
        XCTAssertNotEqual(restarted.epoch, moved.epoch, "A rebuilt host graph cannot reuse its former sample timeline")
        for invalid in [Double?.none, .nan, .infinity, 0.5, 4_503_599_627_370_496] {
            XCTAssertNil(tracker.record(sampleTime: invalid, frames: 128, sampleRate: 44100, mediaEnd: 5, complete: true))
        }
        XCTAssertNil(tracker.record(sampleTime: 128, frames: 128, sampleRate: 44100, mediaEnd: 5, complete: false))
        tracker.invalidate()
        let recovered = try XCTUnwrap(tracker.record(sampleTime: 256, frames: 128, sampleRate: 44100, mediaEnd: 6, complete: true))
        XCTAssertNotEqual(recovered.epoch, restarted.epoch)
        var replacement = NativeMediaClockTracker()
        let other = try XCTUnwrap(replacement.record(sampleTime: 256, frames: 128, sampleRate: 44100, mediaEnd: 6, complete: true))
        XCTAssertNotEqual(other.source, recovered.source)
    }

    func testExactPCMClockIsRevokedOnUnderflowPauseSeekBendAndClose() throws {
        let input = LimitedTempoFeed(), tested = try NativeTempoHandover(source: input)
        defer { tested.close() }
        let pcm = AVAudioPCMBuffer(pcmFormat: input.format, frameCapacity: 512)!
        pcm.frameLength = 512; input.available = 768
        XCTAssertEqual(tested.render(pcm.mutableAudioBufferList, frames: 512, sampleTime: 10000), noErr)
        let first = try XCTUnwrap(tested.snapshot().mediaClock)
        XCTAssertEqual(try XCTUnwrap(first.position(at: 10000)), 0, accuracy: 1e-12)
        XCTAssertEqual(tested.render(pcm.mutableAudioBufferList, frames: 512, sampleTime: 10512), noErr)
        XCTAssertNil(tested.snapshot().mediaClock, "A half-filled buffer cannot project a moving media clock")
        XCTAssertEqual(tested.snapshot().position, 768 / 44100.0, accuracy: 1e-12)
        input.available = input.length
        XCTAssertEqual(tested.render(pcm.mutableAudioBufferList, frames: 512, sampleTime: 11024), noErr)
        let resumed = try XCTUnwrap(tested.snapshot().mediaClock)
        XCTAssertNotEqual(resumed.epoch, first.epoch)
        XCTAssertEqual(try XCTUnwrap(resumed.position(at: 11024)), 768 / 44100.0, accuracy: 1e-12)
        for i in 0..<512 { for channel in 0..<2 {
            XCTAssertEqual(pcm.floatChannelData![0][i * 2 + channel], LimitedTempoFeed.sample(768 + i, channel))
        } }
        input.isPaused = true
        XCTAssertEqual(tested.render(pcm.mutableAudioBufferList, frames: 512, sampleTime: 11536), noErr)
        XCTAssertNil(tested.snapshot().mediaClock)
        input.isPaused = false
        XCTAssertEqual(tested.render(pcm.mutableAudioBufferList, frames: 512, sampleTime: 12048), noErr)
        XCTAssertNotNil(tested.snapshot().mediaClock)
        try tested.request(rate: 1.1)
        XCTAssertNil(tested.snapshot().mediaClock, "A pending bend revokes the control-side anchor immediately")
        XCTAssertEqual(tested.render(pcm.mutableAudioBufferList, frames: 512, sampleTime: 12560), noErr)
        XCTAssertNil(tested.snapshot().mediaClock)
        input.cursor = 4410; try tested.reset()
        XCTAssertNil(tested.snapshot().mediaClock)
        XCTAssertEqual(tested.render(pcm.mutableAudioBufferList, frames: 512, sampleTime: 0), noErr)
        XCTAssertEqual(try XCTUnwrap(tested.snapshot().mediaClock?.position(at: 0)), 0.1, accuracy: 1e-12)
        input.isSeeking = true
        XCTAssertNotEqual(tested.render(pcm.mutableAudioBufferList, frames: 512, sampleTime: 512), noErr)
        XCTAssertNil(tested.snapshot().mediaClock)
        input.isSeeking = false; try tested.reset()
        XCTAssertEqual(tested.render(pcm.mutableAudioBufferList, frames: 512, sampleTime: 1024), noErr)
        XCTAssertNotNil(tested.snapshot().mediaClock)
        tested.close(); XCTAssertNil(tested.snapshot().mediaClock)
    }

    func testRealDeckMediaClocksUseSameHostTimelineAtDifferentMediaOffsets() async throws {
        let url = try sharedConstantFile(seconds: 4, stereo: true)
        defer { try? FileManager.default.removeItem(at: url) }
        let output = try await StreamMixOutput.make()
        defer { output.close() }
        let a = try await StreamOccurrence.prepare(url: url, output: output, allowsTempo: true)
        defer { a.dispose() }
        let b = try await StreamOccurrence.prepare(url: url, position: 0.75, output: output, allowsTempo: true)
        defer { b.dispose() }
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512)!
        try output.engine.enableManualRenderingMode(.realtime, format: format, maximumFrameCount: 512)
        try a.play(); try b.play()
        var checked = 0
        for _ in 0..<32 {
            let start = Double(output.engine.manualRenderingSampleTime)
            pcm.frameLength = 512
            var error: OSStatus = noErr
            XCTAssertEqual(output.engine.manualRenderingBlock(512, pcm.mutableAudioBufferList, &error), .success)
            XCTAssertEqual(error, noErr)
            if let out = output.mediaClock(a.audio), let incoming = output.mediaClock(b.audio) {
                XCTAssertEqual(out.sampleEnd, start + 512); XCTAssertEqual(incoming.sampleEnd, out.sampleEnd)
                XCTAssertNotEqual(out.source, incoming.source)
                XCTAssertEqual(incoming.mediaEnd - out.mediaEnd, 0.75, accuracy: 1e-6)
                XCTAssertEqual(try XCTUnwrap(out.position(at: start + 512)), a.position, accuracy: 1e-12)
                XCTAssertEqual(try XCTUnwrap(incoming.position(at: start + 512)), b.position, accuracy: 1e-12)
                checked += 1
            }
        }
        XCTAssertGreaterThan(checked, 24)
        let beforePause = try XCTUnwrap(output.mediaClock(a.audio))
        output.pause()
        XCTAssertNil(output.mediaClock(a.audio)); XCTAssertNil(output.mediaClock(b.audio))
        XCTAssertNil(output.tempoState(a.audio)?.mediaClock)
        try output.start()
        XCTAssertNil(output.mediaClock(a.audio), "The old timeline cannot return before a fresh render")
        pcm.frameLength = 512
        var error: OSStatus = noErr
        XCTAssertEqual(output.engine.manualRenderingBlock(512, pcm.mutableAudioBufferList, &error), .success)
        XCTAssertEqual(error, noErr)
        let resumed = try XCTUnwrap(output.mediaClock(a.audio))
        XCTAssertEqual(resumed.source, beforePause.source); XCTAssertNotEqual(resumed.epoch, beforePause.epoch)
        output.remove(b.audio); XCTAssertNil(output.mediaClock(b.audio))
        print("FOLIA_MEDIA_CLOCK realDecoderPairs=\(checked) offset=0.75 hostRate=44100")
    }

    func testTempoRenderFailureNoticesAreCoalescedAndOldSeekNoticesExpire() async throws {
        let input = LimitedTempoFeed()
        let tested = try NativeTempoHandover(source: input)
        defer { tested.close() }
        let pcm = AVAudioPCMBuffer(pcmFormat: input.format, frameCapacity: 512)!
        pcm.frameLength = 512
        var failures = 0, changes = 0
        tested.changed = { failed in if failed { failures += 1 } else { changes += 1 } }
        input.isSeeking = true
        XCTAssertNotEqual(tested.render(pcm.mutableAudioBufferList, frames: 512), noErr)
        input.isSeeking = false; try tested.reset()
        try await Task.sleep(nanoseconds: 10_000_000)
        XCTAssertEqual(failures, 0, "The reset invalidates a queued failure from the old source state")
        input.isSeeking = true
        for _ in 0..<8 { XCTAssertNotEqual(tested.render(pcm.mutableAudioBufferList, frames: 512), noErr) }
        try await waitForStream { failures > 0 }
        XCTAssertEqual(failures, 1); XCTAssertEqual(changes, 0)
        XCTAssertNotEqual(tested.render(pcm.mutableAudioBufferList, frames: 512), noErr)
        tested.close()
        try await Task.sleep(nanoseconds: 10_000_000)
        XCTAssertEqual(failures, 1)
    }

    func testLiveHardwareMediaClocksProjectTwoDecodersAndInvalidateOnRestart() async throws {
        let file = try sharedConstantFile(seconds: 4, stereo: true)
        defer { try? FileManager.default.removeItem(at: file) }
        let output = try await StreamMixOutput.make()
        defer { output.close() }
        let a = try await StreamOccurrence.prepare(url: file, output: output, allowsTempo: true)
        defer { a.dispose() }
        let b = try await StreamOccurrence.prepare(url: file, position: 0.75, output: output, allowsTempo: true)
        defer { b.dispose() }
        try AVAudioSession.sharedInstance().setCategory(.playback)
        try AVAudioSession.sharedInstance().setActive(true)
        // Release both prepared decoders before starting the hardware, so neither gains a head start.
        try a.attachOutput(); try b.attachOutput()
        XCTAssertTrue(a.audio.startPreparedPlayback()); XCTAssertTrue(b.audio.startPreparedPlayback())
        try output.start()
        var last: NativeMediaClock?, checked = 0, maximum = 0.0
        let deadline = ProcessInfo.processInfo.systemUptime + 3
        while checked < 16 && ProcessInfo.processInfo.systemUptime < deadline {
            if let out = output.mediaClock(a.audio), let incoming = output.mediaClock(b.audio) {
                let common = max(out.sampleEnd, incoming.sampleEnd)
                if out.isCurrent(at: common), incoming.isCurrent(at: common), last?.sampleEnd != out.sampleEnd {
                    let difference = try XCTUnwrap(incoming.position(at: common)) - XCTUnwrap(out.position(at: common))
                    maximum = max(maximum, abs(difference - 0.75))
                    if let last {
                        XCTAssertEqual(last.epoch, out.epoch)
                        XCTAssertEqual(try XCTUnwrap(last.position(at: out.sampleEnd)), out.mediaEnd, accuracy: 1e-9)
                    }
                    last = out; checked += 1
                }
            }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertEqual(checked, 16); XCTAssertLessThan(maximum, 0.5 / 44100)
        let old = try XCTUnwrap(last)
        output.pause(); a.audio.pause(); b.audio.pause()
        XCTAssertNil(output.mediaClock(a.audio)); XCTAssertNil(output.tempoState(a.audio)?.mediaClock)
        a.audio.resume(); b.audio.resume(); try output.start()
        try await waitForStream { output.mediaClock(a.audio)?.epoch != old.epoch && output.mediaClock(a.audio) != nil }
        let resumed = try XCTUnwrap(output.mediaClock(a.audio))
        XCTAssertEqual(resumed.source, old.source); XCTAssertGreaterThanOrEqual(resumed.mediaEnd, old.mediaEnd)
        print("FOLIA_LIVE_MEDIA_CLOCK pairs=\(checked) maxMediaErrorSeconds=\(maximum) sampleRate=\(resumed.sampleRate) restart=PASS")
    }

    func testWarmTempoHandoverPreservesRawHistoryAndMatchesSystemAtFirstActiveBlock() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        defer { try? FileManager.default.removeItem(at: url) }
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        func sample(_ frame: Int, _ channel: Int) -> Float {
            Float(0.2 * sin(Double(frame) * 2 * .pi * (channel == 0 ? 440 : 659.25) / 44100))
        }
        do {
            let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 176400)!
            pcm.frameLength = pcm.frameCapacity
            for frame in 0..<176400 { for channel in 0..<2 { pcm.floatChannelData![channel][frame] = sample(frame, channel) } }
            let file = try AVAudioFile(forWriting: url, settings: format.settings); try file.write(from: pcm)
        }
        var player: AudioPlayer? = try await preparedExternalPlayer(url)
        weak var released = player
        defer { player?.stop() }
        for _ in 0..<100 {
            if player!.bufferedDuration >= 4 { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        let handover = try NativeTempoHandover(player: player!)
        defer { handover.close() }
        let pcm = AVAudioPCMBuffer(pcmFormat: player!.externalOutputFormat, frameCapacity: 8192)!
        XCTAssertTrue(player!.startPreparedPlayback())
        var at = 0, maximum: Float = 0, seamDifference: Float = 0, warmed = false, warmSeconds = 0.0
        var reference: WarmSystemReference?
        for block in 0..<100 {
            let count: UInt32 = [128, 257, 1024, 4096, 8192][block % 5]
            pcm.frameLength = count
            if block == 1 { try handover.request(rate: 1.12); try handover.request(rate: 1) }
            if at > 40000 {
                reference = try WarmSystemReference(origin: at - 8192, sample: sample)
                _ = try reference!.render(frames: 12288)
                try handover.request(rate: 1.12)
            }
            let begin = CACurrentMediaTime()
            let status = handover.render(pcm.mutableAudioBufferList, frames: count, sampleTime: Double(at))
            let renderedSeconds = CACurrentMediaTime() - begin
            XCTAssertEqual(status, noErr)
            let state = handover.snapshot()
            let expected = try reference?.render(frames: Int(count))
            for frame in 0..<Int(count) {
                for channel in 0..<2 {
                    let value = pcm.floatChannelData![0][frame * 2 + channel]
                    maximum = max(maximum, abs(value - (expected?[frame * 2 + channel] ?? sample(at + frame, channel))))
                    if expected != nil { seamDifference = max(seamDifference, abs(value - sample(at + frame, channel))) }
                }
            }
            at += Int(count)
            XCTAssertEqual(state.rate, 1)
            XCTAssertEqual(state.position, Double(at) / 44100, accuracy: 0.00003)
            if state.phase == .active {
                XCTAssertNil(state.mediaClock, "TimePitch cannot publish an exact source clock, including its unity-rate warm block")
                warmed = true; warmSeconds = renderedSeconds; break
            }
            XCTAssertEqual(state.phase, .raw)
            XCTAssertEqual(state.mediaClock?.sampleEnd, Double(at))
            XCTAssertEqual(try XCTUnwrap(state.mediaClock).mediaEnd, Double(at) / 44100, accuracy: 1e-9)
        }
        XCTAssertTrue(warmed); XCTAssertLessThan(maximum, 1e-6)
        XCTAssertEqual(player!.progress - handover.snapshot().position, 4096 / 44100.0, accuracy: 1e-6)
        var previous = handover.snapshot().position, expectedPosition = previous, tone = [Float](), holds = 0
        let system = try XCTUnwrap(reference)
        for block in 0..<100 {
            pcm.frameLength = 512
            if block == 50 { try handover.request(rate: 1) }
            XCTAssertEqual(handover.render(pcm.mutableAudioBufferList, frames: 512), noErr)
            let state = handover.snapshot()
            XCTAssertEqual(state.phase, .active)
            XCTAssertNil(state.mediaClock, "Returning TimePitch to unity does not turn its estimated position into exact PCM timing")
            XCTAssertEqual(state.rate, block < 50 ? Double(Float(1.12)) : 1)
            // TimePitch pulls input in chunks. A rate change may briefly hold the latency-corrected
            // estimate; require monotonicity and bounded timing error, not invented per-block progress.
            XCTAssertGreaterThanOrEqual(state.position, previous)
            if state.position == previous { holds += 1 }
            previous = state.position
            expectedPosition += 512 / 44100.0 * state.rate
            XCTAssertEqual(state.position, expectedPosition, accuracy: 0.04)
            let expected = try system.render(frames: 512, rate: block < 50 ? 1.12 : 1)
            for i in 0..<1024 { maximum = max(maximum, abs(pcm.floatChannelData![0][i] - expected[i])) }
            if (10..<45).contains(block) { for frame in 0..<512 { tone.append(pcm.floatChannelData![0][frame * 2]) } }
        }
        XCTAssertLessThan(maximum, 1e-6)
        XCTAssertLessThanOrEqual(holds, 1)
        var crossings = [Double]()
        for index in 1..<tone.count where tone[index - 1] <= 0 && tone[index] > 0 {
            let a = Double(tone[index - 1]), b = Double(tone[index])
            crossings.append(Double(index - 1) - a / (b - a))
        }
        let hz = Double(crossings.count - 1) * 44100 / (try XCTUnwrap(crossings.last) - XCTUnwrap(crossings.first))
        XCTAssertEqual(hz, 440, accuracy: 1)
        player!.pause()
        let held = handover.snapshot().position
        XCTAssertEqual(handover.render(pcm.mutableAudioBufferList, frames: 512), noErr)
        XCTAssertEqual(handover.snapshot().position, held)
        for frame in 0..<1024 { XCTAssertEqual(pcm.floatChannelData![0][frame], 0) }
        player!.resume()
        XCTAssertEqual(handover.render(pcm.mutableAudioBufferList, frames: 512), noErr)
        XCTAssertGreaterThan(handover.snapshot().position, held)
        player!.stop(); player = nil; handover.close()
        for _ in 0..<100 { if released == nil { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertNil(released)
        print("FOLIA_TEMPO_WARM systemDifference=\(maximum) rawSeamDifference=\(seamDifference) clockHolds=\(holds) warmSeconds=\(warmSeconds) preservedPitch=\(hz)")
    }

    func testWarmTempoUnderflowRetainsReadAheadForUnchangedRawPlayback() throws {
        let input = LimitedTempoFeed()
        let tested = try NativeTempoHandover(source: input)
        defer { tested.close() }
        let pcm = AVAudioPCMBuffer(pcmFormat: input.format, frameCapacity: 512)!
        pcm.frameLength = 512
        var expected = 0
        for block in 0..<55 {
            if block == 0 { try tested.request(rate: 1.1) }
            if block == 24 { input.available = input.length }
            let before = expected
            XCTAssertEqual(tested.render(pcm.mutableAudioBufferList, frames: 512), noErr)
            expected = min(before + 512, input.available, input.length)
            for frame in 0..<512 {
                for channel in 0..<2 {
                    let value = before + frame < expected ? LimitedTempoFeed.sample(before + frame, channel) : 0
                    XCTAssertEqual(pcm.floatChannelData![0][frame * 2 + channel], value)
                }
            }
            let state = tested.snapshot()
            XCTAssertEqual(state.position, Double(expected) / 44100, accuracy: 1e-9)
            XCTAssertEqual(state.rate, 1)
            if block < 16 { XCTAssertEqual(state.phase, .armed) }
            else { XCTAssertEqual(state.phase, .failed) }
        }
        XCTAssertTrue(tested.snapshot().decoderEnded); XCTAssertTrue(tested.snapshot().drained)
        tested.close(); XCTAssertTrue(input.closed)
    }

    func testSharedOutputTempoWarmupPreservesCommonClockOtherDeckAndRelease() async throws {
        let url = try sharedConstantFile(seconds: 4, stereo: true)
        defer { try? FileManager.default.removeItem(at: url) }
        var outgoing: AudioPlayer? = try await preparedExternalPlayer(url)
        weak var released = outgoing
        let incoming = try await preparedExternalPlayer(url)
        defer { outgoing?.stop(); incoming.stop() }
        for _ in 0..<100 {
            if outgoing!.bufferedDuration >= 4 && incoming.bufferedDuration >= 4 { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        let output = try await StreamMixOutput.make()
        defer { output.close() }
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512)!
        try output.engine.enableManualRenderingMode(.realtime, format: format, maximumFrameCount: 512)
        try output.attach(outgoing!, allowsTempo: true); try output.attach(incoming)
        XCTAssertTrue(outgoing!.startPreparedPlayback()); XCTAssertTrue(incoming.startPreparedPlayback())
        try output.start()
        let nodeCount = output.engine.attachedNodes.count
        XCTAssertThrowsError(try output.requestTempo(incoming, rate: 1.1))
        var maximum: Float = 0
        let reference = try WarmSystemReference(origin: 4096) { _, channel in channel == 0 ? 0.125 : -0.0625 }
        _ = try reference.render(frames: 12288)
        for block in 0..<60 {
            if block == 24 { try output.requestTempo(outgoing!, rate: 1.12) }
            let before = output.engine.manualRenderingSampleTime, inBefore = incoming.framesPlayed
            pcm.frameLength = 512
            var error: OSStatus = noErr
            XCTAssertEqual(output.engine.manualRenderingBlock(512, pcm.mutableAudioBufferList, &error), .success)
            XCTAssertEqual(error, noErr)
            XCTAssertEqual(output.engine.manualRenderingSampleTime, before + 512)
            XCTAssertEqual(incoming.framesPlayed, inBefore + 512)
            XCTAssertEqual(output.engine.attachedNodes.count, nodeCount)
            let expected = block >= 24 ? try reference.render(frames: 512, rate: block == 24 ? 1 : 1.12) : nil
            for frame in 0..<512 {
                maximum = max(maximum, abs(pcm.floatChannelData![0][frame] - ((expected?[frame * 2] ?? 0.125) + 0.125)),
                              abs(pcm.floatChannelData![1][frame] - ((expected?[frame * 2 + 1] ?? -0.0625) - 0.0625)))
            }
        }
        XCTAssertLessThan(maximum, 1e-6)
        XCTAssertEqual(output.tempoState(outgoing!)?.phase, .active)
        XCTAssertEqual(output.tempoState(outgoing!)?.rate, Double(Float(1.12)))
        output.remove(outgoing!); outgoing!.stop(); outgoing = nil
        for _ in 0..<100 { if released == nil { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertNil(released); XCTAssertEqual(output.attachedCount, 1); XCTAssertTrue(output.running)
        print("FOLIA_SHARED_TEMPO_WARM maximumPCM=\(maximum) commonClock=PASS incomingClock=PASS release=PASS")
    }

    func testSharedTempoResetCancelsPendingRateAfterSeekAndDrainsEOF() async throws {
        let url = try sharedConstantFile(seconds: 3, stereo: true)
        defer { try? FileManager.default.removeItem(at: url) }
        let player = try await preparedExternalPlayer(url)
        defer { player.stop() }
        let output = try await StreamMixOutput.make()
        defer { output.close() }
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512)!
        try output.engine.enableManualRenderingMode(.realtime, format: format, maximumFrameCount: 512)
        try output.attach(player, allowsTempo: true)
        XCTAssertTrue(player.startPreparedPlayback()); try output.start()
        func render() {
            pcm.frameLength = 512
            var error: OSStatus = noErr
            XCTAssertEqual(output.engine.manualRenderingBlock(512, pcm.mutableAudioBufferList, &error), .success)
            XCTAssertEqual(error, noErr)
        }
        try output.requestTempo(player, rate: 0.88)
        for _ in 0..<40 { render() }
        XCTAssertEqual(output.tempoState(player)?.phase, .active)
        XCTAssertThrowsError(try output.resetTempo(player), "A running output cannot reset another render graph")
        output.pause(); player.pause(); player.seek(to: 0.75)
        XCTAssertThrowsError(try output.resetTempo(player), "Pending seek must not admit stale PCM")
        player.resume()
        for _ in 0..<100 {
            if !player.isSeeking && player.bufferedDuration >= 2.2 { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertFalse(player.isSeeking)
        try output.requestTempo(player, rate: 1.12)
        try output.resetTempo(player)
        XCTAssertEqual(output.tempoState(player)?.phase, .raw)
        XCTAssertEqual(try XCTUnwrap(output.tempoState(player)).position, 0.75, accuracy: 0.001)
        try output.start()
        var tail: Float = 0, drained = false
        for block in 0..<350 {
            if block == 24 { try output.requestTempo(player, rate: 1.1) }
            render()
            let state = try XCTUnwrap(output.tempoState(player))
            if block < 24 {
                XCTAssertEqual(state.phase, .raw); XCTAssertEqual(state.rate, 1)
                for frame in 0..<512 {
                    XCTAssertEqual(pcm.floatChannelData![0][frame], 0.125, accuracy: 1e-6)
                    XCTAssertEqual(pcm.floatChannelData![1][frame], -0.0625, accuracy: 1e-6)
                }
            }
            if state.decoderEnded && !state.drained { for frame in 0..<512 { tail = max(tail, abs(pcm.floatChannelData![0][frame])) } }
            if state.drained { drained = true; break }
        }
        XCTAssertTrue(drained); XCTAssertGreaterThan(tail, 0.01)
        XCTAssertEqual(try XCTUnwrap(output.tempoState(player)).position, 3, accuracy: 0.001)
        print("FOLIA_SHARED_TEMPO_RESET pendingRate=cleared reprime=PASS eofTailPeak=\(tail)")
    }

    #if FOLIA_AUDIO_OUTPUT_PROBE
    func testHTTPTempoWarmupRunsOnLiveSharedOutputAndResumesItsClock() async throws {
        let player = try await preparedExternalPlayer(URL(string: "http://127.0.0.1:18779/mono.wav")!)
        defer { player.stop() }
        let output = try await StreamMixOutput.make()
        let measured = OutputMeasurement()
        output.engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { buffer, _ in measured.consume(buffer) }
        defer { output.engine.mainMixerNode.removeTap(onBus: 0); output.close() }
        try AVAudioSession.sharedInstance().setCategory(.playback)
        try AVAudioSession.sharedInstance().setActive(true)
        try output.attach(player, allowsTempo: true)
        XCTAssertTrue(player.startPreparedPlayback()); try output.start()
        try await waitForStream { (output.tempoState(player)?.position ?? 0) > 0.25 }
        try output.requestTempo(player, rate: 1.12)
        try await waitForStream { output.tempoState(player)?.phase == .active && output.tempoState(player)?.rate == Double(Float(1.12)) }
        let start = try XCTUnwrap(output.tempoState(player)).position
        measured.reset()
        try await waitForStream { (output.tempoState(player)?.position ?? 0) > start + 0.4 }
        let pcm = measured.read()
        XCTAssertEqual(pcm.channels, 2)
        XCTAssertGreaterThan(pcm.frames, 1000)
        XCTAssertGreaterThan(pcm.rms, 0.01)
        output.pause(); player.pause()
        let paused = try XCTUnwrap(output.tempoState(player)).position
        try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertEqual(output.tempoState(player)?.position, paused)
        player.resume(); try output.start()
        try await waitForStream { (output.tempoState(player)?.position ?? 0) > paused + 0.2 }
        try output.requestTempo(player, rate: 1)
        try await waitForStream { output.tempoState(player)?.rate == 1 }
        XCTAssertEqual(output.tempoState(player)?.phase, .active)
        XCTAssertTrue(output.running)
        print("FOLIA_HTTP_TEMPO_WARM channels=\(pcm.channels) frames=\(pcm.frames) rms=\(pcm.rms) position=\(output.tempoState(player)?.position ?? -1)")
    }
    #endif
}
