import XCTest
import AVFoundation
@testable import App

// NativeTests.swift — native policy/state tests; no real music accounts or provider network.
final class FailingGateway: GatewayClient {
    var count = 0
    var code = "unavailable"
    override func resolve(_ song: [String: Any], quality: String = "standard") async throws -> NativeAudioSource { count += 1; throw MobileFailure(code) }
    override func send(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] { throw MobileFailure("fixture-no-lyrics") }
}
final class AudioFixtureGateway: GatewayClient {
    let url: URL
    var resolved: [String] = []
    var qualities: [String] = []
    init(url: URL) { self.url = url }
    override func send(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] { throw MobileFailure("fixture-no-lyrics") }
    override func resolve(_ song: [String: Any], quality: String = "standard") async throws -> NativeAudioSource {
        let id = (song["sourceRef"] as? [String: Any])?["mediaId"] as? String ?? ""
        resolved.append(id)
        qualities.append(quality)
        if id == "slow" { try? await Task.sleep(nanoseconds: 250_000_000) }
        return NativeAudioSource(url: url, replayGain: NativeReplayGainInfo(song["replayGain"]))
    }
}
final class RefreshingAudioGateway: GatewayClient {
    let validURL: URL
    let missingURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
    var count = 0
    init(validURL: URL) { self.validURL = validURL }
    override func send(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] { throw MobileFailure("fixture-no-lyrics") }
    override func resolve(_ song: [String: Any], quality: String = "standard") async throws -> NativeAudioSource {
        count += 1
        return NativeAudioSource(url: count == 1 ? missingURL : validURL)
    }
}
@MainActor final class NativeTests: XCTestCase {
    func song(_ provider: String, _ id: String) -> [String: Any] {
        ["name": id, "sourceRef": ["kind": "online", "providerId": provider, "mediaId": id]]
    }
    func engine(_ gateway: GatewayClient = FailingGateway()) -> PlaybackEngine {
        let storage = UserDefaults(suiteName: "folia.native-tests")!
        storage.removePersistentDomain(forName: "folia.native-tests")
        return PlaybackEngine(gateway: gateway, storage: storage)
    }
    func silentAudio() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44100)!
        buffer.frameLength = 44100
        buffer.floatChannelData?.pointee.update(repeating: 0, count: 44100)
        let file = try AVAudioFile(forWriting: url, settings: format.settings)
        try file.write(from: buffer)
        return url
    }
    func testHTTPSOriginValidation() throws {
        XCTAssertEqual(try GatewayClient.validatedServer("https://music.example.com/"), "https://music.example.com")
        for value in ["http://example.com", "https://u:p@example.com", "https://example.com/path", "https://example.com?secret=1"] {
            XCTAssertThrowsError(try GatewayClient.validatedServer(value))
        }
    }
    func testLyricSharePreservesUTF8AndAcceptsOriginalFormats() throws {
        let content = "[00:02.00]原始歌词 🎵\n[00:02.00]Translation\n"
        XCTAssertEqual(try LyricFileShare.validate(fileName: "歌曲 - 作者.lrc", content: content), Data(content.utf8))
        let document = "{\"lyrics\":{\"lines\":[]}}\n"
        XCTAssertEqual(try LyricFileShare.validate(fileName: "01 Original.fia", content: document), Data(document.utf8))
    }
    func testLyricArchiveSharePreservesBytesAndRejectsInvalidInput() throws {
        let bytes = Data([0x50, 0x4b, 0x03, 0x04, 0, 255, 128, 1])
        XCTAssertEqual(try LyricFileShare.validateArchive(fileName: "歌词.zip", encoded: bytes.base64EncodedString()), bytes)
        for name in ["../lyrics.zip", "lyrics.lrc", ".hidden.zip", "lyrics\n.zip"] {
            XCTAssertThrowsError(try LyricFileShare.validateArchive(fileName: name, encoded: bytes.base64EncodedString()))
        }
        for encoded in ["", "%%%", Data("text".utf8).base64EncodedString(), String(repeating: "A", count: 21_333_337)] {
            XCTAssertThrowsError(try LyricFileShare.validateArchive(fileName: "lyrics.zip", encoded: encoded))
        }
    }
    func testLyricShareRejectsPathsControlCharactersAndOversizedUTF8() {
        for name in ["", ".hidden.lrc", "../song.lrc", "folder/song.lrc", "folder\\song.lrc", "x:y.lrc",
                     "x\n.lrc", "x\u{0}.lrc", "song.mp3", String(repeating: "歌", count: 84) + ".lrc"] {
            XCTAssertThrowsError(try LyricFileShare.validate(fileName: name, content: "lyrics"), name)
        }
        XCTAssertThrowsError(try LyricFileShare.validate(fileName: "song.lrc", content: ""))
        XCTAssertThrowsError(try LyricFileShare.validate(fileName: "song.lrc", content: String(repeating: "歌", count: 5_333_334)))
    }
    func testPlaylistSharePreservesUTF8AndUsesItsOwnAllowlist() throws {
        let text = "#EXTM3U\r\n#PLAYLIST:歌单\r\n#EXTINF:12,歌手 - 歌曲\r\n歌曲.wav\r\n"
        XCTAssertEqual(try LyricFileShare.validatePlaylist(fileName: "歌单.m3u8", content: text), Data(text.utf8))
        for name in ["../list.m3u8", ".hidden.m3u8", "list.lrc", "list.zip", "a\n.m3u8", "x:y.m3u8",
                     String(repeating: "歌", count: 84) + ".m3u8"] {
            XCTAssertThrowsError(try LyricFileShare.validatePlaylist(fileName: name, content: text))
        }
        for content in ["", "#EXTM3U\r\n\0", "#EXTM3U\r\n" + String(repeating: "歌", count: 666_667)] {
            XCTAssertThrowsError(try LyricFileShare.validatePlaylist(fileName: "list.m3u8", content: content))
        }
        XCTAssertThrowsError(try LyricFileShare.validate(fileName: "list.m3u8", content: text))
    }
    func testQueueRequiresPlatformIdentity() {
        let player = engine()
        XCTAssertThrowsError(try player.setQueue([["id": 42]], at: 0))
        XCTAssertThrowsError(try player.setQueue([song("unknown", "42")], at: 0))
        XCTAssertThrowsError(try player.setQueue([song("netease", "42")], at: 9))
    }
    func testLoopBoundariesAndCrossPlatformQueue() {
        let player = engine()
        player.queue = [song("netease", "42"), song("qq", "42"), song("kugou", "42")]
        player.index = 2
        XCTAssertNil(player.nextIndex())
        player.repeatMode = "all"
        XCTAssertEqual(player.nextIndex(), 0)
        player.index = 0
        XCTAssertEqual(player.nextIndex(-1), 2)
        player.repeatMode = "one"
        XCTAssertEqual(player.nextIndex(automatic: true), 0)
        XCTAssertEqual(player.nextIndex(), 1)
    }
    func testThreeFailuresStopAndEachURLRefreshesOnce() async throws {
        let gateway = FailingGateway(), player = engine()
        // Retain this injected resolver throughout the asynchronous failure chain.
        let tested = PlaybackEngine(gateway: gateway, storage: player.storage)
        tested.network.cancel()
        let stopped = expectation(description: "three failed songs stop")
        var signaled = false
        tested.emit = { snapshot in if !signaled && snapshot["error"] as? String == "unavailable" { signaled = true; stopped.fulfill() } }
        try tested.setQueue([song("netease", "1"), song("qq", "2"), song("kugou", "3"), song("qq", "4")], at: 0)
        await fulfillment(of: [stopped], timeout: 10)
        tested.emit = nil
        XCTAssertEqual(gateway.count, 6)
        XCTAssertEqual(tested.index, 2)
        XCTAssertFalse(tested.intentToPlay)
        XCTAssertEqual(tested.error, "unavailable")
    }
    func testAuthFailureStopsWithoutSkipping() async throws {
        let gateway = FailingGateway(); gateway.code = "auth-required"
        let player = engine(gateway); player.network.cancel()
        try player.setQueue([song("qq", "1"), song("netease", "2")], at: 0)
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(gateway.count, 1)
        XCTAssertEqual(player.index, 0)
        XCTAssertEqual(player.error, "auth-required")
    }
    func testLogoutRemovesOnlyOneProvidersQueueEntries() {
        let player = engine()
        player.queue = [song("qq", "1"), song("netease", "1")]
        player.invalidateProvider("qq")
        XCTAssertEqual(player.queue.count, 1)
        XCTAssertEqual((player.queue[0]["sourceRef"] as? [String: String])?["providerId"], "netease")
        XCTAssertFalse(player.intentToPlay)
    }
    func testKeychainRoundTripAndDeletion() throws {
        let key = "test." + UUID().uuidString
        defer { try? SecureStore.remove(key) }
        try SecureStore.write(key, ["cookie": "fixture"])
        XCTAssertEqual(try SecureStore.read(key)["cookie"] as? String, "fixture")
        try SecureStore.remove(key)
        XCTAssertTrue(try SecureStore.read(key).isEmpty)
    }
    func testNativeQueueAdvancesWithoutAnyWebViewCalls() async throws {
        let url = try silentAudio()
        defer { try? FileManager.default.removeItem(at: url) }
        let gateway = AudioFixtureGateway(url: url), player = engine()
        let tested = PlaybackEngine(gateway: gateway, storage: player.storage); tested.network.cancel()
        let advanced = expectation(description: "native queue advances")
        var observed = false
        tested.emit = { state in if !observed && state["index"] as? Int == 1 { observed = true; advanced.fulfill() } }
        try tested.setQueue([song("netease", "1"), song("qq", "2")], at: 0)
        await fulfillment(of: [advanced], timeout: 10)
        tested.emit = nil
        XCTAssertTrue(gateway.resolved.contains("2"))
        XCTAssertEqual(tested.index, 1)
        XCTAssertEqual(tested.failures, 0, "Must advance by completion, not by skipping a broken fixture")
        XCTAssertEqual(tested.player.currentItem?.status, .readyToPlay)
        XCTAssertEqual(tested.player.currentItem?.duration.seconds ?? 0, 1, accuracy: 0.1)
        tested.stop()
    }
    func testUnplayableAddressRefreshesOnceWithoutWebView() async throws {
        let url = try silentAudio()
        defer { try? FileManager.default.removeItem(at: url) }
        let gateway = RefreshingAudioGateway(validURL: url), player = engine(gateway)
        player.network.cancel()
        defer { player.emit = nil; player.stop() }
        let recovered = expectation(description: "refreshed audio actually plays")
        var signaled = false
        player.emit = { state in
            if !signaled && state["playing"] as? Bool == true && (state["position"] as? Double ?? 0) > 0 {
                signaled = true; recovered.fulfill()
            }
        }
        try player.setQueue([song("qq", "1")], at: 0)
        await fulfillment(of: [recovered], timeout: 10)
        XCTAssertEqual(gateway.count, 2)
        XCTAssertEqual(player.index, 0)
        XCTAssertEqual(player.failures, 0)
        XCTAssertNil(player.error)
        XCTAssertEqual(player.player.currentItem?.status, .readyToPlay)
    }
    func testObsoleteEndEventCannotOverrideNewSelection() throws {
        let gateway = AudioFixtureGateway(url: URL(fileURLWithPath: "/nonexistent-fixture.wav"))
        let player = engine(gateway); player.network.cancel()
        defer { player.stop() }
        player.queue = [song("netease", "old"), song("qq", "slow"), song("netease", "last")]
        player.index = 0
        let oldItem = AVPlayerItem(url: gateway.url)
        player.player.insert(oldItem, after: nil)
        player.observeStatus(oldItem, epoch: player.generation)
        player.select(1)
        let selectedGeneration = player.generation
        NotificationCenter.default.post(name: .AVPlayerItemDidPlayToEndTime, object: oldItem)
        XCTAssertEqual(player.index, 1, "A queued completion from the previous song must not skip the selected song")
        XCTAssertEqual(player.generation, selectedGeneration)
    }
    func testStoppedEngineIgnoresPendingAudioEvents() {
        let player = engine(); player.network.cancel()
        defer { player.stop() }
        player.queue = [song("qq", "old"), song("netease", "next")]
        player.index = 0
        let oldItem = AVPlayerItem(url: URL(fileURLWithPath: "/nonexistent-fixture.wav"))
        player.player.insert(oldItem, after: nil)
        player.observeStatus(oldItem, epoch: player.generation)
        player.stop("auth-required")
        let stoppedGeneration = player.generation
        NotificationCenter.default.post(name: .AVPlayerItemFailedToPlayToEndTime, object: oldItem)
        NotificationCenter.default.post(name: .AVPlayerItemDidPlayToEndTime, object: oldItem)
        XCTAssertEqual(player.index, 0)
        XCTAssertEqual(player.generation, stoppedGeneration)
        XCTAssertEqual(player.error, "auth-required")
        XCTAssertFalse(player.intentToPlay)
    }
    func testPlayAfterStopReattachesCurrentItemObservation() throws {
        let player = engine(); player.network.cancel()
        defer { player.stop() }
        let url = try silentAudio()
        defer { try? FileManager.default.removeItem(at: url) }
        player.queue = [song("qq", "1")]; player.index = 0
        let item = AVPlayerItem(url: url)
        player.player.insert(item, after: nil)
        player.observeStatus(item, epoch: player.generation)
        player.stop()
        XCTAssertNil(player.observedItem)
        try player.command("play")
        XCTAssertTrue(player.observedItem === item)
        let resumedGeneration = player.generation
        NotificationCenter.default.post(name: .AVPlayerItemFailedToPlayToEndTime, object: item)
        XCTAssertTrue(player.retried)
        XCTAssertEqual(player.generation, resumedGeneration + 1)
    }
    func testSlowOldResolveCannotReplaceNewSelection() async throws {
        let gateway = AudioFixtureGateway(url: URL(fileURLWithPath: "/nonexistent-fixture.wav"))
        let player = engine(gateway); player.network.cancel()
        player.queue = [song("qq", "slow"), song("netease", "new")]
        player.select(0)
        try await Task.sleep(nanoseconds: 20_000_000)
        player.select(1)
        try await Task.sleep(nanoseconds: 400_000_000)
        XCTAssertEqual(player.index, 1)
        player.stop()
    }
    func testQueueSanitizationDropsTemporaryURLsAndSecrets() throws {
        var raw = song("qq", "42"); raw["url"] = "https://cdn.example.com?signature=secret"; raw["cookie"] = "secret"
        let clean = try PlaybackEngine.sanitizedSong(raw)
        XCTAssertNil(clean["url"]); XCTAssertNil(clean["cookie"])
        XCTAssertEqual((clean["sourceRef"] as? [String: String])?["providerId"], "qq")
    }
    func testPersistenceContainsIdentityAndNoResolvedURL() throws {
        let player = engine()
        player.queue = [song("qq", "42")]; player.index = 0
        player.restoredPosition = 12.5; player.persist()
        let restored = PlaybackEngine(gateway: FailingGateway(), storage: player.storage)
        XCTAssertEqual(restored.queue.count, 1)
        XCTAssertEqual(restored.restoredPosition, 12.5)
        XCTAssertFalse(restored.intentToPlay)
        let data = player.storage.data(forKey: "folia.queue")!
        XCTAssertFalse(String(data: data, encoding: .utf8)!.contains("https:"))
    }
}
