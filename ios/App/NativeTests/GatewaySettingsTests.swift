import XCTest
@testable import App

// GatewaySettingsTests.swift — fault-injected migration, isolated real Keychain and controlled URLSession; no real accounts.
private final class GatewayStorageFixture {
    var records: [String: [String: Any]] = [:]
    var failedRead: String?, failedRemove: String?
    var failWrite = false
    func store() -> NativeGatewayStore {
        NativeGatewayStore(read: { key in
            if self.failedRead == key { throw MobileFailure("secure-storage") }
            return self.records[key] ?? [:]
        }, write: { key, value in
            if self.failWrite { throw MobileFailure("secure-storage") }
            self.records[key] = value
        }, remove: { key in
            if self.failedRemove == key { throw MobileFailure("secure-storage") }
            self.records.removeValue(forKey: key)
        })
    }
}

private final class GatewayAccountFixture: GatewayClient {
    private let lock = NSLock()
    private var values: [(String, [String: Any])] = []
    var calls: [(String, [String: Any])] { lock.withLock { values } }
    override func send(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        lock.withLock { values.append((path, body ?? [:])) }
        switch path {
        case "/mobile/resolve": return ["url": "https://cdn.example/synthetic.mp3"]
        case "/mobile/report": return ["reported": true]
        case "/mobile/fm": return ["songs": []]
        default: throw MobileFailure("fixture-unsupported")
        }
    }
}

@MainActor final class GatewaySettingsTests: XCTestCase {
    private let token = String(repeating: "generated-", count: 4)
    private func configured(_ store: NativeGatewayStore, server: String = "https://old.example") throws -> NativeGatewayRecord {
        let first = try store.configure(server: server, token: token, expected: store.snapshot().scope)
        for provider in NativeGatewayStore.providers {
            _ = try store.saveSession(provider, values: ["cookie": "synthetic-" + provider], expected: first.scope)
        }
        return try store.snapshot()
    }
    private func expectFailure(_ operation: () async throws -> Void, code: String = "gateway-settings-changed") async {
        do { try await operation(); XCTFail("Expected \(code)") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, code) }
    }
    func testGatewayCommitFailurePreservesAllSessionsAndTokenRotationRetainsThem() throws {
        let disk = GatewayStorageFixture(), store = disk.store()
        let old = try configured(store)
        disk.failWrite = true
        XCTAssertThrowsError(try store.configure(server: "https://new.example", token: token, expected: old.scope))
        XCTAssertEqual(try store.snapshot().dictionary() as NSDictionary, try old.dictionary() as NSDictionary)
        disk.failWrite = false
        let same = try store.configure(server: "https://OLD.example:443/", token: token, expected: old.scope)
        XCTAssertEqual(same.scope, old.scope)
        let rotated = try store.configure(server: old.server, token: token + "new", expected: old.scope)
        XCTAssertNotEqual(rotated.scope, old.scope); XCTAssertEqual(rotated.sessions, old.sessions)
        let moved = try store.configure(server: "https://new.example", token: token, expected: rotated.scope)
        XCTAssertTrue(moved.sessions.isEmpty); XCTAssertNotEqual(moved.scope, rotated.scope)
        let restored = try disk.store().snapshot()
        XCTAssertEqual(restored.scope, moved.scope); XCTAssertTrue(restored.sessions.isEmpty)
        XCTAssertEqual(restored.server, "https://new.example")
        XCTAssertThrowsError(try store.saveSession("qq", values: ["cookie": "late"], expected: old.scope))
        XCTAssertThrowsError(try store.clearSession("qq", expected: rotated.scope))
        XCTAssertThrowsError(try store.configure(server: old.server, token: token, expected: old.scope))
        XCTAssertEqual(try store.snapshot().scope, moved.scope)
    }
    func testGatewayLogoutFailureIsNonDestructiveAndProvidersStaySeparate() throws {
        let disk = GatewayStorageFixture(), store = disk.store(), before = try configured(store)
        disk.failWrite = true
        XCTAssertThrowsError(try store.clearSession("qq", expected: before.scope))
        XCTAssertEqual(try store.snapshot().sessions, before.sessions)
        disk.failWrite = false
        try store.clearSession("qq", expected: before.scope)
        let after = try disk.store().snapshot()
        XCTAssertNil(after.sessions["qq"])
        XCTAssertEqual(after.sessions["netease"], before.sessions["netease"])
        XCTAssertEqual(after.sessions["kugou"], before.sessions["kugou"])
        XCTAssertThrowsError(try store.saveSession("unknown", values: [:], expected: before.scope))
        XCTAssertThrowsError(try store.saveSession("qq", values: ["cookie": String(repeating: "x", count: 24001)], expected: before.scope))
    }
    func testGatewayMigrationReadAndWriteFailureNeverDeleteLegacyRecords() throws {
        for mode in ["read", "write"] {
            let disk = GatewayStorageFixture()
            disk.records = ["gateway": ["server": "https://OLD.example:443/", "token": token],
                "session.qq": ["cookie": "old-qq"], "session.netease": ["cookie": "old-netease"], "session.kugou": ["token": "old-kugou"]]
            let before = disk.records as NSDictionary
            if mode == "read" { disk.failedRead = "session.netease" } else { disk.failWrite = true }
            XCTAssertThrowsError(try disk.store().snapshot())
            XCTAssertEqual(disk.records as NSDictionary, before)
            disk.failedRead = nil; disk.failWrite = false
            let restored = try disk.store().snapshot()
            XCTAssertEqual(restored.server, "https://old.example"); XCTAssertEqual(restored.sessions.count, 3)
            XCTAssertEqual(restored.sessions["qq"]?["cookie"], "old-qq")
            XCTAssertEqual(Set(disk.records.keys), ["gateway.credentials"])
        }
    }
    func testGatewayInterruptedMigrationCleanupAlwaysResumesFromDurableCopy() throws {
        for key in ["gateway", "session.netease", "session.qq", "session.kugou"] {
            let disk = GatewayStorageFixture()
            disk.records = ["gateway": ["server": "https://old.example", "token": token],
                "session.qq": ["cookie": "old-qq"], "session.netease": ["cookie": "old-netease"]]
            disk.failedRemove = key
            XCTAssertThrowsError(try disk.store().snapshot())
            XCTAssertNotNil(disk.records["gateway.credentials"])
            disk.records["session.qq"] = ["cookie": "stale-legacy-must-not-win"]
            disk.failedRemove = nil
            let result = try disk.store().snapshot()
            XCTAssertEqual(result.sessions["qq"]?["cookie"], "old-qq")
            XCTAssertEqual(result.sessions["netease"]?["cookie"], "old-netease")
            XCTAssertEqual(Set(disk.records.keys), ["gateway.credentials"])
        }
    }
    func testGatewayValidatesBeforeAnyMutationAndRejectsCorruptRecords() throws {
        let disk = GatewayStorageFixture(), store = disk.store(), before = try configured(store)
        for url in ["http://old.example", "https://u:p@old.example", "https://old.example/api", "https://old.example?x=1",
                    "https://old.example#x", "https://old.example:0", "https://old.example:65536", "https://old.example/%2f", "https://old.example/a\\b"] {
            XCTAssertThrowsError(try store.configure(server: url, token: token, expected: before.scope), url)
        }
        for invalid in ["short", token + "\n", String(repeating: "x", count: 4097)] {
            XCTAssertThrowsError(try store.configure(server: before.server, token: invalid, expected: before.scope))
        }
        XCTAssertEqual(try store.snapshot().scope, before.scope)
        for patch: [String: Any] in [["scope": "bad"], ["version": 2], ["token": "short"], ["server": "http://bad.example"], ["sessions": ["unknown": [:]]]] {
            var invalid = try before.dictionary(); invalid.merge(patch) { _, new in new }
            disk.records["gateway.credentials"] = invalid
            XCTAssertThrowsError(try disk.store().snapshot())
            XCTAssertEqual(disk.records["gateway.credentials"]! as NSDictionary, invalid as NSDictionary)
        }
    }
    func testGatewayActualKeychainMigrationReopenAndLogoutUseIsolatedNames() throws {
        let prefix = "test.gateway." + UUID().uuidString + "."
        let keys = ["gateway.credentials", "gateway", "session.netease", "session.qq", "session.kugou"]
        defer { keys.forEach { try? SecureStore.remove(prefix + $0) } }
        try SecureStore.write(prefix + "gateway", ["server": "https://old.example", "token": token])
        try SecureStore.write(prefix + "session.qq", ["cookie": "synthetic-qq"])
        func store() -> NativeGatewayStore {
            NativeGatewayStore(read: { try SecureStore.read(prefix + $0) },
                write: { try SecureStore.write(prefix + $0, $1) }, remove: { try SecureStore.remove(prefix + $0) })
        }
        let old = try store().snapshot()
        XCTAssertEqual(old.sessions["qq"]?["cookie"], "synthetic-qq")
        XCTAssertTrue(try SecureStore.read(prefix + "gateway").isEmpty)
        XCTAssertNil(old.publicValues["token"])
        let rotated = try store().configure(server: old.server, token: token + "new", expected: old.scope)
        XCTAssertEqual(try store().snapshot().sessions, old.sessions)
        try store().clearSession("qq", expected: rotated.scope)
        XCTAssertNil(try store().snapshot().sessions["qq"])
    }
    func testGatewayTransportRejectsStaleIntentBeforeSendAndResponseAfterCommit() async throws {
        let fixture = ProfileHTTPFixture(Data(("{\"padding\":\"" + String(repeating: "x", count: 65536) + "\"}").utf8))
        fixture.status = 200; fixture.delay = 0.015; fixture.headers = ["Content-Type": "application/json"]
        let url = ProfileHTTPProtocol.add(fixture, route: "mobile/health", atOrigin: true)
        defer { ProfileHTTPProtocol.remove(url) }
        let disk = GatewayStorageFixture(), store = disk.store()
        let before = try configured(store, server: "https://" + url.host!)
        let gateway = GatewayClient(credentials: store, configuration: {
            let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [ProfileHTTPProtocol.self]; return config
        })
        await expectFailure({ _ = try await gateway.send("/mobile/health", scope: "retired") })
        XCTAssertEqual(fixture.stats.requests, 0)
        let request = Task { try await gateway.send("/mobile/health", scope: before.scope) }
        for _ in 0..<100 { if fixture.stats.requests > 0 { break }; try await Task.sleep(for: .milliseconds(5)) }
        XCTAssertEqual(fixture.stats.requests, 1)
        let next = try store.configure(server: before.server, token: token + "new", expected: before.scope)
        await expectFailure({ _ = try await request.value })
        XCTAssertEqual(fixture.stats.first?.value(forHTTPHeaderField: "Authorization"), "Bearer " + token)
        _ = try await gateway.send("/mobile/health", scope: next.scope)
        XCTAssertEqual(fixture.stats.requests, 2)
    }
    func testGatewayLyricSessionScopeSurvivesAwaitAndRejectsCachedLateResults() async throws {
        for sendsRequest in [false, true] {
            let disk = GatewayStorageFixture(), store = disk.store(), before = try configured(store)
            let gateway = GatewayClient(credentials: store)
            await expectFailure {
                _ = try await gateway.withSession("qq") { values in
                    XCTAssertEqual(values["cookie"] as? String, "synthetic-qq")
                    await Task.yield()
                    _ = try store.configure(server: "https://new.example", token: self.token, expected: before.scope)
                    if sendsRequest { _ = try await gateway.send("/mobile/request", body: ["cookie": values["cookie"]!]) }
                    return "cached-old-lyrics"
                }
            }
        }
    }
    func testGatewayPlaybackFMAndReportsUseOnlyOwningSessionAndLogoutRevokesAccount() async throws {
        let disk = GatewayStorageFixture(), store = disk.store(), before = try configured(store)
        let gateway = GatewayAccountFixture(credentials: store)
        for provider in NativeGatewayStore.providers {
            _ = try await gateway.resolve(["sourceRef": ["kind": "online", "providerId": provider, "mediaId": "42"]])
            XCTAssertEqual(gateway.calls.last?.0, "/mobile/resolve")
            XCTAssertEqual(gateway.calls.last?.1["session"] as? [String: String], ["cookie": "synthetic-" + provider])
        }
        XCTAssertTrue(gateway.listeningAccountAvailable())
        let song: [String: Any] = ["sourceRef": ["kind": "online", "providerId": "netease", "mediaId": "42"]]
        let report = NativeListeningReport(songKey: "online:netease:42", mediaId: "42", playedSeconds: 35, totalSeconds: 240)
        try await gateway.reportListening(song: song, report: report, quality: "standard")
        XCTAssertEqual(gateway.calls.last?.1["session"] as? [String: String], ["cookie": "synthetic-netease"])
        _ = try await gateway.personalFM(["mode": "normal"])
        XCTAssertEqual(gateway.calls.last?.1["session"] as? [String: String], ["cookie": "synthetic-netease"])
        try store.clearSession("netease", expected: before.scope)
        XCTAssertFalse(gateway.listeningAccountAvailable())
        let count = gateway.calls.count
        await expectFailure({ _ = try await gateway.personalFM(["mode": "normal"]) }, code: "auth-required")
        await expectFailure({ try await gateway.reportListening(song: song, report: report, quality: "standard") }, code: "auth-required")
        XCTAssertEqual(gateway.calls.count, count)
        XCTAssertEqual(try store.snapshot().sessions["qq"]?["cookie"], "synthetic-qq")
    }
}
