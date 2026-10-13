import XCTest
import AVFoundation
@testable import App

// AudioQualityTests.swift — preferences change future resolutions, never audible occurrences or cache identity.
private final class QualityPayloadGateway: GatewayClient {
    var qualities: [String] = []
    override func send(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        XCTAssertEqual(path, "/mobile/resolve")
        qualities.append(body?["quality"] as? String ?? "missing")
        return ["url": "https://audio.example.invalid/fixture.mp3"]
    }
}
private final class DelayedQualityGateway: GatewayClient {
    let url: URL
    var release: (() -> Void)?
    var qualities: [String] = []
    init(url: URL) { self.url = url }
    override func send(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] { throw MobileFailure("fixture-no-lyrics") }
    override func resolve(_ song: [String: Any], quality: String = "standard") async throws -> NativeAudioSource {
        qualities.append(quality)
        if (song["sourceRef"] as? [String: Any])?["mediaId"] as? String == "next", quality == "standard" {
            // Deliberately ignore cancellation: the old network reply must not replace the newer preload.
            await withCheckedContinuation { continuation in release = { continuation.resume() } }
        }
        return NativeAudioSource(url: url)
    }
}
@MainActor extension NativeTests {
    func testAudioQualityMigratesPersistsAndRejectsInvalidEditsAtomically() throws {
        let tested = engine(); tested.network.cancel(); defer { tested.stop() }
        var legacy = NativeAudioSettings().dictionary
        legacy.removeValue(forKey: "audioQuality")
        tested.storage.set(try JSONSerialization.data(withJSONObject: legacy), forKey: "folia.audio")
        tested.restoreAudioSettings()
        XCTAssertEqual(tested.audioSettings.audioQuality, "standard")
        for tier in NativeAudioSettings.audioQualities {
            var settings = tested.audioSettings; settings.audioQuality = tier
            _ = try tested.setAudioSettings(settings.dictionary)
            XCTAssertEqual(tested.audioSettings.audioQuality, tier)
        }
        let saved = tested.storage.data(forKey: "folia.audio")
        var invalid = tested.audioSettings; invalid.audioQuality = "exhigh"; invalid.volume = 0.1
        XCTAssertThrowsError(try tested.setAudioSettings(invalid.dictionary))
        XCTAssertEqual(tested.audioSettings.audioQuality, "hires"); XCTAssertEqual(tested.audioSettings.volume, 1)
        XCTAssertEqual(tested.storage.data(forKey: "folia.audio"), saved)
        let restored = PlaybackEngine(gateway: FailingGateway(), storage: tested.storage)
        restored.network.cancel(); defer { restored.stop() }
        XCTAssertEqual(restored.audioSettings.audioQuality, "hires")
    }

    func testAudioQualityGatewayCarriesFourTiersAndRejectsUnknownBeforeSending() async throws {
        let gateway = QualityPayloadGateway(), track = song("qq", "quality-payload")
        for tier in NativeAudioSettings.audioQualities { _ = try await gateway.resolve(track, quality: tier) }
        XCTAssertEqual(gateway.qualities, NativeAudioSettings.audioQualities)
        do { _ = try await gateway.resolve(track, quality: "invalid"); XCTFail("Unknown tier accepted") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "invalid-audio-settings") }
        XCTAssertEqual(gateway.qualities.count, 4)
    }

    func testAudioQualityRepreparesOnlineNextWithoutRestartingPlayingOrPausedAudio() async throws {
        let url = try streamingTone(); defer { try? FileManager.default.removeItem(at: url) }
        let gateway = AudioFixtureGateway(url: url), tested = stereoEngine(gateway)
        defer { tested.stop(); tested.clearOutput() }
        try tested.setQueue([song("qq", "current"), song("netease", "next")], at: 0)
        try await waitForStream { tested.outputIsPlaying && tested.preparedStream != nil }
        let current = try XCTUnwrap(tested.stream), generation = tested.generation, before = tested.playbackPosition
        let old = try XCTUnwrap(tested.preparedStream?.entry)
        var settings = tested.audioSettings; settings.audioQuality = "lossless"
        _ = try tested.setAudioSettings(settings.dictionary)
        try await waitForStream { tested.preparedStream != nil && tested.playbackPosition > before }
        XCTAssertTrue(tested.stream === current); XCTAssertEqual(tested.generation, generation)
        XCTAssertFalse(tested.preparedStream?.entry === old); XCTAssertTrue(tested.outputIsPlaying)
        XCTAssertEqual(gateway.resolved, ["current", "next", "next"])
        XCTAssertEqual(gateway.qualities, ["standard", "standard", "lossless"])
        try tested.command("pause")
        XCTAssertFalse(tested.intentToPlay)
        settings.audioQuality = "high"; _ = try tested.setAudioSettings(settings.dictionary)
        XCTAssertFalse(tested.intentToPlay)
        // Pause keeps decoding during the original fade drain; changing quality must not cancel its completion.
        try await waitForStream { tested.preparedStream != nil && !tested.outputIsPlaying }
        let paused = tested.playbackPosition
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertTrue(tested.stream === current); XCTAssertFalse(tested.outputIsPlaying)
        XCTAssertEqual(tested.generation, generation); XCTAssertFalse(tested.intentToPlay)
        XCTAssertEqual(tested.playbackPosition, paused, accuracy: 0.01)
        XCTAssertEqual(gateway.qualities.last, "high")
    }

    func testAudioQualityLateOldResolutionCannotReplaceNewPreload() async throws {
        let url = try streamingTone(); defer { try? FileManager.default.removeItem(at: url) }
        let gateway = DelayedQualityGateway(url: url), tested = stereoEngine(gateway)
        defer { gateway.release?(); gateway.release = nil; tested.stop(); tested.clearOutput() }
        try tested.setQueue([song("qq", "current"), song("netease", "next")], at: 0)
        try await waitForStream { tested.outputIsPlaying && gateway.release != nil }
        var settings = tested.audioSettings; settings.audioQuality = "hires"
        _ = try tested.setAudioSettings(settings.dictionary)
        try await waitForStream { tested.preparedStream != nil }
        let next = try XCTUnwrap(tested.preparedStream?.entry)
        gateway.release?(); gateway.release = nil
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertTrue(tested.preparedStream?.entry === next)
        XCTAssertEqual(gateway.qualities, ["standard", "standard", "hires"])
        tested.move(1)
        try await waitForStream { tested.index == 1 && tested.outputIsPlaying }
        XCTAssertTrue(tested.stream === next)
    }

    func testAudioQualityPreservesLocalPreloadAndAvoidsGateway() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let url = try streamingTone()
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: url) }
        let library = LocalMediaLibrary(root: root), gateway = FailingGateway()
        let track = try await library.importAudio(url)
        let tested = PlaybackEngine(gateway: gateway, storage: engine().storage, local: library, usesStereoOutput: true)
        tested.network.cancel(); defer { tested.stop(); tested.clearOutput() }
        try tested.setQueue([track, track], at: 0)
        try await waitForStream { tested.outputIsPlaying && tested.preparedStream != nil }
        let next = tested.preparedStream?.entry, current = tested.stream
        var settings = tested.audioSettings; settings.audioQuality = "hires"
        _ = try tested.setAudioSettings(settings.dictionary)
        XCTAssertTrue(tested.stream === current); XCTAssertTrue(tested.preparedStream?.entry === next)
        XCTAssertEqual(gateway.count, 0)
    }

    func testAudioQualityPreservesActiveCrossfadeThenResolvesFollowingTrackAtNewTier() async throws {
        let url = try sharedConstantFile(seconds: 8); defer { try? FileManager.default.removeItem(at: url) }
        let tested = try await startCrossfadeQueue(url, songs: [song("qq", "a"), song("netease", "b"), song("qq", "c")])
        defer { tested.stop(); tested.clearOutput() }
        let incoming = tested.stream, gateway = try XCTUnwrap(tested.gateway as? AudioFixtureGateway)
        var settings = tested.audioSettings; settings.audioQuality = "lossless"
        _ = try tested.setAudioSettings(settings.dictionary)
        XCTAssertTrue(tested.crossfade!.isFading); XCTAssertTrue(tested.stream === incoming)
        XCTAssertEqual(tested.streamOutput?.attachedCount, 2)
        try await waitForStream { tested.crossfade?.isFading == false && tested.preparedStream?.index == 2 }
        XCTAssertTrue(tested.stream === incoming); XCTAssertEqual(gateway.resolved.last, "c")
        XCTAssertEqual(gateway.qualities.last, "lossless")
    }

    func testAudioQualityLegacyQueueReconcilesAlreadyAdvancedItem() async throws {
        let url = try streamingTone(); defer { try? FileManager.default.removeItem(at: url) }
        let gateway = AudioFixtureGateway(url: url), tested = engine(gateway)
        tested.network.cancel(); defer { tested.stop(); tested.clearOutput() }
        try tested.setQueue([song("qq", "a"), song("netease", "b"), song("qq", "c")], at: 0)
        try await waitForStream { tested.prepared != nil }
        let next = try XCTUnwrap(tested.prepared?.item)
        tested.player.advanceToNextItem()
        var settings = tested.audioSettings; settings.audioQuality = "high"
        _ = try tested.setAudioSettings(settings.dictionary)
        XCTAssertTrue(tested.player.currentItem === next); XCTAssertEqual(tested.index, 1)
        try await waitForStream { tested.prepared?.index == 2 }
        XCTAssertEqual(gateway.qualities.last, "high")
    }
}
