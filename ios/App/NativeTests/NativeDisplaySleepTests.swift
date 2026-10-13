import XCTest
import UIKit
import Capacitor
import WebKit
@testable import App

// NativeDisplaySleepTests.swift — real UIKit timer, isolated defaults, synthetic lifecycle and packaged React.
@MainActor extension NativeTests {
    private func displaySleepQAGuard() throws {
        guard Bundle.main.bundleIdentifier == "app.folia.validation.App" else { throw MobileFailure("display-sleep-qa-only") }
        let gateway = try NativeGatewayStore.shared.snapshot()
        guard gateway.server.isEmpty, gateway.sessions.values.allSatisfy({ $0.isEmpty }) else { throw MobileFailure("display-sleep-qa-gateway-not-empty") }
    }
    func testDisplaySleepDefaultPersistenceAndForegroundPlaybackPolicy() throws {
        try displaySleepQAGuard()
        let suite = "display-sleep-qa-" + UUID().uuidString, center = NotificationCenter()
        let storage = try XCTUnwrap(UserDefaults(suiteName: suite)); defer { storage.removePersistentDomain(forName: suite) }
        var playing = false, active = true
        let sleep = NativeDisplaySleep(storage: storage, center: center, isApplicationActive: { active }, isPlaying: { playing })
        defer { sleep.stop() }
        XCTAssertFalse(sleep.enabled); XCTAssertFalse(UIApplication.shared.isIdleTimerDisabled)
        playing = true; sleep.refresh(); XCTAssertFalse(UIApplication.shared.isIdleTimerDisabled)
        sleep.setEnabled(true); XCTAssertTrue(UIApplication.shared.isIdleTimerDisabled)
        for _ in 0..<10 { sleep.refresh() }; XCTAssertTrue(UIApplication.shared.isIdleTimerDisabled)
        // willResign arrives before applicationState necessarily changes; later playback ticks cannot re-acquire.
        center.post(name: UIApplication.willResignActiveNotification, object: nil)
        sleep.refresh(); XCTAssertFalse(UIApplication.shared.isIdleTimerDisabled)
        active = false; center.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
        sleep.setEnabled(true); XCTAssertFalse(UIApplication.shared.isIdleTimerDisabled)
        playing = false; active = true; center.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        XCTAssertFalse(UIApplication.shared.isIdleTimerDisabled)
        playing = true; sleep.refresh(); XCTAssertTrue(UIApplication.shared.isIdleTimerDisabled)
        sleep.setEnabled(false); XCTAssertFalse(UIApplication.shared.isIdleTimerDisabled)
        sleep.setEnabled(true); sleep.stop(); XCTAssertFalse(UIApplication.shared.isIdleTimerDisabled)
        playing = false
        let restored = NativeDisplaySleep(storage: storage, center: center, isApplicationActive: { active }, isPlaying: { playing })
        defer { restored.stop() }
        XCTAssertTrue(restored.enabled); XCTAssertFalse(UIApplication.shared.isIdleTimerDisabled)
        playing = true; restored.refresh(); XCTAssertTrue(UIApplication.shared.isIdleTimerDisabled)
        center.post(name: UIApplication.willTerminateNotification, object: nil)
        XCTAssertFalse(UIApplication.shared.isIdleTimerDisabled)
    }
    func testDisplaySleepDeallocationCannotReleaseReplacementOwner() async throws {
        try displaySleepQAGuard()
        let suite = "display-sleep-qa-" + UUID().uuidString, center = NotificationCenter()
        let storage = try XCTUnwrap(UserDefaults(suiteName: suite)); defer { storage.removePersistentDomain(forName: suite) }
        storage.set(true, forKey: NativeDisplaySleep.storageKey)
        var old: NativeDisplaySleep? = NativeDisplaySleep(storage: storage, center: center, isApplicationActive: { true }, isPlaying: { true })
        XCTAssertTrue(try XCTUnwrap(old).enabled)
        old = nil
        let replacement = NativeDisplaySleep(storage: storage, center: center, isApplicationActive: { true }, isPlaying: { true })
        defer { replacement.stop() }
        await Task.yield()
        XCTAssertTrue(UIApplication.shared.isIdleTimerDisabled)
        replacement.stop(); center.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        XCTAssertFalse(UIApplication.shared.isIdleTimerDisabled)
        var last: NativeDisplaySleep? = NativeDisplaySleep(storage: storage, center: center, isApplicationActive: { true }, isPlaying: { true })
        XCTAssertTrue(try XCTUnwrap(last).enabled); last = nil
        try await waitForStream { !UIApplication.shared.isIdleTimerDisabled }
        center.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        XCTAssertFalse(UIApplication.shared.isIdleTimerDisabled)
    }
    private func displaySleepJS(_ web: WKWebView, _ script: String) async throws -> Any? {
        try await web.callAsyncJavaScript(script, arguments: [:], in: nil, contentWorld: .page)
    }
    private func displaySleepReady(_ web: WKWebView, _ condition: String) async throws {
        for _ in 0..<150 {
            if (try? await displaySleepJS(web, "return " + condition)) as? Bool == true { return }
            try await Task.sleep(for: .milliseconds(50))
        }
        print("DISPLAY_SLEEP_QA timeout waiting for \(condition)")
        throw MobileFailure("display-sleep-qa-timeout")
    }
    func testPackagedDisplaySleepPreferenceTracksRealPlaybackAndRestores() async throws {
        try displaySleepQAGuard()
        let host = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).compactMap { $0.rootViewController as? CAPBridgeViewController }.first)
        let web = try XCTUnwrap(host.webView)
        try await waitForStream({ !web.isLoading && web.url?.scheme == "capacitor" }, seconds: 15)
        let plugin = try XCTUnwrap(host.bridge?.plugin(withName: "FoliaNative") as? FoliaNativePlugin)
        try await waitForStream { plugin.engine != nil && plugin.displaySleep != nil }
        let player = try XCTUnwrap(plugin.engine), sleep = try XCTUnwrap(plugin.displaySleep)
        let saved = sleep.enabled
        defer { player.stop(); sleep.setEnabled(saved); player.clearOutput(); web.loadHTMLString("<body>QA complete</body>", baseURL: nil) }
        player.stop(); player.network.cancel(); sleep.setEnabled(false)
        let originalEmit = player.emit
        player.emit = { state in XCTAssertTrue(Thread.isMainThread, "local refresh/playback published off main"); originalEmit?(state) }
        defer { player.emit = originalEmit }
        _ = try await player.refreshLocalLibrary()
        _ = try player.setAudioSettings(NativeAudioSettings().dictionary)
        _ = try player.setTransitionSettings(["enabled": false, "mode": "crossfade", "crossfadeMaxSec": 5, "performance": false])
        _ = try await displaySleepJS(web, "localStorage.setItem('auto_use_best_lyric','false'); localStorage.setItem('song_theme_auto_generate_enabled','false'); localStorage.setItem('video_layer_enabled','false'); return true;")
        let source = try streamingTone(); defer { try? FileManager.default.removeItem(at: source) }
        let song = try await player.local.importAudio(source), id = try XCTUnwrap(song["id"] as? String)
        addTeardownBlock { @MainActor in try await player.local.remove(id) }
        web.load(URLRequest(url: try XCTUnwrap(URL(string: "capacitor://localhost/mobile.html"))))
        try await displaySleepReady(web, "!!document.querySelector('.mobile-app')")
        _ = try await displaySleepJS(web, "document.querySelector('.brand button').click(); return true;")
        try await displaySleepReady(web, "!!document.querySelector('.display-sleep-preference input:not(:disabled)')")
        let invalid = try await displaySleepJS(web, "try { await Capacitor.Plugins.FoliaNative.setDisplaySleepSettings({}); return 'unexpected'; } catch(e) { return e.message; }")
        XCTAssertEqual(invalid as? String, "invalid-display-sleep-settings")
        _ = try await displaySleepJS(web, "document.querySelector('.display-sleep-preference input').click(); return true;")
        try await waitForStream { sleep.enabled }
        XCTAssertFalse(UIApplication.shared.isIdleTimerDisabled)
        try player.setQueue([song], at: 0)
        try await waitForStream { player.outputIsPlaying && UIApplication.shared.isIdleTimerDisabled }
        let output = try XCTUnwrap(player.streamOutput), measured = OutputMeasurement()
        output.engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { buffer, _ in measured.consume(buffer) }
        defer { output.engine.mainMixerNode.removeTap(onBus: 0) }
        _ = try await displaySleepJS(web, "document.querySelector('.display-sleep-preference').closest('[role=dialog]').querySelector('header button').click(); return true;")
        try await displaySleepReady(web, "!document.querySelector('.display-sleep-preference')")
        try await waitForStream { measured.read().rms > 0.005 && player.playbackPosition > 0.2 }
        XCTAssertTrue(UIApplication.shared.isIdleTimerDisabled)
        try player.command("pause")
        try await waitForStream { !UIApplication.shared.isIdleTimerDisabled }
        try player.command("play")
        try await waitForStream { UIApplication.shared.isIdleTimerDisabled }
        NotificationCenter.default.post(name: UIApplication.willResignActiveNotification, object: nil)
        player.publish(); XCTAssertFalse(UIApplication.shared.isIdleTimerDisabled); XCTAssertTrue(player.outputIsPlaying)
        NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        try await waitForStream { UIApplication.shared.isIdleTimerDisabled }
        // Rebuild the real React page without changing the native player or preference.
        _ = try await displaySleepJS(web, "window.displaySleepOldDocument=true; return true;")
        web.reload(); try await displaySleepReady(web, "!window.displaySleepOldDocument && !!document.querySelector('.mobile-app')")
        _ = try await displaySleepJS(web, "document.querySelector('.brand button').click(); return true;")
        try await displaySleepReady(web, "!!document.querySelector('.display-sleep-preference input:checked:not(:disabled)')")
        _ = try await displaySleepJS(web, "document.querySelector('.display-sleep-preference input').click(); return true;")
        try await waitForStream { !sleep.enabled && !UIApplication.shared.isIdleTimerDisabled }
        XCTAssertTrue(player.outputIsPlaying); XCTAssertNil(player.error)
        print("DISPLAY_SLEEP_QA packaged setting, real PCM, pause/resume, synthetic lifecycle, WebView reload passed; rms=\(measured.read().rms)")
    }
}
