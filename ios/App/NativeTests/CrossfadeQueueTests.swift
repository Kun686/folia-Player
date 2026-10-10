import XCTest
import AVFoundation
@testable import App

// CrossfadeQueueTests.swift — real native queue transitions and user-intent cancellation, without WKWebView.
@MainActor extension NativeTests {
    func startCrossfadeQueue(_ source: URL, songs: [[String: Any]]) async throws -> PlaybackEngine {
        let tested = stereoEngine(AudioFixtureGateway(url: source))
        do {
            try tested.crossfade?.configure(enabled: true, maximumSeconds: 1)
            try tested.setQueue(songs, at: 0)
            try await waitForStream { tested.outputIsPlaying && tested.preparedStream != nil }
            try tested.command("seek", position: 6.8)
            try await waitForStream { tested.crossfade?.isFading == true && tested.index == 1 && tested.outputIsPlaying }
            return tested
        } catch { tested.stop(); tested.clearOutput(); throw error }
    }

    func testTransitionSettingsPersistRestoreAndRejectInvalidEditsAtomically() throws {
        let tested = engine()
        XCTAssertFalse(tested.transitionSettings.enabled)
        XCTAssertEqual(tested.transitionSettings.mode, "automix")
        let values: [String: Any] = ["enabled": true, "mode": "crossfade", "crossfadeMaxSec": 12.0]
        _ = try tested.setTransitionSettings(values)
        let saved = tested.storage.data(forKey: "folia.transition")
        for invalid in [["enabled": false, "mode": "other", "crossfadeMaxSec": 5.0],
                        ["enabled": false, "mode": "automix", "crossfadeMaxSec": 26.0],
                        ["enabled": "yes", "mode": "crossfade", "crossfadeMaxSec": 5.0]] as [[String: Any]] {
            XCTAssertThrowsError(try tested.setTransitionSettings(invalid))
            XCTAssertEqual(tested.storage.data(forKey: "folia.transition"), saved)
            XCTAssertTrue(tested.crossfade!.enabled)
            XCTAssertEqual(tested.crossfade!.maximumSeconds, 12)
        }
        let restored = PlaybackEngine(gateway: FailingGateway(), storage: tested.storage)
        XCTAssertTrue(restored.crossfade!.enabled)
        XCTAssertEqual(restored.transitionSettings.mode, "crossfade")
        XCTAssertEqual(restored.crossfade!.maximumSeconds, 12)
        _ = try restored.setTransitionSettings(["enabled": false, "mode": "automix", "crossfadeMaxSec": 5.0])
        XCTAssertFalse(restored.crossfade!.enabled)
        tested.storage.set(Data("invalid".utf8), forKey: "folia.transition")
        let corrupt = PlaybackEngine(gateway: FailingGateway(), storage: tested.storage)
        XCTAssertFalse(corrupt.crossfade!.enabled)
        tested.storage.removeObject(forKey: "folia.transition")
    }

    func testNativeCrossfadeAdvancesIdentityQueueAndReleasesTail() async throws {
        let url = try sharedConstantFile(seconds: 8)
        defer { try? FileManager.default.removeItem(at: url) }
        let tested = try await startCrossfadeQueue(url, songs: [song("qq", "a"), song("netease", "b"), song("qq", "c")])
        defer { tested.stop(); tested.clearOutput() }
        let output = try XCTUnwrap(tested.streamOutput), incoming = try XCTUnwrap(tested.stream)
        XCTAssertEqual(output.attachedCount, 2)
        XCTAssertEqual(tested.currentSong?["name"] as? String, "b")
        XCTAssertTrue(tested.intentToPlay); XCTAssertNil(tested.error)
        try await waitForStream { tested.crossfade?.isFading == false && tested.preparedStream?.index == 2 }
        XCTAssertTrue(tested.stream === incoming); XCTAssertTrue(tested.streamOutput === output)
        XCTAssertEqual(output.attachedCount, 1)
        XCTAssertGreaterThan(incoming.position, 0.8)
        XCTAssertEqual(tested.index, 1)
        print("FOLIA_NATIVE_CROSSFADE identityQueue=PASS dualDecks=PASS tailCleanup=PASS nextPrepared=PASS")
    }

    func testNativeCrossfadePauseResumeSeekAndSkipCancelPreviousIntents() async throws {
        let url = try sharedConstantFile(seconds: 8)
        defer { try? FileManager.default.removeItem(at: url) }
        let tested = try await startCrossfadeQueue(url, songs: (0..<4).map { song("qq", "track\($0)") })
        defer { tested.stop(); tested.clearOutput() }
        let incoming = try XCTUnwrap(tested.stream)
        try tested.command("pause")
        XCTAssertFalse(tested.crossfade!.isFading); XCTAssertFalse(tested.outputIsPlaying)
        XCTAssertEqual(tested.streamOutput?.attachedCount, 1); XCTAssertTrue(tested.stream === incoming)
        let stopped = tested.playbackPosition
        try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertEqual(tested.playbackPosition, stopped, accuracy: 0.001)
        try tested.command("play")
        try await waitForStream { tested.outputIsPlaying && tested.preparedStream?.index == 2 }
        try tested.command("seek", position: 6.8)
        try await waitForStream { tested.crossfade?.isFading == true && tested.index == 2 }
        let current = tested.stream
        try tested.command("seek", position: 1)
        XCTAssertFalse(tested.crossfade!.isFading); XCTAssertTrue(tested.stream === current)
        XCTAssertEqual(tested.streamOutput?.attachedCount, 1)
        try await waitForStream { tested.playbackPosition >= 1 && tested.preparedStream?.index == 3 }
        try tested.command("seek", position: 6.8)
        try await waitForStream { tested.crossfade?.isFading == true && tested.index == 3 }
        try tested.selectQueue(0, expectedRevision: tested.queueRevision)
        try await waitForStream { tested.index == 0 && tested.outputIsPlaying }
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertEqual(tested.index, 0); XCTAssertFalse(tested.crossfade!.isFading)
        XCTAssertEqual(tested.streamOutput?.attachedCount, 1)
    }

    func testNativeCrossfadeQueueEditKeepsAudiblePairButLogoutRemovesMatchingTail() async throws {
        let url = try sharedConstantFile(seconds: 8)
        defer { try? FileManager.default.removeItem(at: url) }
        let a = song("qq", "a"), b = song("netease", "b"), c = song("netease", "c")
        let tested = try await startCrossfadeQueue(url, songs: [a, b, song("qq", "removed")])
        defer { tested.stop(); tested.clearOutput() }
        let incoming = tested.stream
        try tested.editQueue([a, b, c], currentIndex: 1, expectedRevision: tested.queueRevision)
        XCTAssertTrue(tested.crossfade!.isFading); XCTAssertEqual(tested.streamOutput?.attachedCount, 2)
        XCTAssertTrue(tested.stream === incoming)
        tested.invalidateProvider("qq")
        XCTAssertFalse(tested.crossfade!.isFading); XCTAssertEqual(tested.streamOutput?.attachedCount, 1)
        XCTAssertTrue(tested.stream === incoming); XCTAssertTrue(tested.outputIsPlaying)
        XCTAssertEqual(tested.currentSong?["name"] as? String, "b")
        XCTAssertEqual(tested.index, 0)
        try await waitForStream { tested.preparedStream?.index == 1 }
        XCTAssertEqual(tested.queue[1]["name"] as? String, "c")
    }

    func testNativeCrossfadeDisabledAndInvalidSettingsPreserveCurrentSong() async throws {
        let url = try sharedConstantFile(seconds: 8)
        defer { try? FileManager.default.removeItem(at: url) }
        let tested = try await startCrossfadeQueue(url, songs: (0..<3).map { song("qq", "track\($0)") })
        defer { tested.stop(); tested.clearOutput() }
        let current = tested.stream
        XCTAssertThrowsError(try tested.crossfade?.configure(enabled: false, maximumSeconds: .nan))
        XCTAssertTrue(tested.crossfade!.isFading)
        try tested.crossfade?.configure(enabled: false, maximumSeconds: 1)
        XCTAssertFalse(tested.crossfade!.isFading); XCTAssertTrue(tested.stream === current)
        XCTAssertEqual(tested.streamOutput?.attachedCount, 1)
        try await waitForStream { tested.preparedStream != nil }
        try tested.command("seek", position: 7.5)
        try await waitForStream { tested.index == 2 && tested.outputIsPlaying }
        XCTAssertFalse(tested.crossfade!.isFading); XCTAssertEqual(tested.streamOutput?.attachedCount, 1)
    }

    func testNativeCrossfadeDoesNotBlendSingleRepeatOrSameSongOccurrences() async throws {
        let url = try sharedConstantFile(seconds: 8)
        defer { try? FileManager.default.removeItem(at: url) }
        for singleRepeat in [true, false] {
            let tested = stereoEngine(AudioFixtureGateway(url: url))
            defer { tested.stop(); tested.clearOutput() }
            try tested.crossfade?.configure(enabled: true, maximumSeconds: 1)
            if singleRepeat { try tested.command("repeat", mode: "one") }
            try tested.setQueue([song("qq", "same"), song("qq", singleRepeat ? "different" : "same")], at: 0)
            try await waitForStream { tested.outputIsPlaying && tested.preparedStream != nil }
            let first = tested.stream
            try tested.command("seek", position: 7.2)
            try await Task.sleep(nanoseconds: 350_000_000)
            XCTAssertFalse(tested.crossfade!.isFading); XCTAssertTrue(tested.stream === first)
            XCTAssertEqual(tested.streamOutput?.attachedCount, 1)
            try await waitForStream { tested.stream !== first && tested.outputIsPlaying }
            XCTAssertFalse(tested.crossfade!.isFading)
            XCTAssertEqual(tested.index, singleRepeat ? 0 : 1)
        }
    }
}
