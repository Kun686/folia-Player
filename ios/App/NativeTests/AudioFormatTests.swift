import XCTest
import AVFoundation
@testable import App

// AudioFormatTests.swift — observe AVPlayer's actual processing-tap format before connecting stereo effect branches.
@MainActor extension NativeTests {
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
            print("FOLIA_TAP_FORMAT sourceChannels=\(channelCount) tapChannels=\(channels) rate=\(actual["sampleRate"] ?? 0)")
        }
    }
}
