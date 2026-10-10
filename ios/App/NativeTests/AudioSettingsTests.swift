import XCTest
import AVFoundation
@testable import App

// AudioSettingsTests.swift — original WebKit output is the oracle; player tests use synthetic local audio.
private struct EqualizerReference: Decodable {
    struct Case: Decodable { let rate: Double; let gains: [Double]; let samples: [Float]; let energy: Double }
    let indices: [Int]
    let cases: [Case]
}
@MainActor extension NativeTests {
    func testEqualizerMatchesOriginalWebKitAcrossSampleRatesAndGains() throws {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "EqualizerReference", withExtension: "json"))
        let reference = try JSONDecoder().decode(EqualizerReference.self, from: Data(contentsOf: url))
        for entry in reference.cases {
            let format = AVAudioFormat(standardFormatWithSampleRate: entry.rate, channels: 1)!
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 8192)!
            buffer.frameLength = 8192
            let samples = buffer.floatChannelData!.pointee
            samples.update(repeating: 0, count: 8192); samples[0] = 0.25
            let eq = AudioEqualizer()
            eq.configure(enabled: true, gains: entry.gains); eq.prepare(format.streamDescription.pointee)
            eq.process(buffer.mutableAudioBufferList, frames: 8192)
            XCTAssertTrue(eq.available)
            for (i, index) in reference.indices.enumerated() {
                XCTAssertEqual(samples[index], entry.samples[i], accuracy: 0.00002, "rate=\(entry.rate) sample=\(index)")
            }
            let energy = (0..<8192).reduce(0.0) { $0 + Double(samples[$1]) * Double(samples[$1]) }
            XCTAssertEqual(energy, entry.energy, accuracy: max(0.00001, entry.energy * 0.0002))
        }
    }
    func testEqualizerKeepsPlanarAndInterleavedChannelsIndependent() {
        for interleaved in [false, true] {
            let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 44100, channels: 2, interleaved: interleaved)!
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 256)!
            buffer.frameLength = 256
            let list = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
            for b in list { b.mData!.assumingMemoryBound(to: Float.self).update(repeating: 0, count: Int(b.mDataByteSize) / 4) }
            list[0].mData!.assumingMemoryBound(to: Float.self)[0] = 0.25
            let eq = AudioEqualizer(); eq.prepare(format.streamDescription.pointee)
            eq.configure(enabled: true, gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 12])
            eq.process(buffer.mutableAudioBufferList, frames: 256)
            XCTAssertGreaterThan(list[0].mData!.assumingMemoryBound(to: Float.self)[0], 0.25)
            let right = list[interleaved ? 0 : 1].mData!.assumingMemoryBound(to: Float.self)
            for i in 0..<256 { XCTAssertEqual(right[interleaved ? i * 2 + 1 : i], 0) }
        }
    }
    func testEqualizerNeutralIsExactBypassAndDisableSettlesWithoutPolling() {
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44100)!
        buffer.frameLength = 44100
        let samples = buffer.floatChannelData!.pointee
        let eq = AudioEqualizer(); eq.prepare(format.streamDescription.pointee)
        for i in 0..<44100 { samples[i] = Float(sin(Double(i))) * 0.1 }
        eq.process(buffer.mutableAudioBufferList, frames: 44100)
        for i in 0..<44100 { XCTAssertEqual(samples[i], Float(sin(Double(i))) * 0.1) }
        eq.configure(enabled: true, gains: Array(repeating: 12, count: 10))
        eq.process(buffer.mutableAudioBufferList, frames: 44100)
        eq.configure(enabled: false, gains: Array(repeating: 12, count: 10))
        samples.update(repeating: 0, count: 44100)
        eq.process(buffer.mutableAudioBufferList, frames: 44100)
        samples.update(repeating: 0.125, count: 44100)
        eq.process(buffer.mutableAudioBufferList, frames: 44100)
        for i in 0..<44100 { XCTAssertEqual(samples[i], 0.125) }
    }
    func testEqualizerDiscontinuityResetsHistoryAndRejectsUnsupportedPCM() {
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 128)!
        buffer.frameLength = 128
        let samples = buffer.floatChannelData!.pointee
        samples.update(repeating: 0, count: 128); samples[0] = 0.25
        let eq = AudioEqualizer(); eq.configure(enabled: true, gains: Array(repeating: 6, count: 10))
        eq.prepare(format.streamDescription.pointee); eq.process(buffer.mutableAudioBufferList, frames: 128)
        samples.update(repeating: 0, count: 128)
        eq.process(buffer.mutableAudioBufferList, frames: 128, discontinuity: true)
        for i in 0..<128 { XCTAssertEqual(samples[i], 0) }
        var invalid = format.streamDescription.pointee; invalid.mBitsPerChannel = 16
        eq.prepare(invalid); XCTAssertFalse(eq.available)
    }
    func testAudioSettingsPersistWithoutReplacingCurrentItemOrChangingMuteOnVolumeEdit() throws {
        let tested = engine(); tested.network.cancel(); defer { tested.stop() }
        let source = try silentAudio(); defer { try? FileManager.default.removeItem(at: source) }
        let item = AVPlayerItem(url: source); tested.player.insert(item, after: nil)
        var values = NativeAudioSettings(); values.volume = 0.35; values.isMuted = true
        values.equalizer.enabled = true; values.equalizer.gains[5] = 6
        _ = try tested.setAudioSettings(values.dictionary)
        XCTAssertTrue(tested.player.currentItem === item); XCTAssertTrue(tested.player.isMuted)
        values.volume = 0.6; _ = try tested.setAudioSettings(values.dictionary)
        XCTAssertTrue(tested.player.isMuted); XCTAssertEqual(tested.player.volume, 0.6, accuracy: 0.001)
        let restored = PlaybackEngine(gateway: FailingGateway(), storage: tested.storage)
        restored.network.cancel(); defer { restored.stop() }
        XCTAssertEqual(restored.player.volume, 0.6, accuracy: 0.001); XCTAssertTrue(restored.player.isMuted)
        XCTAssertEqual(restored.audioSettings.equalizer.gains[5], 6)
        XCTAssertNil(restored.player.currentItem); XCTAssertFalse(restored.intentToPlay)
    }
    func testInvalidAndUnsupportedSettingsDoNotPartiallyApply() throws {
        let tested = engine(); tested.network.cancel(); defer { tested.stop() }
        let before = tested.storage.data(forKey: "folia.audio")
        var invalid = NativeAudioSettings(); invalid.volume = -1
        XCTAssertThrowsError(try tested.setAudioSettings(invalid.dictionary))
        invalid.volume = 0.1; invalid.equalizer.gains[0] = 13
        XCTAssertThrowsError(try tested.setAudioSettings(invalid.dictionary))
        invalid.equalizer.gains = []; XCTAssertThrowsError(try tested.setAudioSettings(invalid.dictionary))
        invalid.equalizer = NativeEqualizerSettings(); invalid.equalizer.enabled = true; invalid.equalizer.effects["space"] = 0.5
        XCTAssertThrowsError(try tested.setAudioSettings(invalid.dictionary)) { XCTAssertEqual(($0 as? MobileFailure)?.code, "unsupported-audio-effects") }
        XCTAssertEqual(tested.player.volume, 1); XCTAssertEqual(tested.storage.data(forKey: "folia.audio"), before)
    }
    func testCurrentAndPreloadedMetersInheritLatestSettings() async throws {
        let source = try silentAudio(); defer { try? FileManager.default.removeItem(at: source) }
        let tested = engine(AudioFixtureGateway(url: source)); tested.network.cancel(); defer { tested.stop() }
        var values = NativeAudioSettings(); values.equalizer.enabled = true; values.equalizer.gains[5] = 6
        _ = try tested.setAudioSettings(values.dictionary)
        try tested.setQueue([song("netease", "a"), song("qq", "b")], at: 0)
        try tested.command("pause")
        for _ in 0..<40 {
            if tested.prepared?.meter != nil { break }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        values.equalizer.gains[5] = -12; _ = try tested.setAudioSettings(values.dictionary)
        let current = try XCTUnwrap(tested.meter), next = try XCTUnwrap(tested.prepared?.meter)
        for meter in [current, next] {
            XCTAssertEqual(meter.equalizer.configuredGains, values.equalizer.gains)
        }
    }
    func testEqualizerChangesActualDecodedAudioAfterVisualizerStopsPolling() async throws {
        let source = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        defer { try? FileManager.default.removeItem(at: source) }
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44100 * 5)!
        buffer.frameLength = buffer.frameCapacity
        for i in 0..<Int(buffer.frameLength) { buffer.floatChannelData!.pointee[i] = Float(sin(Double(i) * 2 * .pi * 1000 / 44100)) * 0.02 }
        do { let file = try AVAudioFile(forWriting: source, settings: format.settings); try file.write(from: buffer) }
        let tested = engine(AudioFixtureGateway(url: source)); tested.network.cancel(); defer { tested.stop() }
        try tested.setQueue([song("qq", "eq-tone")], at: 0)
        func peak() async throws -> Int {
            for _ in 0..<30 {
                let sample = tested.meter?.snapshot()
                if sample?["available"] as? Bool == true, let value = (sample?["spectrum"] as? [Int])?.max(), value > 100 { return value }
                try await Task.sleep(nanoseconds: 50_000_000)
            }
            XCTFail("No decoded PCM from the native tap"); return 0
        }
        let before = try await peak()
        try await Task.sleep(nanoseconds: 700_000_000)
        var values = NativeAudioSettings(); values.equalizer.enabled = true; values.equalizer.gains[5] = -12
        _ = try tested.setAudioSettings(values.dictionary)
        try await Task.sleep(nanoseconds: 500_000_000)
        XCTAssertTrue(tested.meter?.processingAvailable() == true)
        let after = try await peak()
        XCTAssertGreaterThan(before - after, 35, "The -12 dB change must reach real decoded PCM even without visualizer polling")
        XCTAssertLessThan(before - after, 55)
    }
}
