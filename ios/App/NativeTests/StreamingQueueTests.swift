import XCTest
import AVFoundation
@testable import App

// StreamingQueueTests.swift — original queue semantics on independent stereo occurrences, with real decoded PCM.
private final class PrefetchReplayGainGateway: GatewayClient {
    let url: URL
    init(url: URL) { self.url = url }
    override func send(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        throw MobileFailure("fixture-no-lyrics")
    }
    override func resolve(_ song: [String: Any], quality: String = "standard") async throws -> NativeAudioSource {
        NativeAudioSource(url: url, replayGain: NativeReplayGainInfo(["trackGain": -3.0]))
    }
}

@MainActor extension NativeTests {
    func stereoEngine(_ gateway: GatewayClient) -> PlaybackEngine {
        let storage = UserDefaults(suiteName: "folia.streaming-tests")!
        storage.removePersistentDomain(forName: "folia.streaming-tests")
        let tested = PlaybackEngine(gateway: gateway, storage: storage, usesStereoOutput: true)
        tested.network.cancel()
        return tested
    }
    func waitForStream(_ condition: @escaping () -> Bool, seconds: Double = 5) async throws {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            if condition() { return }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTFail("Native stream condition timed out")
        throw MobileFailure("test-timeout")
    }

    func testPausedPrefetchPublishesQueueRevisionBeforeSelectingBufferedSong() async throws {
        let source = try streamingTone(); defer { try? FileManager.default.removeItem(at: source) }
        let tested = stereoEngine(PrefetchReplayGainGateway(url: source))
        defer { tested.emit = nil; tested.stop(); tested.clearOutput() }
        await tested.libraryRefreshTask?.value
        tested.queue = try [song("qq", "current"), song("netease", "next")].map(PlaybackEngine.sanitizedSong)
        tested.index = 0
        let output = try await StreamMixOutput.make()
        tested.streamOutput = output
        tested.stream = try await StreamOccurrence.prepare(url: source, output: output)
        var lastEvent: [String: Any] = [:]
        tested.emit = { lastEvent = $0 }
        tested.publish()
        let before = tested.queueRevision

        // No playback timer can rescue an unpublished metadata change while the current song is paused.
        tested.prefetchStream()
        try await waitForStream { tested.preparedStream != nil }
        XCTAssertFalse(tested.intentToPlay)
        XCTAssertGreaterThan(tested.queueRevision, before)
        let observedRevision = try XCTUnwrap(lastEvent["queueRevision"] as? Int)
        XCTAssertEqual(observedRevision, tested.queueRevision)
        let publishedQueue = lastEvent["queue"] as? [[String: Any]]
        XCTAssertEqual(publishedQueue?.count, 2)
        XCTAssertEqual(NativeReplayGainInfo(publishedQueue?[1]["replayGain"])?.dictionary, ["trackGain": -3])
        XCTAssertNoThrow(try tested.selectQueue(1, expectedRevision: observedRevision))
        tested.task?.cancel()
        XCTAssertEqual(tested.index, 1)
    }

    func testStereoQueueDeletesBufferedNextWithoutRestartingCurrent() async throws {
        let source = try streamingTone(); defer { try? FileManager.default.removeItem(at: source) }
        let tested = stereoEngine(AudioFixtureGateway(url: source)); defer { tested.stop(); tested.clearOutput() }
        let first = song("qq", "first"), removedSong = song("netease", "removed"), next = song("qq", "next")
        try tested.setQueue([first, removedSong, next], at: 0)
        try await waitForStream { tested.outputIsPlaying && (tested.preparedStream?.entry.audio.bufferedDuration ?? 0) > 0.5 }
        let current = try XCTUnwrap(tested.stream)
        let sharedOutput = try XCTUnwrap(tested.streamOutput)
        XCTAssertTrue(current.meter === tested.preparedStream?.entry.meter)
        XCTAssertEqual(sharedOutput.attachedCount, 1, "A prepared deck must not join the hardware graph")
        let before = tested.playbackPosition
        weak var removed = tested.preparedStream?.entry
        let oldGeneration = tested.generation
        try tested.editQueue([first, next], currentIndex: 0, expectedRevision: tested.queueRevision)
        XCTAssertTrue(tested.stream === current)
        XCTAssertEqual(tested.generation, oldGeneration)
        try await waitForStream { removed == nil && tested.preparedStream != nil }
        XCTAssertGreaterThanOrEqual(tested.playbackPosition, before)
        XCTAssertTrue(tested.outputIsPlaying)
        try tested.command("seek", position: 19.8)
        try await waitForStream { tested.index == 1 && tested.outputIsPlaying }
        XCTAssertEqual(tested.currentSong?["name"] as? String, "next")
        XCTAssertTrue(tested.streamOutput === sharedOutput)
        XCTAssertTrue(tested.stream?.meter === current.meter, "Queue changes reuse one overall effect chain")
        XCTAssertEqual(sharedOutput.attachedCount, 1)
        XCTAssertNil(tested.error)
    }

    func testStereoQueueAutomaticallyAdvancesFourSameURLDistinctOccurrences() async throws {
        let source = try silentAudio(); defer { try? FileManager.default.removeItem(at: source) }
        let tested = stereoEngine(AudioFixtureGateway(url: source)); defer { tested.stop(); tested.clearOutput() }
        var observed = Set<Int>()
        tested.emit = { state in if state["playing"] as? Bool == true, let index = state["index"] as? Int { observed.insert(index) } }
        defer { tested.emit = nil }
        try tested.setQueue((0..<4).map { song($0 % 2 == 0 ? "qq" : "netease", "occurrence\($0)") }, at: 0)
        try await waitForStream({ observed.count == 4 && !tested.intentToPlay }, seconds: 9)
        XCTAssertEqual(observed, [0, 1, 2, 3])
        XCTAssertEqual(tested.index, 3)
        XCTAssertNil(tested.error)
    }

    func testStereoQueueRapidSelectionCannotRestoreOldResolvedSong() async throws {
        let source = try streamingTone(); defer { try? FileManager.default.removeItem(at: source) }
        let tested = stereoEngine(AudioFixtureGateway(url: source)); defer { tested.stop(); tested.clearOutput() }
        var slow = song("qq", "slow"), next = song("netease", "new")
        slow["replayGain"] = ["trackGain": -9.0]; next["replayGain"] = ["trackGain": -3.0]
        try tested.setQueue([slow, next], at: 0)
        try await Task.sleep(nanoseconds: 20_000_000)
        try tested.selectQueue(1, expectedRevision: tested.queueRevision)
        try await waitForStream { tested.outputIsPlaying }
        let active = tested.stream
        try await Task.sleep(nanoseconds: 350_000_000)
        XCTAssertEqual(tested.index, 1); XCTAssertTrue(tested.stream === active)
        XCTAssertEqual(tested.currentSong?["name"] as? String, "new")
        XCTAssertEqual(tested.stream?.replayGain?.dictionary, ["trackGain": -3])
        XCTAssertEqual(NativeReplayGainInfo(tested.currentSong?["replayGain"])?.dictionary, ["trackGain": -3])
    }

    func testStereoQueueAuthenticationAndFailureLimitKeepExistingPolicy() async throws {
        let gateway = FailingGateway(); gateway.code = "auth-required"
        let tested = stereoEngine(gateway); defer { tested.stop(); tested.clearOutput() }
        try tested.setQueue([song("qq", "1"), song("netease", "2")], at: 0)
        try await waitForStream { tested.error != nil }
        XCTAssertEqual(gateway.count, 1); XCTAssertEqual(tested.index, 0); XCTAssertFalse(tested.intentToPlay)
        gateway.code = "unavailable"; gateway.count = 0
        try tested.setQueue((0..<4).map { song("qq", "failed\($0)") }, at: 0)
        try await waitForStream { tested.error == "unavailable" }
        XCTAssertEqual(gateway.count, 6); XCTAssertEqual(tested.index, 2); XCTAssertFalse(tested.intentToPlay)
    }

    func testStereoMasterMuteSilencesNoiseAndPreservesPlaybackPosition() async throws {
        let source = try streamingTone(); defer { try? FileManager.default.removeItem(at: source) }
        let tested = stereoEngine(AudioFixtureGateway(url: source)); defer { tested.stop(); tested.clearOutput() }
        var settings = NativeAudioSettings(); settings.equalizer.enabled = true
        settings.equalizer.effects["noise"] = 0.6; settings.equalizer.effects["space"] = 0.4
        _ = try tested.setAudioSettings(settings.dictionary)
        try tested.setQueue([song("qq", "mono")], at: 0)
        try await waitForStream { tested.outputIsPlaying && tested.meter?.effects.status.available == true }
        let entry = try XCTUnwrap(tested.stream), measured = OutputMeasurement()
        let output = try XCTUnwrap(tested.streamOutput)
        output.engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { buffer, _ in measured.consume(buffer) }
        defer { output.engine.mainMixerNode.removeTap(onBus: 0) }
        try await waitForStream { measured.read().rms > 0.005 }
        settings.isMuted = true; _ = try tested.setAudioSettings(settings.dictionary)
        try await Task.sleep(nanoseconds: 200_000_000)
        measured.reset(); let before = tested.playbackPosition
        try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertGreaterThan(measured.read().frames, 1000)
        XCTAssertLessThan(measured.read().rms, 0.000001)
        XCTAssertGreaterThan(tested.playbackPosition, before)
        XCTAssertEqual(entry.meter.snapshot()["channels"] as? Int, 2)
        XCTAssertEqual(entry.meter.effectState()["error"] as? String, "")
        settings.isMuted = false; _ = try tested.setAudioSettings(settings.dictionary)
        try await waitForStream { measured.read().rms > 0.005 }
    }

    func testStereoURLFailureRefreshesOnceAndRestoresAfterNetworkChange() async throws {
        let source = try streamingTone(); defer { try? FileManager.default.removeItem(at: source) }
        let gateway = RefreshingAudioGateway(validURL: source)
        let tested = stereoEngine(gateway); defer { tested.stop(); tested.clearOutput() }
        try tested.setQueue([song("qq", "retry")], at: 0)
        try await waitForStream { tested.outputIsPlaying }
        XCTAssertEqual(gateway.count, 2)
        try await waitForStream { tested.playbackPosition > 0.3 }
        let position = tested.playbackPosition
        tested.networkChanged(connected: false)
        XCTAssertEqual(tested.error, "network"); XCTAssertFalse(tested.intentToPlay)
        XCTAssertNotNil(tested.networkResume)
        tested.networkChanged(connected: true)
        try await waitForStream { tested.outputIsPlaying }
        XCTAssertNil(tested.networkResume); XCTAssertNil(tested.error)
        XCTAssertGreaterThanOrEqual(tested.playbackPosition, position - 0.05)
        XCTAssertEqual(gateway.count, 3)
    }

    func testQQManualNetworkRetryPreservesPositionAndReplayStartsAtBeginning() async throws {
        try await checkManualNetworkRetry(provider: "qq")
    }

    func testNetEaseManualNetworkRetryPreservesPositionAndReplayStartsAtBeginning() async throws {
        try await checkManualNetworkRetry(provider: "netease")
    }

    // Manual recovery must use the current decoder/seek position, then discard any old auto-resume intent.
    private func checkManualNetworkRetry(provider: String) async throws {
        let source = try streamingTone(); defer { try? FileManager.default.removeItem(at: source) }
        let gateway = AudioFixtureGateway(url: source), tested = stereoEngine(gateway)
        defer { tested.stop(); tested.clearOutput() }
        try tested.setQueue([song(provider, "manual-network-retry")], at: 0)
        try await waitForStream { tested.outputIsPlaying }
        let output = try XCTUnwrap(tested.streamOutput), measured = OutputMeasurement()
        output.engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { buffer, _ in measured.consume(buffer) }
        defer { output.engine.mainMixerNode.removeTap(onBus: 0) }
        var checkpoints: [[String: Any]] = []
        for mode in ["direct", "pause-then-play", "seek-then-play"] {
            try tested.command("seek", position: 6)
            try await waitForStream { tested.outputIsPlaying && tested.playbackPosition >= 6 }
            tested.networkChanged(connected: false)
            XCTAssertEqual(tested.error, "network"); XCTAssertFalse(tested.intentToPlay)
            XCTAssertNotNil(tested.networkResume)
            var expected = tested.playbackPosition
            if mode == "pause-then-play" {
                try tested.command("pause"); XCTAssertNil(tested.networkResume)
            } else if mode == "seek-then-play" {
                try tested.command("seek", position: 10); expected = 10
            }
            let old = try XCTUnwrap(tested.stream), resolves = gateway.resolved.count
            try tested.command("play")
            try await waitForStream { tested.outputIsPlaying }
            let resumed = tested.playbackPosition
            XCTAssertGreaterThanOrEqual(resumed, expected - 0.05, mode + " lost the user's position")
            XCTAssertLessThan(resumed, expected + 1, mode)
            XCTAssertFalse(tested.stream === old); XCTAssertEqual(gateway.resolved.count, resolves + 1)
            XCTAssertNil(tested.error); XCTAssertNil(tested.networkResume)
            let entry = tested.stream, epoch = tested.generation
            tested.networkChanged(connected: true)
            measured.reset(); let before = tested.playbackPosition
            try await Task.sleep(nanoseconds: 450_000_000)
            let pcm = measured.read(), advance = tested.playbackPosition - before
            XCTAssertGreaterThan(pcm.frames, 1000); XCTAssertEqual(pcm.channels, 2)
            XCTAssertGreaterThan(pcm.rms, 0.005); XCTAssertGreaterThan(advance, 0.2)
            XCTAssertTrue(tested.stream === entry); XCTAssertEqual(tested.generation, epoch)
            XCTAssertEqual(gateway.resolved.count, resolves + 1, "A late network callback must not restart manual recovery")
            checkpoints.append(["mode": mode, "expectedPosition": expected, "resumedPosition": resumed,
                                "frames": pcm.frames, "channels": pcm.channels, "rms": pcm.rms, "advanceSeconds": advance])
        }
        // After natural EOF, a new play command means replay, not recovery at the old start offset.
        try tested.command("seek", position: 19.8)
        try await waitForStream { tested.stream?.hasEnded == true && !tested.intentToPlay }
        try tested.command("play")
        try await waitForStream { tested.outputIsPlaying }
        XCTAssertLessThan(tested.playbackPosition, 1)
        XCTAssertEqual(gateway.resolved.count, 5)
        let data = try JSONSerialization.data(withJSONObject: ["provider": provider, "checkpoints": checkpoints,
            "replayPosition": tested.playbackPosition], options: [.prettyPrinted, .sortedKeys])
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = provider + "-manual-network-retry"; attachment.lifetime = .keepAlways; add(attachment)
    }

    func testStereoRapidSeeksApplyLastPositionWhenPlayingAndPaused() async throws {
        let source = try streamingTone(); defer { try? FileManager.default.removeItem(at: source) }
        let tested = stereoEngine(AudioFixtureGateway(url: source)); defer { tested.stop(); tested.clearOutput() }
        try tested.setQueue([song("qq", "seek-race")], at: 0)
        try await waitForStream { tested.outputIsPlaying }
        let entry = try XCTUnwrap(tested.stream), generation = tested.generation
        for position in [2.0, 14, 4, 11] { try tested.command("seek", position: position) }
        try await waitForStream { !entry.audio.isSeeking && tested.outputIsPlaying && tested.playbackPosition >= 11 }
        XCTAssertLessThan(tested.playbackPosition, 12)
        try tested.command("pause")
        for position in [7.0, 15, 3, 8] { try tested.command("seek", position: position) }
        XCTAssertFalse(tested.outputIsPlaying)
        XCTAssertEqual(tested.playbackPosition, 8, accuracy: 0.05)
        try tested.command("play")
        try await waitForStream { !entry.audio.isSeeking && tested.outputIsPlaying && tested.playbackPosition >= 8 }
        XCTAssertLessThan(tested.playbackPosition, 9)
        XCTAssertTrue(tested.stream === entry); XCTAssertEqual(tested.generation, generation)
        XCTAssertNil(tested.error)
    }

    func testStereoStallRecoveryUsesFreshURLAndNewGeneration() async throws {
        let source = try streamingTone(); defer { try? FileManager.default.removeItem(at: source) }
        let gateway = AudioFixtureGateway(url: source)
        let tested = stereoEngine(gateway); defer { tested.stop(); tested.clearOutput() }
        try tested.setQueue([song("qq", "stall")], at: 0)
        try await waitForStream { tested.outputIsPlaying }
        let old = try XCTUnwrap(tested.stream), generation = tested.generation
        // Inject a stopped output while play intent remains active; execute the scheduled deadline.
        old.audio.pause()
        try await waitForStream { tested.stalledRecovery != nil }
        tested.stalledRecovery?.perform()
        try await waitForStream { tested.outputIsPlaying }
        XCTAssertEqual(gateway.resolved.count, 2)
        XCTAssertEqual(tested.generation, generation + 1)
        XCTAssertFalse(tested.stream === old); XCTAssertNil(tested.stalledRecovery)
    }

    func testStereoPausedSeekInterruptionAndProviderRemoval() async throws {
        let source = try streamingTone(); defer { try? FileManager.default.removeItem(at: source) }
        let tested = stereoEngine(AudioFixtureGateway(url: source)); defer { tested.stop(); tested.clearOutput() }
        try tested.setQueue([song("qq", "current"), song("netease", "next")], at: 0)
        try await waitForStream { tested.outputIsPlaying && tested.preparedStream != nil }
        let current = tested.stream
        weak var pending = tested.preparedStream?.entry
        tested.invalidateProvider("netease")
        try await waitForStream { pending == nil }
        XCTAssertTrue(tested.stream === current); XCTAssertTrue(tested.outputIsPlaying)
        try tested.command("pause"); try tested.command("seek", position: 10)
        XCTAssertFalse(tested.outputIsPlaying); XCTAssertEqual(tested.playbackPosition, 10, accuracy: 0.05)
        XCTAssertFalse(tested.streamOutput?.running ?? true, "Pause must stop the shared output, including noise/reverb")
        try tested.command("play")
        try await waitForStream { tested.outputIsPlaying && tested.playbackPosition > 10.1 }
        NotificationCenter.default.post(name: AVAudioSession.interruptionNotification, object: nil,
            userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.began.rawValue])
        XCTAssertFalse(tested.intentToPlay); XCTAssertFalse(tested.outputIsPlaying)
        NotificationCenter.default.post(name: AVAudioSession.interruptionNotification, object: nil,
            userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.ended.rawValue,
                       AVAudioSessionInterruptionOptionKey: AVAudioSession.InterruptionOptions.shouldResume.rawValue])
        try await waitForStream { tested.outputIsPlaying }
        tested.invalidateProvider("qq")
        XCTAssertNil(tested.stream); XCTAssertNil(tested.currentSong); XCTAssertFalse(tested.intentToPlay)
        XCTAssertEqual(tested.streamOutput?.attachedCount, 0)
        XCTAssertFalse(tested.streamOutput?.running ?? true)
    }

    func testSharedQueueRebuildsHardwareRouteWithoutReplacingIdentityOrResumingPause() async throws {
        let source = try streamingTone(); defer { try? FileManager.default.removeItem(at: source) }
        let tested = stereoEngine(AudioFixtureGateway(url: source)); defer { tested.stop(); tested.clearOutput() }
        try tested.setQueue([song("qq", "route")], at: 0)
        try await waitForStream { tested.outputIsPlaying && tested.playbackPosition > 0.2 }
        let entry = try XCTUnwrap(tested.stream), output = try XCTUnwrap(tested.streamOutput)
        let before = tested.playbackPosition, epoch = tested.generation
        output.engine.pause()
        NotificationCenter.default.post(name: .AVAudioEngineConfigurationChange, object: output.engine)
        try await waitForStream { tested.outputIsPlaying && tested.playbackPosition > before }
        XCTAssertTrue(tested.stream === entry); XCTAssertEqual(tested.generation, epoch)
        try tested.command("pause")
        try await waitForStream { !tested.outputIsPlaying }
        let paused = tested.playbackPosition
        NotificationCenter.default.post(name: .AVAudioEngineConfigurationChange, object: output.engine)
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertFalse(tested.outputIsPlaying); XCTAssertFalse(output.running)
        XCTAssertEqual(tested.playbackPosition, paused, accuracy: 0.005)
    }

    func testSharedQueueGraphAndDecodersReleaseWithPlaybackOwner() async throws {
        let source = try streamingTone(); defer { try? FileManager.default.removeItem(at: source) }
        var tested: PlaybackEngine? = stereoEngine(AudioFixtureGateway(url: source))
        try tested!.setQueue([song("qq", "current"), song("netease", "pending")], at: 0)
        try await waitForStream { tested?.outputIsPlaying == true && tested?.preparedStream != nil }
        weak var owner = tested, output = tested?.streamOutput, current = tested?.stream, pending = tested?.preparedStream?.entry
        tested = nil
        try await waitForStream { owner == nil && output == nil && current == nil && pending == nil }
    }

    #if FOLIA_AUDIO_OUTPUT_PROBE
    func testHTTPNativeQueueCancelsBufferedSongAndAdvancesWithoutWebView() async throws {
        let gateway = AudioFixtureGateway(url: URL(string: "http://127.0.0.1:18779/mono.wav")!)
        let tested = stereoEngine(gateway); defer { tested.stop(); tested.clearOutput() }
        let first = song("qq", "http-first"), removed = song("netease", "http-removed"), next = song("qq", "http-next")
        try tested.setQueue([first, removed, next], at: 0)
        try await waitForStream { tested.outputIsPlaying && (tested.preparedStream?.entry.audio.bufferedDuration ?? 0) > 0.5 }
        let current = tested.stream
        weak var cancelled = tested.preparedStream?.entry
        try tested.editQueue([first, next], currentIndex: 0, expectedRevision: tested.queueRevision)
        try await waitForStream { cancelled == nil && tested.preparedStream != nil }
        XCTAssertTrue(tested.stream === current)
        XCTAssertEqual(tested.preparedStream?.entry.audio.framesPlayed, 0)
        XCTAssertEqual(tested.meter?.snapshot()["channels"] as? Int, 2)
        try tested.command("seek", position: 59.5)
        try await waitForStream({ tested.index == 1 && tested.outputIsPlaying }, seconds: 8)
        XCTAssertEqual(tested.currentSong?["name"] as? String, "http-next")
        XCTAssertNil(tested.error)
        print("FOLIA_HTTP_NATIVE_QUEUE currentPreserved=PASS cancelledReleased=PASS nativeAdvance=PASS")
    }
    #endif
}
