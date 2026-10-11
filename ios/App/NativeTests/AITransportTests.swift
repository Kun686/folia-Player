import XCTest
@testable import App

// AITransportTests.swift — actual Keychain and URLSession boundaries using generated credentials and the existing bounded HTTP fixture.
@MainActor final class AITransportTests: XCTestCase {
    private func configuration() -> URLSessionConfiguration {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ProfileHTTPProtocol.self]
        config.httpAdditionalHeaders = ["Authorization": "music-gateway-secret", "Cookie": "music-platform-secret"]
        return config
    }
    private func client(_ url: URL, key: String = "qa-generated-ai-key") throws -> NativeAIClient {
        var record: [String: Any] = [:]
        let client = NativeAIClient(read: { record }, write: { record = $0 }, configuration: configuration)
        _ = try client.configure(["provider": "openai", "apiURL": url.absoluteString, "apiKey": key], expected: 0)
        return client
    }
    private func response(_ value: String, status: Int = 200) -> ProfileHTTPFixture {
        let fixture = ProfileHTTPFixture(Data(value.utf8))
        fixture.status = status; fixture.headers = ["Content-Type": "application/json"]
        return fixture
    }
    private func failure(_ operation: () async throws -> Void, code: String) async {
        do { try await operation(); XCTFail("Expected \(code)") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, code) }
    }
    func testAIKeychainRoundTripHidesSecretsAndKeepsProvidersSeparate() throws {
        let name = "test.ai." + UUID().uuidString
        defer { try? SecureStore.remove(name) }
        let client = NativeAIClient(read: { try SecureStore.read(name) }, write: { try SecureStore.write(name, $0) })
        _ = try client.configure(["provider": "gemini", "apiKey": "generated-gemini-qa"], expected: 0)
        let snapshot = try client.configure(["provider": "openai", "apiKey": "generated-openai-qa"], expected: 1)
        let encoded = String(data: try JSONSerialization.data(withJSONObject: snapshot), encoding: .utf8)!
        XCTAssertFalse(encoded.contains("generated-"))
        let restored = try NativeAISettings.read(SecureStore.read(name))
        XCTAssertEqual(restored.geminiKey, "generated-gemini-qa")
        XCTAssertEqual(restored.openai.apiKey, "generated-openai-qa")
        _ = try client.configure(["provider": "openai", "apiKey": ""], expected: 2)
        XCTAssertEqual(try NativeAISettings.read(SecureStore.read(name)).geminiKey, "generated-gemini-qa")
        XCTAssertEqual(try NativeAISettings.read(SecureStore.read(name)).openai.apiKey, "")
    }
    func testAISettingsRejectUnsafeInputsAndDoNotChangeStateOnStorageFailure() throws {
        var record: [String: Any] = [:], fail = false
        let client = NativeAIClient(read: { record }, write: { if fail { throw MobileFailure("secure-storage") }; record = $0 })
        _ = try client.configure(["provider": "openai", "apiKey": "generated-key"], expected: 0)
        let before = try client.snapshot()
        for settings: [String: Any] in [["provider": "bad"], ["provider": "openai", "temperature": 3],
            ["provider": "openai", "temperature": true], ["provider": "openai", "stream": "true"],
            ["provider": "openai", "model": ""], ["provider": "gemini", "apiKey": "a\nb"],
            ["provider": "gemini", "apiURL": "https://example.com"], ["provider": "gemini", "unknown": 1]] {
            XCTAssertThrowsError(try client.configure(settings, expected: 1))
        }
        for url in ["http://example.com/api", "file:///tmp/a", "https://u:p@example.com/api", "https://example.com/?key=x",
                    "https://example.com/#key", "https://example.com/a b"] {
            XCTAssertThrowsError(try client.configure(["provider": "openai", "apiURL": url], expected: 1))
        }
        fail = true
        XCTAssertThrowsError(try client.configure(["provider": "gemini"], expected: 1))
        XCTAssertEqual(try client.snapshot() as NSDictionary, before as NSDictionary)
        XCTAssertEqual(client.revision, 1)
        XCTAssertThrowsError(try client.configure(["provider": "gemini"], expected: 0))
    }
    func testAIEndpointChangeClearsOldKeyAndExplicitReplacementIsAtomic() throws {
        let base = try NativeAISettings().editing(["provider": "openai", "apiKey": "old-generated-key"])
        let changed = try base.editing(["provider": "openai", "apiURL": "https://other.example/v1/chat/completions"])
        XCTAssertEqual(changed.openai.apiKey, "")
        let next = try changed.editing(["provider": "openai", "apiURL": "https://third.example/v1/chat/completions", "apiKey": "new-generated-key"])
        XCTAssertEqual(next.openai.apiKey, "new-generated-key")
        XCTAssertEqual(try next.editing(["provider": "openai", "apiURL": "https://third.example/custom"]).openai.apiKey, "new-generated-key")
    }
    func testAITransportUsesOnlyConfiguredKeyAndPreservesJSONAndSSE() async throws {
        for body in ["{\"choices\":[{\"message\":{\"content\":\"ok\"}}]}", "data: {\"choices\":[]}\n\ndata: [DONE]\n\n"] {
            let fixture = response(body), url = ProfileHTTPProtocol.add(fixture)
            defer { ProfileHTTPProtocol.remove(url) }
            let client = try client(url)
            let result = try await client.send(id: UUID().uuidString, expected: 1, provider: "openai", body: "{\"model\":\"test\"}")
            XCTAssertEqual(result["body"] as? String, body)
            let request = try XCTUnwrap(fixture.stats.first)
            XCTAssertEqual(request.url, url); XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer qa-generated-ai-key")
            XCTAssertNil(request.value(forHTTPHeaderField: "Cookie")); XCTAssertNil(request.value(forHTTPHeaderField: "x-goog-api-key"))
            XCTAssertFalse(request.httpShouldHandleCookies)
        }
        let gemini = try NativeAISettings().editing(["provider": "gemini", "apiKey": "gemini-generated-key"])
        let request = try NativeAIClient.request(settings: gemini, body: Data("{}".utf8))
        XCTAssertEqual(request.url?.absoluteString, NativeAISettings.geminiURL)
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-goog-api-key"), "gemini-generated-key")
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
    }
    func testAIHTTPErrorRedactsEchoedKeyAndKeepsNegotiationFields() async throws {
        let fixture = response("{\"error\":{\"param\":\"response_format\",\"message\":\"unsupported parameter response_format qa-generated-ai-key\"}}", status: 400)
        let url = ProfileHTTPProtocol.add(fixture); defer { ProfileHTTPProtocol.remove(url) }
        let client = try client(url), result = try await client.send(id: "error", expected: 1, provider: "openai", body: "{\"model\":\"test\"}")
        XCTAssertEqual(result["status"] as? Int, 400)
        let text = try XCTUnwrap(result["body"] as? String)
        XCTAssertFalse(text.contains("qa-generated-ai-key")); XCTAssertTrue(text.contains("response_format"))
        XCTAssertEqual(fixture.stats.requests, 1) // The native transport never retries credential or provider failures.
    }
    func testAIOversizeAdvertisedAndStreamingResponsesAreCancelled() async throws {
        for advertised in [true, false] {
            let fixture = ProfileHTTPFixture(Data(repeating: 65, count: NativeAIClient.maxResponseBytes + 262144))
            fixture.status = 200; fixture.advertised = advertised ? fixture.bytes.count : 1
            let url = ProfileHTTPProtocol.add(fixture); defer { ProfileHTTPProtocol.remove(url) }
            let client = try client(url)
            await failure({ _ = try await client.send(id: "size", expected: 1, provider: "openai", body: "{\"model\":\"test\"}") }, code: "ai-response-too-large")
            XCTAssertLessThan(fixture.stats.sent, fixture.bytes.count)
        }
    }
    func testAICancellationBeforeTaskAndDuringStreamReleasesSlot() async throws {
        let fixture = ProfileHTTPFixture(Data(repeating: 65, count: 262144)); fixture.delay = 0.02
        let url = ProfileHTTPProtocol.add(fixture); defer { ProfileHTTPProtocol.remove(url) }
        let client = try client(url)
        client.cancel("early")
        await failure({ _ = try await client.send(id: "early", expected: 1, provider: "openai", body: "{\"test\":true}") }, code: "ai-cancelled")
        XCTAssertEqual(fixture.stats.requests, 0)
        let task = Task { try await client.send(id: "active", expected: 1, provider: "openai", body: "{\"test\":true}") }
        for _ in 0..<50 { if fixture.stats.sent > 0 { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertGreaterThan(fixture.stats.sent, 0); client.cancel("active")
        await failure({ _ = try await task.value }, code: "ai-cancelled")
        XCTAssertLessThan(fixture.stats.sent, fixture.bytes.count)
        let result = try await client.send(id: "recovered", expected: 1, provider: "openai", body: "{\"test\":true}")
        XCTAssertEqual((result["body"] as? String)?.count, fixture.bytes.count)
    }
    func testAIConfigurationChangeRejectsInflightAndStaleRequests() async throws {
        let fixture = ProfileHTTPFixture(Data(repeating: 65, count: 262144)); fixture.delay = 0.02
        let url = ProfileHTTPProtocol.add(fixture); defer { ProfileHTTPProtocol.remove(url) }
        let client = try client(url)
        let task = Task { try await client.send(id: "old", expected: 1, provider: "openai", body: "{\"test\":true}") }
        for _ in 0..<50 { if fixture.stats.sent > 0 { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        _ = try client.configure(["provider": "openai", "apiKey": ""], expected: 1)
        await failure({ _ = try await task.value }, code: "ai-cancelled")
        await failure({ _ = try await client.send(id: "stale", expected: 1, provider: "openai", body: "{\"test\":true}") }, code: "ai-settings-changed")
        await failure({ _ = try await client.send(id: "missing", expected: 2, provider: "openai", body: "{\"test\":true}") }, code: "ai-key-missing")
        XCTAssertEqual(fixture.stats.requests, 1)
    }
    func testAIRedirectDelegateRefusesCredentialForwarding() {
        let url = URL(string: NativeAISettings.geminiURL)!
        let response = HTTPURLResponse(url: url, statusCode: 302, httpVersion: nil, headerFields: ["Location": "https://other.example/"])!
        let session = URLSession(configuration: .ephemeral), task = session.dataTask(with: url)
        defer { task.cancel(); session.invalidateAndCancel() }
        var called = false
        AIRedirectBlocker().urlSession(session, task: task, willPerformHTTPRedirection: response,
            newRequest: URLRequest(url: URL(string: "https://other.example/")!)) { proposed in
                called = true; XCTAssertNil(proposed)
            }
        XCTAssertTrue(called)
    }
    func testAIRejectsInvalidPayloadsBeforeSendingAndBoundsConcurrency() async throws {
        let fixture = ProfileHTTPFixture(Data(repeating: 65, count: 262144)); fixture.delay = 0.02
        let url = ProfileHTTPProtocol.add(fixture); defer { ProfileHTTPProtocol.remove(url) }
        let client = try client(url)
        for body in ["[]", "{}", "not-json", "{\"large\":\"" + String(repeating: "x", count: 262144) + "\"}"] {
            await failure({ _ = try await client.send(id: UUID().uuidString, expected: 1, provider: "openai", body: body) }, code: "invalid-ai-request")
        }
        XCTAssertEqual(fixture.stats.requests, 0)
        let first = Task { try await client.send(id: "one", expected: 1, provider: "openai", body: "{\"test\":true}") }
        let second = Task { try await client.send(id: "two", expected: 1, provider: "openai", body: "{\"test\":true}") }
        for _ in 0..<50 { if fixture.stats.requests == 2 { break }; try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertEqual(fixture.stats.requests, 2)
        await failure({ _ = try await client.send(id: "one", expected: 1, provider: "openai", body: "{\"test\":true}") }, code: "invalid-ai-request")
        await failure({ _ = try await client.send(id: "three", expected: 1, provider: "openai", body: "{\"test\":true}") }, code: "invalid-ai-request")
        XCTAssertEqual(fixture.stats.requests, 2)
        client.cancel("one"); client.cancel("two")
        await failure({ _ = try await first.value }, code: "ai-cancelled")
        await failure({ _ = try await second.value }, code: "ai-cancelled")
        _ = try await client.send(id: "recovered-slot", expected: 1, provider: "openai", body: "{\"test\":true}")
        XCTAssertEqual(fixture.stats.requests, 3)
    }
}
