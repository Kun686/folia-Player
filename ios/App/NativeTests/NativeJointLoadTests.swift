import XCTest
import UIKit
import WebKit
import Capacitor
import AVFoundation
@testable import App

// NativeJointLoadTests.swift — opt-in original models, actual Capacitor UI and hardware audio; QA identity only.
@MainActor extension NativeTests {
    func testProfileSerializationCancelsWaiterAndRecovers() async throws {
        let trace = NativeAnalysisTrace(), profiler = NativeTrackProfiler(trace: trace)
        let activeID = UUID(), cancelledID = UUID(), nextID = UUID()
        let pcm = profilePCM(["name": "groove", "seconds": 60.0, "stereo": false])
        let nextPCM = profilePCM(["name": "groove", "seconds": 3.0, "stereo": false])
        func has(_ stage: String, _ edge: String, _ id: UUID) -> Bool {
            (trace.snapshot()["events"] as? [[String: Any]] ?? []).contains {
                $0["stage"] as? String == stage && $0["edge"] as? String == edge && $0["operation"] as? String == id.uuidString
            }
        }
        let active = Task.detached {
            try await profiler.analyse(pcm, beatModel: URL(fileURLWithPath: "/missing.onnx"), operation: activeID)
        }
        defer { active.cancel() }
        try await waitForStream { has("beat.prepare", "begin", activeID) }
        let cancelled = Task.detached { try await profiler.analyse(nextPCM, operation: cancelledID) }
        defer { cancelled.cancel() }
        try await waitForStream { has("profile.wait", "begin", cancelledID) }
        cancelled.cancel()
        do { _ = try await cancelled.value; XCTFail("Cancelled waiter returned a profile") } catch is CancellationError {}
        XCTAssertFalse(has("profile", "begin", cancelledID), "Cancelled waiting work must never enter analysis")
        let next = Task.detached { try await profiler.analyse(nextPCM, operation: nextID) }
        defer { next.cancel() }
        try await waitForStream { has("profile.wait", "begin", nextID) }
        XCTAssertFalse(has("profile", "begin", nextID), "The active await must not admit another analysis")
        active.cancel()
        do { _ = try await active.value; XCTFail("Cancelled active work returned a profile") } catch is CancellationError {}
        let result = try await next.value
        XCTAssertNotNil(result)
        let events = try XCTUnwrap(trace.snapshot()["events"] as? [[String: Any]])
        let end = try XCTUnwrap(events.first { $0["stage"] as? String == "profile" && $0["edge"] as? String == "end" && $0["operation"] as? String == activeID.uuidString }?["elapsed"] as? Double)
        let begin = try XCTUnwrap(events.first { $0["stage"] as? String == "profile" && $0["edge"] as? String == "begin" && $0["operation"] as? String == nextID.uuidString }?["elapsed"] as? Double)
        XCTAssertGreaterThanOrEqual(begin, end, "Replacement must wait for actual pipeline exit")
    }

    func testResourcePressureCancelsProfilesAndRecoveryUsesCurrentIntent() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let file = try profileAudio(seconds: 4)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: file) }
        let local = LocalMediaLibrary(root: root)
        let old = try await local.importAudio(file), current = try await local.importAudio(file)
        let profiles = NativeTrackProfiles(local: local, profiler: NativeTrackProfiler(cacheDirectory: root.appendingPathComponent("profiles")))
        let player = PlaybackEngine(gateway: FailingGateway(), storage: UserDefaults(suiteName: UUID().uuidString)!, local: local, usesStereoOutput: true)
        player.network.cancel(); player.crossfade = NativeCrossfade(owner: player, profiles: profiles)
        defer { profiles.cancel(); player.stop(); player.clearOutput() }
        profiles.update([old]); XCTAssertTrue(profiles.hasPending)
        NotificationCenter.default.post(name: UIApplication.didReceiveMemoryWarningNotification, object: nil)
        XCTAssertFalse(profiles.hasPending, "The player's real resource notification must cancel profile work too")
        profiles.update([current]); XCTAssertFalse(profiles.hasPending, "Queue ticks cannot restart work while pressure remains")
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertNil(profiles.value(old)); XCTAssertNil(profiles.value(current))
        player.crossfade?.resourcePressure(false); profiles.update([current])
        try await waitForStream { profiles.value(current) != nil }
        XCTAssertNil(profiles.value(old)); XCTAssertEqual(profiles.value(current)?["gridless"] as? Bool, true)
        player.crossfade?.resourcePressure(true)
        XCTAssertNotNil(profiles.value(current), "Already measured small profiles remain usable")
        profiles.cancel(); player.crossfade?.resourcePressure(false)
        XCTAssertFalse(profiles.hasPending, "Recovery cannot resurrect a cancelled queue")
    }

    private func jointJS(_ web: WKWebView, _ script: String) async throws -> Any {
        try await withCheckedThrowingContinuation { continuation in
            web.evaluateJavaScript(script) { value, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: value ?? NSNull()) }
            }
        }
    }

    private func jointUIReady(_ web: WKWebView, condition: String) async throws {
        for _ in 0..<200 {
            if (try? await jointJS(web, condition)) as? Bool == true { return }
            try await Task.sleep(for: .milliseconds(50))
        }
        throw MobileFailure("joint-ui-not-ready")
    }

    // Measures rAF scheduling in the real renderer's WebContent process, not a substitute animation.
    private var jointFrameProbe: String { #"""
    (() => {
      if (window.__foliaJoint) cancelAnimationFrame(window.__foliaJoint.id);
      const m = window.__foliaJoint = {deltas: [], last: null, count: 0, id: 0, hidden: 0};
      const frame = t => {
        if (m.last !== null && m.deltas.length < 20000) m.deltas.push(t - m.last);
        m.last = t; m.count++; if (document.hidden) m.hidden++;
        m.id = requestAnimationFrame(frame);
      };
      m.id = requestAnimationFrame(frame);
      return true;
    })()
    """# }

    func testOriginalModelsWithLivePlaybackAndCadenza() async throws {
        guard Bundle.main.bundleIdentifier == "app.folia.validation.App" else {
            throw XCTSkip("Joint load is restricted to the independent QA identity")
        }
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let assets = documents.appendingPathComponent("ORTQA"), report = documents.appendingPathComponent("joint-load.json")
        guard FileManager.default.fileExists(atPath: assets.appendingPathComponent("music.wav").path) else {
            throw XCTSkip("Stage the approved original music and both unchanged models first")
        }
        guard ProcessInfo.processInfo.thermalState.rawValue < ProcessInfo.ThermalState.serious.rawValue else {
            throw XCTSkip("Device is already under serious thermal pressure")
        }
        let controller = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).compactMap { $0.rootViewController as? CAPBridgeViewController }.first)
        let web = try XCTUnwrap(controller.webView)
        try await jointUIReady(web, condition: "!!document.querySelector('.mobile-app')")
        let plugin = try XCTUnwrap(controller.bridge?.plugin(withName: "FoliaNative") as? FoliaNativePlugin)
        let player = try XCTUnwrap(plugin.engine), models = try XCTUnwrap(plugin.models)
        // Never connect this offline diagnostic to a retained QA gateway or platform account.
        guard try SecureStore.read("gateway").isEmpty else { throw MobileFailure("joint-qa-gateway-not-empty") }
        try await waitForStream({ models.ready }, seconds: 10)
        try player.crossfade?.configure(enabled: false, maximumSeconds: 5, mode: "automix")
        _ = try await jointJS(web, "localStorage.setItem('visualizer_mode','cadenza'); true")
        web.reload()
        try await Task.sleep(for: .milliseconds(200))
        try await jointUIReady(web, condition: "!!document.querySelector('.mobile-app')")
        let first = try await player.local.importAudio(assets.appendingPathComponent("music.wav"))
        let second = try await player.local.importAudio(assets.appendingPathComponent("music.wav"))
        let songs = [first, second]
        let lyricFile = documents.appendingPathComponent("joint-load.lrc")
        let lyricLines: [String] = (0..<67).map { i in
            let seconds: Int = i * 2
            let stamp = String(format: "[%02d:%02d.00]", seconds / 60, seconds % 60)
            return stamp + "联合验证歌词 第\(i + 1)行"
        }
        let lyrics = lyricLines.joined(separator: "\n")
        try lyrics.write(to: lyricFile, atomically: true, encoding: .utf8)
        for song in songs { _ = try await player.local.importLyrics(lyricFile, for: XCTUnwrap(NativeProfileIdentity(song)?.localID)) }
        addTeardownBlock { @MainActor in
            for song in songs { if let id = NativeProfileIdentity(song)?.localID { try await player.local.remove(id) } }
        }
        defer {
            player.stop(); player.clearOutput(); player.crossfade?.cancelAnalysis()
            web.evaluateJavaScript("if(window.__foliaJoint) cancelAnimationFrame(window.__foliaJoint.id)")
            try? FileManager.default.removeItem(at: lyricFile)
        }
        // Retain references to the same production coordinators for observations; no fake separation or profiles.
        let trace = NativeAnalysisTrace(), observation = UUID()
        let profiler = NativeTrackProfiler(trace: trace)
        let profiles = NativeTrackProfiles(local: player.local, profiler: profiler, mediaCache: player.mediaCache)
        let stems = NativeTrackStems(local: player.local, mediaCache: player.mediaCache,
            separator: MeasuredQueueStemSeparator(), profilesIdle: { !profiles.hasPending },
            providerBarrier: { [weak player] in player?.mediaCachePurges[$0] })
        player.crossfade?.cancel()
        player.crossfade = NativeCrossfade(owner: player, profiles: profiles, stems: stems)
        defer { stems.cancel(); profiles.cancel() }
        try await models.install(assets.appendingPathComponent("beat_this.onnx"))
        try await models.install(assets.appendingPathComponent("htdemucs.onnx"))
        try player.setQueue(songs, at: 0)
        try await waitForStream({ player.outputIsPlaying && player.playbackPosition > 0.5 }, seconds: 10)
        _ = try await jointJS(web, "document.querySelector('.mini-title').click(); true")
        try await jointUIReady(web, condition: "!!document.querySelector('.player-panel.expanded .lyric-stage canvas') && !document.querySelector('.lyric-notice')")
        let output = try XCTUnwrap(player.streamOutput), audio = OutputMeasurement()
        output.engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { buffer, _ in audio.consume(buffer) }
        defer { output.engine.mainMixerNode.removeTap(onBus: 0) }
        var phases: [[String: Any]] = []
        var warnings = 0
        let observer = NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification,
            object: nil, queue: .main) { _ in
                warnings += 1; trace.mark("memoryWarning", operation: observation)
            }
        let thermalObserver = NotificationCenter.default.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification,
            object: nil, queue: .main) { _ in trace.mark("thermalChanged", operation: observation) }
        defer { NotificationCenter.default.removeObserver(observer) }
        defer { NotificationCenter.default.removeObserver(thermalObserver) }

        // Baseline, unchanged production scheduling under load, then recovery; bounded samples only.
        for phase in ["baseline", "models", "recovery"] {
            trace.mark("phase." + phase, operation: observation)
            if phase == "models" { try player.crossfade?.configure(enabled: true, maximumSeconds: 5, mode: "automix", performance: true) }
            if phase == "recovery" { try player.crossfade?.configure(enabled: false, maximumSeconds: 5, mode: "automix") }
            _ = try await jointJS(web, jointFrameProbe); audio.reset()
            let started = ProcessInfo.processInfo.systemUptime, startPosition = player.playbackPosition
            var samples: [[String: Any]] = [], maxPollGap = 0.0, last = started, stopped = 0
            var outcome = "duration", sawPreparing = false
            let limit = phase == "models" ? 105.0 : 8.0
            while ProcessInfo.processInfo.systemUptime - started < limit {
                try await Task.sleep(for: .milliseconds(100))
                let now = ProcessInfo.processInfo.systemUptime
                maxPollGap = max(maxPollGap, now - last); last = now
                if !player.outputIsPlaying { stopped += 1 }
                let tail = stems.phase(first, role: .tail), head = stems.phase(second, role: .head)
                if tail == "preparing" || head == "preparing" { sawPreparing = true }
                if samples.isEmpty || now - started >= Double(samples.count) {
                    var row: [String: Any] = FoliaORTJob().diagnostics
                    row["elapsed"] = now - started; row["position"] = player.playbackPosition
                    row["thermal"] = ProcessInfo.processInfo.thermalState.rawValue
                    row["tail"] = tail; row["head"] = head; row["profilesPending"] = profiles.hasPending
                    samples.append(row)
                    if samples.count % 5 == 1 { print("FOLIA_JOINT phase=\(phase) elapsed=\(Int(now-started)) thermal=\(ProcessInfo.processInfo.thermalState.rawValue) tail=\(tail) head=\(head) playing=\(player.outputIsPlaying)") }
                }
                if phase == "models" {
                    if tail == "ready" && head == "ready" { outcome = "ready"; break }
                    if tail == "suspended" || head == "suspended" { outcome = "resource-protection"; break }
                    if tail == "failed" || head == "failed" { outcome = "model-failed"; break }
                }
            }
            let frames = try await jointJS(web, #"JSON.stringify({deltas:window.__foliaJoint.deltas, count:window.__foliaJoint.count, hidden:window.__foliaJoint.hidden, mode:localStorage.getItem('visualizer_mode'), canvases:document.querySelectorAll('.lyric-stage canvas').length, expanded:!!document.querySelector('.player-panel.expanded')})"#)
            let frameData = try XCTUnwrap((frames as? String)?.data(using: .utf8))
            let pcm = audio.read()
            phases.append(["phase": phase, "seconds": ProcessInfo.processInfo.systemUptime - started,
                "positionAdvanced": player.playbackPosition - startPosition, "maxMainPollGap": maxPollGap,
                "notPlayingSamples": stopped, "outcome": outcome, "sawStemPreparing": sawPreparing,
                "audioFrames": pcm.frames, "audioRMS": pcm.rms, "audioChannels": pcm.channels,
                "web": try JSONSerialization.jsonObject(with: frameData), "samples": samples])
            try JSONSerialization.data(withJSONObject: ["phases": phases, "memoryWarnings": warnings,
                "memoryScope": "host-only; excludes WebContent", "music": "approved-original-133s",
                "lyrics": "generated-LRC", "models": "original-beat_this-and-htdemucs",
                "analysisTrace": trace.snapshot()], options: [.prettyPrinted, .sortedKeys]).write(to: report, options: .atomic)
            print("FOLIA_JOINT phase=\(phase) outcome=\(outcome) audioFrames=\(pcm.frames) rms=\(pcm.rms) mainGap=\(maxPollGap) stoppedSamples=\(stopped)")
            XCTAssertGreaterThan(pcm.frames, 10000); XCTAssertGreaterThan(pcm.rms, 0.00001)
            XCTAssertEqual(stopped, 0, "Playback stopped during the measured phase")
            XCTAssertGreaterThan(player.playbackPosition - startPosition, 0.5)
        }
        let attachment = XCTAttachment(data: try Data(contentsOf: report), uniformTypeIdentifier: "public.json")
        attachment.name = "joint-load"; attachment.lifetime = .keepAlways; add(attachment)
        let picture = try await web.takeSnapshot(configuration: nil)
        let screenshot = XCTAttachment(image: picture); screenshot.name = "joint-cadenza"; screenshot.lifetime = .keepAlways; add(screenshot)
        let modelPhase = try XCTUnwrap(phases.first { $0["phase"] as? String == "models" })
        XCTAssertEqual(modelPhase["outcome"] as? String, "ready", "Protected cancellation is not completed Automix preparation")
    }
}
