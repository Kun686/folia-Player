import XCTest
import AVFoundation
@testable import App

// SpectrumTests.swift — independent WebKit PCM oracle plus native capture/lifecycle regressions.
private struct SpectrumReference: Decodable {
    struct Snapshot: Decodable { let frames: Int; let spectrum: [Int] }
    struct Case: Decodable { let rate: Double; let channels: [Double]; let volume: Double; let snapshots: [Snapshot] }
    let fftSize: Int
    let cases: [Case]
}
@MainActor extension NativeTests {
    func testNativeSpectrumMatchesWebKitIncludingSmoothingDownmixAndVolume() throws {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "SpectrumReference", withExtension: "json"))
        let reference = try JSONDecoder().decode(SpectrumReference.self, from: Data(contentsOf: url))
        XCTAssertEqual(reference.fftSize, AudioSpectrum.size)
        for entry in reference.cases {
            for interleaved in [false, true] {
                let layout = try XCTUnwrap(AVAudioChannelLayout(layoutTag:
                    kAudioChannelLayoutTag_DiscreteInOrder | UInt32(entry.channels.count)))
                let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: entry.rate,
                    interleaved: interleaved, channelLayout: layout)
                let meter = AudioMeter(); meter.prepare(format.streamDescription.pointee)
                meter.setOutputGain(volume: entry.volume, muted: false)
                _ = meter.snapshot()
                var previous = 0
                for expected in entry.snapshots {
                    let count = expected.frames - previous
                    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count))!
                    buffer.frameLength = buffer.frameCapacity
                    let list = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
                    for channel in entry.channels.indices {
                        let output = list[interleaved ? 0 : channel].mData!.assumingMemoryBound(to: Float.self)
                        for i in 0..<count {
                            let frame = Double(previous + i)
                            let tone = 0.004 * sin(frame * 2 * .pi * 220 / entry.rate)
                                + 0.002 * cos(frame * 2 * .pi * 997 / entry.rate)
                                + 0.001 * sin(frame * 2 * .pi * 1703 / entry.rate)
                            output[interleaved ? i * entry.channels.count + channel : i] = previous + i < 8192
                                ? Float(entry.channels[channel] * tone) : 0
                        }
                    }
                    meter.consume(buffer.mutableAudioBufferList, frames: count)
                    let result = meter.snapshot()
                    XCTAssertEqual(result["available"] as? Bool, true)
                    let actual = try XCTUnwrap(result["spectrum"] as? [Int])
                    XCTAssertEqual(actual.count, expected.spectrum.count)
                    let difference = zip(actual, expected.spectrum).map { abs($0 - $1) }.max() ?? 999
                    XCTAssertLessThanOrEqual(difference, 1, "rate=\(entry.rate) channels=\(entry.channels) volume=\(entry.volume) frames=\(expected.frames)")
                    XCTAssertEqual(meter.snapshot()["spectrum"] as? [Int], actual, "Repeated reads must not smooth the same audio twice")
                    previous = expected.frames
                }
            }
        }
    }
    func testSpectrumGainNeverChangesAudiblePCMAndMuteIsZero() throws {
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096)!
        buffer.frameLength = 4096
        let samples = buffer.floatChannelData!.pointee
        for i in 0..<4096 { samples[i] = Float(sin(Double(i) * 2 * .pi * 997 / 44100)) * 0.005 }
        let original = Array(UnsafeBufferPointer(start: samples, count: 4096))
        var peaks: [Int] = []
        for (volume, muted) in [(1.0, false), (0.25, false), (1.0, true)] {
            let meter = AudioMeter(); meter.prepare(format.streamDescription.pointee)
            meter.setOutputGain(volume: volume, muted: muted); _ = meter.snapshot()
            meter.consume(buffer.mutableAudioBufferList, frames: 4096)
            peaks.append((try XCTUnwrap(meter.snapshot()["spectrum"] as? [Int])).max() ?? -1)
            XCTAssertEqual(Array(UnsafeBufferPointer(start: samples, count: 4096)), original)
        }
        XCTAssertLessThanOrEqual(abs(peaks[0] - peaks[1] - 44), 1); XCTAssertEqual(peaks[2], 0)
    }
    func testDiscontinuityAndReprepareDiscardOldSpectrum() throws {
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096)!
        buffer.frameLength = 4096
        buffer.floatChannelData!.pointee.update(repeating: 0.005, count: 4096)
        let meter = AudioMeter(); meter.prepare(format.streamDescription.pointee); _ = meter.snapshot()
        meter.consume(buffer.mutableAudioBufferList, frames: 4096)
        XCTAssertGreaterThan((meter.snapshot()["spectrum"] as? [Int])?.max() ?? 0, 100)
        buffer.floatChannelData!.pointee.update(repeating: 0, count: 4096)
        meter.consume(buffer.mutableAudioBufferList, frames: 4096, discontinuity: true)
        XCTAssertEqual((meter.snapshot()["spectrum"] as? [Int])?.max(), 0)
        meter.prepare(format.streamDescription.pointee)
        XCTAssertEqual(meter.snapshot()["available"] as? Bool, false)
        var invalid = format.streamDescription.pointee; invalid.mBitsPerChannel = 16
        meter.prepare(invalid); meter.consume(buffer.mutableAudioBufferList, frames: 4096)
        XCTAssertEqual(meter.snapshot()["available"] as? Bool, false)
    }
}
