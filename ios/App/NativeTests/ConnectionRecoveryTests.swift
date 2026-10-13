import XCTest
import Capacitor
import WebKit
import ObjectiveC
@testable import App

// ConnectionRecoveryTests.swift — packaged React, real bridge/Keychain/URLSession, synthetic gateway responses only.
private final class ConnectionRecoveryHTTP: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var available = false
    private static var authorization = ""
    private static var healthCalls = 0
    private static var accountCalls: [String] = []
    static func reset(token: String) {
        lock.withLock { available = false; authorization = "Bearer " + token; healthCalls = 0; accountCalls = [] }
    }
    static func recover() { lock.withLock { available = true } }
    static var stats: (health: Int, accounts: [String]) { lock.withLock { (healthCalls, accountCalls) } }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    private func payload() throws -> [String: Any] {
        var bytes = request.httpBody ?? Data()
        if bytes.isEmpty, let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while true {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count == 0 { break }
                guard count > 0, bytes.count + count <= 65536 else { throw URLError(.badServerResponse) }
                bytes.append(contentsOf: buffer.prefix(count))
            }
        }
        guard let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { throw URLError(.badServerResponse) }
        return object
    }
    // All native HTTP is intercepted; unexpected hosts and routes fail closed instead of reaching a real provider.
    private func response() throws -> [String: Any] {
        guard request.url?.host == "connection-qa.invalid",
              request.value(forHTTPHeaderField: "Authorization") == Self.lock.withLock({ Self.authorization }) else { throw URLError(.unsupportedURL) }
        if request.url?.path == "/mobile/health" {
            let ready = Self.lock.withLock { Self.healthCalls += 1; return Self.available }
            guard ready else { throw URLError(.notConnectedToInternet) }
            return ["protocol": 1, "providers": ["netease", "qq"]]
        }
        guard request.url?.path == "/mobile/request" else { throw URLError(.unsupportedURL) }
        let payload = try payload(), provider = payload["provider"] as? String ?? ""
        guard ["netease", "qq"].contains(provider), let rawPath = payload["path"] as? String,
              let path = URL(string: rawPath, relativeTo: URL(string: "https://fixture.invalid"))?.path else { throw URLError(.unsupportedURL) }
        let user: [String: Any] = provider == "qq" ? ["uin": "77", "nick": "QQ native fixture"]
            : ["userId": 9, "nickname": "NetEase native fixture"]
        let body: [String: Any]
        switch path {
        case "/login/status":
            Self.lock.withLock { Self.accountCalls.append(provider) }
            body = ["code": provider == "qq" ? 0 : 200, "data": ["code": 200, "profile": user]]
        case "/user/account": body = ["code": 200, "profile": user, "account": ["id": 9]]
        case "/user/playlist": body = ["code": 200, "playlist": [["id": 8, "name": provider + " native playlist", "trackCount": 0]], "total": 1, "more": false]
        default: throw URLError(.unsupportedURL)
        }
        return ["status": 200, "body": String(decoding: try JSONSerialization.data(withJSONObject: body), as: UTF8.self),
                "headers": ["content-type": "application/json"]]
    }
    override func startLoading() {
        do {
            let bytes = try JSONSerialization.data(withJSONObject: response())
            guard let url = request.url, let http = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json", "Content-Length": String(bytes.count)]) else { throw URLError(.badServerResponse) }
            client?.urlProtocol(self, didReceive: http, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: bytes); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() { /* Responses finish synchronously; no deferred work remains to cancel. */ }
}

private extension URLSessionConfiguration {
    // Swapped only while QA runs: this dynamic call reaches the original ephemeral configuration getter.
    @objc dynamic class func foliaConnectionQAConfiguration() -> URLSessionConfiguration {
        let configuration = foliaConnectionQAConfiguration()
        configuration.protocolClasses = [ConnectionRecoveryHTTP.self]
        return configuration
    }
}

@MainActor final class ConnectionRecoveryTests: XCTestCase {
    func testPackagedQQConnectionRetryRestoresNativeSessionAndPlaylists() async throws { try await recover("qq") }
    func testPackagedNetEaseConnectionRetryRestoresNativeSessionAndPlaylists() async throws { try await recover("netease") }

    private func recover(_ provider: String) async throws {
        #if !targetEnvironment(simulator)
        throw XCTSkip("Simulator-only isolated gateway recovery")
        #endif
        guard Bundle.main.bundleIdentifier == "app.folia.validation.App" else { throw MobileFailure("connection-qa-only") }
        let original = try NativeGatewayStore.shared.snapshot()
        guard original.server.isEmpty, original.sessions.values.allSatisfy({ $0.isEmpty }) else { throw MobileFailure("connection-qa-credentials-not-empty") }
        let host = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).compactMap { $0.rootViewController as? CAPBridgeViewController }.first)
        let web = try XCTUnwrap(host.webView)
        let offlinePage = try XCTUnwrap(URL(string: "capacitor://localhost/index.html"))
        let plugin = try XCTUnwrap(host.bridge?.plugin(withName: "FoliaNative") as? FoliaNativePlugin)
        for _ in 0..<100 {
            if plugin.engine != nil && !web.isLoading { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        let player = try XCTUnwrap(plugin.engine)
        player.stop(); player.network.cancel(); player.listening.invalidate()
        let queue = player.queue, index = player.index, detached = player.detachedSong
        player.queue = []; player.index = -1; player.detachedSong = nil
        let token = "generated-connection-qa-" + UUID().uuidString
        ConnectionRecoveryHTTP.reset(token: token)
        let getter = try XCTUnwrap(class_getClassMethod(URLSessionConfiguration.self, #selector(getter: URLSessionConfiguration.ephemeral)))
        let replacement = try XCTUnwrap(class_getClassMethod(URLSessionConfiguration.self, #selector(URLSessionConfiguration.foliaConnectionQAConfiguration)))
        method_exchangeImplementations(getter, replacement)
        defer {
            web.load(URLRequest(url: offlinePage))
            player.stop(); player.clearOutput(); player.listening.invalidate()
            player.queue = queue; player.index = index; player.detachedSong = detached
            try? SecureStore.write("gateway.credentials", original.dictionary())
            method_exchangeImplementations(getter, replacement)
        }
        let gateway = try NativeGatewayStore.shared.configure(server: "https://connection-qa.invalid", token: token, expected: original.scope)
        for id in ["netease", "qq"] {
            _ = try NativeGatewayStore.shared.saveSession(id, values: ["cookie": id == "qq" ? "qqmusic_session=synthetic-native-qa" : "synthetic-native-qa"], expected: gateway.scope)
        }
        let saved = try NativeGatewayStore.shared.snapshot()
        func js(_ script: String) async throws -> Any? { try await web.callAsyncJavaScript(script, arguments: [:], in: nil, contentWorld: .page) }
        func ready(_ condition: String) async throws {
            for _ in 0..<160 {
                if (try? await js("return " + condition)) as? Bool == true { return }
                try await Task.sleep(for: .milliseconds(50))
            }
            XCTFail("Packaged connection UI condition timed out: " + condition)
            throw MobileFailure("connection-qa-page-timeout")
        }
        _ = try await js("window.connectionQARetiredDocument = true; return true")
        web.load(URLRequest(url: try XCTUnwrap(URL(string: "capacitor://localhost/mobile.html"))))
        try await ready("!window.connectionQARetiredDocument && !!document.querySelector('.connection-hint button:not(:disabled)') && !!document.querySelector('.library-panel [role=alert]')")
        let label = provider == "qq" ? "QQ 音乐" : "网易云"
        _ = try await js("[...document.querySelectorAll('.providers button')].find(b=>b.textContent==='\(label)').click(); return true")
        XCTAssertEqual(ConnectionRecoveryHTTP.stats.health, 1)
        let disabled = try await js("return document.querySelector('.account-row button').disabled")
        XCTAssertEqual(disabled as? Bool, true)
        ConnectionRecoveryHTTP.recover()
        _ = try await js("document.querySelector('.connection-hint button').click(); return true")
        let nickname = provider == "qq" ? "QQ native fixture" : "NetEase native fixture"
        try await ready("document.querySelector('.account-row span')?.textContent === '\(nickname)' && [...document.querySelectorAll('button')].some(b=>b.textContent.includes('\(provider) native playlist'))")
        let error = try await js("return !!document.querySelector('.library-panel [role=alert]')")
        XCTAssertEqual(error as? Bool, false)
        XCTAssertEqual(ConnectionRecoveryHTTP.stats.health, 2)
        XCTAssertTrue(ConnectionRecoveryHTTP.stats.accounts.contains(provider))
        let reopened = try NativeGatewayStore().snapshot()
        XCTAssertEqual(reopened.sessions, saved.sessions); XCTAssertEqual(reopened.scope, saved.scope)
        XCTAssertEqual(reopened.token, saved.token); XCTAssertEqual(reopened.server, saved.server)
        // DOM commits can precede WebKit's compositor; capture only after the restored page has painted.
        _ = try await js("await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return true")
        let snapshot = WKSnapshotConfiguration(); snapshot.afterScreenUpdates = true
        let image = try await web.takeSnapshot(configuration: snapshot)
        let attachment = XCTAttachment(image: image); attachment.name = provider + "-connection-recovered"
        attachment.lifetime = .keepAlways; add(attachment)
        print("CONNECTION_QA \(provider): native health failure/retry, packaged account/playlist, and reopened Keychain assertions completed")
    }
}
