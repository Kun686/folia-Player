import XCTest
import AVFoundation
@testable import App

// ListeningReporterTests.swift — controlled account transport; the integration test uses real native decoder time.
final class ListeningFixtureGateway: GatewayClient {
    @MainActor var signedIn = true
    @MainActor var supported = true
    @MainActor var failure: String?
    @MainActor var hold = false
    @MainActor var audioURL: URL?
    @MainActor var reports: [(song: [String: Any], report: NativeListeningReport, quality: String)] = []
    @MainActor var pending: [CheckedContinuation<Void, Error>] = []
    @MainActor var cancellations = 0
    override func listeningAccountAvailable() -> Bool { MainActor.assumeIsolated { signedIn } }
    override func send(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        guard path == "/mobile/health" else { throw MobileFailure("fixture-no-network") }
        return await MainActor.run { ["protocol": 1, "providers": ["netease"], "playbackReportProviders": supported ? ["netease"] : []] }
    }
    override func resolve(_ song: [String: Any], quality: String = "standard") async throws -> NativeAudioSource {
        guard let audioURL = await MainActor.run(body: { self.audioURL }) else { throw MobileFailure("fixture-no-audio") }
        return NativeAudioSource(url: audioURL, replayGain: nil)
    }
    override func reportListening(song: [String: Any], report: NativeListeningReport, quality: String) async throws {
        try Task.checkCancellation()
        let (blocked, failure) = await MainActor.run {
            reports.append((song, report, quality)); return (hold, self.failure)
        }
        if blocked {
            // Deliberately non-cooperative completion tests that a cancelled old account cannot mutate new state.
            try await withTaskCancellationHandler(operation: {
                try await withCheckedThrowingContinuation { continuation in
                    Task { @MainActor in self.pending.append(continuation) }
                }
            }, onCancel: { Task { @MainActor in self.cancellations += 1 } })
        }
        if let failure { throw MobileFailure(failure) }
    }
    @MainActor func release() { let work = pending; pending = []; work.forEach { $0.resume() } }
}

private final class ListeningTestClock { var now = 0.0 }

@MainActor extension NativeTests {
    private func samples(_ reporter: NativeListeningReporter, clock: ListeningTestClock, seconds: Int = 35,
                         song: [String: Any]? = nil, quality: String = "standard") {
        for step in 0...seconds * 4 {
            reporter.observe(song: song ?? self.song("netease", "42"), position: Double(step) / 4,
                             duration: 240, playing: true, quality: quality)
            clock.now += 250
        }
    }
    func testListeningReporterDefaultOffOriginalMetadataAndRepeatAreIdempotent() async throws {
        let gateway = ListeningFixtureGateway(); let clock = ListeningTestClock()
        let tested = NativeListeningReporter(gateway: gateway, clock: { clock.now })
        defer { tested.invalidate() }
        tested.refresh(); try await waitForStream { tested.ready }
        samples(tested, clock: clock); tested.finishOccurrence(); XCTAssertTrue(gateway.reports.isEmpty)
        tested.setEnabled(true)
        samples(tested, clock: clock, quality: "lossless"); tested.finishOccurrence(); tested.finishOccurrence()
        try await waitForStream { gateway.reports.count == 1 }
        XCTAssertEqual(gateway.reports[0].report.playedSeconds, 35)
        XCTAssertEqual(gateway.reports[0].report.mediaId, "42"); XCTAssertEqual(gateway.reports[0].song["name"] as? String, "42")
        XCTAssertEqual(gateway.reports[0].quality, "lossless")
        try await Task.sleep(nanoseconds: 30_000_000)
        samples(tested, clock: clock); tested.finishOccurrence()
        try await waitForStream { gateway.reports.count == 2 }
    }
    func testListeningReporterDisableAndAccountChangeCancelWithoutBankingOldAudio() async throws {
        let gateway = ListeningFixtureGateway(); gateway.hold = true; let clock = ListeningTestClock()
        let tested = NativeListeningReporter(gateway: gateway, clock: { clock.now })
        defer { tested.invalidate(); gateway.release() }
        tested.refresh(); try await waitForStream { tested.ready }; tested.setEnabled(true)
        samples(tested, clock: clock); tested.setEnabled(false); tested.finishOccurrence()
        XCTAssertTrue(gateway.reports.isEmpty)
        tested.setEnabled(true); samples(tested, clock: clock); tested.finishOccurrence()
        try await waitForStream { gateway.pending.count == 1 }
        tested.invalidate(); gateway.failure = nil; tested.refresh()
        try await waitForStream { tested.ready && gateway.cancellations == 1 }
        samples(tested, clock: clock, song: song("netease", "43")); tested.finishOccurrence()
        try await waitForStream { gateway.pending.count == 2 }
        gateway.pending.removeFirst().resume(throwing: MobileFailure("auth-required"))
        try await Task.sleep(nanoseconds: 30_000_000)
        XCTAssertTrue(tested.ready); XCTAssertNil(tested.error)
        samples(tested, clock: clock); tested.finishOccurrence()
        XCTAssertEqual(gateway.reports.count, 2, "Late old completion must not release the newer in-flight slot")
        tested.setEnabled(false)
        try await waitForStream { gateway.cancellations == 2 }
        gateway.release()
    }
    func testListeningReporterTimeoutCancelsTransportAndDoesNotRetry() async throws {
        let gateway = ListeningFixtureGateway(); gateway.hold = true; let clock = ListeningTestClock()
        let tested = NativeListeningReporter(gateway: gateway, clock: { clock.now }, timeout: 0.1)
        defer { tested.invalidate(); gateway.release() }
        tested.refresh(); try await waitForStream { tested.ready }; tested.setEnabled(true)
        samples(tested, clock: clock); tested.finishOccurrence()
        try await waitForStream { gateway.cancellations == 1 }
        XCTAssertEqual(tested.error, "network"); XCTAssertEqual(gateway.reports.count, 1)
        gateway.release(); gateway.hold = false
        samples(tested, clock: clock, song: song("netease", "43")); tested.finishOccurrence()
        try await waitForStream { gateway.reports.count == 2 && tested.error == nil }
        XCTAssertEqual(gateway.reports[1].report.mediaId, "43")
    }
    func testListeningReporterAuthFailureAndOldGatewayFailClosed() async throws {
        let gateway = ListeningFixtureGateway(); gateway.supported = false; let clock = ListeningTestClock()
        let tested = NativeListeningReporter(gateway: gateway, clock: { clock.now })
        defer { tested.invalidate() }
        tested.refresh(); try await waitForStream { tested.error == "unsupported" }; tested.setEnabled(true)
        samples(tested, clock: clock); tested.finishOccurrence(); XCTAssertTrue(gateway.reports.isEmpty)
        gateway.supported = true; gateway.failure = "auth-required"; tested.refresh()
        try await waitForStream { tested.ready }
        samples(tested, clock: clock); tested.finishOccurrence()
        try await waitForStream { tested.error == "auth-required" }
        XCTAssertFalse(tested.ready)
        samples(tested, clock: clock); tested.finishOccurrence(); XCTAssertEqual(gateway.reports.count, 1)
        gateway.signedIn = false; tested.refresh(); XCTAssertFalse(tested.ready)
    }
    func testListeningReporterExplicitReplayAndOtherProviderAuthRemainIsolated() async throws {
        let gateway = ListeningFixtureGateway(); let clock = ListeningTestClock()
        let reporter = NativeListeningReporter(gateway: gateway, clock: { clock.now })
        defer { reporter.invalidate() }
        reporter.refresh(); try await waitForStream { reporter.ready }; reporter.setEnabled(true)
        samples(reporter, clock: clock)
        reporter.seek(from: 35, to: 0)
        try await waitForStream { gateway.reports.count == 1 }
        XCTAssertEqual(gateway.reports[0].report.playedSeconds, 35)
        XCTAssertEqual(reporter.listenedSeconds, 0)
        samples(reporter, clock: clock); reporter.finishOccurrence()
        try await waitForStream { gateway.reports.count == 2 }
        let tested = stereoEngine(gateway)
        defer { tested.listening.invalidate(); tested.stop(); tested.clearOutput() }
        try await waitForStream { tested.listening.ready }
        tested.queue = [song("qq", "other")]; tested.index = 0
        tested.failed(MobileFailure("auth-required"), epoch: tested.generation)
        XCTAssertTrue(tested.listening.ready)
        tested.queue = [song("netease", "42")]
        tested.failed(MobileFailure("auth-required"), epoch: tested.generation)
        XCTAssertFalse(tested.listening.ready); XCTAssertEqual(tested.listening.error, "auth-required")
    }
    func testListeningSettingDefaultsOffRestoresAndInvalidEditIsAtomic() throws {
        let tested = engine()
        defer { tested.stop() }
        var old = tested.audioSettings.dictionary; old.removeValue(forKey: "neteaseScrobbleEnabled")
        _ = try tested.setAudioSettings(old); XCTAssertFalse(tested.audioSettings.neteaseScrobbleEnabled)
        old["neteaseScrobbleEnabled"] = true; _ = try tested.setAudioSettings(old)
        tested.restoreAudioSettings(); XCTAssertTrue(tested.audioSettings.neteaseScrobbleEnabled)
        old["neteaseScrobbleEnabled"] = "true"; XCTAssertThrowsError(try tested.setAudioSettings(old))
        XCTAssertTrue(tested.audioSettings.neteaseScrobbleEnabled)
    }
    func testListeningReporterProductionTimerCountsDecoderAndEOFWithoutFrontend() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        defer { try? FileManager.default.removeItem(at: url) }
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44100)!
        buffer.frameLength = 44100; buffer.floatChannelData!.pointee.update(repeating: 0, count: 44100)
        do { let file = try AVAudioFile(forWriting: url, settings: format.settings)
            for _ in 0..<50 { try file.write(from: buffer) }
        }
        let gateway = ListeningFixtureGateway(); gateway.audioURL = url
        let tested = stereoEngine(gateway)
        defer { tested.listening.invalidate(); tested.stop(); tested.clearOutput() }
        try await waitForStream { tested.listening.ready }
        var settings = tested.audioSettings.dictionary; settings["neteaseScrobbleEnabled"] = true
        _ = try tested.setAudioSettings(settings)
        try tested.setQueue([song("netease", "42"), song("qq", "other")], at: 0)
        let deadline = Date().addingTimeInterval(45); var paused = false; var lastPrinted = 0
        while Date() < deadline && tested.listening.listenedSeconds < 31 {
            let heard = tested.listening.listenedSeconds
            if Int(heard) / 5 > lastPrinted { lastPrinted = Int(heard) / 5; print("Production listening timer decoded seconds=\(heard)") }
            if !paused && heard >= 10 {
                paused = true; try tested.command("pause"); let before = tested.listening.listenedSeconds
                try tested.command("seek", position: tested.playbackPosition + 0.5)
                try await Task.sleep(nanoseconds: 500_000_000)
                XCTAssertEqual(tested.listening.listenedSeconds, before); try tested.command("play")
            }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        XCTAssertGreaterThanOrEqual(tested.listening.listenedSeconds, 31)
        try tested.command("seek", position: 49.6)
        try await waitForStream { gateway.reports.count == 1 && tested.index == 1 }
        XCTAssertEqual(gateway.reports[0].report.mediaId, "42")
        XCTAssertEqual(gateway.reports[0].report.totalSeconds, 50)
        XCTAssertGreaterThanOrEqual(gateway.reports[0].report.playedSeconds, 31)
        XCTAssertLessThanOrEqual(gateway.reports[0].report.playedSeconds, 32)
        XCTAssertEqual((tested.currentSong?["sourceRef"] as? [String: Any])?["providerId"] as? String, "qq")
    }
}
