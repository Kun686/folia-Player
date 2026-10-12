import XCTest
@testable import App

// SyncTransportTests.swift — real Keychain and URLSession with synthetic responses; no live sync server or account.
@MainActor final class SyncTransportTests: XCTestCase {
    private func configuration() -> URLSessionConfiguration {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ProfileHTTPProtocol.self]
        config.httpAdditionalHeaders = ["Authorization": "music-secret", "Cookie": "platform-secret", "x-goog-api-key": "ai-secret"]
        return config
    }
    private func client(_ url: URL) throws -> NativeSyncClient {
        var record: [String: Any] = [:]
        let client = NativeSyncClient(read: { record }, write: { record = $0 }, configuration: configuration)
        _ = try client.configure(["baseURL": url.deletingLastPathComponent().absoluteString,
                                  "token": "generated-sync-key", "enabled": true], expected: 0)
        return client
    }
    private func failure(_ operation: () async throws -> Void, _ code: String) async {
        do { try await operation(); XCTFail("Expected \(code)") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, code) }
    }
    private func waitFor(_ condition: () -> Bool) async throws {
        for _ in 0..<100 { if condition() { return }; try await Task.sleep(nanoseconds: 10_000_000) }
        XCTFail("Fixture did not start within 1 second")
    }
    func testSyncKeychainRoundTripAndCheckpointScopes() throws {
        let name = "test.sync." + UUID().uuidString
        defer { try? SecureStore.remove(name) }
        let client = NativeSyncClient(read: { try SecureStore.read(name) }, write: { try SecureStore.write(name, $0) })
        let first = try client.configure(["baseURL": "https://SYNC.example:443/tenant/", "token": "generated-key", "enabled": true], expected: 0)
        XCTAssertEqual(first["baseURL"] as? String, "https://sync.example/tenant")
        XCTAssertFalse(String(data: try JSONSerialization.data(withJSONObject: first), encoding: .utf8)!.contains("generated-key"))
        let stored = try NativeSyncSettings.read(SecureStore.read(name))
        XCTAssertEqual(stored.token, "generated-key"); XCTAssertEqual(first["scope"] as? String, stored.scope)
        let paused = try client.configure(["enabled": false], expected: 1)
        XCTAssertEqual(paused["scope"] as? String, stored.scope)
        let restored = NativeSyncClient(read: { try SecureStore.read(name) }, write: { try SecureStore.write(name, $0) })
        XCTAssertEqual(try restored.snapshot()["scope"] as? String, stored.scope)
        let moved = try client.configure(["baseURL": "https://sync.example/another"], expected: 2)
        XCTAssertEqual(moved["hasToken"] as? Bool, false); XCTAssertEqual(moved["enabled"] as? Bool, false)
        XCTAssertNotEqual(moved["scope"] as? String, stored.scope)
        let replaced = try client.configure(["baseURL": "https://new.example", "token": "new-key", "enabled": true], expected: 3)
        XCTAssertEqual(replaced["hasToken"] as? Bool, true); XCTAssertEqual(replaced["enabled"] as? Bool, true)
        let cleared = try client.configure(["token": ""], expected: 4)
        XCTAssertEqual(cleared["enabled"] as? Bool, false); XCTAssertEqual(cleared["hasToken"] as? Bool, false)
        XCTAssertNotEqual(cleared["scope"] as? String, replaced["scope"] as? String)
    }
    func testSyncRejectsUnsafeSettingsAndFailedWritePreservesState() throws {
        var record: [String: Any] = [:], failWrite = false
        let client = NativeSyncClient(read: { record }, write: { if failWrite { throw MobileFailure("secure-storage") }; record = $0 })
        _ = try client.configure(["baseURL": "https://sync.example", "token": "key", "enabled": true], expected: 0)
        let before = try client.snapshot()
        for settings: [String: Any] in [["enabled": 1], ["enabled": "true"], ["enabled": NSNull()], ["token": true],
            ["token": "a\nb"], ["token": String(repeating: "x", count: 8193)], ["scope": UUID().uuidString], [:]] {
            XCTAssertThrowsError(try client.configure(settings, expected: 1))
        }
        for url in ["http://sync.example", "https://u:p@sync.example", "https://sync.example?token=x", "https://sync.example#x",
                    "https://sync.example:0", "https://sync.example:65536", "https://sync.example/a b", "https://sync.example/a/../b",
                    "https://sync.example/%2e%2e/b", "https://sync.example/%2fother", "https://sync.example/%252e", "https://sync.example/a\\b"] {
            XCTAssertThrowsError(try client.configure(["baseURL": url], expected: 1), url)
        }
        failWrite = true
        XCTAssertThrowsError(try client.configure(["token": "replacement"], expected: 1))
        XCTAssertEqual(try client.snapshot() as NSDictionary, before as NSDictionary)
        XCTAssertEqual(client.revision, 1)
        XCTAssertThrowsError(try client.configure(["enabled": false], expected: 0))
    }
    func testSyncFixedRoutesBodyValidationAndDisabledBoundary() throws {
        let settings = try NativeSyncSettings().editing(["baseURL": "https://sync.example/tenant", "token": "key", "enabled": true])
        let routes = ["health": ("GET", "/health"), "state": ("GET", "/state"), "settingsRead": ("GET", "/settings"),
            "settingsWrite": ("PUT", "/settings"), "themeManifest": ("GET", "/themes/manifest"), "themeGet": ("POST", "/themes/get"),
            "themePut": ("POST", "/themes/put"), "themeBuckets": ("POST", "/themes/bucket"), "themeList": ("POST", "/themes/list")]
        for (operation, route) in routes {
            let request = try NativeSyncClient.request(settings: settings, operation: operation, body: route.0 == "GET" ? nil : "{}")
            XCTAssertEqual(request.url?.absoluteString, settings.baseURL + route.1); XCTAssertEqual(request.httpMethod, route.0)
            if route.0 == "GET" { XCTAssertNil(request.httpBody) } else { XCTAssertEqual(request.httpBody, Data("{}".utf8)) }
            let disabled = try settings.editing(["enabled": false])
            if ["health", "state"].contains(operation) {
                XCTAssertNoThrow(try NativeSyncClient.request(settings: disabled, operation: operation, body: nil))
            } else { XCTAssertThrowsError(try NativeSyncClient.request(settings: disabled, operation: operation, body: "{}")) }
        }
        for operation in ["https://other.example", "../state", "state?token=other", ""] {
            XCTAssertThrowsError(try NativeSyncClient.request(settings: settings, operation: operation, body: nil))
        }
        for body in ["[]", "null", "bad-json", "{\"large\":\"" + String(repeating: "x", count: NativeSyncClient.maxRequestBytes) + "\"}"] {
            XCTAssertThrowsError(try NativeSyncClient.request(settings: settings, operation: "themePut", body: body))
        }
        XCTAssertThrowsError(try NativeSyncClient.request(settings: settings, operation: "state", body: "{}"))
    }
    func testSyncTransportHasIndependentHeadersAndOmitsHTTPErrorBodies() async throws {
        for status in [200, 401, 500] {
            let fixture = ProfileHTTPFixture(Data((status == 200 ? "{\"ok\":true}" : "echo generated-sync-key").utf8))
            fixture.status = status; fixture.headers = ["Content-Type": "application/json"]
            let url = ProfileHTTPProtocol.add(fixture, route: "state"); defer { ProfileHTTPProtocol.remove(url) }
            let client = try client(url), result = try await client.send(id: "state", expected: 1, operation: "state", body: nil)
            XCTAssertEqual(result["status"] as? Int, status)
            XCTAssertEqual(result["body"] as? String, status == 200 ? "{\"ok\":true}" : "")
            let request = try XCTUnwrap(fixture.stats.first)
            XCTAssertEqual(request.url, url); XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer generated-sync-key")
            XCTAssertNil(request.value(forHTTPHeaderField: "Cookie")); XCTAssertNil(request.value(forHTTPHeaderField: "x-goog-api-key"))
            XCTAssertFalse(request.httpShouldHandleCookies); XCTAssertEqual(fixture.stats.requests, 1)
        }
    }
    func testSyncBoundsAdvertisedAndStreamingResponses() async throws {
        for advertised in [true, false] {
            let fixture = ProfileHTTPFixture(Data(repeating: 65, count: NativeSyncClient.maxResponseBytes + 524288))
            fixture.status = 200; fixture.advertised = advertised ? fixture.bytes.count : 1
            let url = ProfileHTTPProtocol.add(fixture, route: "state"); defer { ProfileHTTPProtocol.remove(url) }
            let client = try client(url)
            await failure({ _ = try await client.send(id: "size", expected: 1, operation: "state", body: nil) }, "sync-response-too-large")
            XCTAssertLessThan(fixture.stats.sent, fixture.bytes.count)
        }
    }
    func testSyncCancellationConfigurationChangeAndSlotRecovery() async throws {
        let fixture = ProfileHTTPFixture(Data(repeating: 65, count: 262144)); fixture.delay = 0.02
        let url = ProfileHTTPProtocol.add(fixture, route: "state"); defer { ProfileHTTPProtocol.remove(url) }
        let client = try client(url)
        client.cancel("early")
        await failure({ _ = try await client.send(id: "early", expected: 1, operation: "state", body: nil) }, "sync-cancelled")
        XCTAssertEqual(fixture.stats.requests, 0)
        let first = Task { try await client.send(id: "one", expected: 1, operation: "state", body: nil) }
        let second = Task { try await client.send(id: "two", expected: 1, operation: "state", body: nil) }
        try await waitFor { fixture.stats.requests == 2 }
        await failure({ _ = try await client.send(id: "one", expected: 1, operation: "state", body: nil) }, "invalid-sync-request")
        await failure({ _ = try await client.send(id: "three", expected: 1, operation: "state", body: nil) }, "invalid-sync-request")
        client.cancel("one")
        await failure({ _ = try await first.value }, "sync-cancelled")
        _ = try client.configure(["token": "replacement"], expected: 1)
        await failure({ _ = try await second.value }, "sync-cancelled")
        await failure({ _ = try await client.send(id: "stale", expected: 1, operation: "state", body: nil) }, "sync-settings-changed")
        _ = try await client.send(id: "recovered", expected: 2, operation: "state", body: nil)
        XCTAssertEqual(fixture.stats.requests, 3)
    }
}
