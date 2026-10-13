import XCTest
import AVFoundation
@testable import AudioStreaming
@testable import App

// NativeOnlineAutomixTests.swift — original models and music through controlled HTTPS, native caches and real mixed output.
final class OnlineAutomixGateway: GatewayClient {
    let sources: [String: URL]
    var resolves: [String] = []
    var offline = false
    init(sources: [String: URL]) { self.sources = sources; super.init() }
    override func listeningAccountAvailable() -> Bool { false }
    override func send(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        throw MobileFailure("controlled-no-platform-request")
    }
    override func resolve(_ song: [String: Any], quality: String = "standard") async throws -> NativeAudioSource {
        let identity = try XCTUnwrap(NativeProfileIdentity(song))
        resolves.append(identity.key)
        guard !offline, let url = sources[identity.key] else { throw MobileFailure("controlled-offline") }
        return NativeAudioSource(url: url)
    }
}

@MainActor extension NativeTests {
    func testStreamingTransportIsolationPreservesSchedulingAndCallerConfiguration() throws {
        let source = profileNetworkConfiguration()
        source.timeoutIntervalForRequest = 37; source.timeoutIntervalForResource = 123
        source.networkServiceType = .responsiveAV
        let isolated = NativeMediaTransport.streamingConfiguration(source)
        XCTAssertNil(isolated.httpCookieStorage); XCTAssertNil(isolated.urlCredentialStorage)
        XCTAssertFalse(isolated.httpShouldSetCookies); XCTAssertNil(isolated.urlCache)
        XCTAssertEqual(isolated.httpAdditionalHeaders?.count, 0)
        XCTAssertEqual(isolated.timeoutIntervalForRequest, 37); XCTAssertEqual(isolated.timeoutIntervalForResource, 123)
        XCTAssertEqual(isolated.networkServiceType, .responsiveAV)
        XCTAssertTrue(isolated.protocolClasses?.contains { $0 == ProfileHTTPProtocol.self } == true)
        XCTAssertEqual(source.httpAdditionalHeaders?["Authorization"] as? String, "fixture-only")
        let defaults = NativeMediaTransport.streamingConfiguration(nil)
        let upstream = URLSessionConfiguration.networkingConfiguration
        XCTAssertEqual(defaults.networkServiceType, .avStreaming)
        // Foundation can ignore this option on Simulator; preserve the actual pinned library behavior.
        XCTAssertEqual(defaults.shouldUseExtendedBackgroundIdleMode, upstream.shouldUseExtendedBackgroundIdleMode)
        XCTAssertEqual(defaults.requestCachePolicy, .reloadIgnoringLocalCacheData)
        XCTAssertNil(defaults.httpCookieStorage); XCTAssertNil(defaults.urlCredentialStorage)
    }

    func testStreamingRedirectSeekAndEOFRebuildKeepCredentialsOutOfCDNRequests() async throws {
        let file = try profileAudio(seconds: 4)
        defer { try? FileManager.default.removeItem(at: file) }
        let audioFixture = ProfileHTTPFixture(try Data(contentsOf: file))
        let destination = ProfileHTTPProtocol.add(audioFixture, atOrigin: true)
        let redirectFixture = ProfileHTTPFixture(Data())
        redirectFixture.redirect = destination
        redirectFixture.headers = ["Set-Cookie": "fixture-cookie=not-for-cdn; Path=/"]
        let origin = ProfileHTTPProtocol.add(redirectFixture)
        defer { ProfileHTTPProtocol.remove(origin); ProfileHTTPProtocol.remove(destination) }
        let output = try await StreamMixOutput.make()
        defer { output.close() }
        let entry = try await StreamOccurrence.prepare(url: origin, output: output,
            networkConfiguration: profileNetworkConfiguration(), allowsTempo: true)
        defer { entry.dispose() }
        try entry.play(); try await waitForStream { entry.position > 0.1 }
        try entry.seek(to: 3.7)
        try await waitForStream { entry.hasEnded }
        let previous = entry.audio
        try entry.seek(to: 0)
        try await waitForStream { entry.audio !== previous && !entry.seeking && entry.position > 0.1 }
        let requests = redirectFixture.capturedRequests + audioFixture.capturedRequests
        XCTAssertGreaterThan(redirectFixture.stats.requests, 1)
        XCTAssertGreaterThan(audioFixture.stats.requests, 1)
        for request in requests {
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
            XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
        }
        XCTAssertFalse(entry.hasFailed)
    }

    func testOriginalOnlineAutomixCachesMixedProvidersAndReplaysOfflineWithoutWebView() async throws {
        guard Bundle.main.bundleIdentifier == "app.folia.validation.App" else {
            throw XCTSkip("Original-model workload requires the independent QA identity")
        }
        let assets = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("ORTQA")
        let files = [assets.appendingPathComponent("music.wav"), assets.appendingPathComponent("distinct.wav")]
        let beat = assets.appendingPathComponent("beat_this.onnx"), demucs = assets.appendingPathComponent("htdemucs.onnx")
        guard (files + [beat, demucs]).allSatisfy({ FileManager.default.fileExists(atPath: $0.path) }) else {
            throw XCTSkip("Stage both approved models and the two original music samples")
        }
        let manager = FileManager.default, root = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let suite = "folia.online-automix." + UUID().uuidString, storage = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { try? manager.removeItem(at: root); storage.removePersistentDomain(forName: suite) }
        let hashes = try files.map { try NativeStemSnapshot.capture($0, deadline: ProcessInfo.processInfo.systemUptime + 10).digest }
        XCTAssertNotEqual(hashes[0], hashes[1])
        let fixtures = try files.map { ProfileHTTPFixture(try Data(contentsOf: $0)) }
        fixtures.forEach { $0.delay = 0.0001 }
        let urls = fixtures.map { ProfileHTTPProtocol.add($0) }
        defer { urls.forEach(ProfileHTTPProtocol.remove) }
        // Equal media IDs on different providers must never alias audio, profiles or stem windows.
        let songs = [song("qq", "same-media-id"), song("netease", "same-media-id")]
        let identities = try songs.map { try XCTUnwrap(NativeProfileIdentity($0)) }
        let gateway = OnlineAutomixGateway(sources: Dictionary(uniqueKeysWithValues: zip(identities.map(\.key), urls)))
        let config = profileNetworkConfiguration()
        let media = NativeMediaCache(directory: root.appendingPathComponent("media"), configuration: config, settings: .init(enabled: true))
        let local = LocalMediaLibrary(root: root.appendingPathComponent("local"))
        let player = PlaybackEngine(gateway: gateway, storage: storage, local: local, usesStereoOutput: true,
            mediaNetworkConfiguration: config, mediaCache: media,
            coverCache: NativeCoverCache(root: root.appendingPathComponent("covers")),
            lyricCache: NativeLyricCache(root: root.appendingPathComponent("lyrics")))
        player.network.cancel()
        let trace = NativeAnalysisTrace()
        let profiles = NativeTrackProfiles(local: local, profiler: NativeTrackProfiler(cacheDirectory: root.appendingPathComponent("profiles"), trace: trace),
            configuration: config, mediaCache: media)
        let stemCache = NativeStemCache()
        let stems = NativeTrackStems(local: local, mediaCache: media, cache: stemCache, separator: MeasuredQueueStemSeparator(),
            profilesIdle: { !profiles.hasPending }, providerBarrier: { [weak player] in player?.mediaCachePurges[$0] })
        player.crossfade?.cancel()
        player.crossfade = NativeCrossfade(owner: player, profiles: profiles, stems: stems, trace: trace)
        defer { player.stop(); player.clearOutput(); player.crossfade?.cancelAnalysis(); stems.cancel(); profiles.cancel() }
        let modelStore = try NativeModelStore(directory: root.appendingPathComponent("models"))
        let models = try PlaybackModels(engine: player, store: modelStore)
        models.start(); try await waitForStream({ models.ready }, seconds: 10)
        try await models.install(beat); try await models.install(demucs)
        _ = try player.setTransitionSettings(["enabled": true, "mode": "automix", "crossfadeMaxSec": 5.0, "performance": true])
        var report: [String: Any] = ["sourceHashes": hashes, "source": "controlled-HTTPS; original-models-and-music; no-WebView-calls"]
        defer {
            report["trace"] = trace.snapshot()
            report["requests"] = fixtures.map { ["count": $0.stats.requests, "bytes": $0.stats.sent, "prefixRequests": $0.prefixRequests] }
            report["resolves"] = gateway.resolves.count
            if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
                let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                attachment.name = "online-automix.json"; attachment.lifetime = .keepAlways; add(attachment)
            }
        }
        try player.setQueue(songs, at: 0)
        try await waitForStream({ player.outputIsPlaying && player.playbackPosition > 0.5 }, seconds: 15)
        let output = try XCTUnwrap(player.streamOutput), audio = OutputMeasurement()
        output.engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { buffer, _ in audio.consume(buffer) }
        defer { output.engine.mainMixerNode.removeTap(onBus: 0) }
        let started = ProcessInfo.processInfo.systemUptime
        var samples: [[String: Any]] = []
        for index in 0..<2400 {
            if profiles.value(songs[0]) != nil, profiles.value(songs[1]) != nil,
               stems.value(songs[0], role: .tail) != nil, stems.value(songs[1], role: .head) != nil { break }
            if index % 20 == 0 {
                let sample: [String: Any] = ["seconds": ProcessInfo.processInfo.systemUptime - started,
                    "tail": stems.phase(songs[0], role: .tail), "head": stems.phase(songs[1], role: .head),
                    "profilePending": profiles.hasPending, "playing": player.outputIsPlaying, "index": player.index]
                samples.append(sample)
                print("FOLIA_ONLINE_AUTOMIX preparation=\(sample)")
            }
            if player.index != 0 || !player.intentToPlay { break }
            try await Task.sleep(for: .milliseconds(100))
        }
        report["preparation"] = samples
        let tail = try XCTUnwrap(stems.value(songs[0], role: .tail)), head = try XCTUnwrap(stems.value(songs[1], role: .head))
        XCTAssertEqual(tail.role, .tail); XCTAssertEqual(head.role, .head)
        for (index, identity) in identities.enumerated() {
            let profile = try XCTUnwrap(profiles.value(songs[index]))
            XCTAssertNotEqual(profile["partial"] as? Bool, true)
            let lease = try await media.cached(identity)
            let cached = try XCTUnwrap(lease)
            XCTAssertEqual(try NativeStemSnapshot.capture(cached: cached, deadline: ProcessInfo.processInfo.systemUptime + 10).digest, hashes[index])
            XCTAssertEqual(fixtures[index].prefixRequests, 0, "Original full preparation cannot use a bounded prefix")
            let request = try XCTUnwrap(fixtures[index].stats.first)
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization")); XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
        }
        XCTAssertTrue(audio.read().rms > 0.00001)
        report["liveHandover"] = try await onlineAutomixHandover(player, audio: audio, refreshLyricsDuringPreplay: true)
        let requests = fixtures.map { $0.stats.requests }, resolutions = gateway.resolves.count
        gateway.offline = true
        // Restart the native queue from persisted complete media; no resolver, network or WebView should be needed.
        player.stop(); player.clearOutput()
        try player.setQueue(songs, at: 0)
        try await waitForStream({ player.outputIsPlaying && player.playbackPosition > 0.5 }, seconds: 10)
        XCTAssertEqual(gateway.resolves.count, resolutions)
        XCTAssertEqual(fixtures.map { $0.stats.requests }, requests)
        report["offlineHandover"] = try await onlineAutomixHandover(player, audio: audio, refreshLyricsDuringPreplay: true)
        XCTAssertEqual(gateway.resolves.count, resolutions)
        XCTAssertEqual(fixtures.map { $0.stats.requests }, requests)
        XCTAssertNil(player.error)
        // Logout must purge only the selected provider's prepared results and persisted media.
        player.invalidateProvider("qq")
        try await player.mediaCachePurges["qq"]?.value
        let deleted = try await media.cached(identities[0]), retained = try await media.cached(identities[1])
        XCTAssertNil(deleted); XCTAssertNotNil(retained)
        XCTAssertNil(stems.value(songs[0], role: .tail)); XCTAssertNil(profiles.value(songs[0]))
        for _ in 0..<100 {
            if !(await stemCache.keys).contains(where: { $0.provider == "qq" }) { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        let keys = await stemCache.keys
        XCTAssertFalse(keys.contains { $0.provider == "qq" })
        XCTAssertTrue(keys.contains { $0.provider == "netease" })
    }

    // Observe the real render clock after moving to the original measured cue; never replace its plan or PCM.
    func onlineAutomixHandover(_ player: PlaybackEngine, audio: OutputMeasurement, loopingNext: Int? = nil,
                              refreshLyricsDuringPreplay: Bool = false) async throws -> [String: Any] {
        try await waitForStream({
            player.crossfade?.analysisDiagnostics["planKind"] as? String == "fade"
                && player.crossfade?.analysisDiagnostics["planning"] as? Bool == false
        }, seconds: 10)
        let plan = try XCTUnwrap(player.crossfade?.analysisDiagnostics)
        let cue = try XCTUnwrap(plan["planOutStart"] as? Double)
        XCTAssertEqual(player.index, 0)
        let outgoingSong = try XCTUnwrap(player.currentSong)
        if refreshLyricsDuringPreplay {
            let snapshot = try await player.lyricCache.read(outgoingSong)
            try await player.lyricCache.write(outgoingSong, token: snapshot["token"] as! String, field: "lyrics",
                value: ["lines": [["startTime": 1, "endTime": cue + 2, "fullText": "延迟保存的歌词", "words": []]]])
        }
        try player.command("seek", position: max(0, cue - 1.5))
        try await waitForStream { player.outputIsPlaying && player.stream?.seeking == false }
        var lyricRefresh: [String: Any] = [:]
        if refreshLyricsDuringPreplay {
            // Deliver the saved automatic update while the actual next decoder is playing at zero gain.
            try await waitForStream {
                player.index == 0 && player.preparedStream?.entry.playing == true
                    && player.crossfade?.analysisDiagnostics["armed"] as? Bool == true
            }
            let next = try XCTUnwrap(player.preparedStream?.entry), crossfade = try XCTUnwrap(player.crossfade)
            let locked = try XCTUnwrap(crossfade.analysisDiagnostics["planOutStart"] as? Double)
            let generation = player.streamOutput?.transitionGain.clock.generation
            crossfade.songLyricsChanged(outgoingSong, automatic: true)
            XCTAssertTrue(player.preparedStream?.entry === next)
            XCTAssertTrue(next.playing)
            XCTAssertEqual(crossfade.analysisDiagnostics["armed"] as? Bool, true)
            XCTAssertEqual(crossfade.analysisDiagnostics["planOutStart"] as? Double, locked)
            XCTAssertEqual(player.streamOutput?.transitionGain.clock.generation, generation)
            lyricRefresh = ["duringMutedPreplay": true, "planOutStart": locked, "position": player.playbackPosition]
        }
        audio.reset()
        var samples: [[String: Any]] = [], sawStem = false, finished = false, stopped = 0
        for index in 0..<400 {
            try await Task.sleep(for: .milliseconds(100))
            let clock = player.streamOutput?.transitionGain.clock
            let rendered = player.crossfade?.isStemFading == true && clock?.stemFailed == false
                && (clock?.renderedEnd ?? 0) > (clock?.curveStart ?? .infinity) + 512
            sawStem = sawStem || rendered
            if !player.outputIsPlaying { stopped += 1 }
            samples.append(["index": player.index, "stem": rendered, "playing": player.outputIsPlaying,
                "stemFailed": clock?.stemFailed ?? false, "clockInvalid": clock?.stemClockInvalid ?? false])
            if index % 20 == 0 { print("FOLIA_ONLINE_AUTOMIX handover index=\(player.index) stem=\(rendered) status=\(player.crossfade?.stemPreparationStatus ?? "missing")") }
            if player.index == 1, player.crossfade?.isFading == false { finished = true; break }
        }
        XCTAssertTrue(sawStem, "A master-only fallback does not pass full Automix")
        XCTAssertTrue(finished); XCTAssertEqual(stopped, 0)
        XCTAssertFalse(samples.contains { $0["stemFailed"] as? Bool == true || $0["clockInvalid"] as? Bool == true })
        if let loopingNext {
            try await waitForStream { player.preparedStream?.index == loopingNext && (player.preparedStream?.entry.audio.bufferedDuration ?? 0) > 0.5 }
        }
        // Prefetch decodes silently outside the hardware graph; only the current song remains attached.
        XCTAssertEqual(player.streamOutput?.attachedCount, 1)
        let pcm = audio.read()
        XCTAssertGreaterThan(pcm.frames, 10000); XCTAssertGreaterThan(pcm.rms, 0.00001)
        return ["plan": plan, "lyricRefresh": lyricRefresh, "sawStem": sawStem, "finished": finished, "notPlayingSamples": stopped,
            "audioFrames": pcm.frames, "audioRMS": pcm.rms, "samples": samples]
    }
}
