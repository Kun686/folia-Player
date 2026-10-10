import XCTest
import AVFoundation
@testable import App

// StreamingQueueTests.swift — original queue semantics on independent stereo occurrences, with real decoded PCM.
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

    func testStereoQueueDeletesBufferedNextWithoutRestartingCurrent() async throws {
        let source = try streamingTone(); defer { try? FileManager.default.removeItem(at: source) }
        let tested = stereoEngine(AudioFixtureGateway(url: source)); defer { tested.stop(); tested.clearOutput() }
        let first = song("qq", "first"), removedSong = song("netease", "removed"), next = song("qq", "next")
        try tested.setQueue([first, removedSong, next], at: 0)
        try await waitForStream { tested.outputIsPlaying && (tested.preparedStream?.entry.audio.bufferedDuration ?? 0) > 0.5 }
        let current = try XCTUnwrap(tested.stream)
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
        try tested.setQueue([song("qq", "slow"), song("netease", "new")], at: 0)
        try await Task.sleep(nanoseconds: 20_000_000)
        try tested.selectQueue(1, expectedRevision: tested.queueRevision)
        try await waitForStream { tested.outputIsPlaying }
        let active = tested.stream
        try await Task.sleep(nanoseconds: 350_000_000)
        XCTAssertEqual(tested.index, 1); XCTAssertTrue(tested.stream === active)
        XCTAssertEqual(tested.currentSong?["name"] as? String, "new")
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
        entry.audio.frameFiltering.add(entry: "mute-output") { buffer, _ in measured.consume(buffer) }
        defer { entry.audio.frameFiltering.removeAll() }
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
