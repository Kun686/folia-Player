import XCTest
import UIKit
import WebKit
import Capacitor
import AVFoundation
@testable import App

// NativeJointLoadTests.swift — opt-in original models, actual Capacitor UI and hardware audio; QA identity only.
private final class JointMemoryOwner {
    let name: String
    weak var value: AnyObject?
    init(_ name: String, _ value: AnyObject) { self.name = name; self.value = value }
}

@MainActor extension NativeTests {
    func testProfileSerializationCancelsWaiterAndRecovers() async throws {
        let trace = NativeAnalysisTrace(), profiler = NativeTrackProfiler(trace: trace)
        let activeID = UUID(), cancelledID = UUID(), nextID = UUID()
        let nextPCM = profilePCM(["name": "groove", "seconds": 3.0, "stereo": false])
        defer {
            if let data = try? JSONSerialization.data(withJSONObject: trace.snapshot(), options: [.sortedKeys]) {
                let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                attachment.name = "profile-serialization-trace.json"; attachment.lifetime = .keepAlways; add(attachment)
            }
        }
        func has(_ stage: String, _ edge: String, _ id: UUID) -> Bool {
            (trace.snapshot()["events"] as? [[String: Any]] ?? []).contains {
                $0["stage"] as? String == stage && $0["edge"] as? String == edge && $0["operation"] as? String == id.uuidString
            }
        }
        var release: CheckedContinuation<Void, Never>?
        let active = Task {
            try await profiler.withAnalysisPermit(activeID) {
                let end = trace.begin("test.active", operation: activeID); defer { end() }
                // Hold real work independently of CPU speed and cancellation delivery.
                await withCheckedContinuation { release = $0 }
                try Task.checkCancellation()
            }
        }
        defer { active.cancel(); release?.resume() }
        try await waitForStream { release != nil }
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
        let lastID = UUID()
        let last = Task.detached { try await profiler.analyse(nextPCM, operation: lastID) }
        defer { last.cancel() }
        try await waitForStream { has("profile.wait", "begin", lastID) }
        XCTAssertFalse(has("profile.wait", "end", nextID), "Cancellation cannot release work still awaiting actual exit")
        XCTAssertFalse(has("profile.wait", "end", lastID), "A new caller cannot bypass the held permit")
        release?.resume(); release = nil
        do { _ = try await active.value; XCTFail("Cancelled active work returned a profile") } catch is CancellationError {}
        let result = try await next.value
        XCTAssertNotNil(result)
        let lastResult = try await last.value
        XCTAssertNotNil(lastResult)
        let events = try XCTUnwrap(trace.snapshot()["events"] as? [[String: Any]])
        let end = try XCTUnwrap(events.first { $0["stage"] as? String == "test.active" && $0["edge"] as? String == "end" && $0["operation"] as? String == activeID.uuidString }?["elapsed"] as? Double)
        let begin = try XCTUnwrap(events.first { $0["stage"] as? String == "profile" && $0["edge"] as? String == "begin" && $0["operation"] as? String == nextID.uuidString }?["elapsed"] as? Double)
        XCTAssertGreaterThanOrEqual(begin, end, "Replacement must wait for actual pipeline exit")
        let nextEnd = try XCTUnwrap(events.first { $0["stage"] as? String == "profile" && $0["edge"] as? String == "end" && $0["operation"] as? String == nextID.uuidString }?["elapsed"] as? Double)
        let lastBegin = try XCTUnwrap(events.first { $0["stage"] as? String == "profile" && $0["edge"] as? String == "begin" && $0["operation"] as? String == lastID.uuidString }?["elapsed"] as? Double)
        XCTAssertGreaterThanOrEqual(lastBegin, nextEnd, "Surviving waiters retain FIFO order without overlapping")
    }

    func testProfileFailureReleasesPermit() async throws {
        let profiler = NativeTrackProfiler()
        let pcm = profilePCM(["name": "groove", "seconds": 3.0, "stereo": false])
        let missing = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("onnx")
        do {
            _ = try await profiler.analyse(pcm, beatModel: missing)
            XCTFail("A missing model must fail, rather than hold the permit indefinitely")
        } catch { XCTAssertEqual((error as? MobileFailure)?.code, "stem-source-unavailable") }
        let recovered = try await profiler.analyse(pcm)
        XCTAssertNotNil(recovered, "A genuine model failure must release the next analysis")
    }

    func testAlreadyCancelledProfileNeverTakesPermit() async throws {
        let trace = NativeAnalysisTrace(), profiler = NativeTrackProfiler(trace: trace), operation = UUID()
        let pcm = profilePCM(["name": "groove", "seconds": 3.0, "stereo": false])
        let cancelled = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await profiler.analyse(pcm, operation: operation)
        }
        do { _ = try await cancelled.value; XCTFail("Already cancelled work returned a profile") } catch is CancellationError {}
        let events = try XCTUnwrap(trace.snapshot()["events"] as? [[String: Any]])
        XCTAssertFalse(events.contains { $0["stage"] as? String == "profile" })
        let recovered = try await profiler.analyse(pcm)
        XCTAssertNotNil(recovered)
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
        try await originalJointLoad(includingHandover: false)
    }

    func testOriginalModelsCompleteStemHandoverWithCadenza() async throws {
        try await originalJointLoad(includingHandover: true)
    }

    func testDistinctOriginalSongsCompleteStemHandoverWithCadenza() async throws {
        try await originalJointLoad(includingHandover: true, distinctSongs: true)
    }

    func testConsecutiveOriginalModelHandoversWithCadenza() async throws {
        // Bounded continuation of the original joint workload; keep every round's evidence and stop on failure.
        var owners: [JointMemoryOwner] = []
        try await jointMemoryCheckpoint("baseline", owners: owners)
        for index in 0..<3 {
            try await originalJointLoad(includingHandover: true, distinctSongs: index == 0,
                reportPrefix: "joint-consecutive-\(index)", observeOwner: { name, value in
                    owners.append(JointMemoryOwner("round-\(index)." + name, value))
                })
            if (testRun?.failureCount ?? 0) > 0 { return }
            try await jointMemoryCheckpoint("round-\(index)", owners: owners)
            // The shared output belongs to PlaybackEngine across all queue rounds.
            for owner in owners where !owner.name.hasPrefix("round-\(index).") && !owner.name.hasSuffix(".output") {
                XCTAssertNil(owner.value, "Previous round is still retained: \(owner.name)")
            }
        }
    }

    // Optional host-side memgraph capture after work has returned; never stall ordinary regression runs.
    private func jointMemoryCheckpoint(_ phase: String, owners: [JointMemoryOwner]) async throws {
        guard let mode = ProcessInfo.processInfo.environment["FOLIA_MEMORY_CAPTURE"], ["1", "sample"].contains(mode) else { return }
        guard Bundle.main.bundleIdentifier == "app.folia.validation.App" else {
            throw MobileFailure("memory-capture-requires-qa")
        }
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MemoryCapture", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let ack = directory.appendingPathComponent(phase + ".ack")
        if FileManager.default.fileExists(atPath: ack.path) { try FileManager.default.removeItem(at: ack) }
        // Let cancelled tasks and actor cache invalidations finish before freezing the graph.
        try await Task.sleep(for: .seconds(2))
        var state = nativeMemorySnapshot(phase)
        state["pid"] = ProcessInfo.processInfo.processIdentifier; state["phase"] = phase
        state["liveOwners"] = owners.filter { $0.value != nil }.map(\.name)
        try JSONSerialization.data(withJSONObject: state, options: [.prettyPrinted, .sortedKeys])
            .write(to: directory.appendingPathComponent(phase + ".json"), options: .atomic)
        print("FOLIA_MEMORY phase=\(phase) footprint=\(state["footprintBytes"]!) mallocInUse=\(state["mallocInUseBytes"]!) liveOwners=\(state["liveOwners"]!)")
        if mode == "sample" { return }
        for second in 0..<45 {
            if FileManager.default.fileExists(atPath: ack.path) { return }
            if second % 5 == 0 { print("FOLIA_MEMORY phase=\(phase) awaitingCapture=\(second)s") }
            try await Task.sleep(for: .seconds(1))
        }
        throw MobileFailure("memory-capture-timed-out")
    }

    // Reuse the same original-model preparation; the optional leg observes the actual queue adoption.
    private func originalJointLoad(includingHandover: Bool, distinctSongs: Bool = false, reportPrefix: String? = nil,
                                   observeOwner: ((String, AnyObject) -> Void)? = nil) async throws {
        guard Bundle.main.bundleIdentifier == "app.folia.validation.App" else {
            throw XCTSkip("Joint load is restricted to the independent QA identity")
        }
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let assets = documents.appendingPathComponent("ORTQA")
        let prefix = reportPrefix ?? (distinctSongs ? "joint-distinct" : "joint")
        let report = documents.appendingPathComponent(prefix + "-load.json")
        let firstFile = assets.appendingPathComponent("music.wav")
        let secondFile = assets.appendingPathComponent(distinctSongs ? "distinct.wav" : "music.wav")
        guard [firstFile, secondFile].allSatisfy({ FileManager.default.fileExists(atPath: $0.path) }) else {
            throw XCTSkip("Stage the approved original music and both unchanged models first")
        }
        // Verify the actual inputs, not just two filenames or separately imported queue identities.
        let sourceHashes = try [firstFile, secondFile].map {
            try NativeStemSnapshot.capture($0, deadline: ProcessInfo.processInfo.systemUptime + 10).digest
        }
        if distinctSongs { XCTAssertNotEqual(sourceHashes[0], sourceHashes[1]) }
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
        let first = try await player.local.importAudio(firstFile)
        let second = try await player.local.importAudio(secondFile)
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
        player.crossfade = NativeCrossfade(owner: player, profiles: profiles, stems: stems, trace: trace)
        observeOwner?("crossfade", player.crossfade!); observeOwner?("profiles", profiles)
        observeOwner?("stems", stems); observeOwner?("profiler", profiler); observeOwner?("trace", trace)
        defer { stems.cancel(); profiles.cancel() }
        try await models.install(assets.appendingPathComponent("beat_this.onnx"))
        try await models.install(assets.appendingPathComponent("htdemucs.onnx"))
        try player.setQueue(songs, at: 0)
        try await waitForStream({ player.outputIsPlaying && player.playbackPosition > 0.5 }, seconds: 10)
        _ = try await jointJS(web, "document.querySelector('.mini-title').click(); true")
        try await jointUIReady(web, condition: "!!document.querySelector('.player-panel.expanded .lyric-stage canvas') && !document.querySelector('.lyric-notice')")
        let output = try XCTUnwrap(player.streamOutput), audio = OutputMeasurement()
        observeOwner?("output", output)
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
                "memoryScope": "host-only; excludes WebContent", "music": distinctSongs ? "fishin-to-vibeace" : "approved-original-133s",
                "sourceSHA256": sourceHashes,
                "lyrics": "generated-LRC", "models": "original-beat_this-and-htdemucs",
                "analysisTrace": trace.snapshot()], options: [.prettyPrinted, .sortedKeys]).write(to: report, options: .atomic)
            print("FOLIA_JOINT phase=\(phase) outcome=\(outcome) audioFrames=\(pcm.frames) rms=\(pcm.rms) mainGap=\(maxPollGap) stoppedSamples=\(stopped)")
            XCTAssertGreaterThan(pcm.frames, 10000); XCTAssertGreaterThan(pcm.rms, 0.00001)
            XCTAssertEqual(stopped, 0, "Playback stopped during the measured phase")
            XCTAssertGreaterThan(player.playbackPosition - startPosition, 0.5)
            if phase == "models", includingHandover, outcome == "ready" {
                let measured = try songs.map { try XCTUnwrap(profiles.value($0)) }
                for profile in measured {
                    XCTAssertEqual(profile["gridless"] as? Bool, false)
                    XCTAssertEqual(profile["partial"] as? Bool, false)
                }
                let data = try JSONSerialization.data(withJSONObject: measured, options: [.prettyPrinted, .sortedKeys])
                try data.write(to: documents.appendingPathComponent(prefix + "-profiles.json"), options: .atomic)
                let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                attachment.name = prefix + "-profiles"; attachment.lifetime = .keepAlways; add(attachment)
                try await originalStemHandover(player, web: web, audio: audio, documents: documents, reportPrefix: prefix)
            }
        }
        let attachment = XCTAttachment(data: try Data(contentsOf: report), uniformTypeIdentifier: "public.json")
        attachment.name = prefix + "-load"; attachment.lifetime = .keepAlways; add(attachment)
        let picture = try await web.takeSnapshot(configuration: nil)
        let screenshot = XCTAttachment(image: picture); screenshot.name = "joint-cadenza"; screenshot.lifetime = .keepAlways; add(screenshot)
        let modelPhase = try XCTUnwrap(phases.first { $0["phase"] as? String == "models" })
        XCTAssertEqual(modelPhase["outcome"] as? String, "ready", "Protected cancellation is not completed Automix preparation")
    }

    // Seek only to the production planner's measured cue, then leave adoption and mixing to its render clock.
    private func originalStemHandover(_ player: PlaybackEngine, web: WKWebView,
                                      audio: OutputMeasurement, documents: URL, reportPrefix: String) async throws {
        try await waitForStream {
            let state = player.crossfade?.analysisDiagnostics
            return state?["planKind"] as? String == "fade" && state?["planning"] as? Bool == false
        }
        let plan = try XCTUnwrap(player.crossfade?.analysisDiagnostics)
        let outStart = try XCTUnwrap(plan["planOutStart"] as? Double)
        XCTAssertEqual(player.index, 0)
        try player.command("seek", position: max(0, outStart - 1.5))
        try await waitForStream { player.outputIsPlaying && player.stream?.seeking == false }
        _ = try await jointJS(web, jointFrameProbe); audio.reset()
        let started = ProcessInfo.processInfo.systemUptime
        var samples: [[String: Any]] = [], sawStem = false, finished = false, stopped = 0
        defer {
            let pcm = audio.read()
            let result: [String: Any] = ["plan": plan, "samples": samples, "sawStem": sawStem,
                "finished": finished, "notPlayingSamples": stopped, "seconds": ProcessInfo.processInfo.systemUptime - started,
                "audioFrames": pcm.frames, "audioRMS": pcm.rms, "audioChannels": pcm.channels,
                "source": "original-models-and-music; production-planner; seek-to-cue"]
            if let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]) {
                try? data.write(to: documents.appendingPathComponent(reportPrefix + "-handover.json"), options: .atomic)
                let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                attachment.name = reportPrefix + "-handover"; attachment.lifetime = .keepAlways; add(attachment)
            }
        }
        while ProcessInfo.processInfo.systemUptime - started < 40 {
            try await Task.sleep(for: .milliseconds(100))
            let clock = player.streamOutput?.transitionGain.clock
            let renderedStem = player.crossfade?.isStemFading == true && clock?.stemFailed == false
                && (clock?.renderedEnd ?? 0) > (clock?.curveStart ?? .infinity) + 512
            sawStem = sawStem || renderedStem
            if !player.outputIsPlaying { stopped += 1 }
            samples.append(["elapsed": ProcessInfo.processInfo.systemUptime - started, "index": player.index,
                "position": player.playbackPosition, "playing": player.outputIsPlaying,
                "stem": renderedStem, "fading": player.crossfade?.isFading ?? false,
                "stemFailed": clock?.stemFailed ?? false, "stemClockInvalid": clock?.stemClockInvalid ?? false,
                "preparation": player.crossfade?.stemPreparationStatus ?? "missing",
                "decks": player.streamOutput?.attachedCount ?? 0])
            if samples.count % 50 == 1 {
                print("FOLIA_JOINT_HANDOVER elapsed=\(Int(ProcessInfo.processInfo.systemUptime-started)) index=\(player.index) stem=\(renderedStem) preparation=\(player.crossfade?.stemPreparationStatus ?? "missing")")
            }
            if player.index == 1, player.crossfade?.isFading == false {
                finished = true; break
            }
        }
        XCTAssertTrue(sawStem, "Original inferred stems must reach the actual shared audio graph")
        XCTAssertTrue(finished, "The original transition must finish and release the outgoing deck")
        XCTAssertFalse(samples.contains { $0["stemFailed"] as? Bool == true || $0["stemClockInvalid"] as? Bool == true },
                       "A later fallback must not count as a completed stem handover")
        XCTAssertEqual(stopped, 0); XCTAssertEqual(player.index, 1)
        XCTAssertEqual(player.streamOutput?.attachedCount, 1)
        XCTAssertGreaterThan(audio.read().frames, 10000); XCTAssertGreaterThan(audio.read().rms, 0.00001)
        let frames = try await jointJS(web, "window.__foliaJoint.count")
        XCTAssertGreaterThan((frames as? Int) ?? 0, 10, "WebContent rAF scheduling must continue during handover")
    }
}
