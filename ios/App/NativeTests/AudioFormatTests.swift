import XCTest
import AVFoundation
@testable import App

// AudioFormatTests.swift — observe AVPlayer's actual processing-tap format before connecting stereo effect branches.
@MainActor extension NativeTests {
    func testPausedTapAppliesDisabledEffectsWithoutResumingPlayback() async throws {
        let source = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        defer { try? FileManager.default.removeItem(at: source) }
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44100 * 8)!
        buffer.frameLength = buffer.frameCapacity
        for channel in 0..<2 { buffer.floatChannelData![channel].update(repeating: 0.01, count: Int(buffer.frameLength)) }
        do { let file = try AVAudioFile(forWriting: source, settings: format.settings); try file.write(from: buffer) }
        let tested = engine(AudioFixtureGateway(url: source)); tested.network.cancel(); defer { tested.stop() }
        var settings = NativeAudioSettings(); settings.equalizer.enabled = true
        settings.equalizer.effects["space"] = 0.4; settings.equalizer.effects["noise"] = 0.2
        _ = try tested.setAudioSettings(settings.dictionary)
        try tested.setQueue([song("qq", "pause-lifecycle")], at: 0)
        for _ in 0..<60 {
            if tested.meter?.effects.status.available == true && tested.finiteTime(tested.player.currentTime()) > 0.3 { break }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        let meter = try XCTUnwrap(tested.meter)
        XCTAssertTrue(meter.effects.status.available)
        try tested.command("pause")
        try await Task.sleep(nanoseconds: 2_000_000_000)
        let pausedPosition = tested.finiteTime(tested.player.currentTime())
        settings.equalizer.enabled = false
        _ = try tested.setAudioSettings(settings.dictionary)
        let disabledRevision = meter.effects.status.requested
        for _ in 0..<120 {
            let state = meter.effects.status
            if state.requested > disabledRevision && state.applied == state.requested { break }
            try await Task.sleep(nanoseconds: 25_000_000)
        }
        XCTAssertGreaterThan(meter.effects.status.requested, disabledRevision, "The tap must finish fading and schedule resource retirement")
        XCTAssertEqual(meter.effects.status.applied, meter.effects.status.requested)
        XCTAssertEqual(tested.player.timeControlStatus, .paused)
        XCTAssertEqual(tested.finiteTime(tested.player.currentTime()), pausedPosition, accuracy: 0.02)
        try tested.command("play")
        try await Task.sleep(nanoseconds: 400_000_000)
        XCTAssertEqual(tested.player.timeControlStatus, .playing)
        XCTAssertEqual(meter.effects.status.applied, meter.effects.status.requested)
    }
    #if FOLIA_AUDIO_OUTPUT_PROBE
    func testRemoteAssetReaderStereoProbe() async throws {
        let url = URL(string: "http://127.0.0.1:18779/mono.wav")!
        let asset = AVURLAsset(url: url)
        let tracks = try await asset.loadTracks(withMediaType: .audio)
        let track = try XCTUnwrap(tracks.first)
        let formats = try await track.load(.formatDescriptions)
        XCTAssertEqual(CMAudioFormatDescriptionGetStreamBasicDescription(try XCTUnwrap(formats.first))?.pointee.mChannelsPerFrame, 1)
        do {
            let reader = try AVAssetReader(asset: asset)
            defer { reader.cancelReading() }
            let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
                AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMIsFloatKey: true,
                AVLinearPCMBitDepthKey: 32, AVLinearPCMIsNonInterleaved: false,
                AVSampleRateKey: 44100, AVNumberOfChannelsKey: 2])
            XCTAssertTrue(reader.canAdd(output)); reader.add(output)
            let started = reader.startReading()
            let sample = started ? output.copyNextSampleBuffer() : nil
            let channels = sample.flatMap(CMSampleBufferGetFormatDescription).flatMap(CMAudioFormatDescriptionGetStreamBasicDescription)?.pointee.mChannelsPerFrame ?? 0
            print("FOLIA_REMOTE_READER started=\(started) channels=\(channels) status=\(reader.status.rawValue) error=\(reader.error.map { ($0 as NSError).code } ?? 0)")
        } catch {
            print("FOLIA_REMOTE_READER initializationError=\((error as NSError).domain):\((error as NSError).code)")
        }
    }
    func testMonoCompositionTapFormatProbe() async throws {
        let asset = AVURLAsset(url: URL(string: "http://127.0.0.1:18779/mono.wav")!)
        let tracks = try await asset.loadTracks(withMediaType: .audio)
        let track = try XCTUnwrap(tracks.first)
        let duration = try await asset.load(.duration)
        let source = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        defer { try? FileManager.default.removeItem(at: source) }
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4410)!
        buffer.frameLength = 4410
        for channel in 0..<2 { buffer.floatChannelData![channel].update(repeating: 0, count: 4410) }
        do { let file = try AVAudioFile(forWriting: source, settings: format.settings); try file.write(from: buffer) }
        let silenceAsset = AVURLAsset(url: source)
        let silenceTracks = try await silenceAsset.loadTracks(withMediaType: .audio)
        let silenceTrack = try XCTUnwrap(silenceTracks.first)
        let composition = AVMutableComposition()
        let music = try XCTUnwrap(composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid))
        let silence = try XCTUnwrap(composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid))
        try music.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: track, at: .zero)
        let silenceDuration = CMTime(seconds: 0.1, preferredTimescale: 44100)
        try silence.insertTimeRange(CMTimeRange(start: .zero, duration: silenceDuration), of: silenceTrack, at: .zero)
        silence.insertEmptyTimeRange(CMTimeRange(start: silenceDuration, end: duration))
        let item = AVPlayerItem(asset: composition)
        let attached = await AudioMeter.attach(to: item)
        let meter = try XCTUnwrap(attached)
        let player = AVPlayer(playerItem: item)
        defer { player.pause(); player.replaceCurrentItem(with: nil) }
        try AVAudioSession.sharedInstance().setCategory(.playback)
        try AVAudioSession.sharedInstance().setActive(true)
        player.play()
        for _ in 0..<80 {
            if meter.snapshot()["available"] as? Bool == true { break }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        let snapshot = meter.snapshot()
        print("FOLIA_COMPOSITION_TAP channels=\(snapshot["channels"] ?? 0) available=\(snapshot["available"] ?? false) status=\(item.status.rawValue) error=\(item.error.map { ($0 as NSError).code } ?? 0)")
        XCTAssertEqual(item.status, .readyToPlay)
    }
    #endif
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
