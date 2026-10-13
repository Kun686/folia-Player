import XCTest
import AVFoundation
import UIKit
import Capacitor
import WebKit
@testable import App

// LaunchPlaybackTests.swift — opt-in restoration on real PCM; isolated defaults and no provider accounts.
@MainActor extension NativeTests {
    private func launchPlayer(_ gateway: GatewayClient, enabled: Bool? = true, detached: Bool = false,
                              active: @escaping () -> Bool = { true }, now: @escaping () -> Date = Date.init) throws -> PlaybackEngine {
        let suite = "folia.launch-qa-" + UUID().uuidString
        let storage = try XCTUnwrap(UserDefaults(suiteName: suite))
        addTeardownBlock { storage.removePersistentDomain(forName: suite) }
        var settings = NativeAudioSettings().dictionary
        settings["autoPlayOnLaunch"] = enabled
        settings["playbackFadeEnabled"] = false
        storage.set(try JSONSerialization.data(withJSONObject: settings), forKey: "folia.audio")
        let current = song("netease", "launch-current")
        storage.set(try JSONSerialization.data(withJSONObject: ["queue": detached ? [] : [song("qq", "launch-before"), current],
            "index": detached ? -1 : 1, "currentSong": current, "position": 6.0, "repeat": "off"]), forKey: "folia.queue")
        let player = PlaybackEngine(gateway: gateway, storage: storage, usesStereoOutput: true,
            sleepTimer: NativeSleepTimer(storage: storage, now: now), launchIsActive: active)
        player.network.cancel()
        addTeardownBlock { @MainActor in player.stop(); player.clearOutput(); player.libraryRefreshTask?.cancel() }
        return player
    }

    func testLaunchPlaybackLegacyDefaultsAndSettingsAreAtomic() async throws {
        let gateway = FailingGateway(), player = try launchPlayer(gateway, enabled: nil)
        await player.libraryRefreshTask?.value
        player.prepareLaunchPlayback()
        XCTAssertFalse(player.audioSettings.autoPlayOnLaunch); XCTAssertFalse(player.intentToPlay)
        XCTAssertEqual(player.restoredPosition, 6); XCTAssertEqual(gateway.count, 0)
        var settings = player.audioSettings.dictionary; settings["autoPlayOnLaunch"] = true
        _ = try player.setAudioSettings(settings)
        player.prepareLaunchPlayback(); player.resumeLaunchPlaybackIfReady()
        XCTAssertFalse(player.intentToPlay, "Enabling a preference must not start audio in the current run")
        let saved = try XCTUnwrap(player.storage.data(forKey: "folia.audio"))
        XCTAssertTrue(try JSONDecoder().decode(NativeAudioSettings.self, from: saved).autoPlayOnLaunch)
        for invalid in ["true", 1, [true]] as [Any] {
            settings["autoPlayOnLaunch"] = invalid
            XCTAssertThrowsError(try player.setAudioSettings(settings))
            XCTAssertEqual(player.storage.data(forKey: "folia.audio"), saved)
            XCTAssertTrue(player.audioSettings.autoPlayOnLaunch)
        }
    }

    func testLaunchPlaybackRestoresOccurrenceAndPositionWithRealPCMOnce() async throws {
        let source = try streamingTone(); defer { try? FileManager.default.removeItem(at: source) }
        let gateway = AudioFixtureGateway(url: source), player = try launchPlayer(gateway)
        player.prepareLaunchPlayback()
        try await waitForStream { player.outputIsPlaying && player.playbackPosition >= 6 }
        XCTAssertEqual(player.index, 1); XCTAssertEqual(gateway.resolved, ["launch-current"])
        XCTAssertLessThan(player.playbackPosition, 8)
        let output = try XCTUnwrap(player.streamOutput), measurement = OutputMeasurement()
        output.engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { buffer, _ in measurement.consume(buffer) }
        defer { output.engine.mainMixerNode.removeTap(onBus: 0) }
        try await waitForStream { measurement.read().rms > 0.005 }
        try player.command("pause")
        for _ in 0..<3 {
            player.prepareLaunchPlayback(); player.resumeLaunchPlaybackIfReady()
            NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        }
        await Task.yield()
        XCTAssertFalse(player.intentToPlay); XCTAssertFalse(player.outputIsPlaying)
        XCTAssertEqual(gateway.resolved, ["launch-current"])
        print("LAUNCH_QA restored index=1 position>=6 real PCM rms=\(measurement.read().rms); foreground never replays")
    }

    func testLaunchPlaybackDetachedOccurrenceRestoresWithoutRebuildingQueue() async throws {
        let source = try streamingTone(); defer { try? FileManager.default.removeItem(at: source) }
        let gateway = AudioFixtureGateway(url: source), player = try launchPlayer(gateway, detached: true)
        player.prepareLaunchPlayback()
        try await waitForStream { player.outputIsPlaying && player.playbackPosition >= 6 }
        XCTAssertEqual(player.index, -1); XCTAssertTrue(player.queue.isEmpty)
        XCTAssertEqual(player.currentSong?["name"] as? String, "launch-current")
        XCTAssertEqual(gateway.resolved, ["launch-current"])
    }

    func testLaunchPlaybackWaitsForLibraryAndForegroundBeforeResolving() async throws {
        var active = false
        let gateway = FailingGateway(), player = try launchPlayer(gateway, active: { active })
        player.prepareLaunchPlayback()
        XCTAssertEqual(player.launchResume, .pending); XCTAssertEqual(gateway.count, 0)
        await player.libraryRefreshTask?.value
        XCTAssertTrue(player.launchLibraryReady); XCTAssertEqual(gateway.count, 0)
        // Also exercise the opposite ordering: active before library completion.
        player.launchLibraryReady = false; active = true; player.resumeLaunchPlaybackIfReady()
        XCTAssertEqual(gateway.count, 0); XCTAssertFalse(player.intentToPlay)
        player.launchLibraryReady = true; player.resumeLaunchPlaybackIfReady()
        try await waitForStream { gateway.count > 0 }
        XCTAssertEqual(player.launchResume, .finished)
    }

    func testLaunchPlaybackExplicitPauseDisableLogoutAndSystemEventsCancelPendingIntent() async throws {
        for reason in ["pause", "disable", "logout", "interruption", "route", "stop"] {
            var active = false
            let gateway = FailingGateway(), player = try launchPlayer(gateway, active: { active })
            player.prepareLaunchPlayback(); await player.libraryRefreshTask?.value
            switch reason {
            case "pause": try player.command("pause")
            case "disable":
                var settings = player.audioSettings.dictionary; settings["autoPlayOnLaunch"] = false
                _ = try player.setAudioSettings(settings)
            case "logout": player.invalidateProvider("netease")
            case "interruption": NotificationCenter.default.post(name: AVAudioSession.interruptionNotification, object: nil,
                userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.began.rawValue])
            case "route": NotificationCenter.default.post(name: AVAudioSession.routeChangeNotification, object: nil,
                userInfo: [AVAudioSessionRouteChangeReasonKey: AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue])
            default: player.stop()
            }
            active = true; player.prepareLaunchPlayback(); player.resumeLaunchPlaybackIfReady()
            XCTAssertEqual(player.launchResume, .finished, reason)
            XCTAssertFalse(player.intentToPlay, reason); XCTAssertEqual(gateway.count, 0, reason)
        }
    }

    func testLaunchPlaybackManualSelectionWinsOverRestoredIntent() async throws {
        var active = false
        let source = try streamingTone(); defer { try? FileManager.default.removeItem(at: source) }
        let gateway = AudioFixtureGateway(url: source), player = try launchPlayer(gateway, active: { active })
        player.prepareLaunchPlayback(); await player.libraryRefreshTask?.value
        try player.selectQueue(0, expectedRevision: player.queueRevision)
        try await waitForStream { player.outputIsPlaying }
        active = true; player.resumeLaunchPlaybackIfReady()
        XCTAssertEqual(player.index, 0); XCTAssertEqual(player.launchResume, .finished)
        XCTAssertLessThan(player.playbackPosition, 3)
        XCTAssertEqual(gateway.resolved.first, "launch-before")
    }

    func testLaunchPlaybackAuthFailureDoesNotRetryOnForegroundAndEmptyQueueDoesNotStart() async throws {
        let gateway = FailingGateway(); gateway.code = "auth-required"
        let player = try launchPlayer(gateway)
        player.prepareLaunchPlayback()
        try await waitForStream { player.error == "auth-required" }
        player.prepareLaunchPlayback(); player.resumeLaunchPlaybackIfReady()
        NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        await Task.yield()
        XCTAssertEqual(gateway.count, 1); XCTAssertEqual(player.index, 1); XCTAssertFalse(player.intentToPlay)
        let empty = try launchPlayer(gateway)
        empty.queue = []; empty.detachedSong = nil
        empty.prepareLaunchPlayback(); await empty.libraryRefreshTask?.value
        XCTAssertFalse(empty.intentToPlay); XCTAssertEqual(gateway.count, 1)
    }

    func testLaunchPlaybackSleepExpiryCancelsDeferredResume() async throws {
        var now = Date(timeIntervalSince1970: 1000), active = false
        let player = try launchPlayer(FailingGateway(), active: { active }, now: { now })
        player.prepareLaunchPlayback(); await player.libraryRefreshTask?.value
        _ = try player.sleepTimer.apply(["minutes": 1, "enabled": true]); now.addTimeInterval(61)
        active = true; player.resumeLaunchPlaybackIfReady()
        XCTAssertFalse(player.intentToPlay); XCTAssertEqual(player.launchResume, .finished)
    }

    func testPackagedLaunchPreferenceUsesNativeAuthorityWithoutStartingAudio() async throws {
        guard Bundle.main.bundleIdentifier == "app.folia.validation.App" else { throw MobileFailure("launch-qa-only") }
        let gateway = try NativeGatewayStore.shared.snapshot()
        guard gateway.server.isEmpty, gateway.sessions.values.allSatisfy({ $0.isEmpty }) else { throw MobileFailure("launch-qa-gateway-not-empty") }
        let host = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).compactMap { $0.rootViewController as? CAPBridgeViewController }.first)
        let web = try XCTUnwrap(host.webView)
        try await waitForStream({ !web.isLoading && web.url?.scheme == "capacitor" }, seconds: 15)
        let plugin = try XCTUnwrap(host.bridge?.plugin(withName: "FoliaNative") as? FoliaNativePlugin)
        try await waitForStream { plugin.engine != nil }
        let player = try XCTUnwrap(plugin.engine), saved = player.audioSettings.dictionary
        defer { player.stop(); player.clearOutput(); _ = try? player.setAudioSettings(saved); web.loadHTMLString("<body>QA complete</body>", baseURL: nil) }
        player.stop(); player.network.cancel()
        _ = try player.setAudioSettings(NativeAudioSettings().dictionary)
        player.queue = [try PlaybackEngine.sanitizedSong(song("qq", "launch-qa"))]
        player.index = 0; player.persist(); player.publish()
        func js(_ script: String) async throws -> Any? {
            try await web.callAsyncJavaScript(script, arguments: [:], in: nil, contentWorld: .page)
        }
        func ready(_ condition: String) async throws {
            for _ in 0..<150 {
                if (try? await js("return " + condition)) as? Bool == true { return }
                try await Task.sleep(for: .milliseconds(50))
            }
            print("LAUNCH_QA timeout waiting for \(condition)")
            throw MobileFailure("launch-qa-page-timeout")
        }
        // No provider request is needed: restore a paused identity into the real packaged UI.
        web.load(URLRequest(url: try XCTUnwrap(URL(string: "capacitor://localhost/mobile.html"))))
        try await ready("!!document.querySelector('.launch-playback-preference input:not(:disabled)')")
        _ = try await js("document.querySelector('.launch-playback-preference input').click(); return true;")
        try await waitForStream { player.audioSettings.autoPlayOnLaunch }
        XCTAssertFalse(player.intentToPlay)
        _ = try await js("window.launchOldDocument=true; localStorage.setItem('folia_auto_play_on_launch','false'); return true;")
        web.reload()
        try await ready("!window.launchOldDocument && !!document.querySelector('.launch-playback-preference input:checked:not(:disabled)')")
        XCTAssertFalse(player.intentToPlay)
        _ = try await js("document.querySelector('.launch-playback-preference input').click(); return true;")
        try await waitForStream { !player.audioSettings.autoPlayOnLaunch }
        XCTAssertFalse(player.intentToPlay)
        print("LAUNCH_QA packaged checkbox saves native state, survives stale WebView state and reload; no automatic UI play command")
    }
}
