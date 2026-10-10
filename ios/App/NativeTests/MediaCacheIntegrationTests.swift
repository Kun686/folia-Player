import XCTest
@testable import App

// MediaCacheIntegrationTests.swift — completed native playback, serial transfers and account-scoped offline state.
@MainActor extension NativeTests {
    func waitForMediaCache(_ cache: NativeMediaCache, count: Int) async throws {
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline {
            if await cache.summary()["count"] as? Int == count { return }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        throw MobileFailure("cache-test-timeout")
    }
    func testMediaCacheNaturalEOFStoresButManualSkipDoesNot() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let file = try profileAudio(seconds: 2)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: file) }
        let fixture = ProfileHTTPFixture(try Data(contentsOf: file)), url = ProfileHTTPProtocol.add(fixture)
        defer { ProfileHTTPProtocol.remove(url) }
        let config = profileNetworkConfiguration()
        let cache = NativeMediaCache(directory: root, configuration: config, settings: .init(enabled: true))
        let storage = UserDefaults(suiteName: "folia.cache-eof")!
        storage.removePersistentDomain(forName: "folia.cache-eof")
        let engine = PlaybackEngine(gateway: AudioFixtureGateway(url: url), storage: storage, usesStereoOutput: true,
                                    mediaNetworkConfiguration: config, mediaCache: cache)
        engine.network.cancel()
        defer { engine.stop(); engine.clearOutput(); storage.removePersistentDomain(forName: "folia.cache-eof") }
        let skipped = song("qq", "skipped"), completed = song("netease", "completed")
        try engine.setQueue([skipped, completed], at: 0)
        try await waitForStream { engine.outputIsPlaying && engine.preparedStream != nil }
        engine.move(1)
        try await waitForStream { engine.index == 1 && engine.outputIsPlaying }
        try engine.command("seek", position: 1.8)
        try await waitForMediaCache(cache, count: 1)
        let missing = try await cache.cached(NativeProfileIdentity(skipped)!)
        let hit = try await cache.cached(NativeProfileIdentity(completed)!)
        XCTAssertNil(missing); XCTAssertNotNil(hit)
        XCTAssertEqual(fixture.prefixRequests, 0)
    }
    func testMediaCacheSerialDownloadsAndLogoutPreserveOtherProvider() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let first = ProfileHTTPFixture(Data(repeating: 3, count: 100000)); first.delay = 0.04
        let second = ProfileHTTPFixture(Data(repeating: 4, count: 100000))
        let a = ProfileHTTPProtocol.add(first), b = ProfileHTTPProtocol.add(second)
        defer { ProfileHTTPProtocol.remove(a); ProfileHTTPProtocol.remove(b) }
        let cache = NativeMediaCache(directory: root, configuration: profileNetworkConfiguration(), settings: .init(enabled: true))
        var qq = song("qq", "same")
        qq["album"] = ["name": "album", "coverUrl": "https://cover.invalid/?signed=fixture"]
        qq["url"] = "https://audio.invalid/?signature=fixture"; qq["cookie"] = "fixture-only"
        let netease = song("netease", "same"), qi = NativeProfileIdentity(qq)!, ni = NativeProfileIdentity(netease)!
        let one = Task { try await cache.store(qi, song: qq, source: a) }
        try await waitForStream { first.stats.sent > 0 }
        let two = Task { try await cache.store(ni, song: netease, source: b) }
        try await Task.sleep(nanoseconds: 40_000_000)
        XCTAssertEqual(second.stats.requests, 0)
        _ = try await one.value; _ = try await two.value
        let catalog = await cache.catalog()
        let json = String(data: try JSONSerialization.data(withJSONObject: catalog), encoding: .utf8)!
        for secret in ["signed", "signature", "cookie", "fixture-only", "cover.invalid", "audio.invalid"] { XCTAssertFalse(json.contains(secret)) }
        try await cache.clear(provider: "qq")
        let q = try await cache.cached(qi), n = try await cache.cached(ni)
        XCTAssertNil(q); XCTAssertNotNil(n)
        let restored = NativeMediaCache(directory: root)
        let songs = await restored.catalog(); XCTAssertEqual(songs.count, 1)
        XCTAssertEqual(NativeProfileIdentity(songs[0])?.key, ni.key)
    }
    func testMediaDownloadRedirectRejectsCredentialsDowngradeAndLoops() async throws {
        let fixture = ProfileHTTPFixture(Data(repeating: 0, count: 300000)); fixture.delay = 0.05
        let url = ProfileHTTPProtocol.add(fixture); defer { ProfileHTTPProtocol.remove(url) }
        let downloader = NativeMediaDownload(configuration: profileNetworkConfiguration())
        let work = Task { try await downloader.read(url) }
        try await waitForStream { fixture.stats.sent > 0 }
        let session = URLSession(configuration: .ephemeral), task = session.dataTask(with: url)
        defer { session.invalidateAndCancel() }
        let response = HTTPURLResponse(url: url, statusCode: 302, httpVersion: nil, headerFields: [:])!
        var request = URLRequest(url: URL(string: "https://other.invalid/audio")!)
        request.setValue("fixture-only", forHTTPHeaderField: "Authorization")
        request.setValue("fixture-only", forHTTPHeaderField: "Cookie")
        for _ in 0..<5 {
            var accepted: URLRequest?
            downloader.urlSession(session, task: task, willPerformHTTPRedirection: response, newRequest: request) { accepted = $0 }
            XCTAssertEqual(accepted?.url, request.url)
            XCTAssertNil(accepted?.value(forHTTPHeaderField: "Authorization")); XCTAssertNil(accepted?.value(forHTTPHeaderField: "Cookie"))
        }
        downloader.urlSession(session, task: task, willPerformHTTPRedirection: response, newRequest: request) { XCTAssertNil($0) }
        do { _ = try await work.value; XCTFail() } catch { XCTAssertEqual((error as? MobileFailure)?.code, "cache-redirect-unavailable") }
        for raw in ["http://audio.invalid/a", "https://u:p@audio.invalid/a"] { XCTAssertThrowsError(try NativeMediaTransport.request(URL(string: raw)!)) }
    }

    func testMediaCacheFullAnalysisDrivesCrossfadeAndOfflineReplay() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let file = try profileAudio(seconds: 10, head: 2)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: file) }
        let fixture = ProfileHTTPFixture(try Data(contentsOf: file)), url = ProfileHTTPProtocol.add(fixture)
        defer { ProfileHTTPProtocol.remove(url) }
        let config = profileNetworkConfiguration()
        let cache = NativeMediaCache(directory: root, configuration: config, settings: .init(enabled: true))
        let storage = UserDefaults(suiteName: "folia.cache-crossfade")!
        storage.removePersistentDomain(forName: "folia.cache-crossfade")
        let gateway = AudioFixtureGateway(url: url)
        let engine = PlaybackEngine(gateway: gateway, storage: storage, usesStereoOutput: true,
                                    mediaNetworkConfiguration: config, mediaCache: cache)
        engine.network.cancel()
        defer { engine.stop(); engine.clearOutput(); storage.removePersistentDomain(forName: "folia.cache-crossfade") }
        _ = try engine.setTransitionSettings(["enabled": true, "mode": "crossfade", "crossfadeMaxSec": 1.0])
        let songs = [song("qq", UUID().uuidString), song("netease", UUID().uuidString)]
        try engine.setQueue(songs, at: 0)
        try await waitForMediaCache(cache, count: 2)
        try await waitForStream { engine.outputIsPlaying && (engine.preparedStream?.entry.preparedPosition ?? 0) > 1 }
        try engine.command("seek", position: 7.5)
        try await waitForStream { engine.index == 1 && engine.crossfade?.isFading == true && engine.outputIsPlaying }
        try await waitForStream { engine.crossfade?.isFading == false && engine.streamOutput?.attachedCount == 1 }
        XCTAssertEqual(fixture.prefixRequests, 0); XCTAssertEqual(gateway.resolved.count, 2)
        engine.stop(); engine.clearOutput()
        let requests = fixture.stats.requests
        try engine.setQueue(songs, at: 0)
        try await waitForStream { engine.outputIsPlaying && engine.preparedStream != nil }
        XCTAssertNotNil(engine.stream?.cachedMedia); XCTAssertNotNil(engine.preparedStream?.entry.cachedMedia)
        XCTAssertEqual(gateway.resolved.count, 2); XCTAssertEqual(fixture.stats.requests, requests)
    }
}
