import XCTest
import Capacitor
import WebKit
import AVFoundation
@testable import App

// VisualizerContainerTests.swift — actual packaged renderers and PCM; synthetic online identities, no retained GL objects.
@MainActor extension NativeTests {
    func testPackagedVisualizerSettingsPreserveNativeOnlinePlayback() async throws {
        try await checkPackagedVisualizers(["classic", "diorama", "lumiere", "sonnet"])
    }

    func testRemainingPackagedVisualizersPreserveNativeOnlinePlayback() async throws {
        try await checkPackagedVisualizers(["cadenza", "cappella", "claddagh", "fume", "monet",
                                            "partita", "pendolo", "still", "tempera", "tilt"])
    }

    // Reuses the same native output and page lifecycle for both mode groups, without a second playback fixture.
    func checkPackagedVisualizers(_ modes: [String],
        afterRestore: (@MainActor (WKWebView, String) async throws -> Void)? = nil) async throws {
        #if !targetEnvironment(simulator)
        throw XCTSkip("Independent simulator container check only")
        #endif
        guard Bundle.main.bundleIdentifier == "app.folia.validation.App" else { throw MobileFailure("visualizer-qa-only") }
        let credentials = try NativeGatewayStore.shared.snapshot()
        guard credentials.server.isEmpty, credentials.sessions.values.allSatisfy({ $0.isEmpty }) else {
            throw MobileFailure("visualizer-qa-credentials-not-empty")
        }
        defer { print("FOLIA_JOINT_PROCESS_DONE") }
        let controller = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).compactMap { $0.rootViewController as? CAPBridgeViewController }.first)
        let web = try XCTUnwrap(controller.webView)
        let plugin = try XCTUnwrap(controller.bridge?.plugin(withName: "FoliaNative") as? FoliaNativePlugin)
        try await waitForStream { plugin.engine != nil && !web.isLoading }
        let original = try XCTUnwrap(plugin.engine)
        original.stop(); original.network.cancel(); original.listening.invalidate()
        let file = try profileAudio(seconds: 120)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let suite = "folia.visualizer-qa." + UUID().uuidString
        let storage = try XCTUnwrap(UserDefaults(suiteName: suite))
        let gateway = AudioFixtureGateway(url: file)
        let lyrics = NativeLyricCache(root: root.appendingPathComponent("lyrics"))
        let player = PlaybackEngine(gateway: gateway, storage: storage, local: LocalMediaLibrary(root: root.appendingPathComponent("local")),
            usesStereoOutput: true, lyricCache: lyrics)
        player.network.cancel(); player.emit = original.emit; plugin.engine = player
        defer {
            player.emit = nil; player.stop(); player.clearOutput(); player.listening.invalidate()
            player.crossfade?.cancel(); plugin.engine = original
            web.load(URLRequest(url: URL(string: "capacitor://localhost/index.html")!))
            storage.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: file); try? FileManager.default.removeItem(at: root)
        }
        try player.crossfade?.configure(enabled: false, maximumSeconds: 5, mode: "automix")
        let songs: [[String: Any]] = ["qq", "netease"].map { provider in
            ["id": "container-" + provider, "name": provider + " native visualizer", "durationMs": 120000,
             "artists": [["id": "qa", "name": "离线验证"]], "album": ["id": "qa", "name": "原生样本"],
             "sourceRef": ["kind": "online", "providerId": provider, "mediaId": "container-" + provider]]
        }
        let text = "晚风轻轻吹过窗前我们听着同一首歌等待星光慢慢落下"
        for song in songs {
            let snapshot = try await lyrics.read(song)
            let token = try XCTUnwrap(snapshot["token"] as? String)
            try await lyrics.write(song, token: token, field: "state", value: ["lyricsSource": "online", "hasOnlineOverride": true,
                "onlineOverrideLyrics": ["lines": [["startTime": 0, "endTime": 120, "fullText": text,
                    "words": [["text": text, "startTime": 0, "endTime": 120]]]]]])
        }
        _ = try await jointJS(web, "localStorage.clear(); localStorage.setItem('auto_use_best_lyric','false'); window.visualizerRetiredDocument = true; true")
        web.load(URLRequest(url: URL(string: "capacitor://localhost/mobile.html")!))
        try await jointUIReady(web, condition: "!window.visualizerRetiredDocument && !!document.querySelector('.mobile-app')")
        _ = try await jointJS(web, #"""
        (() => {
          const report = window.visualizerContainerQA = {errors: [], warnings: [], connectedContextLosses: 0};
          const add = (key, message) => { if (report[key].length < 100) report[key].push(String(message)); };
          window.addEventListener('error', event => add('errors', event.message));
          window.addEventListener('unhandledrejection', event => add('errors', event.reason));
          for (const [level, key] of [['error','errors'], ['warn','warnings']]) {
            const original = console[level].bind(console);
            console[level] = (...args) => { add(key, args.map(String).join(' ')); original(...args); };
          }
          // Event observation keeps no canvas, context or program references and does not patch rendering APIs.
          document.addEventListener('webglcontextlost', event => {
            if (event.target?.isConnected) report.connectedContextLosses++;
          }, true);
          return true;
        })()
        """#)
        try player.setQueue(songs, at: 0)
        try await waitForStream({ player.outputIsPlaying && player.playbackPosition > 0.5 }, seconds: 10)
        let output = try XCTUnwrap(player.streamOutput), audio = OutputMeasurement()
        output.engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { buffer, _ in audio.consume(buffer) }
        defer { output.engine.mainMixerNode.removeTap(onBus: 0) }
        try await jointUIReady(web, condition: "!!document.querySelector('.mini-title')")
        _ = try await jointJS(web, "document.querySelector('.mini-title').click(); true")
        var samples: [[String: Any]] = []
        defer {
            if let data = try? JSONSerialization.data(withJSONObject: samples, options: [.prettyPrinted, .sortedKeys]) {
                let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                attachment.name = "visualizer-container-phases"; attachment.lifetime = .keepAlways; add(attachment)
            }
        }
        // Each checkpoint observes actual output while the real setting handlers mount/unmount the stage.
        func checkpoint(_ phase: String, mode: String, provider: String, settingsOpen: Bool) async throws {
            try jointProcessCheckpoint(phase, web: web)
            audio.reset(); let position = player.playbackPosition
            // Give the external system sampler time to capture each second restored phase independently.
            try await Task.sleep(for: .milliseconds(phase.hasSuffix("-1-restored") ? 3000 : 450))
            let pcm = audio.read(), advanced = player.playbackPosition - position
            let state = try await jointJS(web, #"JSON.stringify({canvases:document.querySelectorAll('.lyric-stage canvas').length,settings:!!document.querySelector('.visual-settings'),mode:localStorage.getItem('visualizer_mode'),title:document.querySelector('.track-description h2')?.textContent,stageText:document.querySelector('.lyric-stage')?.textContent?.slice(0,250),diagnostics:window.visualizerContainerQA})"#)
            let bytes = try XCTUnwrap((state as? String)?.data(using: .utf8))
            let ui = try XCTUnwrap(try JSONSerialization.jsonObject(with: bytes) as? [String: Any])
            samples.append(["phase": phase, "positionAdvanced": advanced, "frames": pcm.frames, "rms": pcm.rms,
                            "channels": pcm.channels, "playing": player.outputIsPlaying, "ui": ui])
            XCTAssertTrue(player.outputIsPlaying, phase); XCTAssertGreaterThan(advanced, 0.1, phase)
            XCTAssertGreaterThan(pcm.frames, 1000, phase); XCTAssertGreaterThan(pcm.rms, 0.00001, phase)
            XCTAssertEqual(pcm.channels, 2, phase)
            XCTAssertEqual((ui["canvases"] as? Int ?? 0) > 0, !settingsOpen && mode != "still", phase)
            XCTAssertEqual(ui["settings"] as? Bool, settingsOpen, phase)
            XCTAssertEqual(ui["mode"] as? String, mode, phase)
            XCTAssertEqual(ui["title"] as? String, provider + " native visualizer", phase)
            print("VISUALIZER_CONTAINER \(phase) frames=\(pcm.frames) rms=\(pcm.rms) advanced=\(advanced)")
        }
        for (index, provider) in ["qq", "netease"].enumerated() {
            if index != 0 {
                player.select(index)
                try await waitForStream({ player.outputIsPlaying && player.playbackPosition > 0.5 }, seconds: 10)
            }
            for mode in modes {
                for cycle in 0..<2 {
                    _ = try await jointJS(web, "document.querySelector('.player-wake')?.click(); true")
                    try await jointUIReady(web, condition: "!document.querySelector('.player-heading')?.inert")
                    _ = try await jointJS(web, "document.querySelector('.player-heading button[aria-haspopup=dialog]').click(); true")
                    try await jointUIReady(web, condition: "!!document.querySelector('.player-options button')")
                    _ = try await jointJS(web, "document.querySelector('.player-options button').click(); true")
                    try await jointUIReady(web, condition: "!!document.querySelector('.visual-settings select') && !document.querySelector('.lyric-stage canvas')")
                    _ = try await jointJS(web, "(()=>{const s=document.querySelector('.visual-settings select');s.value='\(mode)';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()")
                    try await checkpoint("\(provider)-\(mode)-\(cycle)-settings", mode: mode, provider: provider, settingsOpen: true)
                    _ = try await jointJS(web, "document.querySelector('.visual-settings > header button').click(); true")
                    // Still intentionally has no canvas; raster lyrics need their own canvas beyond the shared background.
                    let raster = ["diorama", "fume", "lumiere", "sonnet", "tempera"].contains(mode)
                    let rendering = mode == "still"
                        ? "!!document.querySelector('.lyric-stage .visualizer-still') && !document.querySelector('.lyric-stage canvas')"
                        : "document.querySelectorAll('.lyric-stage canvas').length >= \(raster ? 3 : 2)"
                    let lyricsReady = raster ? "true" : "/晚|风|轻|窗|我们|星光/.test(document.querySelector('.lyric-stage')?.textContent ?? '')"
                    try await jointUIReady(web, condition: "!document.querySelector('.visual-settings') && (\(rendering)) && (\(lyricsReady)) && !document.querySelector('.empty-lyrics') && !document.querySelector('.lyric-notice')")
                    try await checkpoint("\(provider)-\(mode)-\(cycle)-restored", mode: mode, provider: provider, settingsOpen: false)
                    XCTAssertEqual(player.index, index); XCTAssertEqual(player.queue.count, 2); XCTAssertNil(player.error)
                    if cycle == 1 {
                        let config = WKSnapshotConfiguration(); config.afterScreenUpdates = true
                        let image = try await web.takeSnapshot(configuration: config)
                        let attachment = XCTAttachment(image: image); attachment.name = "\(provider)-\(mode)-restored"
                        attachment.lifetime = .keepAlways; add(attachment)
                        try await afterRestore?(web, "\(provider)-\(mode)")
                    }
                }
            }
        }
        let diagnostics = try await jointJS(web, "JSON.stringify(window.visualizerContainerQA)")
        let data = try XCTUnwrap((diagnostics as? String)?.data(using: .utf8))
        let report = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(report["errors"] as? [String], [])
        XCTAssertEqual(report["connectedContextLosses"] as? Int, 0)
        let contextWarnings = (report["warnings"] as? [String] ?? []).filter {
            $0.range(of: "too many.*context|context.*limit|context.*lost", options: [.regularExpression, .caseInsensitive]) != nil
        }
        XCTAssertEqual(contextWarnings, [])
        XCTAssertEqual(try NativeGatewayStore.shared.snapshot().scope, credentials.scope)
        XCTAssertEqual(gateway.resolved.filter { $0 == "container-qq" }.count, 1)
        XCTAssertTrue(gateway.resolved.contains("container-netease"))
    }
}
