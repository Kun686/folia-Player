import XCTest
import Capacitor
import WebKit
@testable import App

// NavidromeTransportTests.swift — real Keychain/URLSession/Capacitor with isolated fixtures, never a live music server.
@MainActor final class NavidromeTransportTests: XCTestCase {
    private let ok = "{\"subsonic-response\":{\"status\":\"ok\",\"version\":\"1.16.1\",\"playlists\":{\"playlist\":[]}}}"
    private func configuration() -> URLSessionConfiguration {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ProfileHTTPProtocol.self]
        config.httpAdditionalHeaders = ["Authorization": "music-secret", "Cookie": "platform-secret", "x-goog-api-key": "ai-secret"]
        return config
    }
    private func fixture(_ body: String? = nil, operation: String = "getPlaylists") -> (ProfileHTTPFixture, URL) {
        let value = ProfileHTTPFixture(Data((body ?? ok).utf8))
        value.status = 200; value.headers = ["Content-Type": "application/json"]
        return (value, ProfileHTTPProtocol.add(value, route: "rest/" + operation))
    }
    private func configured(_ url: URL) throws -> NativeNavidromeClient {
        var record: [String: Any] = [:]
        let client = NativeNavidromeClient(read: { record }, write: { record = $0 }, configuration: configuration)
        _ = try client.configure(["baseURL": url.deletingLastPathComponent().deletingLastPathComponent().absoluteString,
            "username": "qa+用户", "password": "generated password", "enabled": true], expected: 0, scope: "")
        return client
    }
    private func send(_ client: NativeNavidromeClient, id: String = "read", operation: String = "getPlaylists") async throws -> [String: Any] {
        let state = try client.snapshot()
        return try await client.send(id: id, expected: state["revision"] as! Int, scope: state["scope"] as! String,
            operation: operation, parameters: [:])
    }
    private func failure(_ code: String, _ work: () async throws -> Void) async {
        do { try await work(); XCTFail("Expected \(code)") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, code) }
    }
    private func waitFor(_ condition: () -> Bool) async throws {
        for _ in 0..<200 { if condition() { return }; try await Task.sleep(for: .milliseconds(10)) }
        throw MobileFailure("navidrome-fixture-timeout")
    }
    func testKeychainRestoresPasswordWithoutReturningItAndScopesAccountChanges() throws {
        let name = "test.navidrome." + UUID().uuidString
        defer { try? SecureStore.remove(name) }
        let client = NativeNavidromeClient(read: { try SecureStore.read(name) }, write: { try SecureStore.write(name, $0) })
        XCTAssertEqual(try client.snapshot()["scope"] as? String, "")
        let saved = try client.configure(["baseURL": "https://MUSIC.example:443/tenant/", "username": "user", "password": " secret ", "enabled": true], expected: 0, scope: "")
        let scope = try XCTUnwrap(saved["scope"] as? String)
        XCTAssertEqual(saved["baseURL"] as? String, "https://music.example/tenant")
        XCTAssertNil(saved["password"]); XCTAssertNil(saved["passwordHash"])
        XCTAssertEqual(try NativeNavidromeSettings.read(SecureStore.read(name)).password, " secret ")
        let restored = NativeNavidromeClient(read: { try SecureStore.read(name) }, write: { try SecureStore.write(name, $0) })
        XCTAssertEqual(try restored.snapshot()["scope"] as? String, scope)
        XCTAssertEqual(try restored.snapshot()["hasPassword"] as? Bool, true)
        let disabled = try client.configure(["enabled": false], expected: 1, scope: scope)
        XCTAssertEqual(disabled["scope"] as? String, scope)
        let changed = try client.configure(["username": "another"], expected: 2, scope: scope)
        XCTAssertEqual(changed["hasPassword"] as? Bool, false); XCTAssertEqual(changed["enabled"] as? Bool, false)
        XCTAssertNotEqual(changed["scope"] as? String, scope)
        XCTAssertThrowsError(try client.configure(["enabled": false], expected: 3, scope: scope))
        let settings = try NativeNavidromeSettings().editing(["baseURL": "https://music.example/one", "username": "a", "password": "b", "enabled": true])
        let moved = try settings.editing(["baseURL": "https://music.example/two"])
        XCTAssertEqual(moved.password, ""); XCTAssertFalse(moved.enabled); XCTAssertNotEqual(moved.scope, settings.scope)
        let rotated = try settings.editing(["password": "next"])
        XCTAssertNotEqual(rotated.scope, settings.scope)
        let cleared = try settings.editing(["baseURL": "", "username": "", "password": "", "enabled": false])
        XCTAssertFalse(cleared.enabled); XCTAssertEqual(cleared.password, ""); XCTAssertNotEqual(cleared.scope, settings.scope)
    }
    func testInvalidEditsAndPersistedRecordsCannotIntroduceUnsafeDestinations() throws {
        let initial = NativeNavidromeSettings()
        for values: [String: Any] in [["enabled": 1], ["enabled": "true"], ["enabled": true], ["password": NSNull()], ["username": false],
            ["scope": "override"], ["password": "a\nb"], ["username": String(repeating: "a", count: 513)], ["password": String(repeating: "a", count: 8193)], [:]] {
            XCTAssertThrowsError(try initial.editing(values))
        }
        for url in ["http://music.example", "https://u:p@music.example", "https://music.example?secret=x", "https://music.example#x",
            "https://music.example:0", "https://music.example:65536", "https://music.example/a b", "https://music.example/a/../b",
            "https://music.example/%2e%2e/b", "https://music.example/%2fother", "https://music.example/%252e", "https://music.example/a\\b"] {
            XCTAssertThrowsError(try initial.editing(["baseURL": url]), url)
        }
        for record: [String: Any] in [["enabled": true], ["password": "secret"], ["enabled": false, "baseURL": "", "username": "", "password": "", "scope": "invalid"]] {
            XCTAssertThrowsError(try NativeNavidromeSettings.read(record))
        }
    }
    func testAuthenticationMatchesOfficialAndOriginalJavaScriptVectors() throws {
        XCTAssertEqual(NativeNavidromeRequest.token(password: "sesame", salt: "c19b2d"), "26719a1196d2a940705a59634eb18eab")
        // Second vector generated with the repository's already-installed blueimp-md5, preserving UTF-8 and spaces.
        XCTAssertEqual(NativeNavidromeRequest.token(password: " 密码+&🔊 ", salt: "abcdef0123456789"), "d2891a5c8d869b203e9df6a6390c6e4d")
        let settings = try NativeNavidromeSettings().editing(["baseURL": "https://music.example/tenant", "username": "u+汉&", "password": "secret", "enabled": true])
        var salts = Set<String>()
        for _ in 0..<20 {
            let request = try NativeNavidromeRequest.make(settings: settings, operation: "search3", parameters: ["query": "C++ & 雪", "songCount": "20"])
            let url = try XCTUnwrap(request.url), parts = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
            let params = Dictionary(uniqueKeysWithValues: try XCTUnwrap(parts.queryItems).map { ($0.name, $0.value ?? "") })
            let salt = try XCTUnwrap(params["s"]); salts.insert(salt)
            XCTAssertEqual(salt.count, 32); XCTAssertEqual(params["u"], settings.username); XCTAssertEqual(params["query"], "C++ & 雪")
            XCTAssertEqual(params["t"], NativeNavidromeRequest.token(password: settings.password, salt: salt))
            XCTAssertEqual(params["v"], "1.16.1"); XCTAssertEqual(params["c"], "Folia"); XCTAssertEqual(params["f"], "json")
            XCTAssertNil(params["p"]); XCTAssertFalse(url.absoluteString.contains("secret")); XCTAssertFalse(parts.percentEncodedQuery!.contains("+"))
            XCTAssertEqual(url.path, "/tenant/rest/search3"); XCTAssertEqual(request.httpMethod, "GET")
        }
        XCTAssertEqual(salts.count, 20)
    }
    func testReadRoutesRejectMutationsAuthOverridesAndMalformedParameters() throws {
        let settings = try NativeNavidromeSettings().editing(["baseURL": "https://music.example", "username": "user", "password": "secret", "enabled": true])
        for (operation, allowed) in NativeNavidromeRequest.routes {
            var params: [String: String] = [:]
            if allowed.contains("id") { params["id"] = "song-1" }
            if operation == "search3" { params["query"] = "song" }
            if operation == "getAlbumList2" { params["type"] = "newest" }
            XCTAssertNoThrow(try NativeNavidromeRequest.make(settings: settings, operation: operation, parameters: params), operation)
        }
        for operation in ["../ping", "https://another.example", "ping?u=x", "stream", "getCoverArt", "star", "scrobble", "createPlaylist", "deletePlaylist"] {
            XCTAssertThrowsError(try NativeNavidromeRequest.make(settings: settings, operation: operation, parameters: [:]))
        }
        for params in [["u": "other"], ["t": "override"], ["s": "fixed"], ["p": "raw"], ["f": "xml"], ["url": "https://other.example"], ["query": "bad\nquery"], ["songCount": "-1"], ["songCount": "501"], ["songCount": "1.5"], ["songCount": "true"]] {
            XCTAssertThrowsError(try NativeNavidromeRequest.make(settings: settings, operation: "search3", parameters: params.merging(["query": params["query"] ?? "song"], uniquingKeysWith: { a, _ in a })))
        }
        XCTAssertThrowsError(try NativeNavidromeRequest.make(settings: settings, operation: "getUser", parameters: ["username": "another"]))
        XCTAssertThrowsError(try NativeNavidromeRequest.make(settings: settings, operation: "getSong", parameters: ["id": ""]))
        XCTAssertThrowsError(try NativeNavidromeRequest.make(settings: settings, operation: "getLyricsBySongId", parameters: ["id": "1", "enhanced": "1"]))
        let disabled = try settings.editing(["enabled": false])
        XCTAssertNoThrow(try NativeNavidromeRequest.make(settings: disabled, operation: "ping", parameters: [:]))
        XCTAssertThrowsError(try NativeNavidromeRequest.make(settings: disabled, operation: "getPlaylists", parameters: [:]))
    }
    func testURLSessionIsolatesHeadersAndReturnsOriginalSubsonicEnvelope() async throws {
        let (sample, url) = fixture(); defer { ProfileHTTPProtocol.remove(url) }
        let client = try configured(url), result = try await send(client)
        let response = try XCTUnwrap(result["response"] as? [String: Any])
        XCTAssertEqual((response["subsonic-response"] as? [String: Any])?["status"] as? String, "ok")
        let request = try XCTUnwrap(sample.stats.first)
        XCTAssertEqual(request.url?.path, url.path); XCTAssertEqual(request.url?.host, url.host)
        for header in ["Authorization", "Cookie", "x-goog-api-key"] { XCTAssertNil(request.value(forHTTPHeaderField: header)) }
        XCTAssertFalse(request.httpShouldHandleCookies); XCTAssertNil(request.httpBody)
        let json = String(data: try JSONSerialization.data(withJSONObject: result), encoding: .utf8)!
        XCTAssertFalse(json.contains("generated password")); XCTAssertFalse(json.contains("/rest/"))
    }
    func testHTTPAndSubsonicErrorsNeverReturnCredentialEchoes() async throws {
        for (status, code) in [(401, "navidrome-auth-required"), (403, "navidrome-forbidden"), (500, "navidrome-http-500")] {
            let (sample, url) = fixture("echo generated password"); sample.status = status
            defer { ProfileHTTPProtocol.remove(url) }
            let client = try configured(url)
            await failure(code) { _ = try await self.send(client) }
        }
        for (code, expected) in [(40, "navidrome-auth-required"), (41, "navidrome-token-auth-unsupported"), (50, "navidrome-forbidden"), (70, "navidrome-not-found"), (20, "navidrome-api-20")] {
            let (_, url) = fixture("{\"subsonic-response\":{\"status\":\"failed\",\"version\":\"1.16.1\",\"error\":{\"code\":\(code),\"message\":\"echo generated password\"}}}")
            defer { ProfileHTTPProtocol.remove(url) }; let client = try configured(url)
            await failure(expected) { _ = try await self.send(client) }
        }
    }
    func testMalformedResponsesAreErrorsRatherThanEmptyCatalogs() throws {
        for body in ["<html>login</html>", "null", "[]", "{}", "{\"subsonic-response\":{\"status\":\"ok\"}}",
            "{\"subsonic-response\":{\"status\":\"failed\",\"version\":\"1\",\"error\":{\"code\":true}}}",
            "{\"subsonic-response\":{\"status\":\"ok\",\"version\":\"1\",\"error\":{\"code\":40}}}"] {
            XCTAssertThrowsError(try NativeNavidromeRequest.response(["status": 200, "body": body]))
        }
    }
    func testRedirectDoesNotForwardSignedQueryOrContactTarget() async throws {
        let (destination, target) = fixture()
        let (sample, url) = fixture(); sample.redirect = target; sample.completesDeclinedRedirect = true
        defer { ProfileHTTPProtocol.remove(url); ProfileHTTPProtocol.remove(target) }
        let client = try configured(url)
        await failure("navidrome-redirect-refused") { _ = try await self.send(client) }
        XCTAssertEqual(destination.stats.requests, 0)
    }
    func testAdvertisedAndStreamingBodiesAreBounded() async throws {
        for advertised in [true, false] {
            let sample = ProfileHTTPFixture(Data(repeating: 65, count: NativeNavidromeClient.maxResponseBytes + 524288))
            sample.status = 200; sample.advertised = advertised ? sample.bytes.count : 1
            let url = ProfileHTTPProtocol.add(sample, route: "rest/getPlaylists"); defer { ProfileHTTPProtocol.remove(url) }
            let client = try configured(url)
            await failure("navidrome-response-too-large") { _ = try await self.send(client) }
            XCTAssertLessThan(sample.stats.sent, sample.bytes.count)
        }
    }
    func testFailedSavePreservesRequestAndConfiguration() async throws {
        let (sample, url) = fixture(); sample.delay = 0.1
        defer { ProfileHTTPProtocol.remove(url) }
        var record: [String: Any] = [:], failWrite = false
        let client = NativeNavidromeClient(read: { record }, write: { if failWrite { throw MobileFailure("secure-storage") }; record = $0 }, configuration: configuration)
        let before = try client.configure(["baseURL": url.deletingLastPathComponent().deletingLastPathComponent().absoluteString,
            "username": "user", "password": "secret", "enabled": true], expected: 0, scope: "")
        let work = Task { try await self.send(client) }; try await waitFor { sample.stats.requests == 1 }
        failWrite = true
        XCTAssertThrowsError(try client.configure(["password": "replacement"], expected: 1, scope: before["scope"] as! String))
        XCTAssertEqual(try client.snapshot() as NSDictionary, before as NSDictionary)
        _ = try await work.value
    }
    func testCancellationSettingsChangeAndConcurrentRequestLimit() async throws {
        let body = "{\"subsonic-response\":{\"status\":\"ok\",\"version\":\"1.16.1\",\"padding\":\"" + String(repeating: "x", count: 262144) + "\"}}"
        let (sample, url) = fixture(body); sample.delay = 0.02
        defer { ProfileHTTPProtocol.remove(url) }; let client = try configured(url), before = try client.snapshot()
        client.cancel("early")
        await failure("navidrome-cancelled") { _ = try await self.send(client, id: "early") }
        XCTAssertEqual(sample.stats.requests, 0)
        let one = Task { try await self.send(client, id: "one") }, two = Task { try await self.send(client, id: "two") }
        try await waitFor { sample.stats.requests == 2 }
        await failure("invalid-navidrome-request") { _ = try await self.send(client, id: "one") }
        await failure("invalid-navidrome-request") { _ = try await self.send(client, id: "three") }
        client.cancel("one"); await failure("navidrome-cancelled") { _ = try await one.value }
        let changed = try client.configure(["password": "changed"], expected: 1, scope: before["scope"] as! String)
        await failure("navidrome-cancelled") { _ = try await two.value }
        await failure("navidrome-settings-changed") {
            _ = try await client.send(id: "stale", expected: 1, scope: before["scope"] as! String, operation: "getPlaylists", parameters: [:])
        }
        let recovered = try await send(client)
        XCTAssertEqual(recovered["scope"] as? String, changed["scope"] as? String); XCTAssertEqual(sample.stats.requests, 3)
    }
    func testParentCancellationReleasesRequestSlot() async throws {
        let (sample, url) = fixture(); defer { ProfileHTTPProtocol.remove(url) }
        let client = try configured(url), task = Task { try await self.send(client) }
        try await waitFor { sample.stats.requests == 1 }; task.cancel()
        await failure("navidrome-cancelled") { _ = try await task.value }
        _ = try await send(client)
    }
    func testPackagedBridgeOwnsSecretsAndRejectsInvalidCalls() async throws {
        guard Bundle.main.bundleIdentifier == "app.folia.validation.App" else { throw MobileFailure("qa-bundle-required") }
        let host = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).compactMap { $0.rootViewController as? CAPBridgeViewController }.first)
        let web = try XCTUnwrap(host.webView)
        try await waitFor { !web.isLoading && web.url?.scheme == "capacitor" }
        let plugin = try XCTUnwrap(host.bridge?.plugin(withName: "FoliaNative") as? FoliaNativePlugin)
        try await waitFor { plugin.navidrome != nil }
        let original = plugin.navidrome
        defer { plugin.navidrome = original }
        let (_, url) = fixture(); defer { ProfileHTTPProtocol.remove(url) }
        var record: [String: Any] = [:]
        plugin.navidrome = NativeNavidromeClient(read: { record }, write: { record = $0 }, configuration: configuration)
        let result = try await web.callAsyncJavaScript("""
            const invoke = (name, options = {}) => Capacitor.nativePromise('FoliaNative', name, options);
            const start = await invoke('getNavidromeSettings');
            const saved = await invoke('setNavidromeSettings', {...start, settings: {
                baseURL, username: 'qa', password: 'generated bridge password', enabled: true
            }});
            const response = await invoke('navidromeRequest', {...saved, id: 'bridge', operation: 'getPlaylists', parameters: {}});
            let invalid = '', stale = '', cancelled = '';
            try { await invoke('navidromeRequest', {...saved, id: 'bad', operation: 'ping', parameters: {u:'override'}}); }
            catch(e) { invalid = e.message; }
            try { await invoke('setNavidromeSettings', {...start, settings: {enabled:false}}); }
            catch(e) { stale = e.message; }
            await invoke('cancelNavidromeRequest', {id:'early'});
            try { await invoke('navidromeRequest', {...saved, id:'early', operation:'ping', parameters:{}}); }
            catch(e) { cancelled = e.message; }
            return {saved, response, invalid, stale, cancelled, restored: await invoke('getNavidromeSettings')};
            """, arguments: ["baseURL": url.deletingLastPathComponent().deletingLastPathComponent().absoluteString], in: nil, contentWorld: .page)
        let value = try XCTUnwrap(result as? [String: Any]), saved = try XCTUnwrap(value["saved"] as? [String: Any])
        XCTAssertNil(saved["password"]); XCTAssertEqual(saved["hasPassword"] as? Bool, true)
        XCTAssertEqual(value["invalid"] as? String, "invalid-navidrome-request")
        XCTAssertEqual(value["stale"] as? String, "navidrome-settings-changed")
        XCTAssertEqual(value["cancelled"] as? String, "navidrome-cancelled")
        XCTAssertEqual(saved as NSDictionary, value["restored"] as? NSDictionary)
        XCTAssertEqual(try NativeNavidromeSettings.read(record).password, "generated bridge password")
    }
}
