import XCTest
@testable import App

// LyricMatchTransportTests.swift — real native account validation and URLSession, with all HTTP intercepted offline.
private final class LyricPublicHTTP: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var fixture: ProfileHTTPFixture?
    private var work: Task<Void, Never>?
    private var current: ProfileHTTPFixture?
    static func set(_ fixture: ProfileHTTPFixture?) { lock.withLock { self.fixture = fixture } }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard request.url?.host == "api.amll.dev", let fixture = Self.lock.withLock({ Self.fixture }) else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL)); return
        }
        current = fixture; fixture.request(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: fixture.status, httpVersion: "HTTP/1.1",
            headerFields: fixture.headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        work = Task {
            do {
                try await Task.sleep(nanoseconds: UInt64(fixture.delay * 1_000_000_000))
                try Task.checkCancellation()
                client?.urlProtocol(self, didLoad: fixture.bytes); fixture.delivered(fixture.bytes.count)
                client?.urlProtocolDidFinishLoading(self)
            } catch { /* stopLoading already cancels the URLSession request. */ }
        }
    }
    override func stopLoading() { work?.cancel(); current?.stop() }
}

@MainActor final class LyricMatchTransportTests: XCTestCase {
    private func gateway() throws -> LyricFixtureGateway {
        var records: [String: [String: Any]] = [:]
        let store = NativeGatewayStore(read: { records[$0] ?? [:] }, write: { records[$0] = $1 }, remove: { records.removeValue(forKey: $0) })
        let record = try store.configure(server: "https://gateway.invalid", token: String(repeating: "test-", count: 8), expected: store.snapshot().scope)
        for provider in NativeGatewayStore.providers { _ = try store.saveSession(provider, values: ["cookie": "fixture-" + provider], expected: record.scope) }
        return LyricFixtureGateway(credentials: store)
    }
    private func configuration() -> URLSessionConfiguration {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [LyricPublicHTTP.self]
        config.httpAdditionalHeaders = ["Authorization": "must-not-leak", "Cookie": "must-not-leak"]
        return config
    }
    private var amll: [String: Any] { ["provider": "amll", "path": "https://api.amll.dev/v1/lyrics/get?ncmMusicId=42"] }
    private func reject(_ code: String, _ operation: () async throws -> Void) async {
        do { try await operation(); XCTFail("Expected \(code)") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, code) }
    }
    func testAMLLSessionNeverSendsGatewayOrPlatformCredentials() async throws {
        let fixture = ProfileHTTPFixture(Data("{\"status\":200,\"data\":null}".utf8)); fixture.status = 200
        LyricPublicHTTP.set(fixture); defer { LyricPublicHTTP.set(nil) }
        let gateway = try gateway(), transport = try NativeLyricMatchTransport(gateway: gateway, configuration: configuration())
        let result = try await transport.send(amll)
        XCTAssertEqual(result["status"] as? Int, 200)
        XCTAssertEqual(fixture.stats.requests, 1); XCTAssertTrue(gateway.calls.isEmpty)
        let request = try XCTUnwrap(fixture.stats.first)
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization")); XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
        XCTAssertNil(request.httpBody)
        XCTAssertEqual(request.value(forHTTPHeaderField: "User-Agent"), "Folia/mobile (Kun686/folia-Player)")
    }
    func testAMLLRejectsNonPublicTargetsAndExtraCredentialFieldsBeforeIO() async throws {
        let fixture = ProfileHTTPFixture(Data("{}".utf8)); fixture.status = 200
        LyricPublicHTTP.set(fixture); defer { LyricPublicHTTP.set(nil) }
        let transport = try NativeLyricMatchTransport(gateway: gateway(), configuration: configuration())
        for path in ["http://api.amll.dev/v1/lyrics/get?ncmMusicId=42", "https://other.invalid/v1/lyrics/get?ncmMusicId=42",
                     "https://api.amll.dev:443/v1/lyrics/get?ncmMusicId=42", "https://user:secret@api.amll.dev/v1/lyrics/get?ncmMusicId=42",
                     "https://api.amll.dev/v1/lyrics/get?ncmMusicId=42&cookie=private", "https://api.amll.dev/v1/lyrics/get?ncmMusicId=42#fragment"] {
            await reject("forbidden") { _ = try await transport.send(["provider": "amll", "path": path]) }
        }
        var extra = amll; extra["headers"] = ["Authorization": "private"]
        await reject("forbidden") { _ = try await transport.send(extra) }
        XCTAssertEqual(fixture.stats.requests, 0)
    }
    func testAMLLBoundsAdvertisedAndStreamedBodySizes() async throws {
        for advertised in [true, false] {
            let fixture = ProfileHTTPFixture(Data(repeating: 65, count: 2_000_001)); fixture.status = 200
            if advertised { fixture.headers = ["Content-Length": "2000001"]; fixture.delay = 0.2 }
            LyricPublicHTTP.set(fixture); defer { LyricPublicHTTP.set(nil) }
            let transport = try NativeLyricMatchTransport(gateway: gateway(), configuration: configuration())
            await reject("lyrics-too-large") { _ = try await transport.send(amll) }
            // URLSession may prefetch bytes before returning AsyncBytes; only bounded rejection is guaranteed.
        }
    }
    func testAnyPlatformSessionReplacementOrLogoutInvalidatesTheWholeMatch() async throws {
        for provider in NativeGatewayStore.providers {
            for logout in [false, true] {
                let gateway = try gateway(), transport = try NativeLyricMatchTransport(gateway: gateway, configuration: configuration())
                let scope = transport.record.scope
                if logout { try gateway.credentials.clearSession(provider, expected: scope) }
                else { _ = try gateway.credentials.saveSession(provider, values: ["cookie": "replacement"], expected: scope) }
                XCTAssertEqual(try gateway.credentials.snapshot().scope, scope)
                await reject("lyric-session-changed") { _ = try await transport.send(["provider": "netease", "path": "/cloudsearch"]) }
                XCTAssertTrue(gateway.calls.isEmpty)
            }
        }
    }
    func testAccountReplacementWhileAwaitingRejectsTheLateReply() async throws {
        let gateway = try gateway(), transport = try NativeLyricMatchTransport(gateway: gateway, configuration: configuration())
        let scope = transport.record.scope
        gateway.handler = { _, _ in
            await Task.yield()
            _ = try gateway.credentials.saveSession("qq", values: ["cookie": "new-qq"], expected: scope)
            return ["status": 200, "body": "{}"]
        }
        await reject("lyric-session-changed") { _ = try await transport.send(["provider": "netease", "path": "/cloudsearch"]) }
        XCTAssertEqual(gateway.calls.count, 1)
    }
    func testLogoutThenRestoreOfTheSameCookieStillInvalidatesOldWork() async throws {
        let gateway = try gateway(), transport = try NativeLyricMatchTransport(gateway: gateway, configuration: configuration())
        let before = transport.record
        try gateway.credentials.clearSession("qq", expected: before.scope)
        _ = try gateway.credentials.saveSession("qq", values: before.sessions["qq"]!, expected: before.scope)
        let after = try gateway.credentials.snapshot()
        XCTAssertEqual(after.sessions, before.sessions); XCTAssertEqual(after.scope, before.scope)
        XCTAssertNotEqual(after.sessionGeneration, before.sessionGeneration)
        await reject("lyric-session-changed") { _ = try await transport.send(amll) }
    }
    func testParentCancellationStopsThePublicURLSessionTask() async throws {
        let fixture = ProfileHTTPFixture(Data("{}".utf8)); fixture.status = 200; fixture.delay = 10
        LyricPublicHTTP.set(fixture); defer { LyricPublicHTTP.set(nil) }
        let transport = try NativeLyricMatchTransport(gateway: gateway(), configuration: configuration())
        let request = amll
        let work = Task { try await transport.send(request) }
        for _ in 0..<100 { if fixture.stats.requests > 0 { break }; try await Task.sleep(nanoseconds: 5_000_000) }
        XCTAssertEqual(fixture.stats.requests, 1); work.cancel()
        do { _ = try await work.value; XCTFail("Cancelled request returned") } catch { }
        try await Task.sleep(nanoseconds: 30_000_000)
        XCTAssertGreaterThan(fixture.stats.stopped, 0); XCTAssertEqual(fixture.stats.sent, 0)
    }
    func testProductionNativeMatcherUsesRawQQSearchAndOriginalQRCWithoutWebView() async throws {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "OnlineLyricReference", withExtension: "json"))
        let rows = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [[String: Any]])
        let steps = try XCTUnwrap(rows.first(where: { $0["name"] as? String == "qq-qrc" })?["steps"] as? [[String: Any]])
        let fixture = try XCTUnwrap(steps.last?["input"] as? [String: Any])
        let lyrics = try XCTUnwrap((fixture["responses"] as? [[String: Any]])?.last)
        let gateway = try gateway()
        gateway.handler = { request, _ in
            XCTAssertEqual(request["provider"] as? String, "lyrics")
            XCTAssertNil(request["query"])
            XCTAssertEqual((request["headers"] as? [String: String])?["Cookie"], "tmeLoginType=-1;")
            let text = try XCTUnwrap(request["body"] as? String)
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
            if (body["request"] as? [String: Any])?["method"] as? String == "GetPlayLyricInfo" { return lyrics }
            let result: [String: Any] = ["code": 0, "request": ["code": 0, "data": ["body": ["item_song": [
                ["id": 42, "mid": "mid42", "title": "合成测试", "singer": [["id": 1, "name": "测试"]],
                 "album": ["id": 2, "name": "测试专辑"], "interval": 30]]]]]]
            return ["status": 200, "body": String(decoding: try JSONSerialization.data(withJSONObject: result), as: UTF8.self)]
        }
        let result = try await NativeBestLyrics.match(["version": 1, "title": "合成测试", "artist": "测试", "durationMs": 30000,
            "options": ["preferredSource": "qq", "album": "测试专辑"]], gateway: gateway)
        XCTAssertEqual(result?["source"] as? String, "qq")
        let document = try XCTUnwrap(result?["lyrics"] as? [String: Any])
        XCTAssertEqual(document["isWordByWord"] as? Bool, true)
        XCTAssertEqual((document["lines"] as? [[String: Any]])?.last?["endTime"] as? Double, 26)
        XCTAssertEqual(gateway.calls.count, 2)
    }
}
