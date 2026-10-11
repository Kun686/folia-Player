import XCTest
import zlib
@testable import App

// OnlineLyricTests.swift — isolated provider replies exercise native HTTP orchestration, original crypto and decoded queues.
final class LyricFixtureGateway: GatewayClient, @unchecked Sendable {
    // Current/next requests can execute on different executors; snapshot fixture state before awaiting.
    private let lock = NSLock()
    private var requests: [[String: Any]] = []
    private var responder: ([String: Any], Int) async throws -> [String: Any] = { _, _ in throw MobileFailure("fixture-missing") }
    private var source: URL?
    var calls: [[String: Any]] { lock.withLock { requests } }
    var handler: ([String: Any], Int) async throws -> [String: Any] {
        get { lock.withLock { responder } }
        set { lock.withLock { responder = newValue } }
    }
    var audioURL: URL? {
        get { lock.withLock { source } }
        set { lock.withLock { source = newValue } }
    }
    override func send(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        guard path == "/mobile/request", let body else { throw MobileFailure("fixture-path") }
        let (reply, count) = lock.withLock { requests.append(body); return (responder, requests.count) }
        return try await reply(body, count)
    }
    override func resolve(_ song: [String: Any]) async throws -> URL {
        guard let audioURL else { throw MobileFailure("fixture-audio-missing") }; return audioURL
    }
}

@MainActor extension NativeTests {
    func onlineLyricFixture() throws -> [[String: Any]] {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "OnlineLyricReference", withExtension: "json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [[String: Any]])
    }
    func testOriginalOnlineLyricsExecuteInJavaScriptCoreAndNativeTransport() async throws {
        let parser = NativeLyricParser(), rows = try onlineLyricFixture()
        XCTAssertEqual(rows.count, 7)
        for row in rows {
            let steps = try XCTUnwrap(row["steps"] as? [[String: Any]])
            for step in steps {
                let output = try await parser.onlineStep(JSONSerialization.data(withJSONObject: XCTUnwrap(step["input"])))
                assertTransitionJSON(try JSONSerialization.jsonObject(with: output), try XCTUnwrap(step["expected"]), path: row["name"] as? String ?? "online")
            }
            let last = try XCTUnwrap(steps.last?["input"] as? [String: Any])
            let replies = try XCTUnwrap(last["responses"] as? [[String: Any]])
            let gateway = LyricFixtureGateway()
            gateway.handler = { _, count in replies[count - 1] }
            let result = try await NativeOnlineLyrics.load(XCTUnwrap(last["song"] as? [String: Any]),
                session: XCTUnwrap(last["session"] as? [String: Any]), gateway: gateway, parser: parser)
            let expected = try XCTUnwrap(steps.last?["expected"] as? [String: Any])
            assertTransitionJSON(result as Any? ?? NSNull(), try XCTUnwrap(expected["lines"]))
            XCTAssertEqual(gateway.calls.count, replies.count)
        }
    }
    func testOnlineLyricCancellationAndAccountReplacementDiscardOldReplies() async throws {
        let local = LocalMediaLibrary(), gateway = LyricFixtureGateway()
        let netease = song("netease", "42")
        var cookie = "old-fixture-session"
        gateway.handler = { _, index in
            if index == 1 { try? await Task.sleep(nanoseconds: 300_000_000) }
            let text = index == 1 ? "[00:01.00]Old" : "[00:01.00]New"
            return ["status": 200, "body": String(decoding: try JSONSerialization.data(withJSONObject: ["code": 200, "lrc": ["lyric": text]]), as: UTF8.self)]
        }
        let lyrics = NativeLyrics(local: local, gateway: gateway, session: { _ in ["cookie": cookie] })
        defer { lyrics.cancel() }
        lyrics.update([netease])
        try await waitForStream { gateway.calls.count == 1 }
        cookie = "new-fixture-session"; lyrics.invalidateProvider("netease"); lyrics.update([netease])
        try await waitForStream { lyrics.value(netease)?.last?["fullText"] as? String == "New" }
        try await Task.sleep(nanoseconds: 350_000_000)
        XCTAssertEqual(lyrics.value(netease)?.last?["fullText"] as? String, "New")
        XCTAssertEqual((gateway.calls[0]["query"] as? [String: String])?["cookie"], "old-fixture-session")
        XCTAssertEqual((gateway.calls[1]["query"] as? [String: String])?["cookie"], "new-fixture-session")
        lyrics.invalidateProvider("netease"); XCTAssertNil(lyrics.value(netease))
        gateway.handler = { _, _ in try await Task.sleep(nanoseconds: 1_000_000_000); return [:] }
        let work = Task { try await NativeOnlineLyrics.load(netease, session: [:], gateway: gateway, parser: NativeLyricParser()) }
        try await waitForStream { gateway.calls.count == 3 }; work.cancel()
        do { _ = try await work.value; XCTFail("Cancelled request succeeded") } catch { XCTAssertTrue(error is CancellationError) }
    }
    func testQRCInflateBoundsAndEmptyOrDamagedStreams() throws {
        func packed(_ text: String) throws -> String {
            let input = Data(text.utf8)
            var capacity = compressBound(uLong(input.count)), output = [UInt8](repeating: 0, count: Int(compressBound(uLong(input.count))))
            let status = input.withUnsafeBytes { data in compress2(&output, &capacity, data.bindMemory(to: UInt8.self).baseAddress, uLong(input.count), Z_BEST_SPEED) }
            XCTAssertEqual(status, Z_OK)
            return Data(output.prefix(Int(capacity))).base64EncodedString()
        }
        XCTAssertEqual(NativeLyricInflate.text(try packed("UTF8 中文")), "UTF8 中文")
        XCTAssertEqual(NativeLyricInflate.text(try packed("")), "")
        XCTAssertNil(NativeLyricInflate.text(try packed(String(repeating: "a", count: 2_000_001))))
        XCTAssertNil(NativeLyricInflate.text("invalid"))
        XCTAssertNil(NativeLyricInflate.text(Data([1, 2, 3]).base64EncodedString()))
    }
    func testQQNumericLyricIdentitySurvivesNativeQueueSanitization() throws {
        var qq = song("qq", "mid42")
        qq["sourceRef"] = ["kind": "online", "providerId": "qq", "mediaId": "mid42", "providerData": ["songId": 42]]
        let result = try PlaybackEngine.sanitizedSong(qq), ref = try XCTUnwrap(result["sourceRef"] as? [String: Any])
        XCTAssertEqual(result["id"] as? String, "mid42")
        XCTAssertEqual((ref["providerData"] as? [String: Any])?["songId"] as? Int, 42)
    }
    func testBothOnlineProvidersDriveLyricAwareNativeQueueWithoutWebView() async throws {
        let rows = try onlineLyricFixture(), file = try sharedConstantFile(seconds: 30, stereo: true)
        defer { try? FileManager.default.removeItem(at: file) }
        var songs: [[String: Any]] = [], replies: [String: [String: Any]] = [:]
        for name in ["netease-yrc", "qq-qrc"] {
            let row = try XCTUnwrap(rows.first { $0["name"] as? String == name })
            let steps = try XCTUnwrap(row["steps"] as? [[String: Any]])
            let input = try XCTUnwrap(steps.last?["input"] as? [String: Any])
            songs.append(try XCTUnwrap(input["song"] as? [String: Any]))
            replies[name == "netease-yrc" ? "netease" : "lyrics"] = (input["responses"] as? [[String: Any]])?.last
        }
        for queue in [songs, Array(songs.reversed())] {
            let gateway = LyricFixtureGateway(); gateway.audioURL = file
            gateway.handler = { request, _ in try XCTUnwrap(replies[request["provider"] as? String ?? ""]) }
            let suite = "folia.online-lyric." + UUID().uuidString, storage = UserDefaults(suiteName: suite)!
            defer { storage.removePersistentDomain(forName: suite) }
            let local = LocalMediaLibrary(), lyrics = NativeLyrics(local: local, gateway: gateway, session: { _ in [:] })
            let tested = PlaybackEngine(gateway: gateway, storage: storage, local: local, usesStereoOutput: true)
            tested.network.cancel(); tested.crossfade = NativeCrossfade(owner: tested, lyrics: lyrics)
            defer { tested.stop(); tested.clearOutput() }
            _ = try tested.setTransitionSettings(["enabled": true, "mode": "automix", "crossfadeMaxSec": 5.0])
            try tested.setQueue(queue, at: 0)
            let current = try XCTUnwrap(tested.currentSong)
            try await waitForStream { tested.outputIsPlaying && tested.preparedStream != nil && lyrics.value(current) != nil }
            XCTAssertEqual(lyrics.value(current)?.last?["endTime"] as? Double, 26)
            try tested.command("seek", position: 23)
            try await waitForStream { tested.playbackPosition > 24 || tested.index == 1 }
            XCTAssertEqual(tested.index, 0)
            let outgoing = try XCTUnwrap(tested.stream)
            try tested.command("seek", position: 25.4)
            try await waitForStream { tested.index == 1 && tested.crossfade?.isFading == true }
            XCTAssertGreaterThanOrEqual(outgoing.position, 25.9)
            XCTAssertLessThan(outgoing.position, 26.8)
            XCTAssertEqual(tested.streamOutput?.attachedCount, 2)
            XCTAssertEqual(gateway.calls.count, 2)
            print("FOLIA_ONLINE_LYRIC_QUEUE provider=\((current["sourceRef"] as? [String: Any])?["providerId"] ?? "") at=\(outgoing.position) WebView=ABSENT")
        }
    }
}
