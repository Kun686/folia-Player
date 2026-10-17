import XCTest
import Capacitor
import AVFoundation
import WebKit
@testable import App

// LivePlaybackAcceptanceTests.swift — opt-in measurements of the signed-in QA app's existing real queue.
@MainActor private final class LiveBackgroundProbe {
    var requests = 0
    var resolutions: [[String: Any]] = []
}

// Delay later requests until UIKit confirms background; responses still come from the production gateway.
private final class LiveBackgroundGateway: GatewayClient {
    let probe: LiveBackgroundProbe
    init(probe: LiveBackgroundProbe) { self.probe = probe; super.init() }
    override func resolve(_ song: [String: Any], quality: String = "standard") async throws -> NativeAudioSource {
        let ordinal = await MainActor.run { probe.requests += 1; return probe.requests }
        if ordinal > 1 {
            let deadline = ProcessInfo.processInfo.systemUptime + 90
            while !(await MainActor.run { UIApplication.shared.applicationState == .background }) {
                try Task.checkCancellation()
                guard ProcessInfo.processInfo.systemUptime < deadline else { throw MobileFailure("live-qa-background-timeout") }
                try await Task.sleep(for: .milliseconds(100))
            }
        }
        let startedInBackground = await MainActor.run { UIApplication.shared.applicationState == .background }
        let source = try await super.resolve(song, quality: quality)
        let provider = (song["sourceRef"] as? [String: Any])?["providerId"] as? String ?? ""
        await MainActor.run {
            probe.resolutions.append(["ordinal": ordinal, "provider": provider, "quality": quality,
                "startedInBackground": startedInBackground,
                "finishedInBackground": UIApplication.shared.applicationState == .background])
            print("FOLIA_LIVE_BACKGROUND resolved provider=\(provider) background=\(startedInBackground)")
        }
        return source
    }
}

@MainActor extension NativeTests {
    func testSignedInSongsResolveAndAdvanceInBackgroundWithoutWebBridge() async throws {
        guard ProcessInfo.processInfo.environment["FOLIA_LIVE_BACKGROUND_QA"] == "1" else {
            throw XCTSkip("Requires signed-in simulator acceptance with operator backgrounding the app")
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
        let plugin = try XCTUnwrap(controller.bridge?.plugin(withName: "FoliaNative") as? FoliaNativePlugin)
        try await waitForStream({ plugin.engine != nil && controller.webView?.isLoading == false }, seconds: 15)
        let original = try XCTUnwrap(plugin.engine)
        guard !original.intentToPlay, !original.outputIsPlaying else { throw MobileFailure("live-qa-pause-original-first") }
        let originalQueue = try JSONSerialization.data(withJSONObject: original.queue, options: [.sortedKeys])
        let originalIndex = original.index, originalPosition = original.playbackPosition
        let songs = try ["netease", "qq", "netease"].map { provider in
            try XCTUnwrap(original.queue.first { song in
                let ref = song["sourceRef"] as? [String: Any]
                return ref?["kind"] as? String == "online" && ref?["providerId"] as? String == provider
            }, "Existing real queue must contain both providers")
        }
        let suite = "folia.live-background-qa." + UUID().uuidString
        let storage = try XCTUnwrap(UserDefaults(suiteName: suite))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(suite, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer {
            storage.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: directory)
        }
        let cache = NativeMediaCache(directory: directory)
        let probe = LiveBackgroundProbe()
        let tested = PlaybackEngine(gateway: LiveBackgroundGateway(probe: probe), storage: storage,
                                    usesStereoOutput: true, mediaCache: cache)
        var measurements: [[String: Any]] = [], advances: [[String: Any]] = []
        var phase = "prepare-first"
        let started = ProcessInfo.processInfo.systemUptime
        defer {
            let lastState: [String: Any] = ["phase": phase, "index": tested.index, "position": tested.playbackPosition,
                "playing": tested.outputIsPlaying, "seeking": tested.stream?.seeking ?? false,
                "preparingOutput": tested.stream?.preparingOutput ?? false,
                "error": tested.error ?? "", "background": UIApplication.shared.applicationState == .background,
                "applicationState": UIApplication.shared.applicationState.rawValue,
                "elapsed": ProcessInfo.processInfo.systemUptime - started]
            tested.stop(); tested.clearOutput(); tested.streamOutput?.close(); tested.network.cancel()
            original.updateNowPlaying()
            let report: [String: Any] = ["source": "existing-signed-in-queue", "freshMediaCache": true,
                "webBridgeAttached": false, "resolutions": probe.resolutions, "advances": advances,
                "measurements": measurements, "lastState": lastState, "physicalDevice": false, "longRunAcceptance": false]
            if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
                let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                attachment.name = "live-native-background-playback"; attachment.lifetime = .keepAlways; add(attachment)
            }
        }
        await tested.libraryRefreshTask?.value
        XCTAssertNil(tested.emit)
        XCTAssertFalse(tested.transitionSettings.enabled)
        XCTAssertFalse(tested.listening.enabled)
        XCTAssertEqual(tested.audioSettings.audioQuality, "standard")
        try tested.setQueue(songs, at: 0)
        try await waitForStream({ tested.index == 0 && tested.outputIsPlaying && tested.playbackPosition > 0.2 }, seconds: 25)
        phase = "seek-first"; print("FOLIA_LIVE_BACKGROUND seek-first")
        try tested.command("seek", position: 30)
        try await waitForStream({ tested.outputIsPlaying && tested.playbackPosition >= 30 }, seconds: 25)
        phase = "wait-for-background"
        print("FOLIA_LIVE_BACKGROUND READY_PRESS_HOME elapsed=\(ProcessInfo.processInfo.systemUptime - started)")
        // Operator-driven Simulator transition needs its own bounded window, not an audio readiness timeout.
        for tick in 0..<120 {
            if UIApplication.shared.applicationState == .background { break }
            if tick % 20 == 0 { print("FOLIA_LIVE_BACKGROUND waiting-for-home seconds=\(tick / 2)") }
            try await Task.sleep(for: .milliseconds(500))
        }
        guard UIApplication.shared.applicationState == .background else { throw MobileFailure("live-qa-background-timeout") }
        print("FOLIA_LIVE_BACKGROUND entered-background")
        // Reach each actual end-of-track callback quickly; do not invoke next/select for the transitions.
        for target in 1...2 {
            phase = "advance-\(target)"
            let duration = tested.playbackDuration
            guard duration > 40 else { throw MobileFailure("live-qa-real-track-too-short") }
            try tested.command("seek", position: duration - 1.5)
            try await waitForStream({ tested.index == target && tested.outputIsPlaying }, seconds: 30)
            let song = try XCTUnwrap(tested.currentSong)
            let ref = try XCTUnwrap(song["sourceRef"] as? [String: Any])
            let provider = try XCTUnwrap(ref["providerId"] as? String)
            advances.append(["index": target, "provider": provider, "title": song["name"] ?? "",
                             "background": UIApplication.shared.applicationState == .background])
            XCTAssertTrue(UIApplication.shared.applicationState == .background)
            XCTAssertNil(tested.error)
            XCTAssertNil(tested.stream?.cachedMedia)
            XCTAssertEqual(provider, target == 1 ? "qq" : "netease")
            print("FOLIA_LIVE_BACKGROUND advanced index=\(target) provider=\(provider)")
            phase = "seek-\(provider)"
            try tested.command("seek", position: 30)
            try await waitForStream({ tested.outputIsPlaying && tested.playbackPosition >= 30 && tested.stream?.audio.isSeeking == false }, seconds: 25)
            phase = "measure-\(provider)"
            let output = try XCTUnwrap(tested.streamOutput), audio = OutputMeasurement()
            output.engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { buffer, _ in audio.consume(buffer) }
            defer { output.engine.mainMixerNode.removeTap(onBus: 0) }
            for window in 0..<3 {
                audio.reset()
                let start = tested.playbackPosition
                try await Task.sleep(for: .seconds(1))
                let pcm = audio.read(), advance = tested.playbackPosition - start
                measurements.append(["provider": provider, "window": window, "frames": pcm.frames,
                    "channels": pcm.channels, "rms": pcm.rms, "advance": advance,
                    "background": UIApplication.shared.applicationState == .background])
                XCTAssertEqual(tested.index, target)
                XCTAssertTrue(UIApplication.shared.applicationState == .background)
                XCTAssertTrue(tested.outputIsPlaying)
                XCTAssertNil(tested.error)
                XCTAssertGreaterThan(advance, 0.25)
                XCTAssertEqual(pcm.channels, 2)
                XCTAssertGreaterThan(pcm.frames, 1000)
                XCTAssertTrue(pcm.rms.isFinite && pcm.rms > 0.00001)
                print("FOLIA_LIVE_BACKGROUND pcm provider=\(provider) window=\(window) frames=\(pcm.frames) rms=\(pcm.rms)")
            }
        }
        for provider in ["qq", "netease"] {
            XCTAssertTrue(probe.resolutions.contains { $0["provider"] as? String == provider
                && $0["startedInBackground"] as? Bool == true && $0["finishedInBackground"] as? Bool == true })
        }
        XCTAssertTrue(try JSONSerialization.data(withJSONObject: original.queue, options: [.sortedKeys]) == originalQueue)
        XCTAssertEqual(original.index, originalIndex)
        XCTAssertEqual(original.playbackPosition, originalPosition, accuracy: 0.05)
        XCTAssertFalse(original.intentToPlay)
        let after = try NativeGatewayStore.shared.snapshot()
        XCTAssertTrue(after.server == credentials.server && after.token == credentials.token && after.sessions == credentials.sessions,
                      "Original settings and both sessions must be preserved")
        let cacheSummary = await cache.summary()
        XCTAssertEqual(cacheSummary["count"] as? Int, 0)
        phase = "complete"
    }

    func testSignedInQueueProducesNativePCM() async throws {
        try await measureSignedInQueue(withVisualizer: false)
    }

    func testSignedInQueueProducesPCMWithVisibleLumiere() async throws {
        try await measureSignedInQueue(withVisualizer: true)
    }

    private func measureSignedInQueue(withVisualizer: Bool) async throws {
        let optIn = withVisualizer ? "FOLIA_LIVE_VISUAL_QA" : "FOLIA_LIVE_PLAYBACK_QA"
        guard ProcessInfo.processInfo.environment[optIn] == "1" else {
            throw XCTSkip("Requires explicit live-account acceptance and an existing signed-in QA queue")
        }
        #if !targetEnvironment(simulator)
        throw XCTSkip("This opt-in check is restricted to the independent simulator app")
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
        let player = try XCTUnwrap(plugin.engine)
        // Capacitor's default start URL is the origin root; it serves the bundled index.html there.
        let page = try XCTUnwrap(web.url)
        let config = try XCTUnwrap(controller.bridge?.config)
        guard page.scheme == "capacitor", page.host == "localhost", page.query == nil,
              ["", "/", "/index.html"].contains(page.path),
              config.appStartPath == nil,
              config.appLocation.standardizedFileURL.path == Bundle.main.bundleURL.appendingPathComponent("public").standardizedFileURL.path,
              FileManager.default.fileExists(atPath: config.appLocation.appendingPathComponent("index.html").path) else {
            throw MobileFailure("live-qa-production-page-required")
        }
        guard type(of: player.gateway) == GatewayClient.self else { throw MobileFailure("live-qa-production-gateway-required") }
        let originalQueue = try JSONSerialization.data(withJSONObject: player.queue, options: [.sortedKeys])
        let targets = try ["netease", "qq"].map { provider in
            try XCTUnwrap(player.queue.indices.first { index in
                let ref = player.queue[index]["sourceRef"] as? [String: Any]
                return ref?["kind"] as? String == "online" && ref?["providerId"] as? String == provider
            }, "Existing real queue must include both providers")
        }
        var measurements: [[String: Any]] = []
        var visuals: [[String: Any]] = []
        let originalMode = try await jointJS(web, "localStorage.getItem('visualizer_mode')") as? String
        defer {
            // End in a predictable paused state; never clear sessions, cache, preferences or queue.
            try? player.command("pause")
            if withVisualizer {
                web.evaluateJavaScript("if(window.__foliaJoint){cancelAnimationFrame(window.__foliaJoint.id);delete window.__foliaJoint;}", completionHandler: nil)
            }
            let report: [String: Any] = ["source": "existing-signed-in-queue", "measurements": measurements,
                "visuals": visuals, "visualizerRequired": withVisualizer,
                "physicalDevice": false, "longRunAcceptance": false]
            if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
                let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                attachment.name = withVisualizer ? "live-native-pcm-with-lumiere" : "live-native-pcm"
                attachment.lifetime = .keepAlways; add(attachment)
            }
        }
        if withVisualizer {
            // The operator opens the existing production player through Simulator UI; no fixture or DOM click is injected.
            print("FOLIA_LIVE_VISUAL waiting-for-visible-production-player")
            var ready = false
            for attempt in 0..<120 {
                ready = (try? await jointJS(web, "!!document.querySelector('.player-panel.expanded .lyric-stage canvas')")) as? Bool == true
                if ready { break }
                if attempt % 20 == 0 { print("FOLIA_LIVE_VISUAL waiting \(attempt / 2)s") }
                try await Task.sleep(for: .milliseconds(500))
            }
            guard ready, originalMode == "lumiere" else { throw MobileFailure("live-qa-visible-lumiere-required") }
        }
        for target in targets {
            let song = player.queue[target]
            let ref = try XCTUnwrap(song["sourceRef"] as? [String: Any])
            let provider = try XCTUnwrap(ref["providerId"] as? String)
            print("FOLIA_LIVE_PCM preparing provider=\(provider)")
            try player.command("pause")
            player.select(target, position: 30)
            try player.command("play")
            try await waitForStream({ player.index == target && player.outputIsPlaying && player.playbackPosition >= 30 }, seconds: 25)
            let output = try XCTUnwrap(player.streamOutput), audio = OutputMeasurement()
            output.engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { buffer, _ in audio.consume(buffer) }
            defer { output.engine.mainMixerNode.removeTap(onBus: 0) }
            var firstPixels: [UInt8]?
            if withVisualizer {
                try await jointUIReady(web, condition: "!!document.querySelector('.player-panel.expanded .lyric-stage canvas') && !document.hidden")
                _ = try await jointJS(web, jointFrameProbe)
            }
            // Inspect each one-second window, rather than hiding a dropout inside a whole-track average.
            for window in 0..<8 {
                audio.reset()
                let start = player.playbackPosition
                let started = ProcessInfo.processInfo.systemUptime
                try await Task.sleep(for: .seconds(1))
                let pcm = audio.read(), elapsed = ProcessInfo.processInfo.systemUptime - started
                let advance = player.playbackPosition - start
                let canvasCount = try await jointJS(web, "document.querySelectorAll('.lyric-stage canvas').length") as? Int ?? 0
                measurements.append(["provider": provider, "mediaId": ref["mediaId"] ?? "", "title": song["name"] ?? "",
                    "window": window, "elapsed": elapsed, "startPosition": start, "advance": advance,
                    "frames": pcm.frames, "channels": pcm.channels, "rms": pcm.rms, "differenceRMS": pcm.difference,
                    "playing": player.outputIsPlaying, "stageCanvases": canvasCount])
                XCTAssertEqual(player.index, target, "Unexpected queue advance during the bounded sample")
                XCTAssertTrue(player.outputIsPlaying, "Playback stopped for \(provider) window \(window)")
                XCTAssertTrue(player.error == nil, "Playback reported a structured error")
                XCTAssertGreaterThan(advance, 0.25, "Native media clock did not advance")
                XCTAssertEqual(pcm.channels, 2)
                XCTAssertGreaterThan(pcm.frames, 1000, "No output frames")
                XCTAssertTrue(pcm.rms.isFinite && pcm.rms > 0.00001, "Silent or invalid output; inspect the actual song before interpreting")
                if withVisualizer {
                    XCTAssertGreaterThan(canvasCount, 0, "The actual visualizer must remain mounted during audio sampling")
                    if window == 1 || window == 6 {
                        let pixels = try await liveStageSnapshot(web, name: "live-\(provider)-lumiere-\(window)")
                        if let firstPixels {
                            let changed = zip(firstPixels, pixels).filter { abs(Int($0.0) - Int($0.1)) > 3 }.count
                            let fraction = Double(changed) / Double(pixels.count)
                            visuals.append(["provider": provider, "changedChannelFraction": fraction])
                            XCTAssertGreaterThan(fraction, 0.001, "Rendered stage snapshots must change while real audio advances")
                        } else { firstPixels = pixels }
                    }
                }
                print("FOLIA_LIVE_PCM provider=\(provider) window=\(window) frames=\(pcm.frames) rms=\(pcm.rms) advance=\(advance)")
            }
            if withVisualizer {
                let webValue = try await jointJS(web, "JSON.stringify({deltas:window.__foliaJoint.deltas,count:window.__foliaJoint.count,hidden:window.__foliaJoint.hidden,mode:localStorage.getItem('visualizer_mode')})")
                let webJSON = try XCTUnwrap(webValue as? String)
                let scheduling = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(webJSON.utf8)) as? [String: Any])
                visuals.append(["provider": provider, "scheduling": scheduling])
                XCTAssertGreaterThan(scheduling["count"] as? Int ?? 0, 0)
                XCTAssertEqual(scheduling["hidden"] as? Int, 0)
                XCTAssertEqual(scheduling["mode"] as? String, originalMode)
            }
            try player.command("pause")
            try await waitForStream({ !player.outputIsPlaying }, seconds: 5)
            let position = player.playbackPosition
            try await Task.sleep(for: .milliseconds(350))
            XCTAssertEqual(player.playbackPosition, position, accuracy: 0.15, "Paused position moved")
        }
        XCTAssertTrue(try JSONSerialization.data(withJSONObject: player.queue, options: [.sortedKeys]) == originalQueue,
                      "The check must preserve the existing queue")
        let after = try NativeGatewayStore.shared.snapshot()
        XCTAssertTrue(after.server == credentials.server && after.token == credentials.token && after.sessions == credentials.sessions,
                      "The check must preserve server settings and platform sessions")
        if withVisualizer {
            let modeAfter = try await jointJS(web, "localStorage.getItem('visualizer_mode')") as? String
            XCTAssertEqual(modeAfter, originalMode)
            _ = try await jointJS(web, "cancelAnimationFrame(window.__foliaJoint.id);delete window.__foliaJoint;true")
        }
    }

    // Capture actual composited stage pixels, excluding controls, and compare a small stable raster rather than PNG metadata.
    private func liveStageSnapshot(_ web: WKWebView, name: String) async throws -> [UInt8] {
        let value = try await jointJS(web, "(() => {const r=document.querySelector('.lyric-stage').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()")
        let rect = try XCTUnwrap(value as? [String: Double])
        let configuration = WKSnapshotConfiguration()
        configuration.afterScreenUpdates = true
        let width = rect["width"] ?? 0, height = rect["height"] ?? 0
        configuration.rect = CGRect(x: (rect["x"] ?? 0) + width * 0.05, y: (rect["y"] ?? 0) + height * 0.24,
                                    width: width * 0.9, height: height * 0.42)
        guard configuration.rect.width > 0, configuration.rect.height > 0 else { throw MobileFailure("live-qa-empty-stage") }
        let shot = try await web.takeSnapshot(configuration: configuration)
        let attachment = XCTAttachment(image: shot)
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
        let image = try XCTUnwrap(shot.cgImage), side = 96
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        let drew = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(data: buffer.baseAddress, width: side, height: side, bitsPerComponent: 8,
                bytesPerRow: side * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: side, height: side))
            return true
        }
        guard drew else { throw MobileFailure("live-qa-snapshot-raster") }
        return pixels
    }
}
