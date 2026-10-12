import XCTest
import AVFoundation
@testable import App

// ListeningSessionTests.swift — original JS accounting in the native host; never sends account writes.
@MainActor extension NativeTests {
    private func listen(_ session: NativeListeningSession, seconds: Double, song: [String: Any]? = nil,
                        start: Double = 0, clock: Double = 0, occurrence: String = "a") throws {
        let track = song ?? self.song("netease", "42")
        for i in 0...Int(seconds * 4) {
            XCTAssertNil(try session.observe(song: track, occurrence: occurrence, position: start + Double(i) / 4,
                duration: 240, playing: true, nowMs: clock + Double(i) * 250))
        }
    }
    func testListeningNativeMatchesOriginalThresholdDurationAndIdempotence() throws {
        let session = try NativeListeningSession()
        try listen(session, seconds: 45)
        let report = try XCTUnwrap(session.settle(nowMs: 45_000))
        XCTAssertEqual(report.mediaId, "42"); XCTAssertEqual(report.songKey, "online:netease:42")
        XCTAssertEqual(report.playedSeconds, 45); XCTAssertEqual(report.totalSeconds, 240)
        XCTAssertNil(try session.settle(nowMs: 45_000))
        try listen(session, seconds: 29, clock: 46_000)
        XCTAssertNil(try session.settle(nowMs: 76_000))
    }
    func testListeningNativePauseSmallSeekAndDiscardNeverCreateAListen() throws {
        let session = try NativeListeningSession()
        try listen(session, seconds: 29)
        _ = try session.observe(song: song("netease", "42"), occurrence: "a", position: 29, duration: 240, playing: false, nowMs: 30_000)
        _ = try session.observe(song: song("netease", "42"), occurrence: "a", position: 30, duration: 240, playing: false, nowMs: 50_000)
        try session.discontinuity()
        _ = try session.observe(song: song("netease", "42"), occurrence: "a", position: 31, duration: 240, playing: true, nowMs: 51_000)
        XCTAssertEqual(try session.listenedSeconds(), 29)
        XCTAssertNil(try session.settle(nowMs: 52_000))
        try listen(session, seconds: 40, clock: 53_000); try session.discard()
        XCTAssertNil(try session.settle(nowMs: 94_000))
    }
    func testListeningNativeRepeatAndOtherProviderSettleOnlyTheOutgoingOccurrence() throws {
        let session = try NativeListeningSession()
        try listen(session, seconds: 40)
        let first = try session.observe(song: song("netease", "42"), occurrence: "b", position: 0,
            duration: 240, playing: true, nowMs: 41_000)
        XCTAssertEqual(first?.playedSeconds, 40)
        try listen(session, seconds: 35, clock: 41_000, occurrence: "b")
        let second = try session.observe(song: song("qq", "42"), occurrence: "c", position: 0,
            duration: 240, playing: true, nowMs: 77_000)
        XCTAssertEqual(second?.playedSeconds, 35)
        XCTAssertNil(try session.settle(nowMs: 78_000))
    }
    func testListeningNativeRejectsCloudOtherSourcesUnsafeIDsAndClockRollback() throws {
        var cloud = song("netease", "42")
        cloud["sourceRef"] = ["kind": "online", "providerId": "netease", "mediaId": "42", "variant": "cloud"]
        let tracks = [cloud, song("qq", "42"), song("netease", "9007199254740992"),
            ["sourceRef": ["kind": "local", "mediaId": "42"]], ["id": 42]]
        for track in tracks {
            let session = try NativeListeningSession(); try listen(session, seconds: 40, song: track)
            XCTAssertNil(try session.settle(nowMs: 41_000))
        }
        let session = try NativeListeningSession(); try listen(session, seconds: 40)
        XCTAssertNil(try session.settle(nowMs: 1000)); XCTAssertNil(try session.settle(nowMs: 41_000))
        XCTAssertThrowsError(try session.observe(song: song("netease", "42"), occurrence: "a",
            position: .infinity, duration: 240, playing: true))
    }
    func testListeningNativeCountsActualDecodedAudioWithoutFrontendCallbacks() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        defer { try? FileManager.default.removeItem(at: url) }
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44100)!
        buffer.frameLength = 44100; buffer.floatChannelData!.pointee.update(repeating: 0, count: 44100)
        do { let file = try AVAudioFile(forWriting: url, settings: format.settings)
            for _ in 0..<50 { try file.write(from: buffer) }
        }
        let tested = stereoEngine(AudioFixtureGateway(url: url)), session = try NativeListeningSession()
        defer { tested.stop(); tested.clearOutput() }
        try tested.setQueue([song("netease", "42")], at: 0)
        let deadline = Date().addingTimeInterval(45)
        var paused = false, lastPrinted = 0
        while Date() < deadline {
            if try session.listenedSeconds() >= 31 { break }
            XCTAssertNil(try session.observe(song: tested.currentSong, occurrence: "a", position: tested.playbackPosition,
                duration: tested.playbackDuration, playing: tested.outputIsPlaying))
            let heard = try session.listenedSeconds()
            if Int(heard) / 5 > lastPrinted {
                lastPrinted = Int(heard) / 5; print("Native listening: decoded seconds=\(heard)")
            }
            if !paused && heard >= 10 {
                paused = true; try tested.command("pause")
                _ = try session.observe(song: tested.currentSong, occurrence: "a", position: tested.playbackPosition,
                    duration: tested.playbackDuration, playing: false)
                try await Task.sleep(nanoseconds: 1_000_000_000)
                _ = try session.observe(song: tested.currentSong, occurrence: "a", position: tested.playbackPosition,
                    duration: tested.playbackDuration, playing: false)
                XCTAssertEqual(try session.listenedSeconds(), heard)
                try tested.command("play")
            }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        let report = try XCTUnwrap(session.settle())
        XCTAssertTrue(paused); XCTAssertEqual(report.mediaId, "42")
        XCTAssertGreaterThanOrEqual(report.playedSeconds, 31); XCTAssertLessThanOrEqual(report.playedSeconds, 32)
        XCTAssertEqual(report.totalSeconds, 50)
        XCTAssertGreaterThanOrEqual(tested.playbackPosition, 31)
        XCTAssertTrue(tested.outputIsPlaying)
    }
}
