import XCTest
import AVFoundation
@testable import App

// NavidromePlaybackTests.swift — scoped native decoding and queue lifetimes against controlled Subsonic responses.
@MainActor final class NavidromePlaybackFixture {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let base = URL(string: "https://" + UUID().uuidString.lowercased() + ".profile.invalid/tenant")!
    let suite = "folia.navidrome-playback." + UUID().uuidString
    var record: [String: Any] = [:], urls: [URL] = []
    var failWrite = false
    var client: NativeNavidromeClient!
    let configuration: URLSessionConfiguration
    let storage: UserDefaults
    let cache: NativeMediaCache
    var player: PlaybackEngine!
    init(gateway: GatewayClient, caching: Bool = false) throws {
        configuration = .ephemeral; configuration.protocolClasses = [ProfileHTTPProtocol.self]
        configuration.httpAdditionalHeaders = ["Authorization": "gateway-secret", "Cookie": "platform-cookie"]
        storage = UserDefaults(suiteName: suite)!
        cache = NativeMediaCache(directory: root, configuration: configuration, settings: .init(enabled: caching))
        client = NativeNavidromeClient(read: { [weak self] in self?.record ?? [:] }, write: { [weak self] value in
            guard let self, !self.failWrite else { throw MobileFailure("secure-storage") }; self.record = value
        }, configuration: { [configuration] in configuration })
        _ = try client.configure(["baseURL": base.absoluteString, "username": "qa+用户", "password": "generated private password",
                                  "enabled": true], expected: 0, scope: "")
        player = PlaybackEngine(gateway: gateway, storage: storage, usesStereoOutput: true,
            mediaNetworkConfiguration: configuration, mediaCache: cache,
            coverCache: NativeCoverCache(root: root.appendingPathComponent("covers"), configuration: configuration),
            lyricCache: NativeLyricCache(root: root.appendingPathComponent("lyrics")))
        player.network.cancel(); player.connectNavidrome(client)
    }
    func close() {
        player.stop(); player.clearOutput(); player.crossfade?.cancelAnalysis()
        for url in urls { ProfileHTTPProtocol.remove(url) }
        storage.removePersistentDomain(forName: suite)
        try? FileManager.default.removeItem(at: root)
    }
    func edit(_ values: [String: Any]) throws {
        let state = try client.snapshot()
        _ = try client.configure(values, expected: state["revision"] as! Int, scope: state["scope"] as! String)
    }
    func song(_ id: String) throws -> [String: Any] {
        ["name": id, "sourceRef": ["kind": "navidrome", "mediaId": id, "scope": try client.snapshot()["scope"] as! String]]
    }
    @discardableResult func route(_ operation: String, id: String, body: Data, status: Int = 200) -> ProfileHTTPFixture {
        var parts = URLComponents(url: base.appendingPathComponent("rest/" + operation), resolvingAgainstBaseURL: false)!
        if !id.isEmpty { parts.queryItems = [URLQueryItem(name: "id", value: id)] }
        let url = parts.url!, fixture = ProfileHTTPFixture(body)
        fixture.status = status
        if operation != "stream" { fixture.headers = ["Content-Type": "application/json"] }
        ProfileHTTPProtocol.add(fixture, at: url); urls.append(url)
        return fixture
    }
    func track(_ id: String, audio: Data) throws -> (ProfileHTTPFixture, ProfileHTTPFixture) {
        let body = try JSONSerialization.data(withJSONObject: ["subsonic-response": ["status": "ok", "version": "1.16.1",
            "song": ["id": id, "replayGain": ["trackGain": -6.0, "trackPeak": 0.8]]]])
        return (route("getSong", id: id, body: body), route("stream", id: id, body: audio, status: 206))
    }
}

@MainActor extension NativeTests {
    func testNavidromeIdentityIsScopedAndDropsSignedURLs() throws {
        let fixture = try NavidromePlaybackFixture(gateway: FailingGateway()); defer { fixture.close() }
        var song = try fixture.song("song:+/汉&?")
        song["album"] = ["name": "album", "coverUrl": "https://secret.invalid/rest/getCoverArt?u=a&t=b&s=c"]
        song["navidromeData"] = ["streamUrl": "private-url"]; song["password"] = "private-password"
        let clean = try PlaybackEngine.sanitizedSong(song), original = try XCTUnwrap(NativeProfileIdentity(clean))
        XCTAssertEqual(original.provider, "navidrome"); XCTAssertNil(original.localID)
        let json = String(decoding: try JSONSerialization.data(withJSONObject: clean), as: UTF8.self)
        for value in ["private-", "secret.invalid", "coverUrl", "navidromeData", "password"] { XCTAssertFalse(json.contains(value)) }
        XCTAssertEqual((clean["sourceRef"] as? [String: Any])?["mediaId"] as? String, "song:+/汉&?")
        for ref: [String: Any] in [["kind": "navidrome", "mediaId": "a"], ["kind": "navidrome", "mediaId": "a", "scope": "invalid"],
            ["kind": "navidrome", "mediaId": "\n", "scope": UUID().uuidString]] {
            XCTAssertThrowsError(try PlaybackEngine.sanitizedSong(["sourceRef": ref]))
        }
        try fixture.edit(["password": "changed"])
        XCTAssertNotEqual(original.key, NativeProfileIdentity(try fixture.song("song:+/汉&?"))?.key)
        XCTAssertNotEqual(original.key, NativeProfileIdentity(self.song("qq", "same"))?.key)
    }

    func testNavidromeResolverUsesNativeSessionAndFreshSignatures() async throws {
        let fixture = try NavidromePlaybackFixture(gateway: FailingGateway()); defer { fixture.close() }
        let (metadata, _) = try fixture.track("song:+/汉&?", audio: Data([1]))
        let song = try fixture.song("song:+/汉&?"), first = try await fixture.client.audioSource(song)
        let second = try await fixture.client.audioSource(song)
        XCTAssertNotEqual(first.url, second.url); XCTAssertEqual(first.url.path, "/tenant/rest/stream")
        XCTAssertEqual(first.replayGain?.dictionary, ["trackGain": -6, "trackPeak": 0.8])
        let params = Dictionary(uniqueKeysWithValues: URLComponents(url: first.url, resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value!) })
        XCTAssertEqual(params["id"], "song:+/汉&?"); XCTAssertEqual(params["u"], "qa+用户")
        XCTAssertEqual(params["t"], NativeNavidromeRequest.token(password: "generated private password", salt: params["s"]!))
        XCTAssertNil(params["p"]); XCTAssertNil(params["format"])
        XCTAssertFalse(NativeMediaTransport.allowsRedirects(first.url))
        for request in metadata.capturedRequests {
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization")); XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
        }
        let restored = NativeNavidromeClient(read: { fixture.record })
        XCTAssertEqual(try restored.validatePlayback(song), 0)
    }

    func testNavidromeNativeQueueOutputsPCMAndAdvancesWithoutWebView() async throws {
        let file = try profileAudio(seconds: 1.4); defer { try? FileManager.default.removeItem(at: file) }
        let gateway = FailingGateway(), fixture = try NavidromePlaybackFixture(gateway: gateway); defer { fixture.close() }
        let data = try Data(contentsOf: file), songs = try ["one", "two", "three"].map(fixture.song)
        let samples = try ["one", "two", "three"].map { try fixture.track($0, audio: data) }
        let player = fixture.player!, measured = OutputMeasurement()
        var observed = Set<Int>()
        player.emit = { if $0["playing"] as? Bool == true, let index = $0["index"] as? Int { observed.insert(index) } }
        defer { player.emit = nil }
        try player.setQueue(songs, at: 0)
        try await waitForStream { player.outputIsPlaying }
        let output = try XCTUnwrap(player.streamOutput)
        output.engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { buffer, _ in measured.consume(buffer) }
        defer { output.engine.mainMixerNode.removeTap(onBus: 0) }
        try await waitForStream({ observed.count == 3 && !player.intentToPlay }, seconds: 12)
        XCTAssertEqual(observed, [0, 1, 2]); XCTAssertGreaterThan(measured.read().rms, 0.0001)
        XCTAssertEqual(gateway.count, 0); XCTAssertNil(player.error)
        XCTAssertEqual(NativeReplayGainInfo(player.currentSong?["replayGain"])?.dictionary["trackGain"], -6)
        for (_, audio) in samples {
            XCTAssertGreaterThan(audio.stats.requests, 0)
            for request in audio.capturedRequests {
                XCTAssertNil(request.value(forHTTPHeaderField: "Authorization")); XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
            }
        }
        let persisted = String(decoding: try XCTUnwrap(fixture.storage.data(forKey: "folia.queue")), as: UTF8.self)
        let publicState = String(decoding: try JSONSerialization.data(withJSONObject: player.snapshot()), as: UTF8.self)
        for text in [persisted, publicState] {
            for secret in ["/rest/", "generated private password", "qa+", "https:"] { XCTAssertFalse(text.contains(secret)) }
        }
        print("FOLIA_NAVIDROME queue=3 pcmRMS=\(measured.read().rms) gatewayCalls=0 webviewCalls=0")
    }

    func testNavidromeSeekNetworkRecoveryAndRapidSelectionUseCurrentIdentity() async throws {
        let file = try profileAudio(seconds: 20); defer { try? FileManager.default.removeItem(at: file) }
        let fixture = try NavidromePlaybackFixture(gateway: FailingGateway()); defer { fixture.close() }
        let bytes = try Data(contentsOf: file), player = fixture.player!
        _ = try fixture.track("first", audio: bytes); let (metadata, audio) = try fixture.track("second", audio: bytes)
        try player.setQueue([fixture.song("first"), fixture.song("second")], at: 0)
        try player.selectQueue(1, expectedRevision: player.queueRevision)
        try await waitForStream { player.outputIsPlaying && player.index == 1 }
        try player.command("seek", position: 11)
        try await waitForStream { player.outputIsPlaying && player.playbackPosition >= 11 }
        XCTAssertLessThan(player.playbackPosition, 12)
        let before = player.playbackPosition, requests = metadata.stats.requests
        player.networkChanged(connected: false); player.networkChanged(connected: true)
        try await waitForStream { player.outputIsPlaying && player.playbackPosition >= before - 0.05 }
        XCTAssertGreaterThan(metadata.stats.requests, requests); XCTAssertEqual(player.index, 1)
        XCTAssertTrue(audio.capturedRequests.contains { ($0.value(forHTTPHeaderField: "Range") ?? "") != "bytes=0-" })
        XCTAssertNil(player.error)
    }

    func testNavidromeCacheRestoresOfflineAndRejectsOldScopeBeforeLookup() async throws {
        let file = try profileAudio(seconds: 10); defer { try? FileManager.default.removeItem(at: file) }
        let fixture = try NavidromePlaybackFixture(gateway: FailingGateway(), caching: true); defer { fixture.close() }
        let (metadata, audio) = try fixture.track("same", audio: Data(contentsOf: file))
        let song = try fixture.song("same"), identity = try XCTUnwrap(NativeProfileIdentity(song))
        let source = try await fixture.client.audioSource(song)
        _ = try await fixture.cache.store(identity, song: song, source: source.url)
        let catalog = await fixture.cache.catalog()
        XCTAssertEqual(catalog.count, 1)
        XCTAssertFalse(String(decoding: try JSONSerialization.data(withJSONObject: catalog), as: UTF8.self).contains("https:"))
        for url in fixture.urls { ProfileHTTPProtocol.remove(url) }
        let before = [metadata.stats.requests, audio.stats.requests], player = fixture.player!
        try player.setQueue([song], at: 0)
        try await waitForStream { player.outputIsPlaying }
        XCTAssertTrue(player.stream?.sourceURL.isFileURL == true)
        XCTAssertEqual([metadata.stats.requests, audio.stats.requests], before)
        let active = player.stream
        fixture.failWrite = true
        XCTAssertThrowsError(try fixture.edit(["password": "new-password"]))
        XCTAssertTrue(player.stream === active); XCTAssertTrue(player.outputIsPlaying)
        fixture.failWrite = false
        try fixture.edit(["password": "new-password"])
        XCTAssertFalse(player.intentToPlay); XCTAssertNil(player.stream); XCTAssertTrue(player.queue.isEmpty)
        try await player.mediaCachePurges["navidrome"]?.value
        let removed = try await fixture.cache.cached(identity); XCTAssertNil(removed)
        try player.setQueue([song], at: 0)
        try await waitForStream { player.error != nil }
        XCTAssertEqual(player.error, "navidrome-settings-changed"); XCTAssertFalse(player.intentToPlay)
        XCTAssertEqual([metadata.stats.requests, audio.stats.requests], before)
        let newIdentity = try XCTUnwrap(NativeProfileIdentity(fixture.song("same")))
        XCTAssertNotEqual(identity.key, newIdentity.key)
        let newHit = try await fixture.cache.cached(newIdentity); XCTAssertNil(newHit)
    }

    func testNavidromeSettingsChangeCancelsPendingReadAndPreservesOtherSource() async throws {
        let file = try profileAudio(seconds: 10); defer { try? FileManager.default.removeItem(at: file) }
        let gateway = AudioFixtureGateway(url: file), fixture = try NavidromePlaybackFixture(gateway: gateway); defer { fixture.close() }
        let body = Data(("{\"subsonic-response\":{\"status\":\"ok\",\"version\":\"1.16.1\",\"song\":{\"id\":\"slow\"}}}" + String(repeating: " ", count: 200000)).utf8)
        let metadata = fixture.route("getSong", id: "slow", body: body); metadata.delay = 0.08
        let player = fixture.player!
        try player.setQueue([fixture.song("slow")], at: 0)
        try await waitForStream { metadata.stats.sent > 0 }
        try fixture.edit(["enabled": false])
        try await waitForStream { metadata.stats.stopped > 0 }
        XCTAssertFalse(player.intentToPlay); XCTAssertNil(player.stream); XCTAssertTrue(player.queue.isEmpty)
        XCTAssertLessThan(metadata.stats.sent, body.count)
        try player.setQueue([self.song("qq", "keep")], at: 0)
        try await waitForStream { player.outputIsPlaying }
        let active = player.stream
        try fixture.edit(["enabled": true])
        XCTAssertTrue(player.stream === active); XCTAssertTrue(player.outputIsPlaying); XCTAssertTrue(player.currentUsesGateway)
        try await player.mediaCachePurges["navidrome"]?.value
    }

    func testNavidromeAuthenticationStopsBeforeTryingOtherTracks() async throws {
        let gateway = FailingGateway(), fixture = try NavidromePlaybackFixture(gateway: gateway); defer { fixture.close() }
        fixture.player.artwork.navidrome = nil // Count playback retries independently of optional artwork reads.
        let metadata = fixture.route("getSong", id: "expired", body: Data("{\"subsonic-response\":{\"status\":\"failed\",\"version\":\"1.16.1\",\"error\":{\"code\":40,\"message\":\"private credentials\"}}}".utf8))
        try fixture.player.setQueue([fixture.song("expired"), fixture.song("next")], at: 0)
        try await waitForStream { fixture.player.error != nil }
        XCTAssertEqual(fixture.player.error, "navidrome-auth-required"); XCTAssertEqual(fixture.player.index, 0)
        XCTAssertFalse(fixture.player.intentToPlay); XCTAssertEqual(metadata.stats.requests, 1); XCTAssertEqual(gateway.count, 0)
    }

    func testNavidromeMediaRedirectsNeverContactDestination() async throws {
        let fixture = try NavidromePlaybackFixture(gateway: FailingGateway()); defer { fixture.close() }
        let destination = ProfileHTTPFixture(Data([1])), target = ProfileHTTPProtocol.add(destination)
        defer { ProfileHTTPProtocol.remove(target) }
        let (_, audio) = try fixture.track("redirect", audio: Data([1]))
        audio.redirect = target; audio.completesDeclinedRedirect = true
        let source = try await fixture.client.audioSource(fixture.song("redirect"))
        do {
            _ = try await NativeMediaDownload(configuration: fixture.configuration).read(source.url); XCTFail("redirect accepted")
        } catch { XCTAssertEqual((error as? MobileFailure)?.code, "cache-redirect-unavailable") }
        do {
            _ = try await NativeProfilePrefix(configuration: fixture.configuration).read(source.url); XCTFail("redirect accepted")
        } catch { XCTAssertEqual((error as? MobileFailure)?.code, "profile-redirect-unavailable") }
        do {
            let entry = try await StreamOccurrence.prepare(url: source.url, networkConfiguration: fixture.configuration)
            entry.dispose(); XCTFail("redirect accepted")
        } catch { XCTAssertEqual((error as? MobileFailure)?.code, "audio-failed") }
        XCTAssertEqual(destination.stats.requests, 0)
    }

    func testNavidromeBrowseRequestsCannotStarveNativePlayback() async throws {
        let fixture = try NavidromePlaybackFixture(gateway: FailingGateway()); defer { fixture.close() }
        let body = Data(("{\"subsonic-response\":{\"status\":\"ok\",\"version\":\"1.16.1\"}}" + String(repeating: " ", count: 200000)).utf8)
        let slow = fixture.route("getSong", id: "browse", body: body); slow.delay = 0.08
        _ = try fixture.track("play", audio: Data([1]))
        let state = try fixture.client.snapshot(), scope = state["scope"] as! String, epoch = state["revision"] as! Int
        let jobs = (0..<2).map { n in Task { try await fixture.client.send(id: "browse-\(n)", expected: epoch,
            scope: scope, operation: "getSong", parameters: ["id": "browse"]) } }
        defer { jobs.forEach { $0.cancel() } }
        try await waitForStream { slow.stats.requests == 2 }
        let source = try await fixture.client.audioSource(fixture.song("play"))
        XCTAssertTrue(NativeNavidromeRequest.isSignedMediaURL(source.url))
        XCTAssertLessThan(slow.stats.sent, body.count * 2)
        for job in jobs { job.cancel(); _ = try? await job.value }
    }

    func testNavidromeRestoredQueueCannotReadStaleAccountCache() async throws {
        let file = try profileAudio(seconds: 10); defer { try? FileManager.default.removeItem(at: file) }
        let fixture = try NavidromePlaybackFixture(gateway: FailingGateway(), caching: true); defer { fixture.close() }
        let (metadata, audio) = try fixture.track("same", audio: Data(contentsOf: file))
        let song = try fixture.song("same"), id = try XCTUnwrap(NativeProfileIdentity(song))
        let source = try await fixture.client.audioSource(song)
        _ = try await fixture.cache.store(id, song: song, source: source.url)
        fixture.player.queue = [try PlaybackEngine.sanitizedSong(song)]; fixture.player.index = 0; fixture.player.persist()
        // Model a crash between Keychain commit and cleanup, then restore the old persisted queue.
        fixture.record = try NativeNavidromeSettings.read(fixture.record).editing(["password": "another-account-secret"]).record()
        let cached = try await NativeMediaCache(directory: fixture.root).cached(id); XCTAssertNotNil(cached)
        let restored = PlaybackEngine(gateway: FailingGateway(), storage: fixture.storage, usesStereoOutput: true,
            mediaNetworkConfiguration: fixture.configuration, mediaCache: NativeMediaCache(directory: fixture.root))
        restored.network.cancel(); restored.connectNavidrome(fixture.client)
        defer { restored.stop(); restored.clearOutput() }
        XCTAssertEqual(NativeProfileIdentity(restored.currentSong ?? [:])?.key, id.key)
        let before = [metadata.stats.requests, audio.stats.requests]
        try restored.command("play")
        try await waitForStream { restored.error != nil }
        XCTAssertEqual(restored.error, "navidrome-settings-changed"); XCTAssertNil(restored.stream)
        XCTAssertEqual([metadata.stats.requests, audio.stats.requests], before)
    }

    func testNavidromeRepeatedSourceFailureStopsAfterThreeTracks() async throws {
        let fixture = try NavidromePlaybackFixture(gateway: FailingGateway()); defer { fixture.close() }
        fixture.player.artwork.navidrome = nil // Count playback retries independently of optional artwork reads.
        var samples: [ProfileHTTPFixture] = []
        for id in ["one", "two", "three", "four"] {
            samples.append(fixture.route("getSong", id: id, body: Data("unavailable".utf8), status: 503))
        }
        try fixture.player.setQueue(["one", "two", "three", "four"].map(fixture.song), at: 0)
        try await waitForStream { fixture.player.error != nil }
        XCTAssertEqual(fixture.player.error, "navidrome-http-503"); XCTAssertFalse(fixture.player.intentToPlay)
        XCTAssertEqual(fixture.player.index, 2); XCTAssertEqual(samples.map { $0.stats.requests }, [2, 2, 2, 0])
    }
}
