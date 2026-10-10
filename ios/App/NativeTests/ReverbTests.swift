import XCTest
import AVFoundation
@testable import App

// ReverbTests.swift — time-domain convolution oracle, full original WebKit tails and resource lifetime boundaries.
private struct ReverbReference: Decodable {
    struct Case: Decodable {
        struct Event: Decodable { let frame: Int; let amount: Double }
        struct Channel: Decodable { let samples: [Float]; let energy: Double }
        let rate: Double; let frames: Int; let indices: [Int]; let events: [Event]; let channels: [Channel]
    }
    let cases: [Case]
}
@MainActor extension NativeTests {
    func testConvolutionPartitionBoundariesHaveNoAddedLatency() throws {
        for count in [1, 127, 128, 129, 2047, 2048, 2049, 4179] {
            let impulse = (0..<count).map { Float(sin(Double($0) * 0.17) * 0.1 + 0.001) }
            let filter = try XCTUnwrap(AudioConvolution(impulse: impulse))
            for i in 0..<(count + 2048) {
                XCTAssertEqual(filter.process(i == 0 ? 1 : 0), i < count ? impulse[i] : 0, accuracy: 0.000001, "length=\(count) frame=\(i)")
            }
        }
        XCTAssertNil(AudioConvolution(impulse: [])); XCTAssertNil(AudioConvolution(impulse: [.nan]))
    }
    func testConvolutionMatchesDirectSumIncludingDCNyquistAndReset() throws {
        let impulse = (0..<4097).map { Float(sin(Double($0) * 0.19) * 0.02 + 0.0001) }
        let input = (0..<512).map { Float(0.02 + 0.08 * sin(Double($0) * 0.31) + ($0 % 2 == 0 ? 0.01 : -0.01)) }
        let filter = try XCTUnwrap(AudioConvolution(impulse: impulse))
        for frame in 0..<(impulse.count + input.count + 128) {
            var expected = 0.0
            for i in 0..<input.count where frame >= i && frame - i < impulse.count {
                expected += Double(input[i]) * Double(impulse[frame - i])
            }
            XCTAssertEqual(filter.process(frame < input.count ? input[frame] : 0), Float(expected), accuracy: 0.000002, "frame=\(frame)")
        }
        for i in 0..<3000 { _ = filter.process(i == 0 ? 1 : 0) }
        filter.reset()
        for i in 0..<6200 { XCTAssertEqual(filter.process(i == 0 ? .nan : i == 1 ? .infinity : 0), 0) }
    }
    func testReverbBranchMatchesOriginalWebKitIncludingEntireTail() throws {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "ReverbReference", withExtension: "json"))
        let reference = try JSONDecoder().decode(ReverbReference.self, from: Data(contentsOf: url))
        for entry in reference.cases {
            var seed: UInt32 = 0x12345678
            let impulse = AudioEffectSources.reverbImpulse(rate: entry.rate) { seed = seed &* 1664525 &+ 1013904223; return Double(seed) / 4294967296 }
            for interleaved in [false, true] {
                let kernel = try XCTUnwrap(AudioReverbKernel(rate: entry.rate, impulse: impulse))
                let effect = AudioReverb(); effect.prepare(rate: entry.rate)
                let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: entry.rate, channels: 2, interleaved: interleaved)!
                var output = [[Float](), [Float]()], energy = [0.0, 0.0]
                for (eventIndex, event) in entry.events.enumerated() {
                    XCTAssertTrue(effect.set(event.amount, kernel: kernel))
                    let end = eventIndex + 1 < entry.events.count ? entry.events[eventIndex + 1].frame : entry.frames
                    var offset = event.frame
                    while offset < end {
                        let count = min(interleaved ? 73 : 257, end - offset)
                        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count))!
                        buffer.frameLength = buffer.frameCapacity
                        let list = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
                        for channel in 0..<2 {
                            let data = list[interleaved ? 0 : channel].mData!.assumingMemoryBound(to: Float.self)
                            for i in 0..<count {
                                let frame = offset + i
                                let input: Double = frame == 0 ? (channel == 0 ? 0.75 : -0.25)
                                    : frame >= 128 && frame < 2048 ? 0.2 * sin(Double(frame) * 2 * .pi * (channel == 0 ? 997 : 313) / entry.rate)
                                    : frame == 2048 ? 0.4 : frame == 4095 ? -0.2 : 0
                                data[interleaved ? i * 2 + channel : i] = Float(input)
                            }
                        }
                        effect.process(buffer.mutableAudioBufferList, frames: count)
                        for channel in 0..<2 {
                            let data = list[interleaved ? 0 : channel].mData!.assumingMemoryBound(to: Float.self)
                            for i in 0..<count {
                                let value = data[interleaved ? i * 2 + channel : i]
                                output[channel].append(value); energy[channel] += Double(value) * Double(value)
                            }
                        }
                        offset += count
                    }
                }
                for channel in 0..<2 {
                    let maximum = zip(entry.indices, entry.channels[channel].samples).map { abs(output[channel][$0.0] - $0.1) }.max() ?? .infinity
                    XCTAssertLessThan(maximum, 0.00002, "rate=\(entry.rate) channel=\(channel)")
                    XCTAssertEqual(energy[channel], entry.channels[channel].energy, accuracy: max(0.00001, entry.channels[channel].energy * 0.0002))
                }
            }
        }
    }
    func testReverbReleaseCancellationDiscontinuityAndInvalidSource() throws {
        let rate = 8000.0, impulse = AudioEffectSources.reverbImpulse(rate: 8000, random: { 0.6 })
        let kernel = try XCTUnwrap(AudioReverbKernel(rate: rate, impulse: impulse))
        let effect = AudioReverb(); effect.prepare(rate: rate)
        XCTAssertFalse(effect.set(0.5)); XCTAssertFalse(effect.set(.nan, kernel: kernel))
        XCTAssertTrue(effect.set(1, kernel: kernel))
        let buffer = AVAudioPCMBuffer(pcmFormat: AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2)!, frameCapacity: 6400)!
        buffer.frameLength = buffer.frameCapacity
        let data = buffer.floatChannelData!
        func clear() { data[0].update(repeating: 0, count: 6400); data[1].update(repeating: 0, count: 6400) }
        clear(); data[0][0] = 0.5
        effect.process(buffer.mutableAudioBufferList, frames: 6401); XCTAssertEqual(data[0][0], 0.5)
        effect.process(buffer.mutableAudioBufferList, frames: 1024)
        let mono = AVAudioPCMBuffer(pcmFormat: AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1)!, frameCapacity: 128)!
        mono.frameLength = 128; mono.floatChannelData![0].update(repeating: 0.25, count: 128)
        effect.process(mono.mutableAudioBufferList, frames: 128); XCTAssertEqual(mono.floatChannelData![0][0], 0.25)
        clear(); effect.process(buffer.mutableAudioBufferList, frames: 6400, discontinuity: true)
        XCTAssertTrue((0..<6400).allSatisfy { data[0][$0] == 0 && data[1][$0] == 0 })
        effect.set(0); clear(); effect.process(buffer.mutableAudioBufferList, frames: 6399); XCTAssertTrue(effect.active)
        effect.set(1); clear(); effect.process(buffer.mutableAudioBufferList, frames: 6400); XCTAssertTrue(effect.active)
        effect.set(0); clear(); effect.process(buffer.mutableAudioBufferList, frames: 3200)
        effect.set(0); clear(); effect.process(buffer.mutableAudioBufferList, frames: 3200); XCTAssertFalse(effect.active)
        XCTAssertFalse(effect.set(1))
        let fresh = try XCTUnwrap(AudioReverbKernel(rate: rate, impulse: impulse))
        XCTAssertTrue(effect.set(1, kernel: fresh))
        clear(); data[0][0] = .greatestFiniteMagnitude; data[1][0] = -.greatestFiniteMagnitude
        data[0][1] = .nan; data[1][1] = .infinity
        effect.process(buffer.mutableAudioBufferList, frames: 6400)
        XCTAssertTrue((0..<6400).allSatisfy { data[0][$0].isFinite && data[1][$0].isFinite })
        effect.unprepare(); XCTAssertFalse(effect.available)
        XCTAssertNil(AudioReverbKernel(rate: .infinity, impulse: impulse))
        XCTAssertNil(AudioReverbKernel(rate: rate, impulse: [[]]))
        let silent = try XCTUnwrap(AudioReverbKernel(rate: rate, impulse: impulse.map { $0.map { _ in 0 } }))
        XCTAssertTrue(silent.normalizationGain.isFinite)
        for _ in 0..<2049 { let result = silent.process(left: 0.5, right: 0.5); XCTAssertEqual(result.0, 0); XCTAssertEqual(result.1, 0) }
    }
}
