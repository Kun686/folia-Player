import XCTest
import UIKit
import Capacitor
import WebKit
@testable import App

// NavidromeResourceTests.swift — real JavaScriptCore, native requests and scoped caches without a server or account.
@MainActor extension NativeTests {
    private func resourceBody(_ body: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: ["subsonic-response": body.merging(["status": "ok", "version": "1.16.1"]) { _, new in new }])
    }
    private func resourceLyrics(_ fixture: NavidromePlaybackFixture, id: String = "one") throws -> ProfileHTTPFixture {
        let main: [String: Any] = ["kind": "main", "synced": true, "line": [["start": 1000, "value": "Hello world"]],
            "cueLine": [["index": 0, "start": 1000, "end": 2500, "value": "Hello world", "cue": [
                ["start": 1000, "end": 1600, "value": "Hello "], ["start": 1600, "end": 2500, "value": "world"]]]]]
        let translation: [String: Any] = ["kind": "translation", "synced": true, "line": [["start": 1000, "value": "你好世界"]]]
        return fixture.route("getLyricsBySongId", id: id, body: try resourceBody(["lyricsList": ["structuredLyrics": [main, translation]]]))
    }
    func testNavidromeResourcesRunOriginalLyricsInBareJavaScriptCore() async throws {
        let fixture = try NavidromePlaybackFixture(gateway: FailingGateway()); defer { fixture.close() }
        let request = try resourceLyrics(fixture), song = try fixture.song("one")
        let cache = NativeLyricCache(root: fixture.root.appendingPathComponent("lyrics"))
        let snapshot = try await cache.navidromeSnapshot(song, client: fixture.client)
        let payload = try XCTUnwrap(snapshot["payload"] as? [String: Any])
        let lyrics = try XCTUnwrap(payload["lyrics"] as? [String: Any]), line = try XCTUnwrap((lyrics["lines"] as? [[String: Any]])?.first)
        XCTAssertEqual(line["fullText"] as? String, "Hello world"); XCTAssertEqual(line["translation"] as? String, "你好世界")
        XCTAssertEqual(line["startTime"] as? Double, 1); XCTAssertEqual((line["words"] as? [[String: Any]])?.count, 2)
        XCTAssertEqual(request.stats.requests, 1)
        for url in fixture.urls { ProfileHTTPProtocol.remove(url) }
        let offline = try await cache.navidromeSnapshot(song, client: fixture.client)
        XCTAssertEqual(try JSONSerialization.data(withJSONObject: offline, options: .sortedKeys),
                       try JSONSerialization.data(withJSONObject: snapshot, options: .sortedKeys))
        let text = String(decoding: try JSONSerialization.data(withJSONObject: snapshot), as: UTF8.self)
        for forbidden in ["password", "/rest/", "https:", "qa+"] { XCTAssertFalse(text.contains(forbidden)) }
        for url in try FileManager.default.contentsOfDirectory(at: fixture.root.appendingPathComponent("lyrics/navidrome"), includingPropertiesForKeys: nil) {
            let bytes = try String(contentsOf: url, encoding: .utf8)
            XCTAssertFalse(bytes.contains("/rest/")); XCTAssertFalse(bytes.contains("password"))
        }
    }
    func testNavidromeResourcesOptionalEndpointFallsBackButAuthDoesNot() async throws {
        let fixture = try NavidromePlaybackFixture(gateway: FailingGateway()); defer { fixture.close() }
        _ = fixture.route("getLyricsBySongId", id: "one", body: Data("{}".utf8), status: 404)
        let plain = fixture.route("getLyrics", id: "", body: try resourceBody(["lyrics": ["value": "[00:01.00]Plain fallback\n[00:03.00]Next"]]))
        let song = try fixture.song("one"), parser = NativeLyricParser()
        let result = try await NativeNavidromeLyrics.document(song, client: fixture.client, parser: parser)
        XCTAssertEqual(((result["lyrics"] as? [String: Any])?["lines"] as? [[String: Any]])?.first?["fullText"] as? String, "Plain fallback")
        XCTAssertEqual(plain.stats.requests, 1)
        _ = fixture.route("getLyricsBySongId", id: "one", body: Data("{\"subsonic-response\":{\"status\":\"failed\",\"version\":\"1.16.1\",\"error\":{\"code\":40}}}".utf8))
        do { _ = try await NativeNavidromeLyrics.document(song, client: fixture.client, parser: parser); XCTFail("auth must propagate") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "navidrome-auth-required") }
        XCTAssertEqual(plain.stats.requests, 1)
    }
    func testNavidromeResourcesImportedSelectionSurvivesRefresh() async throws {
        let fixture = try NavidromePlaybackFixture(gateway: FailingGateway()); defer { fixture.close() }
        let request = try resourceLyrics(fixture), song = try fixture.song("one")
        let cache = NativeLyricCache(root: fixture.root.appendingPathComponent("lyrics"))
        let initial = try await cache.navidromeSnapshot(song, client: fixture.client)
        let state: [String: Any] = ["lyricsSource": "imported", "importedLyricsName": "own.lrc", "importedLyrics": ["lines": [
            ["startTime": 2, "endTime": 4, "fullText": "User text", "words": []]]]]
        try await cache.write(song, token: initial["token"] as! String, field: "state", value: state)
        let refreshed = try await cache.navidromeSnapshot(song, client: fixture.client, refresh: true)
        XCTAssertEqual(request.stats.requests, 2)
        XCTAssertEqual((refreshed["lines"] as? [[String: Any]])?.first?["startTime"] as? Double, 2)
        XCTAssertEqual(((refreshed["payload"] as? [String: Any])?["state"] as? [String: Any])?["importedLyricsName"] as? String, "own.lrc")
    }
    func testNavidromeResourcesScopeChangeRejectsCachedLyricsAndExports() async throws {
        let fixture = try NavidromePlaybackFixture(gateway: FailingGateway()); defer { fixture.close() }
        _ = try resourceLyrics(fixture)
        let cache = NativeLyricCache(root: fixture.root.appendingPathComponent("lyrics")), song = try fixture.song("one")
        _ = try await cache.navidromeSnapshot(song, client: fixture.client)
        let scope = try fixture.client.snapshot()["scope"] as! String
        let inventory = try await cache.exportInventory(knownSongs: [], navidromeScope: scope)
        let entries = try XCTUnwrap(inventory["entries"] as? [[String: Any]]); XCTAssertEqual(entries.count, 1)
        let key = try XCTUnwrap(entries.first?["key"] as? String), token = inventory["token"] as! String
        _ = try await cache.exportRead(key: key, token: token, navidromeScope: scope)
        // The cache is deliberately independent of engine purge: simulates a crash after Keychain commits.
        try fixture.edit(["password": "changed"])
        do { _ = try await cache.navidromeSnapshot(song, client: fixture.client); XCTFail("old account cache") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "navidrome-settings-changed") }
        let current = try fixture.client.snapshot()["scope"] as! String
        do { _ = try await cache.exportRead(key: key, token: token, navidromeScope: current); XCTFail("old export token") } catch {}
        let newInventory = try await cache.exportInventory(knownSongs: [song], navidromeScope: current)
        XCTAssertEqual((newInventory["entries"] as? [[String: Any]])?.count, 0)
        do { _ = try await cache.exportRead(key: key, token: newInventory["token"] as! String, navidromeScope: current); XCTFail("old key") } catch {}
    }
    func testNavidromeResourcesClearAndDisableDiscardPendingLyrics() async throws {
        let fixture = try NavidromePlaybackFixture(gateway: FailingGateway()); defer { fixture.close() }
        let song = try fixture.song("one"), cache = NativeLyricCache(root: fixture.root.appendingPathComponent("lyrics"))
        for disable in [false, true] {
            var data = try resourceBody(["lyricsList": ["structuredLyrics": []]])
            data.append(Data(repeating: 32, count: 200_000))
            let request = fixture.route("getLyricsBySongId", id: "one", body: data); request.delay = 0.02
            let task = Task { try await cache.navidromeSnapshot(song, client: fixture.client) }
            try await waitForStream { request.stats.sent > 0 }
            if disable { try fixture.edit(["enabled": false]) } else { try await cache.clear(provider: "navidrome"); task.cancel() }
            do { _ = try await task.value; XCTFail("late lyrics") } catch {}
            let summary = await cache.summary(); XCTAssertEqual(summary["count"], 0)
        }
    }
    func testNavidromeResourcesCoverStaysNativeAndRestoresOffline() async throws {
        let fixture = try NavidromePlaybackFixture(gateway: FailingGateway()); defer { fixture.close() }
        let metadata = fixture.route("getSong", id: "one", body: try resourceBody(["song": ["id": "one", "coverArt": "album:one"]]))
        let image = try coverFixture(), art = fixture.route("getCoverArt", id: "album:one", body: image.bytes)
        art.headers = ["Content-Type": "image/png"]
        let cache = NativeCoverCache(root: fixture.root.appendingPathComponent("covers"), configuration: fixture.configuration)
        let local = LocalMediaLibrary(root: fixture.root.appendingPathComponent("local")), song = try fixture.song("one")
        async let first = cache.cover(song, local: local, navidrome: fixture.client)
        async let second = cache.cover(song, local: local, navidrome: fixture.client)
        let results = try await [first, second]
        XCTAssertEqual(results[0], results[1]); XCTAssertNotNil(UIImage(data: try XCTUnwrap(results[0])))
        XCTAssertEqual(metadata.stats.requests, 1); XCTAssertEqual(art.stats.requests, 1)
        let request = try XCTUnwrap(art.stats.first), url = try XCTUnwrap(request.url)
        XCTAssertFalse(NativeMediaTransport.allowsRedirects(url))
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization")); XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
        for url in fixture.urls { ProfileHTTPProtocol.remove(url) }
        let restored = try await cache.cover(song, local: local, allowNetwork: false, navidrome: fixture.client)
        XCTAssertEqual(restored, results[0]); XCTAssertEqual(art.stats.requests, 1)
        try fixture.edit(["password": "changed"])
        do { _ = try await cache.cover(song, local: local, allowNetwork: false, navidrome: fixture.client); XCTFail("stale cover") } catch {}
    }
    func testNavidromeResourcesCoverClearCannotPublishLateBytes() async throws {
        let fixture = try NavidromePlaybackFixture(gateway: FailingGateway()); defer { fixture.close() }
        _ = fixture.route("getSong", id: "one", body: try resourceBody(["song": ["id": "one", "coverArt": "art"]]))
        let image = try coverFixture(padding: 300_000), art = fixture.route("getCoverArt", id: "art", body: image.bytes)
        art.headers = ["Content-Type": "image/png"]; art.delay = 0.03
        let cache = NativeCoverCache(root: fixture.root.appendingPathComponent("covers"), configuration: fixture.configuration)
        let local = LocalMediaLibrary(root: fixture.root.appendingPathComponent("local")), song = try fixture.song("one")
        let work = Task { try await cache.cover(song, local: local, navidrome: fixture.client) }
        try await waitForStream { art.stats.sent > 0 }
        try await cache.clear(provider: "navidrome")
        do { _ = try await work.value; XCTFail("revoked cover") } catch {}
        let summary = await cache.summary(); XCTAssertEqual(summary["count"], 0)
        XCTAssertLessThan(art.stats.sent, image.bytes.count)
    }
    func testNavidromeCollectionArtworkCoalescesRestoresAndRejectsOldScope() async throws {
        let fixture = try NavidromePlaybackFixture(gateway: FailingGateway()); defer { fixture.close() }
        let image = try coverFixture(), art = fixture.route("getCoverArt", id: "album:one", body: image.bytes)
        art.headers = ["Content-Type": "image/png"]
        let root = fixture.root.appendingPathComponent("collection-covers")
        let cache = NativeCoverCache(root: root, configuration: fixture.configuration)
        let scope = try fixture.client.snapshot()["scope"] as! String
        async let first = cache.navidromeArtwork("album:one", scope: scope, client: fixture.client)
        async let second = cache.navidromeArtwork("album:one", scope: scope, client: fixture.client)
        let values = try await [first, second]
        XCTAssertEqual(values[0], values[1]); XCTAssertNotNil(UIImage(data: try XCTUnwrap(values[0])))
        XCTAssertEqual(art.stats.requests, 1)
        for url in fixture.urls { ProfileHTTPProtocol.remove(url) }
        let restored = NativeCoverCache(root: root, configuration: fixture.configuration)
        let hit = try await restored.navidromeArtwork("album:one", scope: scope, client: fixture.client)
        XCTAssertEqual(hit, values[0]); XCTAssertEqual(art.stats.requests, 1)
        try fixture.edit(["password": "changed"])
        do { _ = try await restored.navidromeArtwork("album:one", scope: scope, client: fixture.client); XCTFail("stale account cache") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "navidrome-settings-changed") }
    }
    func testNavidromeCollectionArtworkBridgeReturnsOnlyImageAndRejectsStaleAccount() async throws {
        guard Bundle.main.bundleIdentifier == "app.folia.validation.App" else { throw MobileFailure("qa-bundle-required") }
        let host = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).compactMap { $0.rootViewController as? CAPBridgeViewController }.first)
        let web = try XCTUnwrap(host.webView)
        try await waitForStream { !web.isLoading && web.url?.scheme == "capacitor" }
        let plugin = try XCTUnwrap(host.bridge?.plugin(withName: "FoliaNative") as? FoliaNativePlugin)
        try await waitForStream { plugin.navidrome != nil && plugin.engine != nil }
        let originalClient = plugin.navidrome, originalEngine = plugin.engine
        let fixture = try NavidromePlaybackFixture(gateway: FailingGateway())
        defer { plugin.navidrome = originalClient; plugin.engine = originalEngine; fixture.close() }
        plugin.navidrome = fixture.client; plugin.engine = fixture.player
        let image = try coverFixture(), art = fixture.route("getCoverArt", id: "album", body: image.bytes)
        art.headers = ["Content-Type": "image/png"]
        let scope = try fixture.client.snapshot()["scope"] as! String
        let result = try await web.callAsyncJavaScript("""
            const invoke = options => Capacitor.nativePromise('FoliaNative', 'navidromeArtwork', options);
            const image = await invoke({ id: 'album', scope });
            let invalid = '', stale = '';
            try { await invoke({ id: '', scope }); } catch(e) { invalid = e.message; }
            try { await invoke({ id: 'album', scope: 'old-account' }); } catch(e) { stale = e.message; }
            return { image, invalid, stale };
            """, arguments: ["scope": scope], in: nil, contentWorld: .page)
        let value = try XCTUnwrap(result as? [String: Any]), payload = try XCTUnwrap(value["image"] as? [String: Any])
        XCTAssertEqual(Set(payload.keys), ["url"])
        let uri = try XCTUnwrap(payload["url"] as? String)
        XCTAssertTrue(uri.hasPrefix("data:image/jpeg;base64,")); XCTAssertFalse(uri.contains("https:"))
        let bytes = try XCTUnwrap(Data(base64Encoded: String(uri.dropFirst("data:image/jpeg;base64,".count))))
        XCTAssertNotNil(UIImage(data: bytes)); XCTAssertEqual(art.stats.requests, 1)
        XCTAssertEqual(value["invalid"] as? String, "invalid-cover-identity")
        XCTAssertEqual(value["stale"] as? String, "navidrome-settings-changed")
    }
    func testNavidromeCollectionArtworkRejectsRedirectWithoutContactingTarget() async throws {
        let fixture = try NavidromePlaybackFixture(gateway: FailingGateway()); defer { fixture.close() }
        let targetFixture = try coverFixture(), target = ProfileHTTPProtocol.add(targetFixture)
        defer { ProfileHTTPProtocol.remove(target) }
        let art = fixture.route("getCoverArt", id: "redirect", body: Data([1]))
        art.redirect = target; art.completesDeclinedRedirect = true
        let cache = NativeCoverCache(root: fixture.root.appendingPathComponent("collection-covers"), configuration: fixture.configuration)
        let scope = try fixture.client.snapshot()["scope"] as! String
        do { _ = try await cache.navidromeArtwork("redirect", scope: scope, client: fixture.client); XCTFail("signed redirect accepted") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "cache-redirect-unavailable") }
        XCTAssertEqual(targetFixture.stats.requests, 0)
        XCTAssertNil(art.stats.first?.value(forHTTPHeaderField: "Authorization"))
        XCTAssertNil(art.stats.first?.value(forHTTPHeaderField: "Cookie"))
    }
    func testNavidromeCollectionArtworkClearAndDisableCannotPublishLateBytes() async throws {
        let fixture = try NavidromePlaybackFixture(gateway: FailingGateway()); defer { fixture.close() }
        for disable in [false, true] {
            let image = try coverFixture(padding: 300_000), art = fixture.route("getCoverArt", id: "slow", body: image.bytes)
            art.headers = ["Content-Type": "image/png"]; art.delay = 0.03
            let cache = NativeCoverCache(root: fixture.root.appendingPathComponent("collection-covers"), configuration: fixture.configuration)
            let scope = try fixture.client.snapshot()["scope"] as! String
            let task = Task { try await cache.navidromeArtwork("slow", scope: scope, client: fixture.client) }
            try await waitForStream { art.stats.sent > 0 }
            if disable { try fixture.edit(["enabled": false]) } else { try await cache.clear(provider: "navidrome") }
            do { _ = try await task.value; XCTFail("late artwork") } catch {}
            let summary = await cache.summary(); XCTAssertEqual(summary["count"], 0)
        }
    }
    func testNavidromeResourcesFeedNativeCurrentNextAndLockScreen() async throws {
        let gateway = FailingGateway(), fixture = try NavidromePlaybackFixture(gateway: gateway); defer { fixture.close() }
        let first = try resourceLyrics(fixture), next = try resourceLyrics(fixture, id: "next")
        _ = fixture.route("getSong", id: "one", body: try resourceBody(["song": ["id": "one", "coverArt": "art"]]))
        let image = try coverFixture(), art = fixture.route("getCoverArt", id: "art", body: image.bytes)
        art.headers = ["Content-Type": "image/png"]
        let engine = fixture.player!, songs = try [fixture.song("one"), fixture.song("next")]
        let lyrics = NativeLyrics(local: engine.local, gateway: gateway, cache: engine.lyricCache)
        engine.crossfade = NativeCrossfade(owner: engine, lyrics: lyrics)
        engine.connectNavidrome(fixture.client)
        engine.queue = songs; engine.index = 0; engine.intentToPlay = true; engine.repeatMode = "off"
        engine.publish()
        try await waitForStream { lyrics.value(songs[0]) != nil && lyrics.value(songs[1]) != nil && engine.artwork.image != nil }
        XCTAssertEqual(first.stats.requests, 1); XCTAssertEqual(next.stats.requests, 1); XCTAssertEqual(gateway.count, 0)
        XCTAssertEqual(lyrics.value(songs[0])?.first?["startTime"] as? Double, 1)
        try fixture.edit(["enabled": false])
        XCTAssertNil(lyrics.value(songs[0])); XCTAssertNil(lyrics.value(songs[1])); XCTAssertNil(engine.artwork.image)
        try await engine.mediaCachePurges["navidrome"]?.value
        let summary = await engine.lyricCache.summary(); XCTAssertEqual(summary["count"], 0)
    }
}
