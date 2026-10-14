import XCTest
import AVFoundation
@testable import App

// MediaCacheTests.swift — full-body transport, shared jobs, account clearing and live file ownership.
@MainActor extension NativeTests {
    func testMediaDownloadCompleteBodyAndCredentialIsolation() async throws {
        for status in [200, 206] {
            let fixture = ProfileHTTPFixture(Data(repeating: 7, count: 65536)); fixture.status = status
            let url = ProfileHTTPProtocol.add(fixture); defer { ProfileHTTPProtocol.remove(url) }
            let result = try await NativeMediaDownload(configuration: profileNetworkConfiguration()).read(url)
            defer { try? FileManager.default.removeItem(at: result.url) }
            XCTAssertEqual(try Data(contentsOf: result.url), fixture.bytes)
            XCTAssertEqual(result.bytes, 65536); XCTAssertEqual(result.fileExtension, "wav")
            XCTAssertNil(fixture.stats.first?.value(forHTTPHeaderField: "Range"))
            XCTAssertNil(fixture.stats.first?.value(forHTTPHeaderField: "Authorization"))
            XCTAssertNil(fixture.stats.first?.value(forHTTPHeaderField: "Cookie"))
        }
    }
    func testMediaDownloadRejectsPartialOversizedAndTruncatedBodies() async throws {
        for mode in 0..<4 {
            let fixture = ProfileHTTPFixture(Data(repeating: 1, count: 16384)); fixture.status = 200
            if mode == 0 { fixture.status = 206; fixture.headers["Content-Range"] = "bytes 0-16383/32768" }
            if mode == 1 { fixture.advertised = 32768 }
            if mode == 2 { fixture.headers["Content-Type"] = "application/json" }
            let url = ProfileHTTPProtocol.add(fixture); defer { ProfileHTTPProtocol.remove(url) }
            do {
                let result = try await NativeMediaDownload(configuration: profileNetworkConfiguration(), maximumBytes: mode == 3 ? 100 : 65536).read(url)
                try? FileManager.default.removeItem(at: result.url); XCTFail("Invalid complete representation accepted")
            } catch { XCTAssertNotNil(error as? MobileFailure) }
        }
    }
    func testMediaCacheDisabledDeduplicatesAndLeasesSurviveClear() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = ProfileHTTPFixture(Data(repeating: 3, count: 131072)); fixture.delay = 0.01
        let url = ProfileHTTPProtocol.add(fixture); defer { ProfileHTTPProtocol.remove(url) }
        let cache = NativeMediaCache(directory: root, configuration: profileNetworkConfiguration())
        let song = song("qq", "cached"), identity = NativeProfileIdentity(song)!
        let disabled = try await cache.store(identity, song: song, source: url)
        XCTAssertNil(disabled); XCTAssertEqual(fixture.stats.requests, 0)
        try await cache.configure(NativeMediaCacheSettings(enabled: true, limitGB: 5))
        async let a = cache.store(identity, song: song, source: url)
        async let b = cache.store(identity, song: song, source: url)
        var leases = try await [a, b]
        XCTAssertEqual(fixture.stats.requests, 1)
        let paths = leases.compactMap { $0?.url }
        XCTAssertEqual(paths.count, 2); XCTAssertNotEqual(paths[0], paths[1])
        XCTAssertEqual(leases[0]?.generation, leases[1]?.generation)
        try await cache.clear()
        let summary = await cache.summary(); XCTAssertEqual(summary["count"] as? Int, 0)
        for path in paths { XCTAssertEqual(try Data(contentsOf: path), fixture.bytes) }
        leases.removeAll()
        // async-let owns the original results until scope exit; independent leases release immediately.
        try await cache.configure(NativeMediaCacheSettings(enabled: false, limitGB: 0))
    }
    func testMediaCacheClearCancelsDownloadAndCannotRepublish() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = ProfileHTTPFixture(Data(repeating: 1, count: 500000)); fixture.delay = 0.03
        let url = ProfileHTTPProtocol.add(fixture); defer { ProfileHTTPProtocol.remove(url) }
        let cache = NativeMediaCache(directory: root, configuration: profileNetworkConfiguration(), settings: .init(enabled: true))
        let song = song("qq", "cancel"), identity = NativeProfileIdentity(song)!
        let work = Task { try await cache.store(identity, song: song, source: url) }
        try await waitForStream { fixture.stats.sent > 0 }
        try await cache.clear(provider: "qq")
        do { _ = try await work.value; XCTFail() } catch { XCTAssertTrue(error is CancellationError) }
        let hit = try await cache.cached(identity); XCTAssertNil(hit)
        let summary = await cache.summary(); XCTAssertEqual(summary["pending"] as? Int, 0)
        XCTAssertEqual(summary["count"] as? Int, 0)
        XCTAssertLessThan(fixture.stats.sent, fixture.bytes.count)
    }
    func testMediaFilesLRURestoreLeaseAndCorruption() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let files = NativeMediaFiles(directory: root)
        let a = String(repeating: "a", count: 64), b = String(repeating: "b", count: 64)
        for key in [a, b] {
            let temp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try Data(repeating: 1, count: 100).write(to: temp)
            try files.save(key, download: .init(url: temp, fileExtension: "mp3", bytes: 100), provider: "qq", song: Data("{}".utf8))
        }
        var lease = try files.lease(a, touch: false)
        let path = try XCTUnwrap(lease?.url)
        try files.prune(limit: 100)
        XCTAssertNil(files.read(a)); XCTAssertNotNil(NativeMediaFiles(directory: root).read(b))
        XCTAssertEqual(try Data(contentsOf: path).count, 100)
        lease = nil; XCTAssertFalse(FileManager.default.fileExists(atPath: path.path))
        let body = files.path(b, try XCTUnwrap(files.read(b)))
        try Data([0]).write(to: body)
        XCTAssertNil(try files.lease(b, touch: false))
        try files.prune(limit: 100); XCTAssertFalse(FileManager.default.fileExists(atPath: body.path))
    }

    func testMediaCacheOfflinePlaybackSeekAfterClearAndNoGatewayResolve() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let file = try profileAudio(seconds: 8)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: file) }
        let fixture = ProfileHTTPFixture(try Data(contentsOf: file)), url = ProfileHTTPProtocol.add(fixture)
        defer { ProfileHTTPProtocol.remove(url) }
        let cache = NativeMediaCache(directory: root, configuration: profileNetworkConfiguration(), settings: .init(enabled: true))
        let song = song("qq", "offline"), identity = NativeProfileIdentity(song)!
        _ = try await cache.store(identity, song: song, source: url)
        let storage = UserDefaults(suiteName: "folia.cache-playback")!
        storage.removePersistentDomain(forName: "folia.cache-playback")
        let gateway = AudioFixtureGateway(url: URL(string: "https://unreachable.invalid/never")!)
        let engine = PlaybackEngine(gateway: gateway, storage: storage, usesStereoOutput: true, mediaCache: cache)
        engine.network.cancel()
        defer { engine.stop(); engine.clearOutput(); storage.removePersistentDomain(forName: "folia.cache-playback") }
        var settings = engine.audioSettings; settings.audioQuality = "hires"
        _ = try engine.setAudioSettings(settings.dictionary)
        try engine.setQueue([song], at: 0)
        try await waitForStream { engine.outputIsPlaying && engine.playbackPosition > 0.1 }
        XCTAssertNotNil(engine.stream?.cachedMedia)
        try await engine.clearMediaCache()
        try engine.command("seek", position: 4)
        try await waitForStream { engine.outputIsPlaying && engine.playbackPosition > 4 }
        XCTAssertEqual(gateway.resolved.count, 0)
        XCTAssertEqual(fixture.stats.requests, 1)
        XCTAssertEqual(engine.meter?.processingAvailable(), true)
    }

    func testQQCachedPlaybackSurvivesNetworkLossAndCacheClear() async throws {
        try await checkCachedPlaybackNetworkChange(provider: "qq")
    }

    func testNetEaseCachedPlaybackSurvivesNetworkLossAndCacheClear() async throws {
        try await checkCachedPlaybackNetworkChange(provider: "netease")
    }

    // Exercise path-monitor callbacks against a real leased decoder, including clearing its cache index.
    private func checkCachedPlaybackNetworkChange(provider: String) async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let file = try profileAudio(seconds: 12)
        let suite = "folia.cache-network." + UUID().uuidString
        let storage = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer {
            try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: file)
            storage.removePersistentDomain(forName: suite)
        }
        let fixture = ProfileHTTPFixture(try Data(contentsOf: file)), url = ProfileHTTPProtocol.add(fixture)
        defer { ProfileHTTPProtocol.remove(url) }
        let cache = NativeMediaCache(directory: root, configuration: profileNetworkConfiguration(), settings: .init(enabled: true))
        let song = song(provider, "cached-network"), identity = try XCTUnwrap(NativeProfileIdentity(song))
        _ = try await cache.store(identity, song: song, source: url)
        let gateway = FailingGateway()
        let engine = PlaybackEngine(gateway: gateway, storage: storage, usesStereoOutput: true, mediaCache: cache)
        engine.network.cancel()
        defer { engine.stop(); engine.clearOutput() }
        try engine.setQueue([song], at: 0)
        try await waitForStream { engine.outputIsPlaying && engine.playbackPosition > 0.1 }
        let entry = try XCTUnwrap(engine.stream), output = try XCTUnwrap(engine.streamOutput)
        let lease = try XCTUnwrap(entry.cachedMedia), generation = engine.generation
        let measured = OutputMeasurement()
        output.engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { buffer, _ in measured.consume(buffer) }
        defer { output.engine.mainMixerNode.removeTap(onBus: 0) }
        var checkpoints: [[String: Any]] = []
        for cleared in [false, true] {
            if cleared { try await engine.clearMediaCache() }
            engine.networkChanged(connected: false)
            XCTAssertNil(engine.error, "A complete cached song must not report network failure")
            XCTAssertNil(engine.networkResume, "A leased decoder must not schedule remote re-resolution")
            guard engine.intentToPlay else { XCTFail("Network loss stopped cached " + provider + " playback"); return }
            measured.reset(); let before = engine.playbackPosition
            try await Task.sleep(nanoseconds: 450_000_000)
            let pcm = measured.read(), advance = engine.playbackPosition - before
            XCTAssertGreaterThan(pcm.frames, 1000); XCTAssertEqual(pcm.channels, 2)
            XCTAssertGreaterThan(pcm.rms, 0.005); XCTAssertGreaterThan(advance, 0.2)
            XCTAssertTrue(FileManager.default.fileExists(atPath: lease.url.path))
            engine.networkChanged(connected: true)
            XCTAssertTrue(engine.stream === entry); XCTAssertEqual(engine.generation, generation)
            XCTAssertNil(engine.error); XCTAssertTrue(engine.intentToPlay)
            checkpoints.append(["cacheCleared": cleared, "frames": pcm.frames, "channels": pcm.channels,
                                "rms": pcm.rms, "advanceSeconds": advance])
        }
        try engine.command("pause")
        try await waitForStream { !engine.outputIsPlaying }
        engine.networkChanged(connected: false); engine.networkChanged(connected: true)
        XCTAssertFalse(engine.intentToPlay); XCTAssertNil(engine.networkResume)
        try engine.command("seek", position: 5); try engine.command("play")
        try await waitForStream { engine.outputIsPlaying && engine.playbackPosition > 5 }
        XCTAssertTrue(engine.stream === entry); XCTAssertEqual(gateway.count, 0)
        XCTAssertEqual(fixture.stats.requests, 1)
        let summary = await cache.summary(); XCTAssertEqual(summary["count"] as? Int, 0)
        let data = try JSONSerialization.data(withJSONObject: ["provider": provider, "checkpoints": checkpoints,
            "gatewayResolves": gateway.count], options: [.prettyPrinted, .sortedKeys])
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = provider + "-cached-network"; attachment.lifetime = .keepAlways; add(attachment)
    }

    func testMediaCachedFullProfileSurvivesLeaseRotationAndProviderLogout() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let file = try profileAudio(seconds: 6, head: 1, tail: 1)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: file) }
        let fixture = ProfileHTTPFixture(try Data(contentsOf: file)), url = ProfileHTTPProtocol.add(fixture)
        defer { ProfileHTTPProtocol.remove(url) }
        let cache = NativeMediaCache(directory: root.appendingPathComponent("media"), configuration: profileNetworkConfiguration(), settings: .init(enabled: true))
        let song = song("netease", "full"), identity = NativeProfileIdentity(song)!
        let first = try await cache.store(identity, song: song, source: url)
        let profiler = NativeTrackProfiler(cacheDirectory: root.appendingPathComponent("profiles"))
        let data = try await profiler.profile(cached: XCTUnwrap(first), identity: identity)
        let fields = try JSONSerialization.jsonObject(with: XCTUnwrap(data)) as! [String: Any]
        XCTAssertEqual(fields["partial"] as? Bool, false)
        let second = try await cache.cached(identity)
        XCTAssertNotEqual(first?.url, second?.url)
        let offline = NativeTrackProfiler(bundle: Bundle(for: NativeTests.self), cacheDirectory: root.appendingPathComponent("profiles"))
        let hit = try await offline.profile(cached: XCTUnwrap(second), identity: identity)
        XCTAssertEqual(data, hit)
        await profiler.invalidateProvider("netease")
        do { _ = try await offline.profile(cached: XCTUnwrap(second), identity: identity); XCTFail() }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "profile-runtime-unavailable") }
    }

    func testMediaCacheSettingsRestoredAndInvalidSettingsRejected() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let storage = UserDefaults(suiteName: "folia.cache-settings")!
        storage.removePersistentDomain(forName: "folia.cache-settings")
        defer { storage.removePersistentDomain(forName: "folia.cache-settings") }
        let engine = PlaybackEngine(gateway: FailingGateway(), storage: storage, mediaCache: NativeMediaCache(directory: root))
        defer { engine.stop() }
        _ = try await engine.configureMediaCache(.init(enabled: true, limitGB: 0))
        let restored = PlaybackEngine(gateway: FailingGateway(), storage: storage)
        defer { restored.stop() }
        let settings = await restored.mediaCache.settings
        XCTAssertTrue(settings.enabled); XCTAssertEqual(settings.limitGB, 0)
        for value in [-1.0, .nan, .infinity, Double.greatestFiniteMagnitude] {
            do { _ = try await engine.configureMediaCache(.init(enabled: true, limitGB: value)); XCTFail() } catch {}
        }
        let retained = await engine.mediaCache.settings
        XCTAssertEqual(retained.limitGB, 0)
    }
}
