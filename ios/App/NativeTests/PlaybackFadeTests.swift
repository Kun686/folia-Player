import XCTest
import AVFoundation
@testable import App

// PlaybackFadeTests.swift — shared JSC scheduling, stereo sample envelopes and real-decoder transport races.
@MainActor extension NativeTests {
    func testPlaybackFadeNativeRunsOriginalPauseDrainAndCancelsStaleTokens() async throws {
        var ramps: [[Double]] = [], pauses = 0
        let fade = try NativePlaybackFade(enabled: { true }, running: { true }, ramp: { ramps.append([$0, $1]) })
        let token = try XCTUnwrap(fade.prepareFadeIn()); fade.runFadeIn(token)
        XCTAssertEqual(ramps.suffix(2), [[0, 0], [1, 0.2]])
        XCTAssertTrue(fade.fadeOutThen { pauses += 1 })
        XCTAssertTrue(fade.fadeOutThen { XCTFail("Second pause replaced the first") })
        XCTAssertEqual(ramps.last, [0, 0.2])
        XCTAssertTrue(fade.cancelPendingPause())
        fade.runFadeIn(token)
        XCTAssertEqual(ramps.last, [1, 0.2])
        try await Task.sleep(nanoseconds: 400_000_000)
        XCTAssertEqual(pauses, 0)
        XCTAssertTrue(fade.fadeOutThen { pauses += 1 })
        try await Task.sleep(nanoseconds: 250_000_000)
        XCTAssertEqual(pauses, 1); XCTAssertEqual(ramps.last, [0, 0.2])
        try await Task.sleep(nanoseconds: 170_000_000)
        XCTAssertEqual(ramps.last, [1, 0.03])
    }
    func testPlaybackFadeFlushAndUnavailableEngineCannotStrandPause() async throws {
        var running = true, enabled = true, pauses = 0
        let fade = try NativePlaybackFade(enabled: { enabled }, running: { running }, ramp: { _, _ in })
        running = false
        XCTAssertFalse(fade.fadeOutThen { pauses += 1 }); XCTAssertNil(fade.prepareFadeIn())
        running = true; enabled = false
        XCTAssertFalse(fade.fadeOutThen { pauses += 1 })
        enabled = true
        XCTAssertTrue(fade.fadeOutThen { pauses += 1 }); fade.flush(); fade.flush()
        XCTAssertEqual(pauses, 1)
        try await Task.sleep(nanoseconds: 400_000_000)
        XCTAssertEqual(pauses, 1)
        var transient: NativePlaybackFade? = try NativePlaybackFade(enabled: { true }, running: { true }, ramp: { _, _ in })
        weak var reference = transient
        XCTAssertTrue(transient!.fadeOutThen { XCTFail("A released host must not execute a stale pause") })
        transient = nil; XCTAssertNil(reference)
        try await Task.sleep(nanoseconds: 400_000_000)
    }
    func testTransportGainLinearStereoRampsAndReversalAtBothSampleRates() throws {
        for rate in [44100.0, 48000.0] {
            let count = Int(rate * 0.2)
            let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2)!
            let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count + 2))!
            let gain = TransportGain()
            func render(_ frames: Int) {
                pcm.frameLength = AVAudioFrameCount(frames)
                pcm.floatChannelData![0].update(repeating: 0.5, count: frames)
                pcm.floatChannelData![1].update(repeating: -0.25, count: frames)
                gain.process(pcm.mutableAudioBufferList, frames: frames, rate: rate)
            }
            gain.ramp(to: 0, seconds: 0); gain.ramp(to: 1, seconds: 0.2)
            render(count / 2)
            for i in 0..<count / 2 {
                XCTAssertEqual(pcm.floatChannelData![0][i], Float(Double(i) / Double(count)) * 0.5, accuracy: 0.000001)
                XCTAssertEqual(pcm.floatChannelData![1][i], -pcm.floatChannelData![0][i] / 2)
            }
            let last = pcm.floatChannelData![0][count / 2 - 1]
            gain.ramp(to: 0, seconds: 0.2); render(count + 2)
            XCTAssertEqual(pcm.floatChannelData![0][0], last)
            for i in 0..<count {
                XCTAssertEqual(pcm.floatChannelData![0][i], last * Float(1 - Double(i) / Double(count)), accuracy: 0.000001)
            }
            XCTAssertEqual(pcm.floatChannelData![0][count], 0)
            gain.ramp(to: 1, seconds: 0); render(128)
            XCTAssertEqual(pcm.floatChannelData![0][127], 0.5); XCTAssertEqual(pcm.floatChannelData![1][127], -0.25)
        }
    }
    func testPlaybackFadeRealDecoderPauseResumeSkipSeekAndImmediateStop() async throws {
        let source = try streamingTone(); defer { try? FileManager.default.removeItem(at: source) }
        let tested = stereoEngine(AudioFixtureGateway(url: source))
        defer { tested.stop(); tested.clearOutput() }
        try tested.setQueue([song("qq", "fade-first"), song("netease", "fade-next")], at: 0)
        try await waitForStream { tested.outputIsPlaying }
        let first = tested.stream
        XCTAssertTrue(try XCTUnwrap(tested.playbackFade).available)
        try tested.command("pause")
        XCTAssertFalse(tested.snapshot()["playing"] as! Bool)
        XCTAssertTrue(tested.outputIsPlaying, "The decoder must run until the original fade ends")
        try tested.command("play")
        try await Task.sleep(nanoseconds: 400_000_000)
        XCTAssertTrue(tested.outputIsPlaying); XCTAssertTrue(tested.stream === first)
        try tested.command("pause")
        tested.streamOutput?.engine.pause()
        try tested.command("play")
        try await waitForStream { tested.outputIsPlaying }
        try await Task.sleep(nanoseconds: 400_000_000)
        XCTAssertTrue(tested.outputIsPlaying, "Resume must restart a host stopped during the pending fade")
        try tested.command("pause")
        try await waitForStream { !tested.outputIsPlaying }
        try tested.command("play")
        try await waitForStream { tested.outputIsPlaying && tested.playbackFadeToken == nil }
        try tested.command("pause"); try tested.command("next")
        try await waitForStream { tested.index == 1 && tested.outputIsPlaying }
        try await Task.sleep(nanoseconds: 450_000_000)
        XCTAssertTrue(tested.outputIsPlaying); XCTAssertFalse(tested.stream === first)
        try tested.command("pause"); try tested.command("seek", position: 5)
        XCTAssertFalse(tested.outputIsPlaying)
        try tested.command("play"); try await waitForStream { tested.outputIsPlaying }
        try tested.command("pause")
        NotificationCenter.default.post(name: AVAudioSession.routeChangeNotification, object: nil,
            userInfo: [AVAudioSessionRouteChangeReasonKey: AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue])
        XCTAssertFalse(tested.outputIsPlaying); XCTAssertFalse(tested.intentToPlay)
        try tested.command("play"); try await waitForStream { tested.outputIsPlaying }
        try tested.command("pause"); tested.stop()
        XCTAssertFalse(tested.outputIsPlaying); XCTAssertFalse(tested.playbackFade?.isFadingOut == true)
        try await Task.sleep(nanoseconds: 400_000_000)
        XCTAssertFalse(tested.outputIsPlaying)
    }
    func testPlaybackFadeSettingMigratesPersistsAndDisabledPauseIsImmediate() async throws {
        let source = try streamingTone(); defer { try? FileManager.default.removeItem(at: source) }
        let tested = stereoEngine(AudioFixtureGateway(url: source))
        defer { tested.stop(); tested.clearOutput() }
        var settings = tested.audioSettings.dictionary
        settings.removeValue(forKey: "playbackFadeEnabled")
        _ = try tested.setAudioSettings(settings); XCTAssertTrue(tested.audioSettings.playbackFadeEnabled)
        settings["playbackFadeEnabled"] = false
        _ = try tested.setAudioSettings(settings); tested.restoreAudioSettings()
        XCTAssertFalse(tested.audioSettings.playbackFadeEnabled)
        settings["playbackFadeEnabled"] = "false"
        XCTAssertThrowsError(try tested.setAudioSettings(settings)); XCTAssertFalse(tested.audioSettings.playbackFadeEnabled)
        try tested.setQueue([song("qq", "disabled-fade")], at: 0)
        try await waitForStream { tested.outputIsPlaying }
        try tested.command("pause"); XCTAssertFalse(tested.outputIsPlaying)
    }
}
