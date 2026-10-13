import XCTest
import Capacitor
import WebKit
@testable import App

// OnlineLogoutIntegrationTests.swift — production JS and real native cleanup; only cancellation/network replies are injected.
@MainActor extension NativeTests {
    func testPackagedQQLogoutClearsNativeAccountQueueAndCaches() async throws {
        try await packagedLogout("qq", cancellationFails: false)
    }
    func testPackagedNetEaseLogoutClearsNativeAccountQueueAndCaches() async throws {
        try await packagedLogout("netease", cancellationFails: false)
    }
    func testPackagedQQLogoutSurvivesCancellationBridgeFailure() async throws {
        try await packagedLogout("qq", cancellationFails: true)
    }
    func testPackagedNetEaseLogoutSurvivesCancellationBridgeFailure() async throws {
        try await packagedLogout("netease", cancellationFails: true)
    }

    // Exercise the production session queue and native cleanup with isolated synthetic accounts.
    private func packagedLogout(_ provider: String, cancellationFails: Bool) async throws {
        #if !targetEnvironment(simulator)
        throw XCTSkip("Simulator-only isolated logout integration")
        #endif
        guard Bundle.main.bundleIdentifier == "app.folia.validation.App" else { throw MobileFailure("logout-qa-only") }
        let originalCredentials = try NativeGatewayStore.shared.snapshot()
        guard originalCredentials.server.isEmpty, originalCredentials.sessions.values.allSatisfy({ $0.isEmpty }) else {
            throw MobileFailure("logout-qa-credentials-not-empty")
        }
        let host = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).compactMap { $0.rootViewController as? CAPBridgeViewController }.first)
        let web = try XCTUnwrap(host.webView)
        try await waitForStream({ !web.isLoading && web.url?.scheme == "capacitor" }, seconds: 15)
        let plugin = try XCTUnwrap(host.bridge?.plugin(withName: "FoliaNative") as? FoliaNativePlugin)
        try await waitForStream { plugin.engine != nil }
        let script = try XCTUnwrap(Bundle.main.url(forResource: "online-session-qa", withExtension: "js", subdirectory: "public"),
            "Build and stage dev/mobile/build-online-session-qa.mjs into the independent QA app")
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let suite = "folia.logout-qa." + UUID().uuidString, defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let local = LocalMediaLibrary(root: root.appendingPathComponent("local"))
        let media = NativeMediaCache(directory: root.appendingPathComponent("media"), configuration: profileNetworkConfiguration(),
            settings: NativeMediaCacheSettings(enabled: true, limitGB: 1))
        let covers = NativeCoverCache(root: root.appendingPathComponent("covers"), configuration: profileNetworkConfiguration())
        let lyrics = NativeLyricCache(root: root.appendingPathComponent("lyrics"))
        let player = PlaybackEngine(gateway: FailingGateway(), storage: defaults, local: local,
            mediaCache: media, coverCache: covers, lyricCache: lyrics)
        let previous = plugin.engine
        previous?.stop(); previous?.network.cancel(); player.network.cancel(); plugin.engine = player
        defer {
            player.stop(); player.clearOutput(); player.libraryRefreshTask?.cancel(); plugin.engine = previous
            try? SecureStore.write("gateway.credentials", originalCredentials.dictionary())
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: root)
        }
        await player.libraryRefreshTask?.value
        _ = try await web.evaluateJavaScript(String(contentsOf: script, encoding: .utf8))
        _ = try await web.callAsyncJavaScript("""
            const cap = window.Capacitor;
            window.logoutOriginalBridge ??= cap.nativePromise.bind(cap);
            cap.nativePromise = window.logoutOriginalBridge;
            const initial = await cap.nativePromise('FoliaNative', 'bootstrap', {});
            for (const provider of ['qq', 'netease']) {
                await cap.nativePromise('FoliaNative', 'saveSession', {provider, scope: initial.scope, values: {cookie: 'synthetic-' + provider}});
            }
            await FoliaOnlineSessionQA.initializeRuntime();
            return true;
            """, arguments: [:], in: nil, contentWorld: .page)
        defer { web.evaluateJavaScript("window.Capacitor.nativePromise = window.logoutOriginalBridge") }

        let audio = try silentAudio(); defer { try? FileManager.default.removeItem(at: audio) }
        let audioFixture = ProfileHTTPFixture(try Data(contentsOf: audio)); audioFixture.status = 200
        let audioURL = ProfileHTTPProtocol.add(audioFixture), coverURL = ProfileHTTPProtocol.add(try coverFixture())
        defer { ProfileHTTPProtocol.remove(audioURL); ProfileHTTPProtocol.remove(coverURL) }
        let other = provider == "qq" ? "netease" : "qq"
        let target = try PlaybackEngine.sanitizedSong(coverSong(coverURL, provider: provider, id: "same-id"))
        let retained = try PlaybackEngine.sanitizedSong(coverSong(coverURL, provider: other, id: "same-id"))
        for track in [target, retained] {
            _ = try await media.store(XCTUnwrap(NativeProfileIdentity(track)), song: track, source: audioURL)
            _ = try await covers.cover(track, local: local)
            let snapshot = try await lyrics.read(track), token = try XCTUnwrap(snapshot["token"] as? String)
            try await lyrics.write(track, token: token, field: "lyrics", value: ["lines": [["startTime": 0, "endTime": 1,
                "fullText": "QA lyric", "words": []]]])
        }
        player.queue = [target, retained]; player.index = 0; player.persist()
        let result = try await web.callAsyncJavaScript("""
            const qa = FoliaOnlineSessionQA, port = qa.getMobileRuntime(), original = window.logoutOriginalBridge;
            const events = []; let releaseRequest, releaseSave, saveStarted;
            const started = new Promise(resolve => saveStarted = resolve);
            window.Capacitor.nativePromise = async (plugin, method, options) => {
                if (method === 'request') return await new Promise(resolve => releaseRequest = resolve);
                if (method === 'cancelRequests') { events.push('cancel'); if (cancellationFails) throw Error('cancel-bridge-failed'); }
                if (method === 'saveSession') { saveStarted(); await new Promise(resolve => releaseSave = resolve); }
                if (method === 'clearSession') events.push('clear');
                const value = await original(plugin, method, options);
                if (method === 'saveSession') events.push('saved');
                return value;
            };
            const pending = port.fetch('/mobile/' + provider + '/user/playlist').then(() => 'accepted', e => e.name);
            // Keep credentials unchanged so saveSession cannot clear lyrics ahead of logout.
            port.write(provider, 'cookie', 'synthetic-' + provider); await started;
            const logout = qa.clearProvider(provider).then(() => 'cleared', e => e.message);
            const blocked = !events.includes('clear');
            releaseSave(); const outcome = await logout;
            releaseRequest({status:200, headers:{}, body:'{}'}); const late = await pending;
            await qa.flushSessions();
            window.Capacitor.nativePromise = original;
            await qa.initializeRuntime();
            return {blocked, outcome, late, events, missing: qa.getMobileRuntime().read(provider,'cookie') === null,
                retained: qa.getMobileRuntime().read(other,'cookie') === 'synthetic-' + other};
            """, arguments: ["provider": provider, "other": other, "cancellationFails": cancellationFails], in: nil, contentWorld: .page)
        let values = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual(values["blocked"] as? Bool, true)
        XCTAssertEqual(values["outcome"] as? String, cancellationFails ? "cancel-bridge-failed" : "cleared")
        XCTAssertEqual(values["late"] as? String, "AbortError")
        XCTAssertEqual(values["events"] as? [String], ["cancel", "saved", "clear"])
        XCTAssertEqual(values["missing"] as? Bool, true); XCTAssertEqual(values["retained"] as? Bool, true)
        let reopened = try NativeGatewayStore().snapshot()
        XCTAssertNil(reopened.sessions[provider]); XCTAssertEqual(reopened.sessions[other]?["cookie"], "synthetic-" + other)
        XCTAssertEqual(player.queue.compactMap { NativeProfileIdentity($0)?.provider }, [other])
        XCTAssertNil(player.currentSong); XCTAssertFalse(player.intentToPlay)
        let removedAudio = try await media.cached(XCTUnwrap(NativeProfileIdentity(target)))
        let keptAudio = try await media.cached(XCTUnwrap(NativeProfileIdentity(retained)))
        XCTAssertNil(removedAudio); XCTAssertNotNil(keptAudio)
        let removedCover = try await covers.cover(target, local: local, allowNetwork: false)
        let keptCover = try await covers.cover(retained, local: local, allowNetwork: false)
        XCTAssertNil(removedCover); XCTAssertNotNil(keptCover)
        let removedLyrics = try await lyrics.read(target), keptLyrics = try await lyrics.read(retained)
        XCTAssertNil((removedLyrics["payload"] as? [String: Any])?["lyrics"])
        XCTAssertNotNil((keptLyrics["payload"] as? [String: Any])?["lyrics"])
        print("LOGOUT_QA \(provider) cancelFailure=\(cancellationFails): Keychain reopened; queue/media/cover/lyrics cleared only for target; late reply rejected")
    }
}
