import XCTest
import AVFoundation
@testable import App

// QueueEditingTests.swift — edits must preserve the native item and reject stale UI intent.
@MainActor extension NativeTests {
    func testQueueEditPreservesItemPositionAndPausedState() async throws {
        let url = try silentAudio(), tested = engine()
        defer { tested.stop(); try? FileManager.default.removeItem(at: url) }
        tested.network.cancel()
        tested.queue = try [song("qq", "a"), song("netease", "a"), song("qq", "b")].map(PlaybackEngine.sanitizedSong)
        tested.index = 1
        let item = AVPlayerItem(url: url)
        tested.player.insert(item, after: nil)
        await tested.player.seek(to: CMTime(seconds: 0.4, preferredTimescale: 600))
        let generation = tested.generation, before = tested.player.currentTime().seconds
        try tested.editQueue([tested.queue[2], tested.queue[1], tested.queue[0]], currentIndex: 1, expectedRevision: tested.queueRevision)
        XCTAssertTrue(tested.player.currentItem === item)
        XCTAssertEqual(tested.player.currentTime().seconds, before, accuracy: 0.03)
        XCTAssertEqual(tested.generation, generation)
        XCTAssertFalse(tested.intentToPlay)
        XCTAssertEqual(tested.player.rate, 0)
        XCTAssertEqual((tested.currentSong?["sourceRef"] as? [String: String])?["providerId"], "netease")
    }
    func testQueueEditRejectsStaleIndexAndWrongProviderAtomically() throws {
        let tested = engine(); tested.network.cancel(); defer { tested.stop() }
        tested.queue = [song("netease", "a"), song("qq", "a")]; tested.index = 0
        let oldRevision = tested.queueRevision
        tested.index = 1
        XCTAssertThrowsError(try tested.editQueue([], currentIndex: -1, expectedRevision: oldRevision)) {
            XCTAssertEqual(($0 as? MobileFailure)?.code, "queue-changed")
        }
        XCTAssertThrowsError(try tested.selectQueue(0, expectedRevision: oldRevision))
        XCTAssertThrowsError(try tested.editQueue(tested.queue, currentIndex: 0, expectedRevision: tested.queueRevision))
        XCTAssertEqual(tested.queue.count, 2); XCTAssertEqual(tested.index, 1)
    }
    func testClearKeepsCurrentAndRestoresDetachedSongPaused() throws {
        let tested = engine(); tested.network.cancel(); defer { tested.stop() }
        tested.queue = try [song("qq", "a")].map(PlaybackEngine.sanitizedSong); tested.index = 0
        tested.intentToPlay = true; tested.restoredPosition = 12.5
        try tested.editQueue([], currentIndex: -1, expectedRevision: tested.queueRevision)
        XCTAssertTrue(tested.intentToPlay); XCTAssertEqual(tested.currentSong?["name"] as? String, "a")
        let restored = PlaybackEngine(gateway: FailingGateway(), storage: tested.storage)
        restored.network.cancel(); defer { restored.stop() }
        XCTAssertTrue(restored.queue.isEmpty); XCTAssertEqual(restored.index, -1)
        XCTAssertEqual(restored.currentSong?["name"] as? String, "a")
        XCTAssertEqual(restored.snapshot()["position"] as? Double, 12.5)
        XCTAssertFalse(restored.intentToPlay)
        tested.move(1, automatic: true)
        XCTAssertFalse(tested.intentToPlay, "An empty queue stops when the detached song ends")
    }
    func testRestoredSongShowsDurationAndSeeksWithoutStartingAudio() throws {
        let tested = engine(); tested.network.cancel(); defer { tested.stop() }
        var current = song("qq", "a"); current["durationMs"] = 60000.0
        tested.queue = try [current].map(PlaybackEngine.sanitizedSong); tested.index = 0
        tested.restoredPosition = 12.5
        try tested.editQueue([], currentIndex: -1, expectedRevision: tested.queueRevision)
        let restored = PlaybackEngine(gateway: FailingGateway(), storage: tested.storage)
        restored.network.cancel(); defer { restored.stop() }
        XCTAssertEqual(restored.snapshot()["duration"] as? Double, 60)
        try restored.command("seek", position: 30)
        XCTAssertEqual(restored.snapshot()["position"] as? Double, 30)
        XCTAssertNil(restored.player.currentItem); XCTAssertFalse(restored.intentToPlay)
        try restored.command("seek", position: 90)
        XCTAssertEqual(restored.restoredPosition, 60)
    }
    func testLogoutAlsoRemovesDetachedCurrentSong() throws {
        let tested = engine(); tested.network.cancel(); defer { tested.stop() }
        tested.queue = try [song("qq", "a")].map(PlaybackEngine.sanitizedSong); tested.index = 0
        try tested.editQueue([], currentIndex: -1, expectedRevision: tested.queueRevision)
        tested.invalidateProvider("qq")
        XCTAssertNil(tested.currentSong); XCTAssertFalse(tested.intentToPlay)
    }
    func testBoundaryButtonsDoNotStopAndManualSkipStartsFromPause() throws {
        let tested = engine(); tested.network.cancel(); defer { tested.stop() }
        tested.queue = [song("qq", "a"), song("qq", "b")]; tested.index = 0; tested.intentToPlay = true
        try tested.command("previous")
        XCTAssertEqual(tested.index, 0); XCTAssertTrue(tested.intentToPlay)
        tested.index = 1
        try tested.command("next")
        XCTAssertTrue(tested.intentToPlay)
        tested.intentToPlay = false
        try tested.command("previous")
        XCTAssertEqual(tested.index, 0); XCTAssertTrue(tested.intentToPlay)
    }
    func testDetachedSongAdvancesToQueueBeginningAndRepeatAllPreviousToEnd() throws {
        let tested = engine(); tested.network.cancel(); defer { tested.stop() }
        tested.queue = [song("qq", "a"), song("qq", "b")]; tested.index = 0
        try tested.editQueue([tested.queue[1]], currentIndex: -1, expectedRevision: tested.queueRevision)
        XCTAssertEqual(tested.nextIndex(), 0); XCTAssertNil(tested.nextIndex(-1))
        tested.repeatMode = "all"
        XCTAssertEqual(tested.nextIndex(-1), 0)
    }
    func testQueueEditReconcilesAlreadyAdvancedNativeItemBeforeVersionCheck() throws {
        let url = try silentAudio(), tested = engine()
        defer { tested.stop(); try? FileManager.default.removeItem(at: url) }
        tested.network.cancel()
        tested.queue = [song("qq", "a"), song("qq", "b")]; tested.index = 0
        let revision = tested.queueRevision, nextItem = AVPlayerItem(url: url)
        tested.prepared = (1, nextItem, Date(), nil)
        tested.player.insert(nextItem, after: nil)
        XCTAssertThrowsError(try tested.editQueue([], currentIndex: -1, expectedRevision: revision)) {
            XCTAssertEqual(($0 as? MobileFailure)?.code, "queue-changed")
        }
        XCTAssertEqual(tested.index, 1); XCTAssertTrue(tested.player.currentItem === nextItem)
    }
}
