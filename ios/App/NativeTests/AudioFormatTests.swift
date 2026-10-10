import XCTest
import AVFoundation
@testable import App

// AudioFormatTests.swift — observe AVPlayer's actual processing-tap format before connecting stereo effect branches.
@MainActor extension NativeTests {
    func testEffectChainProcessesActualDecodedStereoWithoutVisualizerPolling() async throws {
        let source = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        defer { try? FileManager.default.removeItem(at: source) }
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44100 * 6)!
        buffer.frameLength = buffer.frameCapacity
        for channel in 0..<2 {
            for i in 0..<Int(buffer.frameLength) {
                buffer.floatChannelData![channel][i] = Float(sin(Double(i) * 2 * .pi * 2000 / 44100)) * 0.02
            }
        }
        do { let file = try AVAudioFile(forWriting: source, settings: format.settings); try file.write(from: buffer) }
        let tested = engine(AudioFixtureGateway(url: source)); tested.network.cancel(); defer { tested.stop() }
        try tested.setQueue([song("qq", "stereo-effects")], at: 0)
        func peak() async throws -> Int {
            for _ in 0..<40 {
                let sample = tested.meter?.snapshot()
                if sample?["available"] as? Bool == true, let value = (sample?["spectrum"] as? [Int])?.max() { return value }
                try await Task.sleep(nanoseconds: 50_000_000)
            }
            XCTFail("No stereo PCM from the actual AVPlayer tap"); return 0
        }
        // AVPlayer can deliver an initial silent buffer while its playback clock is still starting.
        // Establish the fixture's real tone before measuring attenuation; zero is not a valid baseline.
        for _ in 0..<40 {
            if tested.finiteTime(tested.player.currentTime()) >= 0.2 { break }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        let before = try await peak(), meter = try XCTUnwrap(tested.meter)
        XCTAssertGreaterThan(before, 100, "The reference tone must be audible before applying the effect")
        XCTAssertFalse(meter.effects.status.available, "The existing neutral player path must not activate effects")
        try await Task.sleep(nanoseconds: 500_000_000)
        var settings = NativeAudioSettings(); settings.equalizer.enabled = true
        settings.equalizer.effects["lowpass"] = 500
        _ = try tested.setAudioSettings(settings.dictionary)
        try await Task.sleep(nanoseconds: 750_000_000)
        XCTAssertEqual(meter.effects.status.applied, meter.effects.status.requested)
        XCTAssertTrue(meter.effects.status.available)
        let after = try await peak()
        XCTAssertGreaterThan(before - after, 70, "The original lowpass must affect actual decoded PCM without spectrum reads")
        XCTAssertLessThan(before - after, 110)
        settings.equalizer.enabled = false
        _ = try tested.setAudioSettings(settings.dictionary)
        try await Task.sleep(nanoseconds: 750_000_000)
        let restored = try await peak()
        XCTAssertEqual(restored, before, accuracy: 4, "Neutral settings must restore the tone through the same running tap")
    }
    func testActualPlayerTapFormatsForMonoAndStereoSources() async throws {
        for channelCount in [1, 2] {
            let source = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
            defer { try? FileManager.default.removeItem(at: source) }
            let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: AVAudioChannelCount(channelCount))!
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 48000 * 4)!
            buffer.frameLength = buffer.frameCapacity
            for channel in 0..<channelCount {
                for i in 0..<Int(buffer.frameLength) {
                    buffer.floatChannelData![channel][i] = Float(sin(Double(i) * 2 * .pi * Double(220 + 440 * channel) / 48000)) * 0.01
                }
            }
            do { let file = try AVAudioFile(forWriting: source, settings: format.settings); try file.write(from: buffer) }
            let tested = engine(AudioFixtureGateway(url: source)); tested.network.cancel(); defer { tested.stop() }
            try tested.setQueue([song("qq", "format-\(channelCount)")], at: 0)
            var result: [String: Any]?
            for _ in 0..<40 {
                let snapshot = tested.meter?.snapshot()
                if snapshot?["available"] as? Bool == true { result = snapshot; break }
                try await Task.sleep(nanoseconds: 50_000_000)
            }
            let actual = try XCTUnwrap(result), channels = try XCTUnwrap(actual["channels"] as? Int)
            XCTAssertTrue((1...2).contains(channels))
            var settings = NativeAudioSettings(); settings.equalizer.enabled = true; settings.equalizer.effects["lowpass"] = 500
            _ = try tested.setAudioSettings(settings.dictionary)
            if channels == 1 {
                let effect = try XCTUnwrap(tested.snapshot()["audioEffects"] as? [String: Any])
                XCTAssertEqual(effect["error"] as? String, "unsupported-effect-format")
                XCTAssertFalse(effect["available"] as? Bool ?? true)
                XCTAssertTrue(tested.meter?.processingAvailable() == true, "EQ remains usable on mono audio")
            }
            print("FOLIA_TAP_FORMAT sourceChannels=\(channelCount) tapChannels=\(channels) rate=\(actual["sampleRate"] ?? 0)")
        }
    }
}
