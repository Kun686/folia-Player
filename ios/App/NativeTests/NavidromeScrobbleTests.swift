import XCTest
import AVFoundation
@testable import App

// NavidromeScrobbleTests.swift — original JS rules, real native transport/decoder, controlled server responses only.
@MainActor extension NativeTests {
    private func scrobbleResponse() -> Data { Data("{\"subsonic-response\":{\"status\":\"ok\",\"version\":\"1.16.1\"}}".utf8) }
    private func scrobbleParams(_ request: URLRequest) -> [String: String] {
        Dictionary(uniqueKeysWithValues: URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value ?? "") })
    }
    func testNavidromeScrobbleRequestIsNativeOnlyBoundedAndSigned() throws {
        let f = try NavidromePlaybackFixture(gateway: FailingGateway()); defer { f.close() }
        let settings = try NativeNavidromeSettings.read(f.record)
        let request = try NativeNavidromeRequest.scrobble(settings: settings, id: "雪+a", time: 1234567890.7, submission: false)
        let params = scrobbleParams(request)
        XCTAssertEqual(params["time"], "1234567890"); XCTAssertEqual(params["submission"], "false"); XCTAssertEqual(params["id"], "雪+a")
        XCTAssertEqual(params["t"], NativeNavidromeRequest.token(password: settings.password, salt: params["s"]!))
        XCTAssertTrue(request.url!.absoluteString.contains("%2B")); XCTAssertFalse(request.httpShouldHandleCookies)
        XCTAssertThrowsError(try NativeNavidromeRequest.make(settings: settings, operation: "scrobble", parameters: ["id": "a"]))
        XCTAssertThrowsError(try NativeNavidromeRequest.mutation(settings: settings, operation: "scrobble", parameters: ["id": "a"]))
        for time in [Double.nan, .infinity, -1, 9e15] {
            XCTAssertThrowsError(try NativeNavidromeRequest.scrobble(settings: settings, id: "a", time: time, submission: true))
        }
    }
    func testNavidromeScrobbleOriginalThresholdPauseResumeRepeatAndTransport() async throws {
        let f = try NavidromePlaybackFixture(gateway: FailingGateway()); defer { f.close() }
        let route = f.route("scrobble", id: "one", body: scrobbleResponse())
        let reporter = NativeNavidromeScrobbler(client: f.client, clock: { 12345 }), song = try f.song("one")
        defer { reporter.invalidate() }
        reporter.observe(song: song, position: 90, duration: 120, playing: false)
        XCTAssertEqual(route.stats.requests, 0)
        reporter.observe(song: song, position: 0, duration: 120, playing: true)
        try await waitForStream { reporter.pendingCount == 0 && route.stats.requests == 1 }
        for _ in 0..<20 { reporter.observe(song: song, position: 59, duration: 120, playing: true) }
        reporter.observe(song: song, position: 61, duration: 120, playing: false)
        XCTAssertEqual(route.stats.requests, 1)
        reporter.observe(song: song, position: 61, duration: 120, playing: true)
        try await waitForStream { reporter.pendingCount == 0 && route.stats.requests == 2 }
        XCTAssertEqual(route.capturedRequests.map { scrobbleParams($0)["submission"]! }, ["false", "true"])
        for request in route.capturedRequests {
            XCTAssertEqual(scrobbleParams(request)["time"], "12345")
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization")); XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
        }
        reporter.finish(); reporter.observe(song: song, position: 0, duration: 120, playing: true)
        try await waitForStream { reporter.pendingCount == 0 && route.stats.requests == 3 }
        XCTAssertNil(reporter.error)
    }
    func testNavidromeScrobbleAccountChangeCancelsQueuedReportsAndRejectsOldSong() async throws {
        let f = try NavidromePlaybackFixture(gateway: FailingGateway()); defer { f.close() }
        var body = scrobbleResponse(); body.append(Data(repeating: 32, count: 300000))
        let route = f.route("scrobble", id: "one", body: body); route.delay = 0.03
        let reporter = f.client.scrobbling, song = try f.song("one")
        reporter.observe(song: song, position: 80, duration: 120, playing: true)
        try await waitForStream { route.stats.sent > 0 }
        XCTAssertEqual(reporter.pendingCount, 2)
        try f.edit(["password": "next"])
        try await waitForStream { route.stats.stopped > 0 }
        reporter.observe(song: song, position: 90, duration: 120, playing: true)
        XCTAssertEqual(reporter.error, "navidrome-settings-changed"); XCTAssertEqual(reporter.pendingCount, 0)
        XCTAssertEqual(route.stats.requests, 1)
        reporter.observe(song: try f.song("one"), position: 0, duration: 120, playing: true)
        do { try await waitForStream { route.stats.requests == 2 && reporter.pendingCount == 0 } }
        catch { print("Scrobble account recovery requests=\(route.stats.requests) pending=\(reporter.pendingCount) error=\(reporter.error ?? "none")"); throw error }
        XCTAssertNil(reporter.error)
    }
    func testNavidromeScrobbleFailureDoesNotRetryAndRedirectTargetStaysUntouched() async throws {
        let f = try NavidromePlaybackFixture(gateway: FailingGateway()); defer { f.close() }
        let targetFixture = ProfileHTTPFixture(scrobbleResponse()), target = ProfileHTTPProtocol.add(targetFixture)
        defer { ProfileHTTPProtocol.remove(target) }
        let route = f.route("scrobble", id: "one", body: scrobbleResponse()); route.redirect = target; route.completesDeclinedRedirect = true
        let reporter = f.client.scrobbling, song = try f.song("one")
        reporter.observe(song: song, position: 0, duration: 120, playing: true)
        try await waitForStream { reporter.error == "navidrome-redirect-refused" }
        for _ in 0..<50 { reporter.observe(song: song, position: 20, duration: 120, playing: true) }
        XCTAssertEqual(route.stats.requests, 1); XCTAssertEqual(targetFixture.stats.requests, 0)
        XCTAssertNil(f.player.error)
        reporter.finish(); route.redirect = nil; route.status = 401
        reporter.observe(song: song, position: 80, duration: 120, playing: true)
        try await waitForStream { reporter.error == "navidrome-auth-required" }
        XCTAssertEqual(route.stats.requests, 2); XCTAssertEqual(reporter.pendingCount, 0)
        reporter.observe(song: song, position: 90, duration: 120, playing: true)
        XCTAssertEqual(route.stats.requests, 2)
    }
    func testNavidromeScrobbleQueueIsBoundedAndCannotOccupyPlaybackOrMutationSlots() async throws {
        let f = try NavidromePlaybackFixture(gateway: FailingGateway()); defer { f.close() }
        var body = scrobbleResponse(); body.append(Data(repeating: 32, count: 300000))
        let route = f.route("scrobble", id: "one", body: body); route.delay = 0.03
        let reporter = f.client.scrobbling
        for i in 0..<30 {
            reporter.observe(song: try f.song(i == 0 ? "one" : String(i)), position: 80, duration: 120, playing: true)
            XCTAssertLessThanOrEqual(reporter.pendingCount, 8)
        }
        try await waitForStream { route.stats.sent > 0 }
        _ = try f.track("audio", audio: Data([1]))
        _ = try await f.client.audioSource(f.song("audio"))
        _ = f.route("star", id: "audio", body: scrobbleResponse())
        let state = try f.client.snapshot()
        _ = try await f.client.mutate(id: "star", expected: state["revision"] as! Int, scope: state["scope"] as! String,
                                     operation: "star", parameters: ["id": "audio"])
        XCTAssertEqual(route.stats.requests, 1)
    }
    func testNavidromeScrobbleNativeTimerReportsThreeTracksWithoutWebView() async throws {
        let file = try profileAudio(seconds: 1.6); defer { try? FileManager.default.removeItem(at: file) }
        let gateway = FailingGateway(), f = try NavidromePlaybackFixture(gateway: gateway); defer { f.close() }
        let bytes = try Data(contentsOf: file), ids = ["one", "two", "three"]
        let reports = try ids.map { id -> ProfileHTTPFixture in
            _ = try f.track(id, audio: bytes)
            return f.route("scrobble", id: id, body: scrobbleResponse())
        }
        try f.player.setQueue(try ids.map(f.song), at: 0)
        try await waitForStream({ !f.player.intentToPlay && reports.allSatisfy { $0.stats.requests == 2 } }, seconds: 12)
        for report in reports { XCTAssertEqual(report.capturedRequests.map { scrobbleParams($0)["submission"]! }, ["false", "true"]) }
        XCTAssertEqual(gateway.count, 0); XCTAssertNil(f.player.error)
        XCTAssertNil(f.client.scrobbling.error)
    }
}
