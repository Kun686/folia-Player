import XCTest
import AVFoundation
@testable import App

// NoiseTests.swift — independent original-branch PCM oracle plus release, looping and malformed-buffer boundaries.
private struct NoiseReference: Decodable {
    struct Case: Decodable {
        struct Event: Decodable { let frame: Int; let amount: Double }
        struct Channel: Decodable { let samples: [Float]; let energy: Double }
        let rate: Double; let frames: Int; let indices: [Int]; let events: [Event]; let channels: [Channel]
    }
    let cases: [Case]
}
@MainActor extension NativeTests {
    func testNoiseBranchMatchesOriginalWebKitThroughLoopAndAutomation() throws {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "NoiseReference", withExtension: "json"))
        let reference = try JSONDecoder().decode(NoiseReference.self, from: Data(contentsOf: url))
        for entry in reference.cases {
            var seed: UInt32 = 0x12345678
            let pcm = AudioEffectSources.vinylNoise(rate: entry.rate) { seed = seed &* 1664525 &+ 1013904223; return Double(seed) / 4294967296 }
            let source = try XCTUnwrap(AudioNoiseBuffer(rate: entry.rate, samples: pcm))
            for interleaved in [false, true] {
                let effect = AudioNoise(); effect.prepare(rate: entry.rate)
                let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: entry.rate, channels: 2, interleaved: interleaved)!
                var output = [[Float](), [Float]()], energy = [0.0, 0.0]
                for (eventIndex, event) in entry.events.enumerated() {
                    XCTAssertTrue(effect.set(event.amount, source: source))
                    let end = eventIndex + 1 < entry.events.count ? entry.events[eventIndex + 1].frame : entry.frames
                    var offset = event.frame
                    while offset < end {
                        let count = min(interleaved ? 73 : 257, end - offset)
                        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count))!
                        buffer.frameLength = buffer.frameCapacity
                        let list = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
                        for b in list { b.mData!.assumingMemoryBound(to: Float.self).update(repeating: 0, count: Int(b.mDataByteSize) / 4) }
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
    func testNoiseReleaseCancellationRequiresFreshSourceAndValidStereo() throws {
        let source = try XCTUnwrap(AudioNoiseBuffer(rate: 8000, samples: AudioEffectSources.vinylNoise(rate: 8000, random: { 0.3 })))
        let effect = AudioNoise(); effect.prepare(rate: 8000)
        XCTAssertFalse(effect.set(0.5)); XCTAssertFalse(effect.set(.nan, source: source))
        XCTAssertTrue(effect.set(1, source: source)); XCTAssertTrue(effect.active)
        let format = AVAudioFormat(standardFormatWithSampleRate: 8000, channels: 2)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 6400)!
        buffer.frameLength = buffer.frameCapacity
        let data = buffer.floatChannelData!
        func clear() { data[0].update(repeating: 0, count: 6400); data[1].update(repeating: 0, count: 6400) }
        clear(); data[0][0] = 0.25
        effect.process(buffer.mutableAudioBufferList, frames: 6401)
        XCTAssertEqual(data[0][0], 0.25, "Reject an incomplete buffer without advancing source or gain")
        let mono = AVAudioPCMBuffer(pcmFormat: AVAudioFormat(standardFormatWithSampleRate: 8000, channels: 1)!, frameCapacity: 128)!
        mono.frameLength = 128; mono.floatChannelData![0].update(repeating: 0.2, count: 128)
        effect.process(mono.mutableAudioBufferList, frames: 128); XCTAssertEqual(mono.floatChannelData![0][0], 0.2)
        effect.set(0); clear(); effect.process(buffer.mutableAudioBufferList, frames: 6399); XCTAssertTrue(effect.active)
        effect.set(0.4); clear(); effect.process(buffer.mutableAudioBufferList, frames: 6400); XCTAssertTrue(effect.active)
        effect.set(0); clear(); effect.process(buffer.mutableAudioBufferList, frames: 3200)
        effect.set(0); clear(); effect.process(buffer.mutableAudioBufferList, frames: 3200)
        XCTAssertFalse(effect.active, "Repeated disable must not postpone teardown")
        XCTAssertFalse(effect.set(1)); XCTAssertTrue(effect.set(1, source: source))
        clear(); data[0][0] = .nan; data[1][0] = .infinity
        effect.process(buffer.mutableAudioBufferList, frames: 128)
        XCTAssertTrue((0..<128).allSatisfy { data[0][$0].isFinite && data[1][$0].isFinite })
        effect.unprepare(); XCTAssertFalse(effect.available); XCTAssertFalse(effect.active)
        effect.prepare(rate: .infinity); XCTAssertFalse(effect.available)
        XCTAssertNil(AudioNoiseBuffer(rate: 8000, samples: [[]]))
    }
}
