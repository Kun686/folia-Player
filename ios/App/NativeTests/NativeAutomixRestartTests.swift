import XCTest
import AVFoundation
@testable import App

// NativeAutomixRestartTests.swift — two test-host processes share only the original persisted queue, media and models.
private final class RestartOfflineHTTPProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var requests = 0
    static var count: Int { lock.lock(); defer { lock.unlock() }; return requests }
    override class func canInit(with request: URLRequest) -> Bool { ["https", "http"].contains(request.url?.scheme ?? "") }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); Self.requests += 1; Self.lock.unlock()
        client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
    }
    override func stopLoading() { /* Failure is synchronous; there is no pending delivery to cancel. */ }
}

@MainActor extension NativeTests {
    func testOriginalAutomixRestoresOfflineAcrossProcessRestart() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard Bundle.main.bundleIdentifier == "app.folia.validation.App",
              let phase = environment["FOLIA_AUTOMIX_RESTART_PHASE"], ["seed", "restore"].contains(phase),
              let id = environment["FOLIA_AUTOMIX_RESTART_ID"].flatMap(UUID.init(uuidString:)) else {
            throw XCTSkip("Run the two explicit phases with one new UUID in the independent QA simulator")
        }
        let manager = FileManager.default
        let assets = manager.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("ORTQA")
        let root = assets.appendingPathComponent("restart-" + id.uuidString)
        let suite = "folia.automix-restart." + id.uuidString
        let storage = try XCTUnwrap(UserDefaults(suiteName: suite))
        let marker = root.appendingPathComponent("seed.json")
        let previous: [String: Any]
        if phase == "seed" {
            XCTAssertNil(storage.data(forKey: "folia.queue"))
            guard !manager.fileExists(atPath: root.path) else { throw MobileFailure("qa-restart-id-reused") }
            try manager.createDirectory(at: root, withIntermediateDirectories: true)
            previous = [:]
        } else {
            previous = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: marker)) as? [String: Any])
            XCTAssertEqual(previous["runID"] as? String, id.uuidString)
            XCTAssertNotEqual(previous["pid"] as? Int, Int(ProcessInfo.processInfo.processIdentifier), "A new engine in the same process is not a restart")
        }
        let songs = [song("qq", "restart-same-id"), song("netease", "restart-same-id")]
        let identities = try songs.map { try XCTUnwrap(NativeProfileIdentity($0)) }
        var fixtures: [ProfileHTTPFixture] = [], urls: [URL] = []
        var sourceHashes: [String] = []
        if phase == "seed" {
            for name in ["music.wav", "distinct.wav"] {
                let file = assets.appendingPathComponent(name)
                let bytes = try Data(contentsOf: file)
                sourceHashes.append(NativeProfileCache.digest(bytes))
                let fixture = ProfileHTTPFixture(bytes); fixture.delay = 0.0001
                fixtures.append(fixture); urls.append(ProfileHTTPProtocol.add(fixture))
            }
            XCTAssertNotEqual(sourceHashes[0], sourceHashes[1])
        } else { sourceHashes = try XCTUnwrap(previous["sourceHashes"] as? [String]) }
        defer { urls.forEach(ProfileHTTPProtocol.remove) }
        let gateway = OnlineAutomixGateway(sources: Dictionary(uniqueKeysWithValues: zip(identities.map(\.key), urls)))
        gateway.offline = phase == "restore"
        let configuration = profileNetworkConfiguration()
        if phase == "restore" { configuration.protocolClasses = [RestartOfflineHTTPProtocol.self] }
        let settings = storage.data(forKey: "folia.media-cache").flatMap { try? JSONDecoder().decode(NativeMediaCacheSettings.self, from: $0) } ?? .init()
        let media = NativeMediaCache(directory: root.appendingPathComponent("media"), configuration: configuration, settings: settings)
        let local = LocalMediaLibrary(root: root.appendingPathComponent("local"))
        let player = PlaybackEngine(gateway: gateway, storage: storage, local: local, usesStereoOutput: true,
            mediaNetworkConfiguration: configuration, mediaCache: media,
            coverCache: NativeCoverCache(root: root.appendingPathComponent("covers")), lyricCache: NativeLyricCache(root: root.appendingPathComponent("lyrics")))
        player.network.cancel()
        let trace = NativeAnalysisTrace()
        let profiles = NativeTrackProfiles(local: local, profiler: NativeTrackProfiler(cacheDirectory: root.appendingPathComponent("profiles"), trace: trace),
            configuration: configuration, mediaCache: media)
        let cache = NativeStemCache()
        let stems = NativeTrackStems(local: local, mediaCache: media, cache: cache, separator: MeasuredQueueStemSeparator(),
            profilesIdle: { !profiles.hasPending }, providerBarrier: { [weak player] in player?.mediaCachePurges[$0] })
        player.crossfade?.cancel()
        player.crossfade = NativeCrossfade(owner: player, profiles: profiles, stems: stems, trace: trace)
        // The injected isolated analysis directories replace the constructor's crossfade; apply its saved settings too.
        player.restoreTransitionSettings()
        defer { player.stop(); player.clearOutput(); player.crossfade?.cancelAnalysis(); profiles.cancel(); stems.cancel() }
        var report: [String: Any] = ["phase": phase, "runID": id.uuidString, "pid": Int(ProcessInfo.processInfo.processIdentifier), "sourceHashes": sourceHashes]
        defer {
            report["trace"] = trace.snapshot(); report["resolves"] = gateway.resolves.count
            report["httpRequests"] = fixtures.reduce(0) { $0 + $1.stats.requests }
            report["offlineHTTPAttempts"] = RestartOfflineHTTPProtocol.count
            if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
                try? data.write(to: root.appendingPathComponent(phase + "-report.json"), options: .atomic)
                let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                attachment.name = "automix-restart-" + phase + ".json"; attachment.lifetime = .keepAlways; add(attachment)
            }
        }
        let models = try PlaybackModels(engine: player, store: NativeModelStore(directory: root.appendingPathComponent("models")))
        models.start(); try await waitForStream({ models.ready }, seconds: 15)
        if phase == "seed" {
            try await models.install(assets.appendingPathComponent("beat_this.onnx"))
            try await models.install(assets.appendingPathComponent("htdemucs.onnx"))
            _ = try await player.configureMediaCache(.init(enabled: true))
            _ = try player.setTransitionSettings(["enabled": true, "mode": "automix", "crossfadeMaxSec": 5.0, "performance": true])
            try player.setQueue(songs, at: 0)
            try player.command("repeat", mode: "all")
        } else {
            XCTAssertEqual(player.queue.compactMap(NativeProfileIdentity.init).map(\.key), identities.map(\.key))
            XCTAssertEqual(player.index, 0); XCTAssertEqual(player.repeatMode, "all")
            XCTAssertEqual(player.currentSong.flatMap(NativeProfileIdentity.init)?.key, identities[0].key)
            XCTAssertEqual(player.playbackPosition, try XCTUnwrap(previous["position"] as? Double), accuracy: 0.001)
            XCTAssertEqual(player.transitionSettings.dictionary["performance"] as? Bool, true)
            XCTAssertEqual(player.crossfade?.mode, "automix")
            let restoredSettings = await media.settings; XCTAssertTrue(restoredSettings.enabled)
            XCTAssertNil(player.stream); XCTAssertFalse(player.intentToPlay); XCTAssertFalse(player.outputIsPlaying)
            let installed = try XCTUnwrap(models.snapshot()["models"] as? [[String: Any]])
            XCTAssertEqual(installed.filter { $0["installed"] as? Bool == true }.count, 2)
            let keys = await cache.keys; XCTAssertTrue(keys.isEmpty, "Stem PCM must be recomputed after process exit")
            XCTAssertTrue(gateway.resolves.isEmpty)
            report["restoredPosition"] = player.playbackPosition; report["restoredPaused"] = true
            try player.command("play")
        }
        try await waitForStream({ player.outputIsPlaying && player.playbackPosition > 0.5 }, seconds: 15)
        if phase == "restore" { XCTAssertGreaterThan(player.playbackPosition, 12) }
        for attempt in 0..<2400 {
            if profiles.value(songs[0]) != nil, profiles.value(songs[1]) != nil,
               stems.value(songs[0], role: .tail) != nil, stems.value(songs[1], role: .head) != nil { break }
            if attempt % 20 == 0 { print("FOLIA_RESTART phase=\(phase) tail=\(stems.phase(songs[0], role: .tail)) head=\(stems.phase(songs[1], role: .head))") }
            guard player.index == 0, player.intentToPlay else { throw MobileFailure("qa-restart-playback-stopped") }
            try await Task.sleep(for: .milliseconds(100))
        }
        _ = try XCTUnwrap(stems.value(songs[0], role: .tail)); _ = try XCTUnwrap(stems.value(songs[1], role: .head))
        let profileHashes = try songs.map { song in
            NativeProfileCache.digest(try JSONSerialization.data(withJSONObject: XCTUnwrap(profiles.value(song)), options: .sortedKeys))
        }
        report["profileHashes"] = profileHashes
        for (index, identity) in identities.enumerated() {
            let lease = try await media.cached(identity), hit = try XCTUnwrap(lease)
            XCTAssertEqual(try NativeStemSnapshot.capture(cached: hit, deadline: ProcessInfo.processInfo.systemUptime + 10).digest, sourceHashes[index])
        }
        if phase == "seed" {
            try player.command("seek", position: 12.25)
            try await waitForStream { player.stream?.seeking == false && player.playbackPosition >= 12.25 }
            try player.command("pause"); try await waitForStream { !player.outputIsPlaying }
            player.persist()
            report["position"] = player.playbackPosition
            let persisted = try XCTUnwrap(storage.data(forKey: "folia.queue"))
            let text = String(decoding: persisted, as: UTF8.self)
            XCTAssertFalse(text.contains("profile.invalid")); XCTAssertFalse(text.contains("fixture-only"))
            report["queueHash"] = NativeProfileCache.digest(persisted)
            XCTAssertTrue(storage.synchronize(), "The seed must be committed before the process is terminated")
            try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]).write(to: marker, options: .atomic)
        } else {
            XCTAssertEqual(profileHashes, previous["profileHashes"] as? [String])
            let events = try XCTUnwrap(trace.snapshot()["events"] as? [[String: Any]])
            XCTAssertFalse(events.contains { $0["stage"] as? String == "decode" }, "Persisted complete profiles must not trigger beat reanalysis")
            let output = try XCTUnwrap(player.streamOutput), audio = OutputMeasurement()
            output.engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { buffer, _ in audio.consume(buffer) }
            defer { output.engine.mainMixerNode.removeTap(onBus: 0) }
            report["offlineHandover"] = try await onlineAutomixHandover(player, audio: audio, loopingNext: 0)
            XCTAssertTrue(gateway.resolves.isEmpty, "Offline cache replay must not resolve either provider")
            XCTAssertEqual(RestartOfflineHTTPProtocol.count, 0)
            XCTAssertNil(player.error)
        }
    }
}
