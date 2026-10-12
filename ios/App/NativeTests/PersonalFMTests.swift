import XCTest
import AVFoundation
@testable import App

// PersonalFMTests.swift — controlled recommendations with actual native decoding; no WebView or user account.
final class FMFixtureGateway: GatewayClient {
    let url: URL
    var calls: [[String: Any]] = []
    var respond: (([String: Any], Int) async throws -> [String: Any])?
    init(_ url: URL) { self.url = url }
    override func resolve(_ song: [String: Any], quality: String = "standard") async throws -> NativeAudioSource { NativeAudioSource(url: url) }
    override func send(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] { throw MobileFailure("fixture-no-lyrics") }
    override func personalFM(_ selection: [String: Any]) async throws -> [String: Any] {
        calls.append(selection); let number = calls.count
        if let respond { return try await respond(selection, number) }
        return Self.batch(selection, number)
    }
    static func batch(_ selection: [String: Any], _ number: Int) -> [String: Any] {
        ["selection": selection, "fallback": false, "songs": (0..<3).map { i in
            ["name": "fm-\(number)-\(i)", "durationMs": 1000.0,
             "sourceRef": ["kind": "online", "providerId": "netease", "mediaId": "\(number * 10 + i)"]] as [String: Any]
        }]
    }
}
@MainActor extension NativeTests {
    func testFMNativePlaybackRefillsAcrossBatchesWithoutWebView() async throws {
        let source = try silentAudio(); defer { try? FileManager.default.removeItem(at: source) }
        let gateway = FMFixtureGateway(source), tested = stereoEngine(gateway)
        defer { tested.stop(); tested.clearOutput() }
        var heard = Set<String>()
        tested.emit = { _ in if tested.outputIsPlaying, let name = tested.currentSong?["name"] as? String { heard.insert(name) } }
        defer { tested.emit = nil }
        try await tested.personalFM.start(["mode": "DEFAULT"])
        try await waitForStream({ heard.count >= 4 }, seconds: 9)
        XCTAssertGreaterThanOrEqual(gateway.calls.count, 2)
        XCTAssertTrue(tested.personalFM.active); XCTAssertTrue(tested.intentToPlay)
        XCTAssertTrue(heard.contains("fm-2-0")); XCTAssertGreaterThanOrEqual(tested.queue.count, 6)
    }
    func testFMRestoresPausedAndNewModeReplacesWholeQueue() async throws {
        let source = try silentAudio(); defer { try? FileManager.default.removeItem(at: source) }
        let gateway = FMFixtureGateway(source), tested = stereoEngine(gateway)
        defer { tested.stop(); tested.clearOutput() }
        try await tested.personalFM.start(["mode": "DEFAULT"])
        try await tested.personalFM.start(["mode": "SCENE_RCMD", "scene": "FOCUS"])
        XCTAssertEqual(tested.currentSong?["name"] as? String, "fm-2-0")
        XCTAssertEqual(tested.personalFM.selection?["scene"] as? String, "FOCUS")
        tested.persist(); tested.stop()
        let restored = PlaybackEngine(gateway: gateway, storage: tested.storage); restored.network.cancel(); defer { restored.stop() }
        XCTAssertTrue(restored.personalFM.active); XCTAssertFalse(restored.intentToPlay)
        XCTAssertEqual(restored.personalFM.selection?["mode"] as? String, "SCENE_RCMD")
        XCTAssertEqual(gateway.calls.count, 2)
    }
    func testFMLateStartCannotReplaceOrdinaryQueueOrResumePause() async throws {
        let source = try silentAudio(); defer { try? FileManager.default.removeItem(at: source) }
        let gateway = FMFixtureGateway(source), tested = stereoEngine(gateway)
        defer { tested.stop(); tested.clearOutput() }
        gateway.respond = { selection, n in
            try? await Task.sleep(nanoseconds: 200_000_000)
            return FMFixtureGateway.batch(selection, n)
        }
        let pending = Task { try await tested.personalFM.start(["mode": "EXPLORE"]) }
        try await waitForStream { gateway.calls.count == 1 }
        try tested.setQueue([song("qq", "ordinary")], at: 0); try tested.command("pause")
        do { try await pending.value; XCTFail("Late FM selection committed") } catch {}
        XCTAssertEqual(tested.currentSong?["name"] as? String, "ordinary")
        XCTAssertFalse(tested.personalFM.active); XCTAssertFalse(tested.intentToPlay)
    }
    func testFMFailedModePreservesQueueAndSelection() async throws {
        let source = try silentAudio(); defer { try? FileManager.default.removeItem(at: source) }
        let gateway = FMFixtureGateway(source), tested = stereoEngine(gateway)
        defer { tested.stop(); tested.clearOutput() }
        try await tested.personalFM.start(["mode": "DEFAULT"])
        gateway.respond = { _, _ in throw MobileFailure("network") }
        do { try await tested.personalFM.start(["mode": "EXPLORE"]); XCTFail("Expected failure") } catch {}
        XCTAssertEqual(tested.currentSong?["name"] as? String, "fm-1-0")
        XCTAssertEqual(tested.personalFM.selection?["mode"] as? String, "DEFAULT")
        XCTAssertEqual(tested.personalFM.error, "network")
    }
    func testFMEmptyRefillStopsAtEndWithoutLoopingAndAllowsExplicitRetry() async throws {
        let source = try silentAudio(); defer { try? FileManager.default.removeItem(at: source) }
        let gateway = FMFixtureGateway(source), tested = stereoEngine(gateway)
        defer { tested.stop(); tested.clearOutput() }
        gateway.respond = { selection, n in n == 2 ? ["selection": selection, "songs": []] : FMFixtureGateway.batch(selection, n) }
        try await tested.personalFM.start(["mode": "DEFAULT"])
        try await waitForStream({ tested.personalFM.error == "fm-empty" && !tested.intentToPlay }, seconds: 7)
        XCTAssertEqual(gateway.calls.count, 2); XCTAssertEqual(tested.index, 2)
        for _ in 0..<10 { tested.prefetch() }
        XCTAssertEqual(gateway.calls.count, 2)
        try tested.command("next")
        try await waitForStream { tested.currentSong?["name"] as? String == "fm-3-0" && tested.outputIsPlaying }
        XCTAssertEqual(gateway.calls.count, 3)
    }
    func testFMPauseDuringTailRefillDiscardsLateResult() async throws {
        let source = try silentAudio(); defer { try? FileManager.default.removeItem(at: source) }
        let gateway = FMFixtureGateway(source), tested = stereoEngine(gateway)
        defer { tested.stop(); tested.clearOutput() }
        tested.personalFM.restore(["mode": "DEFAULT"]); tested.queue = [song("netease", "tail")]; tested.index = 0
        gateway.respond = { selection, n in try? await Task.sleep(nanoseconds: 200_000_000); return FMFixtureGateway.batch(selection, n) }
        tested.move(1); try await waitForStream { gateway.calls.count == 1 }
        try tested.command("pause"); try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertEqual(tested.queue.count, 1); XCTAssertEqual(tested.index, 0); XCTAssertFalse(tested.intentToPlay)
        XCTAssertEqual(tested.personalFM.snapshot["loading"] as? Bool, false)
    }
    func testFMLogoutCancelsRefillAndUnrelatedProviderKeepsRadio() async throws {
        let source = try silentAudio(); defer { try? FileManager.default.removeItem(at: source) }
        let gateway = FMFixtureGateway(source), tested = stereoEngine(gateway)
        defer { tested.stop(); tested.clearOutput() }
        tested.personalFM.restore(["mode": "DEFAULT"]); tested.queue = [song("netease", "tail")]; tested.index = 0
        tested.invalidateProvider("qq"); XCTAssertTrue(tested.personalFM.active)
        gateway.respond = { selection, n in try? await Task.sleep(nanoseconds: 200_000_000); return FMFixtureGateway.batch(selection, n) }
        tested.move(1); try await waitForStream { gateway.calls.count == 1 }
        tested.invalidateProvider("netease"); try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertFalse(tested.personalFM.active); XCTAssertTrue(tested.queue.isEmpty); XCTAssertFalse(tested.intentToPlay)
    }
    func testFMHistoryIsBoundedAndRepeatCannotLoopOldBatch() async throws {
        let source = try silentAudio(); defer { try? FileManager.default.removeItem(at: source) }
        let gateway = FMFixtureGateway(source), tested = engine(gateway); tested.network.cancel(); defer { tested.stop() }
        tested.personalFM.restore(["mode": "DEFAULT"]); tested.queue = (0..<1000).map { song("netease", String($0 + 1)) }; tested.index = 999
        tested.repeatMode = "one"; XCTAssertNil(tested.nextIndex(automatic: true))
        tested.repeatMode = "all"; XCTAssertNil(tested.nextIndex())
        tested.intentToPlay = true; tested.personalFM.refill()
        try await waitForStream { tested.queue.count == 24 }
        XCTAssertEqual(tested.index, 20); XCTAssertEqual(tested.currentSong?["name"] as? String, "1000")
    }
    func testFMClearingQueueLeavesRadioAndRetainsCurrentOccurrence() throws {
        let tested = engine(); tested.network.cancel(); defer { tested.stop() }
        tested.personalFM.restore(["mode": "DEFAULT"]); tested.queue = [song("netease", "current")]; tested.index = 0
        try tested.editQueue([], currentIndex: -1, expectedRevision: tested.queueRevision)
        XCTAssertFalse(tested.personalFM.active); XCTAssertEqual(tested.currentSong?["name"] as? String, "current")
        tested.move(1, automatic: true); XCTAssertFalse(tested.intentToPlay)
    }
    func testFMLeavingAtExhaustedTailCancelsPendingAdvance() async throws {
        let source = try silentAudio(); defer { try? FileManager.default.removeItem(at: source) }
        let gateway = FMFixtureGateway(source), tested = stereoEngine(gateway)
        defer { tested.stop(); tested.clearOutput() }
        tested.personalFM.restore(["mode": "DEFAULT"]); tested.queue = [song("netease", "tail")]; tested.index = 0
        gateway.respond = { selection, n in try? await Task.sleep(nanoseconds: 200_000_000); return FMFixtureGateway.batch(selection, n) }
        tested.move(1); try await waitForStream { gateway.calls.count == 1 }
        tested.personalFM.leave(); try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertFalse(tested.intentToPlay); XCTAssertEqual(tested.queue.count, 1); XCTAssertFalse(tested.personalFM.active)
    }
    func testFMAuthenticationFailureStopsRadioButNotUnrelatedPlayback() async throws {
        let source = try silentAudio(); defer { try? FileManager.default.removeItem(at: source) }
        let gateway = FMFixtureGateway(source), tested = stereoEngine(gateway)
        defer { tested.stop(); tested.clearOutput() }
        try await tested.personalFM.start(["mode": "DEFAULT"])
        gateway.respond = { _, _ in throw MobileFailure("auth-required") }
        do { try await tested.personalFM.start(["mode": "EXPLORE"]); XCTFail("Expected auth failure") } catch {}
        XCTAssertFalse(tested.intentToPlay); XCTAssertEqual(tested.error, "auth-required")
        try tested.setQueue([song("qq", "unrelated")], at: 0)
        do { try await tested.personalFM.start(["mode": "DEFAULT"]); XCTFail("Expected auth failure") } catch {}
        XCTAssertTrue(tested.intentToPlay); XCTAssertEqual(tested.currentSong?["name"] as? String, "unrelated")
    }
    func testFMManualSelectionSupersedesPendingModeWithoutLeavingExistingRadio() async throws {
        let source = try silentAudio(); defer { try? FileManager.default.removeItem(at: source) }
        let gateway = FMFixtureGateway(source), tested = stereoEngine(gateway)
        defer { tested.stop(); tested.clearOutput() }
        try await tested.personalFM.start(["mode": "DEFAULT"])
        gateway.respond = { selection, n in try? await Task.sleep(nanoseconds: 200_000_000); return FMFixtureGateway.batch(selection, n) }
        let pending = Task { try await tested.personalFM.start(["mode": "EXPLORE"]) }
        try await waitForStream { gateway.calls.count == 2 }
        try tested.command("next")
        do { try await pending.value; XCTFail("Old mode overwrote manual skip") } catch {}
        XCTAssertEqual(tested.currentSong?["name"] as? String, "fm-1-1")
        XCTAssertEqual(tested.personalFM.selection?["mode"] as? String, "DEFAULT")
    }
}
