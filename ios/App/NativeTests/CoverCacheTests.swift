import XCTest
import UIKit
import MediaPlayer
@testable import App

// CoverCacheTests.swift — real URLSession/ImageIO, durable images, account cancellation and lock-screen identity.
@MainActor extension NativeTests {
    func coverFixture(_ color: UIColor = .red, size: CGSize = CGSize(width: 80, height: 40), padding: Int = 0) throws -> ProfileHTTPFixture {
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
            color.setFill(); context.fill(CGRect(origin: .zero, size: size))
        }
        var data = try XCTUnwrap(image.pngData()); data.append(Data(repeating: 0, count: padding))
        let fixture = ProfileHTTPFixture(data); fixture.status = 200; fixture.headers["Content-Type"] = "image/png"
        return fixture
    }
    func coverSong(_ url: URL, provider: String = "qq", id: String = "cover") -> [String: Any] {
        var result = song(provider, id); result["album"] = ["coverUrl": url.absoluteString]; return result
    }
    func testCoverCacheCoalescesPersistsAndRestoresWithoutNetwork() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = try coverFixture(size: CGSize(width: 2048, height: 1024)), url = ProfileHTTPProtocol.add(fixture)
        defer { ProfileHTTPProtocol.remove(url) }
        let local = LocalMediaLibrary(root: root.appendingPathComponent("local"))
        let cache = NativeCoverCache(root: root, configuration: profileNetworkConfiguration())
        let song = coverSong(url)
        async let first = cache.cover(song, local: local)
        async let second = cache.cover(song, local: local)
        let values = try await [first, second]
        XCTAssertEqual(values[0], values[1]); XCTAssertEqual(fixture.stats.requests, 1)
        let image = try XCTUnwrap(UIImage(data: XCTUnwrap(values[0])))
        XCTAssertEqual(image.size.width, 1024); XCTAssertEqual(image.size.height, 512)
        XCTAssertNil(fixture.stats.first?.value(forHTTPHeaderField: "Authorization"))
        XCTAssertNil(fixture.stats.first?.value(forHTTPHeaderField: "Cookie"))
        XCTAssertFalse(fixture.stats.first?.httpShouldHandleCookies ?? true)
        ProfileHTTPProtocol.remove(url)
        let restored = NativeCoverCache(root: root, configuration: profileNetworkConfiguration())
        var expired = song; expired["album"] = ["coverUrl": "https://unreachable.invalid/expired"]
        let hit = try await restored.cover(expired, local: local)
        XCTAssertEqual(hit, values[0]); XCTAssertEqual(fixture.stats.requests, 1)
        let summary = await restored.summary(); XCTAssertEqual(summary["count"], 1)
        for url in try FileManager.default.contentsOfDirectory(at: root.appendingPathComponent("qq"), includingPropertiesForKeys: nil) {
            XCTAssertEqual(url.pathExtension, "jpg")
            XCTAssertFalse(String(decoding: try Data(contentsOf: url), as: UTF8.self).contains("profile.invalid"))
        }
    }
    func testCoverCacheSeparatesProvidersVariantsAndClearCategories() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = try coverFixture(), url = ProfileHTTPProtocol.add(fixture); defer { ProfileHTTPProtocol.remove(url) }
        let cache = NativeCoverCache(root: root, configuration: profileNetworkConfiguration()), local = LocalMediaLibrary(root: root.appendingPathComponent("local"))
        let qq = coverSong(url), netease = coverSong(url, provider: "netease")
        var cloud = netease; var ref = cloud["sourceRef"] as! [String: Any]; ref["variant"] = "cloud"; cloud["sourceRef"] = ref
        for song in [qq, netease, cloud] { _ = try await cache.cover(song, local: local) }
        XCTAssertEqual(fixture.stats.requests, 3)
        try await cache.clear(provider: "qq")
        let retained = await cache.summary(); XCTAssertEqual(retained["count"], 2)
        _ = try await cache.cover(cloud, local: local); XCTAssertEqual(fixture.stats.requests, 3)
        try await cache.clear()
        let cleared = await cache.summary(); XCTAssertEqual(cleared["bytes"], 0)
        let lru = NativeCoverCache(root: root, configuration: profileNetworkConfiguration(), limit: 1)
        let delivered = try await lru.cover(qq, local: local); XCTAssertNotNil(delivered)
        let evicted = await lru.summary(); XCTAssertEqual(evicted["count"], 0)
    }
    func testCoverClearCancelsInFlightAndPreventsLateWrite() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = try coverFixture(padding: 500000); fixture.delay = 0.03
        let url = ProfileHTTPProtocol.add(fixture); defer { ProfileHTTPProtocol.remove(url) }
        let cache = NativeCoverCache(root: root, configuration: profileNetworkConfiguration()), local = LocalMediaLibrary()
        let song = coverSong(url)
        let work = Task { try await cache.cover(song, local: local) }
        try await waitForStream { fixture.stats.sent > 0 }
        try await cache.clear(provider: "qq")
        do { _ = try await work.value; XCTFail("Late cover accepted after logout") } catch { XCTAssertTrue(error is CancellationError) }
        let summary = await cache.summary(); XCTAssertEqual(summary["count"], 0)
        XCTAssertLessThan(fixture.stats.sent, fixture.bytes.count)
        // Failed/cancelled jobs do not permanently consume the four concurrent slots.
        let recovered = try await cache.cover(song, local: local); XCTAssertNotNil(recovered)
    }
    func testCoverRejectsNonImagesOversizeAndUnsafeURLs() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = NativeCoverCache(root: root, configuration: profileNetworkConfiguration()), local = LocalMediaLibrary()
        for fixture in [ProfileHTTPFixture(Data("<svg/>".utf8)), try coverFixture()] {
            fixture.status = 200; fixture.advertised = fixture.bytes.count < 20 ? nil : 8_000_001
            let url = ProfileHTTPProtocol.add(fixture); defer { ProfileHTTPProtocol.remove(url) }
            do { _ = try await cache.cover(coverSong(url), local: local); XCTFail("Invalid image accepted") } catch {}
        }
        for raw in ["http://profile.invalid/cover", "file:///etc/hosts", "https://user:pass@profile.invalid/cover"] {
            do { _ = try await cache.cover(coverSong(URL(string: raw)!), local: local); XCTFail("Unsafe URL accepted") } catch {}
        }
        let summary = await cache.summary(); XCTAssertEqual(summary["count"], 0)
    }
    func testLocalCoverSurvivesOnlineCacheClearAndAppearsOnLockScreen() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), audio = try profileAudio(seconds: 1)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root.appendingPathComponent("imports")), song = try await local.importAudio(audio)
        let id = (song["sourceRef"] as! [String: Any])["mediaId"] as! String
        let cover = try NativeCoverCache.thumbnail(coverFixture(.blue).bytes)
        try cover.write(to: root.appendingPathComponent("imports/" + id + "/cover.jpg"))
        let cache = NativeCoverCache(root: root.appendingPathComponent("cache"))
        let artwork = PlaybackArtwork(cache: cache, local: local); artwork.update(song)
        try await waitForStream { artwork.image != nil }
        try await cache.clear()
        let retained = try await cache.cover(song, local: local); XCTAssertEqual(retained, cover)
        let storage = UserDefaults(suiteName: "folia.cover-test")!
        storage.removePersistentDomain(forName: "folia.cover-test")
        let engine = PlaybackEngine(gateway: FailingGateway(), storage: storage, local: local, coverCache: cache)
        engine.network.cancel(); defer { engine.stop(); storage.removePersistentDomain(forName: "folia.cover-test") }
        engine.detachedSong = song; engine.updateNowPlaying()
        try await waitForStream { MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyArtwork] != nil }
        engine.updateNowPlaying()
        XCTAssertNotNil(MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyArtwork])
        engine.detachedSong = nil; engine.updateNowPlaying()
        XCTAssertNil(MPNowPlayingInfoCenter.default().nowPlayingInfo)
    }
    func testArtworkIgnoresPreviousTrackAndDoesNotRefetchOnSnapshots() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let slow = try coverFixture(.red, padding: 200000); slow.delay = 0.01
        let fast = try coverFixture(.blue, size: CGSize(width: 32, height: 64))
        let a = ProfileHTTPProtocol.add(slow), b = ProfileHTTPProtocol.add(fast)
        defer { ProfileHTTPProtocol.remove(a); ProfileHTTPProtocol.remove(b) }
        let cache = NativeCoverCache(root: root, configuration: profileNetworkConfiguration())
        let art = PlaybackArtwork(cache: cache, local: LocalMediaLibrary())
        art.update(coverSong(a, id: "slow")); try await waitForStream { slow.stats.sent > 0 }
        let song = coverSong(b, id: "fast"); art.update(song)
        try await waitForStream { art.image != nil && slow.stats.sent == slow.bytes.count }
        for _ in 0..<100 { art.update(song) }
        XCTAssertEqual(art.image?.bounds.size, CGSize(width: 32, height: 64))
        XCTAssertEqual(fast.stats.requests, 1)
        art.update(nil); XCTAssertNil(art.image)
    }
    func testArtworkRestoresCachedOnlyUntilPlaybackAndReleasesCompletedJobs() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = try coverFixture(), url = ProfileHTTPProtocol.add(fixture); defer { ProfileHTTPProtocol.remove(url) }
        let cache = NativeCoverCache(root: root, configuration: profileNetworkConfiguration())
        let local = LocalMediaLibrary(), song = coverSong(url)
        let missing = try await cache.cover(song, local: local, allowNetwork: false)
        XCTAssertNil(missing); XCTAssertEqual(fixture.stats.requests, 0)
        let art = PlaybackArtwork(cache: cache, local: local)
        art.update(song, allowNetwork: false)
        art.update(song, allowNetwork: true)
        try await waitForStream { art.image != nil }
        for i in 0..<6 { _ = try await cache.cover(coverSong(url, id: "sequential-\(i)"), local: local) }
        XCTAssertEqual(fixture.stats.requests, 7)
    }
}
