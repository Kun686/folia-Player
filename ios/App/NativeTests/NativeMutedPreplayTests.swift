import XCTest
import AVFoundation
@testable import App

// NativeMutedPreplayTests.swift — render acknowledgement, silent real PCM and revocable queue ownership.
@MainActor private final class MutedPreplayFixture {
    let output: StreamMixOutput, outgoing: StreamOccurrence, incoming: StreamOccurrence
    let buffer: AVAudioPCMBuffer
    init(output: StreamMixOutput, outgoing: StreamOccurrence, incoming: StreamOccurrence) {
        self.output = output; self.outgoing = outgoing; self.incoming = incoming
        buffer = AVAudioPCMBuffer(pcmFormat: AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!, frameCapacity: 512)!
    }
    func render() {
        buffer.frameLength = 512
        var error: OSStatus = noErr
        XCTAssertEqual(output.engine.manualRenderingBlock(512, buffer.mutableAudioBufferList, &error), .success)
        XCTAssertEqual(error, noErr)
    }
    func assertOnlyOutgoing(file: StaticString = #filePath, line: UInt = #line) {
        for channel in 0..<2 {
            let pcm = UnsafeBufferPointer(start: buffer.floatChannelData![channel], count: 512)
            XCTAssertLessThan(pcm.map { abs($0 - 0.125) }.max()!, 0.000001, file: file, line: line)
        }
    }
    func begin(_ session: NativeMutedPreplay) async throws {
        let task = Task { try await session.start(current: { true }) }
        defer { task.cancel() }
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertFalse(incoming.playing); XCTAssertEqual(incoming.position, incoming.preparedPosition)
        render()
        try await task.value
    }
}

@MainActor extension NativeTests {
    func testLiveStemFallbackRestoresCurrentDecoderWhenEngineClockResetsBeforeOrAfterAdoption() async throws {
        let planner = NativeTransitionPlanner()
        let out = try StemStorageReference.window(frames: 176400), input = try StemStorageReference.window(frames: 176400, role: .head)
        let fallback = try await planner.envelope(JSONSerialization.data(withJSONObject: ["version": 1,
            "plan": ["style": "plainBlend", "minOverlap": 0, "tiltDb": [0, 0], "echoThrow": false],
            "timing": ["overlap": 0.8, "remaining": 0.8, "outgoingDb": NSNull(),
                       "nextBeatIn": NSNull(), "periodSec": NSNull(), "incomingLeadIn": NSNull()]]))
        for adopted in [false, true] {
            try await withMutedPreplay { graph in
                let session = try NativeMutedPreplay(output: graph.output, outgoing: graph.outgoing, incoming: graph.incoming)
                defer { session.cancel() }
                try await graph.begin(session)
                for _ in 0..<4 { graph.render() }
                let clocks = try XCTUnwrap(graph.output.stemClocks(outgoing: graph.outgoing.audio, incoming: graph.incoming.audio))
                let at = clocks.outgoing.sampleEnd
                let options = NativeStemAnalysisContext(windowSec: 0.8,
                    outAt: try XCTUnwrap(clocks.outgoing.position(at: at)), inAt: try XCTUnwrap(clocks.incoming.position(at: at)))
                let result = try await NativeStemHandover().prepareLive(outgoing: out, incoming: input,
                    options: options, clocks: clocks, plannedStart: at, planner: planner)
                let prepared = try XCTUnwrap(result)
                let generation = try session.commit(prepared, fallback: fallback, current: { true })
                if adopted {
                    for _ in 0..<4 { graph.render() }
                    XCTAssertTrue(graph.output.transitionGain.clock.stemActive)
                }
                // AVAudioEngine.reset documents a zeroed manual-render timeline. Keep the actual
                // decoders and command alive: this must not rely on a configuration notification.
                XCTAssertGreaterThan(graph.output.engine.manualRenderingSampleTime, 0)
                graph.output.engine.reset()
                XCTAssertEqual(graph.output.engine.manualRenderingSampleTime, 0)
                graph.render()
                let clock = graph.output.transitionGain.clock
                XCTAssertEqual(clock.generation, generation); XCTAssertTrue(clock.stemClockInvalid)
                XCTAssertFalse(clock.stemActive)
                var maximum: Float = 0
                for _ in 0..<4 {
                    graph.render()
                    for channel in 0..<2 { for frame in 0..<512 {
                        maximum = max(maximum, abs(graph.buffer.floatChannelData![channel][frame] - (channel == 0 ? 0.125 : -0.0625)))
                    } }
                }
                XCTAssertLessThan(maximum, 0.000005)
                print("FOLIA_LIVE_STEM_RESET adopted=\(adopted) currentDecoder=PASS maxPCM=\(maximum)")
            }
        }
    }
    func testLiveStemHandoverBindsLatePCMOnRealSharedDecoderClockAndFallsBackOnPause() async throws {
        let planner = NativeTransitionPlanner(), fixture = try await StemClockFixture()
        let out = try StemStorageReference.window(frames: 176400), input = try StemStorageReference.window(frames: 176400, role: .head)
        for build in [false, true] {
            let seconds = build ? 2.0 : 0.8, count = Int(seconds * 44100)
            let fallback = try await planner.envelope(JSONSerialization.data(withJSONObject: ["version": 1,
                "plan": ["style": "plainBlend", "minOverlap": 0, "tiltDb": [0, 0], "echoThrow": false],
                "timing": ["overlap": seconds, "remaining": seconds, "outgoingDb": NSNull(),
                           "nextBeatIn": NSNull(), "periodSec": NSNull(), "incomingLeadIn": NSNull()]]))
            for interrupt in [false, true] {
                try await withMutedPreplay { graph in
                    let session = try NativeMutedPreplay(output: graph.output, outgoing: graph.outgoing, incoming: graph.incoming)
                    defer { session.cancel() }
                    try await graph.begin(session)
                    for _ in 0..<4 { graph.render() }
                    let clocks = try XCTUnwrap(graph.output.stemClocks(outgoing: graph.outgoing.audio, incoming: graph.incoming.audio))
                    let plannedStart = clocks.outgoing.sampleEnd + 256
                    let options = NativeStemAnalysisContext(windowSec: seconds,
                        outAt: try XCTUnwrap(clocks.outgoing.position(at: plannedStart)),
                        inAt: try XCTUnwrap(clocks.incoming.position(at: plannedStart)), expansion: build ? 1 : nil)
                    let prepared = try await NativeStemHandover().prepareLive(outgoing: out, incoming: input,
                        options: options, clocks: clocks, plannedStart: plannedStart, planner: planner)
                    // Advance both actual decoders after analysis: using the old planned offsets would now be wrong.
                    for _ in 0..<8 { graph.render() }
                    let actualStart = Double(graph.output.engine.manualRenderingSampleTime)
                    XCTAssertGreaterThan(actualStart, plannedStart)
                    let value = try XCTUnwrap(prepared)
                    XCTAssertEqual(value.expansion != nil, build)
                    let pair = try await NativeStemWindowPair.prepare(out: out, incoming: input,
                        outAt: options.outAt, inAt: options.inAt, seconds: seconds,
                        lateBy: (actualStart - plannedStart) / 44100, planner: planner)
                    let windows = try XCTUnwrap(pair)
                    let expanded: NativeExpansionPCM?
                    if let plan = value.gesture.expansion { expanded = try await NativeExpansionRenderer().render(windows, plan: plan) }
                    else { expanded = nil }
                    let reference = try NativeStemMixer(outgoing: windows.outgoing, incoming: windows.incoming,
                        gesture: value.gesture, bus: fixture.bus, expansion: expanded)
                    let expected = StemClockFixture.buffer(count)
                    // The renderer bounds individual pulls; retain one reference output in bounded slices.
                    var referenceAt = 0
                    while referenceAt < count {
                        let length = min(32768, count - referenceAt)
                        var buffers = AudioBufferList(mNumberBuffers: 1, mBuffers: AudioBuffer(mNumberChannels: 2,
                            mDataByteSize: UInt32(length * 8), mData: expected.floatChannelData![0] + referenceAt * 2))
                        XCTAssertTrue(reference.render(&buffers, frames: length)); referenceAt += length
                    }
                    let generation = try session.commit(value, fallback: fallback, current: { true })
                    var maximum: Float = 0
                    for block in 0..<(Int(ceil(Double(count) / 512)) + 5) {
                        if interrupt && block == 8 { graph.incoming.pause() }
                        let at = Double(graph.output.engine.manualRenderingSampleTime)
                        graph.render()
                        let clock = graph.output.transitionGain.clock
                        XCTAssertEqual(clock.generation, generation)
                        XCTAssertEqual(clock.curveStart, actualStart)
                        if interrupt && block >= 9 {
                            XCTAssertTrue(clock.stemFailed); XCTAssertFalse(clock.stemActive)
                            continue
                        }
                        if interrupt && block >= 8 { continue }
                        XCTAssertFalse(clock.stemFailed); XCTAssertTrue(clock.stemActive)
                        for frame in 0..<512 {
                            let elapsed = at + Double(frame) - actualStart
                            let outGain = Float(1 - min(1, max(0, elapsed / (0.008 * 44100))))
                            let inGain = Float(min(1, max(0, (elapsed - (seconds - 0.008) * 44100) / (0.008 * 44100))))
                            for channel in 0..<2 {
                                let stems = elapsed < Double(count) ? expected.floatChannelData![0][Int(elapsed) * 2 + channel] : 0
                                let master = Float(0.125) * outGain + (channel == 0 ? Float(0.125) : -0.0625) * inGain
                                maximum = max(maximum, abs(graph.buffer.floatChannelData![channel][frame] - master - stems))
                            }
                        }
                    }
                    XCTAssertLessThan(maximum, 0.000005)
                    if interrupt {
                        graph.incoming.audio.resume()
                        for _ in 0..<3 { graph.render() }
                        XCTAssertFalse(graph.output.transitionGain.clock.stemActive, "Changed media epoch cannot replay an old gesture")
                    }
                    print("FOLIA_LIVE_STEM_GRAPH lateFrames=\(actualStart - plannedStart) maxPCM=\(maximum) interrupted=\(interrupt) expansion=\(build)")
                }
            }
        }
    }
    private func withMutedPreplay(_ exercise: (MutedPreplayFixture) async throws -> Void) async throws {
        let mono = try sharedConstantFile(seconds: 8), stereo = try sharedConstantFile(seconds: 8, stereo: true)
        defer { try? FileManager.default.removeItem(at: mono); try? FileManager.default.removeItem(at: stereo) }
        let output = try await StreamMixOutput.make()
        defer { output.close() }
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        try output.engine.enableManualRenderingMode(.realtime, format: format, maximumFrameCount: 512)
        let outgoing = try await StreamOccurrence.prepare(url: mono, output: output, allowsTempo: true)
        defer { outgoing.dispose() }
        let incoming = try await StreamOccurrence.prepare(url: stereo, position: 0.5, output: output, allowsTempo: true)
        defer { incoming.dispose() }
        let fixture = MutedPreplayFixture(output: output, outgoing: outgoing, incoming: incoming)
        try outgoing.play()
        var stable = 0
        for _ in 0..<100 {
            fixture.render()
            stable = abs(fixture.buffer.floatChannelData![0][511] - 0.125) < 1e-6 ? stable + 1 : 0
            if stable >= 2 { break }
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        guard stable >= 2 else { XCTFail("Outgoing decoder did not reach its known baseline"); return }
        try await exercise(fixture)
    }
    private func preplayEnvelope() async throws -> NativeTransitionEnvelope {
        try await NativeTransitionPlanner().envelope(JSONSerialization.data(withJSONObject: ["version": 1,
            "plan": ["style": "plainBlend", "minOverlap": 0, "tiltDb": [0, 0], "echoThrow": false],
            "timing": ["overlap": 0.1, "remaining": 0.1, "outgoingDb": NSNull(),
                       "nextBeatIn": NSNull(), "periodSec": NSNull(), "incomingLeadIn": NSNull()]]))
    }

    func testMutedPreplayWaitsForRenderAndAdvancesSilentlyUntilAtomicCommit() async throws {
        let envelope = try await preplayEnvelope()
        try await withMutedPreplay { fixture in
            let session = try NativeMutedPreplay(output: fixture.output, outgoing: fixture.outgoing, incoming: fixture.incoming)
            defer { session.cancel() }
            try await fixture.begin(session)
            let gate = try XCTUnwrap(fixture.output.transitionGain.clock.generation)
            let first = fixture.incoming.position
            for _ in 0..<8 { fixture.render(); fixture.assertOnlyOutgoing() }
            XCTAssertGreaterThan(fixture.incoming.position, first)
            let out = try XCTUnwrap(fixture.output.mediaClock(fixture.outgoing.audio))
            let input = try XCTUnwrap(fixture.output.mediaClock(fixture.incoming.audio))
            XCTAssertEqual(out.sampleEnd, input.sampleEnd)
            let committed = try session.commit(envelope, current: { true })
            XCTAssertNotEqual(gate, committed)
            XCTAssertEqual(fixture.output.transitionGain.clock.generation, gate, "A gate must not masquerade as an adopted fade")
            session.cancel()
            XCTAssertEqual(fixture.output.attachedCount, 2, "Transferred ownership survives old preparation cleanup")
            for _ in 0..<14 { fixture.render() }
            XCTAssertEqual(fixture.output.transitionGain.clock.generation, committed)
            for channel in 0..<2 {
                XCTAssertEqual(fixture.buffer.floatChannelData![channel][511], channel == 0 ? 0.125 : -0.0625, accuracy: 1e-6)
            }
            print("FOLIA_MUTED_PREPLAY silence=PASS advancingPCM=PASS sharedClock=PASS atomicCommit=PASS")
        }
    }

    func testMutedPreplayCancellationBeforeAndAfterAdoptionRemovesOnlyIncoming() async throws {
        for adopted in [false, true] {
            try await withMutedPreplay { fixture in
                let session = try NativeMutedPreplay(output: fixture.output, outgoing: fixture.outgoing, incoming: fixture.incoming)
                defer { session.cancel() }
                let task = Task { try await session.start(current: { true }) }
                defer { task.cancel() }
                try await Task.sleep(nanoseconds: 20_000_000)
                if adopted { fixture.render(); try await task.value; fixture.render() }
                session.cancel(); session.cancel()
                if !adopted {
                    do { try await task.value; XCTFail("Cancelled preplay started") } catch {}
                }
                XCTAssertEqual(fixture.output.attachedCount, 1); XCTAssertTrue(fixture.outgoing.playing)
                for _ in 0..<8 { fixture.render(); fixture.assertOnlyOutgoing() }
                // AudioStreaming retires stop asynchronously and may reset progress to zero.
                // Disposal promises no further output, not a retained decoder progress value.
                XCTAssertFalse(fixture.incoming.playing); XCTAssertFalse(fixture.incoming.canPreplay)
            }
        }
    }

    func testMutedPreplayRejectsSupersededGainPauseAndAlreadyStartedDeck() async throws {
        let envelope = try await preplayEnvelope()
        for paused in [false, true] {
            try await withMutedPreplay { fixture in
                let session = try NativeMutedPreplay(output: fixture.output, outgoing: fixture.outgoing, incoming: fixture.incoming)
                defer { session.cancel() }
                try await fixture.begin(session)
                XCTAssertThrowsError(try NativeMutedPreplay(output: fixture.output, outgoing: fixture.outgoing, incoming: fixture.incoming))
                XCTAssertTrue(fixture.incoming.playing, "Invalid acquisition cannot dispose someone else's live deck")
                if paused { fixture.output.pause() }
                let replacement = fixture.output.transitionGain.cancel()
                XCTAssertTrue(try fixture.output.schedulePreplay(outgoing: fixture.outgoing.audio,
                    incoming: fixture.incoming.audio, generation: replacement))
                XCTAssertThrowsError(try session.commit(envelope, current: { true }))
                session.cancel()
                XCTAssertTrue(fixture.output.transitionGain.isCurrent(replacement), "Old cleanup cannot cancel the newer command")
                XCTAssertEqual(fixture.output.attachedCount, 1)
                if paused { try fixture.output.start() }
                for _ in 0..<8 { fixture.render() }
                fixture.assertOnlyOutgoing()
            }
        }
    }

    func testMutedPreplayTimeoutChangedIntentAndCancelledTaskPreserveOutgoing() async throws {
        for failure in ["timeout", "intent", "task"] {
            try await withMutedPreplay { fixture in
                let session = try NativeMutedPreplay(output: fixture.output, outgoing: fixture.outgoing, incoming: fixture.incoming)
                defer { session.cancel() }
                let before = Date()
                let task = Task { try await session.start(current: { failure != "intent" }) }
                if failure == "task" { task.cancel() }
                do { try await task.value; XCTFail("Preplay without adoption cannot start") } catch {}
                XCTAssertLessThan(Date().timeIntervalSince(before), 1.5)
                XCTAssertEqual(fixture.output.attachedCount, 1); XCTAssertTrue(fixture.outgoing.playing)
                for _ in 0..<8 { fixture.render() }
                fixture.assertOnlyOutgoing()
            }
        }
    }

    func testNativeQueueRevokesWaitingPreplayBeforePauseSeekSkipEditAndPressure() async throws {
        let file = try sharedConstantFile(seconds: 8)
        defer { try? FileManager.default.removeItem(at: file) }
        for action in ["pause", "seek", "skip", "edit", "pressure", "disable"] {
            let tested = stereoEngine(AudioFixtureGateway(url: file))
            defer { tested.stop(); tested.clearOutput() }
            let songs = (0..<3).map { song("qq", "preplay\($0)") }
            try tested.setQueue(songs, at: 0)
            try await waitForStream { tested.outputIsPlaying && tested.preparedStream != nil }
            try tested.command("seek", position: 7.05)
            try await waitForStream { tested.outputIsPlaying && tested.stream?.seeking == false && tested.playbackPosition >= 7.05 }
            let output = try XCTUnwrap(tested.streamOutput), original = try XCTUnwrap(tested.stream)
            output.pause()
            // AVAudioEngineManualRenderingErrorInitialized: pause retains initialized I/O; stop is required.
            output.engine.stop()
            try output.engine.enableManualRenderingMode(.realtime,
                format: AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!, maximumFrameCount: 512)
            try output.start()
            try tested.crossfade?.configure(enabled: true, maximumSeconds: 1)
            try await waitForStream { output.attachedCount == 2 }
            let waiting = try XCTUnwrap(tested.preparedStream?.entry)
            XCTAssertFalse(waiting.playing); XCTAssertFalse(tested.crossfade!.isFading)
            switch action {
            case "pause": try tested.command("pause")
            case "seek": try tested.command("seek", position: 1)
            case "skip": try tested.selectQueue(2, expectedRevision: tested.queueRevision)
            case "edit": try tested.editQueue([songs[0], songs[2]], currentIndex: 0, expectedRevision: tested.queueRevision)
            case "pressure": tested.crossfade?.resourcePressure(true)
            default: try tested.crossfade?.configure(enabled: false, maximumSeconds: 1)
            }
            XCTAssertLessThanOrEqual(output.attachedCount, 1, action)
            XCTAssertFalse(waiting.canPreplay); XCTAssertFalse(waiting.playing)
            if action != "skip" { XCTAssertTrue(tested.stream === original, action) }
            try await Task.sleep(nanoseconds: 100_000_000)
            XCTAssertFalse(tested.preparedStream?.entry === waiting, "Late cleanup cannot resurrect the old occurrence")
            XCTAssertFalse(tested.crossfade!.isFading)
            print("FOLIA_PREPLAY_QUEUE cancellation=\(action) detached=PASS currentIntent=PASS")
        }
    }
}
