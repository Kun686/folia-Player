import XCTest
import Capacitor
import AVFoundation
import WebKit
@testable import App

// LiveSettingsAcceptanceTests.swift — opt-in real playback; the operator changes only the production UI.
@MainActor extension NativeTests {
    func testSignedInPlaybackContinuesThroughLiveSettings() async throws {
        guard ProcessInfo.processInfo.environment["FOLIA_LIVE_SETTINGS_QA"] == "1" else {
            throw XCTSkip("Requires the authorized signed-in independent simulator and operator UI changes")
        }
        #if !targetEnvironment(simulator)
        throw XCTSkip("Restricted to the independent simulator app")
        #endif
        guard Bundle.main.bundleIdentifier == "app.folia.validation.App" else { throw MobileFailure("live-qa-identity") }
        let credentials = try NativeGatewayStore.shared.snapshot()
        guard !credentials.server.isEmpty, !credentials.token.isEmpty,
              ["qq", "netease"].allSatisfy({ credentials.sessions[$0]?.isEmpty == false }) else {
            throw MobileFailure("live-qa-requires-both-sessions")
        }
        let controller = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).compactMap { $0.rootViewController as? CAPBridgeViewController }.first)
        let web = try XCTUnwrap(controller.webView)
        let plugin = try XCTUnwrap(controller.bridge?.plugin(withName: "FoliaNative") as? FoliaNativePlugin)
        try await waitForStream({ plugin.engine != nil && !web.isLoading }, seconds: 15)
        let player = try XCTUnwrap(plugin.engine), page = try XCTUnwrap(web.url)
        guard page.scheme == "capacitor", page.host == "localhost", page.query == nil,
              ["", "/", "/index.html"].contains(page.path), controller.bridge?.config.appStartPath == nil,
              type(of: player.gateway) == GatewayClient.self else { throw MobileFailure("live-qa-production-page-required") }
        guard !player.intentToPlay, !player.outputIsPlaying else { throw MobileFailure("live-qa-pause-original-first") }
        let originalQueue = try JSONSerialization.data(withJSONObject: player.queue, options: [.sortedKeys])
        let originalIndex = player.index, originalPosition = player.playbackPosition
        player.persist()
        let savedQueue = try XCTUnwrap(player.storage.data(forKey: "folia.queue"))
        let targets = try ["qq", "netease"].map { provider in
            try XCTUnwrap(player.queue.indices.first { index in
                let ref = player.queue[index]["sourceRef"] as? [String: Any]
                return ref?["providerId"] as? String == provider &&
                    (provider != "qq" || index == originalIndex)
            }, "Use the current real QQ song and an existing NetEase queue entry")
        }
        try await jointUIReady(web, condition: "!!document.querySelector('.mini-title')")
        let modeValue = try await jointJS(web, "localStorage.getItem('visualizer_mode')")
        let originalMode = try XCTUnwrap(modeValue as? String)
        var samples: [[String: Any]] = [], states: [[String: Any]] = []
        // Stop and restore the precise paused identity/position even if a network or UI check fails.
        func restorePlayback() {
            player.stop(); player.clearOutput()
            player.storage.set(savedQueue, forKey: "folia.queue"); player.restore(); player.persist(); player.publish()
        }
        defer {
            restorePlayback()
            if let data = try? JSONSerialization.data(withJSONObject: ["samples": samples, "states": states,
                "source": "existing-signed-in-queue", "physicalDevice": false, "longRunAcceptance": false], options: [.prettyPrinted, .sortedKeys]) {
                let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                attachment.name = "live-settings-pcm"; attachment.lifetime = .keepAlways; add(attachment)
            }
        }
        print("FOLIA_LIVE_SETTINGS READY_OPEN_PANEL: open current player, then its visual settings")
        for tick in 0..<45 {
            let view = try await liveSettingsState(web)
            if view["visible"] as? Bool == true { break }
            if tick % 10 == 0 { print("FOLIA_LIVE_SETTINGS waiting-for-panel \(tick)s") }
            try await Task.sleep(for: .seconds(1))
        }
        let initialView = try await liveSettingsState(web)
        guard initialView["visible"] as? Bool == true else { throw MobileFailure("live-qa-panel-not-open") }
        for (ordinal, target) in targets.enumerated() {
            let mode = ordinal == 0 ? "monet" : "classic"
            let provider = ordinal == 0 ? "qq" : "netease"
            try player.command("pause"); player.select(target, position: 30); try player.command("play")
            try await waitForStream({ player.index == target && player.outputIsPlaying && player.playbackPosition >= 30 }, seconds: 25)
            let output = try XCTUnwrap(player.streamOutput), audio = OutputMeasurement()
            output.engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { buffer, _ in audio.consume(buffer) }
            defer { output.engine.mainMixerNode.removeTap(onBus: 0) }
            print("FOLIA_LIVE_SETTINGS provider=\(provider) CHANGE_MODE=\(mode)")
            var readyWindows = 0
            for window in 0..<45 {
                audio.reset(); let start = player.playbackPosition
                try await Task.sleep(for: .seconds(1))
                let pcm = audio.read(), view = try await liveSettingsState(web)
                let advance = player.playbackPosition - start
                samples.append(["provider": provider, "window": window, "frames": pcm.frames, "channels": pcm.channels,
                    "rms": pcm.rms, "advance": advance, "playing": player.outputIsPlaying,
                    "mode": view["mode"] ?? "", "panelVisible": view["visible"] ?? false])
                XCTAssertEqual(player.index, target); XCTAssertTrue(player.outputIsPlaying); XCTAssertNil(player.error)
                XCTAssertGreaterThan(advance, 0.25); XCTAssertGreaterThan(pcm.frames, 1000)
                XCTAssertEqual(pcm.channels, 2); XCTAssertTrue(pcm.rms.isFinite && pcm.rms > 0.00001)
                let rendered = view[mode == "monet" ? "monet" : "classic"] as? Bool == true
                if view["mode"] as? String == mode && rendered && view["visible"] as? Bool == true {
                    readyWindows += 1
                } else { readyWindows = 0 }
                if window % 5 == 0 { print("FOLIA_LIVE_SETTINGS provider=\(provider) window=\(window) renderedWindows=\(readyWindows)") }
                if readyWindows >= 6 { states.append(view); break }
            }
            XCTAssertGreaterThanOrEqual(readyWindows, 6, "Real playback and the chosen renderer must coexist behind the open panel")
            let snapshot = XCTAttachment(image: try await web.takeSnapshot(configuration: nil))
            snapshot.name = "live-settings-\(provider)-\(mode)"; snapshot.lifetime = .keepAlways; add(snapshot)
            try player.command("pause")
        }
        print("FOLIA_LIVE_SETTINGS RESTORE_MODE=\(originalMode)")
        for tick in 0..<40 {
            let view = try await liveSettingsState(web)
            if view["mode"] as? String == originalMode { break }
            if tick % 10 == 0 { print("FOLIA_LIVE_SETTINGS waiting-for-mode-restore \(tick)s") }
            try await Task.sleep(for: .seconds(1))
        }
        let finalView = try await liveSettingsState(web)
        XCTAssertEqual(finalView["mode"] as? String, originalMode)
        restorePlayback()
        XCTAssertEqual(player.index, originalIndex); XCTAssertEqual(player.playbackPosition, originalPosition, accuracy: 0.001)
        XCTAssertFalse(player.outputIsPlaying)
        XCTAssertTrue(try JSONSerialization.data(withJSONObject: player.queue, options: [.sortedKeys]) == originalQueue)
        let after = try NativeGatewayStore.shared.snapshot()
        XCTAssertTrue(after.server == credentials.server && after.token == credentials.token && after.sessions == credentials.sessions)
    }

    private func liveSettingsState(_ web: WKWebView) async throws -> [String: Any] {
        let result = try await jointJS(web, liveSettingsView)
        return try XCTUnwrap(result as? [String: Any])
    }
}

// Read the actual renderer and settings surface only; no UI clicks, fixture data or storage writes.
private let liveSettingsView = #"""
(() => {
  const panel=document.querySelector('.live-settings-host:not([hidden]) .visual-settings');
  const scene=document.querySelector('.lyric-stage [data-viewport-composition=scene]');
  const rect=panel?.getBoundingClientRect();
  return {visible:!!rect&&rect.width>0&&rect.height>0,mode:localStorage.getItem('visualizer_mode'),
    monet:!!scene?.querySelector('[data-monet-title]'),classic:!!scene?.querySelector('.inline-block.origin-center'),
    width:rect?.width??0,height:rect?.height??0,viewport:[innerWidth,innerHeight],hidden:document.hidden};
})()
"""#
