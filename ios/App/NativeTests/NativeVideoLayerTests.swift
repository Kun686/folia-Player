import XCTest
import Capacitor
import WebKit
import MediaPlayer
@testable import App

// NativeVideoLayerTests.swift — packaged React video and real native PCM run together in an offline QA container.
@MainActor extension NativeTests {
    private func videoJS(_ web: WKWebView, _ script: String) async throws -> Any? {
        try await web.callAsyncJavaScript(script, arguments: [:], in: nil, contentWorld: .page)
    }
    private func videoReady(_ web: WKWebView, _ condition: String) async throws {
        for _ in 0..<150 {
            if (try? await videoJS(web, "return " + condition)) as? Bool == true { return }
            try await Task.sleep(for: .milliseconds(50))
        }
        throw MobileFailure("video-qa-timeout")
    }
    func testPackagedVideoLayerFollowsNativePlaybackWithoutInterruptingPCM() async throws {
        XCTAssertEqual(Bundle.main.bundleIdentifier, "app.folia.validation.App")
        let gateway = try NativeGatewayStore.shared.snapshot()
        guard gateway.server.isEmpty, gateway.sessions.values.allSatisfy({ $0.isEmpty }) else {
            throw MobileFailure("video-qa-gateway-not-empty")
        }
        let controller = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).compactMap { $0.rootViewController as? CAPBridgeViewController }.first)
        let web = try XCTUnwrap(controller.webView)
        try await waitForStream({ !web.isLoading && web.url?.scheme == "capacitor" }, seconds: 15)
        let plugin = try XCTUnwrap(controller.bridge?.plugin(withName: "FoliaNative") as? FoliaNativePlugin)
        try await waitForStream { plugin.engine != nil }
        let player = try XCTUnwrap(plugin.engine)
        player.stop(); player.network.cancel()
        _ = try player.setAudioSettings(NativeAudioSettings().dictionary)
        _ = try player.setTransitionSettings(["enabled": false, "mode": "crossfade", "crossfadeMaxSec": 5, "performance": false])
        _ = try await videoJS(web, """
          localStorage.setItem('video_layer_enabled', 'true');
          localStorage.setItem('video_layer_url', 'capacitor://localhost/video-layer.mp4');
          localStorage.setItem('visualizer_mode', 'classic');
          localStorage.setItem('auto_use_best_lyric', 'false');
          localStorage.setItem('song_theme_auto_generate_enabled', 'false');
          return true;
          """)
        let source = try streamingTone()
        defer { try? FileManager.default.removeItem(at: source) }
        let song = try await player.local.importAudio(source), id = try XCTUnwrap(song["id"] as? String)
        addTeardownBlock { @MainActor in try await player.local.remove(id) }
        defer { player.stop(); player.clearOutput(); web.loadHTMLString("<!doctype html><body>QA complete</body>", baseURL: nil) }
        web.load(URLRequest(url: try XCTUnwrap(URL(string: "capacitor://localhost/mobile.html"))))
        try await videoReady(web, "!!document.querySelector('.mobile-app')")
        try player.setQueue([song], at: 0)
        try await waitForStream { player.outputIsPlaying && player.playbackPosition > 0.1 }
        _ = try await videoJS(web, "document.querySelector('.mini-title').click(); return true;")
        try await videoReady(web, "(() => { const v=document.querySelector('.lyric-stage video'); return !!v && v.readyState >= 2 && !v.paused; })()")
        let output = try XCTUnwrap(player.streamOutput), measured = OutputMeasurement()
        output.engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { buffer, _ in measured.consume(buffer) }
        defer { output.engine.mainMixerNode.removeTap(onBus: 0) }
        try await waitForStream { measured.read().rms > 0.005 }
        let before = player.playbackPosition
        try await Task.sleep(for: .milliseconds(500))
        XCTAssertTrue(player.outputIsPlaying); XCTAssertGreaterThan(player.playbackPosition, before + 0.2)
        XCTAssertGreaterThan(measured.read().frames, 4000)
        XCTAssertEqual(MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyTitle] as? String, song["name"] as? String)
        let properties = try await videoJS(web, "const v=document.querySelector('.lyric-stage video'); return {muted:v.muted, inline:v.playsInline, duration:v.duration};")
        let values = try XCTUnwrap(properties as? [String: Any])
        XCTAssertEqual(values["muted"] as? Bool, true); XCTAssertEqual(values["inline"] as? Bool, true)
        XCTAssertEqual(try XCTUnwrap(values["duration"] as? Double), 4, accuracy: 0.1)
        try player.command("pause"); try player.command("seek", position: 10.5)
        try await videoReady(web, "(() => { const v=document.querySelector('.lyric-stage video'); return !!v && v.paused && Math.abs(v.currentTime - 10.5 % v.duration) < 0.36; })()")
        try player.command("play")
        try await videoReady(web, "!!document.querySelector('.lyric-stage video') && !document.querySelector('.lyric-stage video').paused")
        XCTAssertTrue(player.outputIsPlaying)
        // Collapse is an actual React action and must release the WebKit decoder while music continues.
        _ = try await videoJS(web, "window.savedVideo=document.querySelector('.lyric-stage video'); document.querySelector('.player-collapse').click(); return true;")
        try await videoReady(web, "!document.querySelector('.lyric-stage video') && window.savedVideo.paused && !window.savedVideo.getAttribute('src')")
        XCTAssertTrue(player.outputIsPlaying); XCTAssertNil(player.error)
        print("VIDEO_QA native PCM/video coexist; pause/seek/resume/collapse passed; rms=\(measured.read().rms)")
    }
}
