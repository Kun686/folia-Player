import XCTest
import AVFoundation
import UIKit
@testable import App

// SleepTimerTests.swift — deadline ownership, persistence and playback cancellation without a WebView.
@MainActor extension NativeTests {
    func testSleepTimerRestoresDurationButNeverArmedState() throws {
        let storage = UserDefaults(suiteName: UUID().uuidString)!
        let timer = NativeSleepTimer(storage: storage)
        _ = try timer.apply(["hours": 999, "minutes": 59, "enabled": true])
        XCTAssertNotNil(timer.deadline)
        let restored = NativeSleepTimer(storage: storage)
        XCTAssertEqual(restored.duration.hours, 999); XCTAssertEqual(restored.duration.minutes, 59)
        XCTAssertNil(restored.deadline)
        let invalid: [[String: Any]] = [["hours": -1], ["hours": 1000], ["minutes": 60], ["hours": 1.5],
                                       ["enabled": "true"], ["hours": NSNull()], ["deadlineMs": 0], [:]]
        for values in invalid {
            let before = timer.deadline, revision = timer.revision
            XCTAssertThrowsError(try timer.apply(values))
            XCTAssertEqual(timer.deadline, before); XCTAssertEqual(timer.revision, revision)
        }
        let empty = NativeSleepTimer(storage: UserDefaults(suiteName: UUID().uuidString)!)
        XCTAssertThrowsError(try empty.apply(["enabled": true]))
        XCTAssertNil(empty.deadline)
    }
    func testSleepTimerRearmsOnlyForExplicitActivationOrChangedDuration() throws {
        var now = Date(timeIntervalSince1970: 1000)
        let timer = NativeSleepTimer(storage: UserDefaults(suiteName: UUID().uuidString)!, now: { now })
        _ = try timer.apply(["minutes": 2, "enabled": true]); XCTAssertEqual(timer.deadline, now.addingTimeInterval(120))
        now.addTimeInterval(10)
        _ = try timer.apply(["minutes": 2]); XCTAssertEqual(timer.deadline?.timeIntervalSince1970, 1120)
        _ = try timer.apply(["enabled": true]); XCTAssertEqual(timer.deadline?.timeIntervalSince1970, 1130)
        _ = try timer.apply(["minutes": 1]); XCTAssertEqual(timer.deadline?.timeIntervalSince1970, 1070)
        _ = try timer.apply(["minutes": 0]); XCTAssertNil(timer.deadline)
    }
    func testSleepTimerExpiryIsOnceAndLateDurationEditCannotReenable() throws {
        var now = Date(timeIntervalSince1970: 1000), expired = 0
        let timer = NativeSleepTimer(storage: UserDefaults(suiteName: UUID().uuidString)!, now: { now })
        timer.expired = { expired += 1 }
        _ = try timer.apply(["minutes": 1, "enabled": true])
        now.addTimeInterval(61)
        _ = try timer.apply(["minutes": 5])
        timer.reconcile(); XCTAssertEqual(expired, 1); XCTAssertNil(timer.deadline)
        _ = try timer.apply(["enabled": true]); now.addTimeInterval(301)
        timer.reconcile(); timer.reconcile(); XCTAssertEqual(expired, 2)
    }
    func testSleepTimerDispatchSourceExpiresWithoutFrontendPolling() async throws {
        var now = Date(timeIntervalSince1970: 1000)
        let timer = NativeSleepTimer(storage: UserDefaults(suiteName: UUID().uuidString)!, now: { now })
        let done = expectation(description: "native expiry")
        timer.expired = { done.fulfill() }
        _ = try timer.apply(["minutes": 1, "enabled": true]); now.addTimeInterval(61)
        await fulfillment(of: [done], timeout: 2.5)
        XCTAssertNil(timer.deadline)
    }
    func testSleepTimerPausesEngineAndClearsInterruptionResumeWithoutClearingQueue() throws {
        var now = Date(timeIntervalSince1970: 1000)
        let storage = UserDefaults(suiteName: UUID().uuidString)!
        let timer = NativeSleepTimer(storage: storage, now: { now })
        let tested = PlaybackEngine(gateway: FailingGateway(), storage: storage, sleepTimer: timer)
        tested.network.cancel(); defer { tested.stop() }
        tested.queue = [song("qq", "sleep")]; tested.index = 0; tested.restoredPosition = 12
        tested.intentToPlay = true; tested.resumeAfterInterruption = true; tested.networkResume = 12
        _ = try timer.apply(["minutes": 1, "enabled": true]); now.addTimeInterval(61); timer.reconcile()
        XCTAssertFalse(tested.intentToPlay); XCTAssertFalse(tested.resumeAfterInterruption); XCTAssertNil(tested.networkResume)
        XCTAssertEqual(tested.queue.count, 1); XCTAssertEqual(tested.index, 0); XCTAssertEqual(tested.restoredPosition, 12)
    }
    func testSleepTimerManualPauseKeepsDeadlineAndForegroundReconciles() throws {
        var now = Date(timeIntervalSince1970: 1000)
        let storage = UserDefaults(suiteName: UUID().uuidString)!
        let timer = NativeSleepTimer(storage: storage, now: { now })
        let tested = PlaybackEngine(gateway: FailingGateway(), storage: storage, sleepTimer: timer)
        tested.network.cancel(); defer { tested.stop() }
        _ = try timer.apply(["minutes": 1, "enabled": true]); try tested.command("pause")
        XCTAssertNotNil(timer.deadline)
        now.addTimeInterval(61)
        NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        XCTAssertNil(timer.deadline); XCTAssertFalse(tested.intentToPlay)
    }
    func testSleepTimerExpiresBeforeNetworkRecoveryCanResume() throws {
        var now = Date(timeIntervalSince1970: 1000)
        let storage = UserDefaults(suiteName: UUID().uuidString)!
        let timer = NativeSleepTimer(storage: storage, now: { now })
        let tested = PlaybackEngine(gateway: FailingGateway(), storage: storage, sleepTimer: timer)
        tested.network.cancel(); defer { tested.stop() }
        tested.queue = [song("qq", "sleep")]; tested.index = 0; tested.networkResume = 12
        _ = try timer.apply(["minutes": 1, "enabled": true]); now.addTimeInterval(61)
        tested.networkChanged(connected: true)
        XCTAssertNil(timer.deadline); XCTAssertNil(tested.networkResume); XCTAssertFalse(tested.intentToPlay)
        XCTAssertNil(tested.task)
    }
    func testSleepTimerStopsDecodedStereoOutputAndPreventsInterruptionResume() async throws {
        let source = try streamingTone(); defer { try? FileManager.default.removeItem(at: source) }
        var now = Date(timeIntervalSince1970: 1000)
        let storage = UserDefaults(suiteName: UUID().uuidString)!
        let timer = NativeSleepTimer(storage: storage, now: { now })
        let tested = PlaybackEngine(gateway: AudioFixtureGateway(url: source), storage: storage,
                                   usesStereoOutput: true, sleepTimer: timer)
        tested.network.cancel(); defer { tested.stop(); tested.clearOutput() }
        try tested.setQueue([song("qq", "sleep")], at: 0)
        try await waitForStream { tested.outputIsPlaying && tested.playbackPosition > 0.2 }
        let current = tested.stream
        _ = try timer.apply(["minutes": 1, "enabled": true]); now.addTimeInterval(61)
        try await waitForStream { !tested.outputIsPlaying }
        let paused = tested.playbackPosition
        try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertEqual(tested.playbackPosition, paused, accuracy: 0.01)
        XCTAssertFalse(tested.streamOutput?.running ?? true); XCTAssertTrue(tested.stream === current)
        XCTAssertFalse(tested.intentToPlay); XCTAssertEqual(tested.queue.count, 1)
        try tested.command("play")
        try await waitForStream { tested.outputIsPlaying }
        _ = try timer.apply(["enabled": true])
        NotificationCenter.default.post(name: AVAudioSession.interruptionNotification, object: nil,
            userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.began.rawValue])
        XCTAssertTrue(tested.resumeAfterInterruption); now.addTimeInterval(61)
        NotificationCenter.default.post(name: AVAudioSession.interruptionNotification, object: nil,
            userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.ended.rawValue,
                       AVAudioSessionInterruptionOptionKey: AVAudioSession.InterruptionOptions.shouldResume.rawValue])
        XCTAssertNil(timer.deadline); XCTAssertFalse(tested.intentToPlay); XCTAssertFalse(tested.outputIsPlaying)
        XCTAssertFalse(tested.resumeAfterInterruption)
    }
}
