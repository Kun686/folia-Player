import XCTest
import AVFoundation
@testable import App

// EffectPrimitiveTests.swift — compare native effect primitives with original generators and WebKit audio output.
private struct EffectReference: Decodable {
    struct Curve: Decodable { let amount: Double; let saturation: [Float]; let crush: [Float] }
    struct Source: Decodable {
        struct Channel: Decodable { let samples: [Float]; let energy: Double }
        let rate: Double; let kind: String; let length: Int; let indices: [Int]; let channels: [Channel]
    }
    struct Cutoff: Decodable {
        struct Event: Decodable { let frame: Int; let highpass: Double; let lowpass: Double }
        let rate: Double; let events: [Event]; let samples: [Float]; let energy: Double
    }
    let curves: [Curve]; let sources: [Source]; let indices: [Int]; let cutoffs: [Cutoff]
    static func read() throws -> EffectReference {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "EffectReference", withExtension: "json"))
        return try JSONDecoder().decode(EffectReference.self, from: Data(contentsOf: url))
    }
}

@MainActor extension NativeTests {
    func testEffectCurvesMatchEveryOriginalFloat32Sample() throws {
        for entry in try EffectReference.read().curves {
            let saturation = AudioEffectSources.saturation(entry.amount) ?? [], crush = AudioEffectSources.bitCrush(entry.amount) ?? []
            XCTAssertEqual(saturation.count, entry.saturation.count); XCTAssertEqual(crush, entry.crush)
            for (actual, expected) in zip(saturation, entry.saturation) { XCTAssertEqual(actual, expected, accuracy: 0.0000001) }
        }
        for invalid in [Double.nan, .infinity, -1, 1.1] {
            XCTAssertNil(AudioEffectSources.saturation(invalid)); XCTAssertNil(AudioEffectSources.bitCrush(invalid))
        }
    }
    func testNoiseAndReverbSourcesMatchOriginalWithSeededRandomness() throws {
        for entry in try EffectReference.read().sources {
            var seed: UInt32 = 0x12345678
            let random: () -> Double = { seed = seed &* 1664525 &+ 1013904223; return Double(seed) / 4294967296 }
            let actual = entry.kind == "noise" ? AudioEffectSources.vinylNoise(rate: entry.rate, random: random)
                : AudioEffectSources.reverbImpulse(rate: entry.rate, random: random)
            XCTAssertEqual(actual.count, 2)
            for channel in 0..<2 {
                XCTAssertEqual(actual[channel].count, entry.length)
                for (probe, index) in entry.indices.enumerated() {
                    XCTAssertEqual(actual[channel][index], entry.channels[channel].samples[probe], accuracy: 0.0000001)
                }
                let energy = actual[channel].reduce(0.0) { $0 + Double($1) * Double($1) }
                XCTAssertEqual(energy, entry.channels[channel].energy, accuracy: 0.00001)
            }
        }
        XCTAssertEqual(AudioEffectSources.vinylNoise(rate: .infinity), [])
        XCTAssertEqual(AudioEffectSources.reverbImpulse(rate: 1e9), [])
    }
    func testCutoffAutomationMatchesOriginalWebKitAcrossRatesAndBufferLayouts() throws {
        let reference = try EffectReference.read()
        for entry in reference.cutoffs {
            for interleaved in [false, true] {
                let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: entry.rate, channels: 2, interleaved: interleaved)!
                let filter = AudioCutoffFilters(); filter.prepare(rate: entry.rate, channels: 2)
                XCTAssertTrue(filter.available)
                var output = [Float](), energy = 0.0
                for (eventIndex, event) in entry.events.enumerated() {
                    filter.set(highpass: event.highpass, lowpass: event.lowpass)
                    let end = eventIndex + 1 < entry.events.count ? entry.events[eventIndex + 1].frame : 8192
                    var offset = event.frame
                    // Uneven callback sizes must not alter automation, channel state or boundary samples.
                    while offset < end {
                        let count = min(interleaved ? 73 : 257, end - offset)
                        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count))!
                        buffer.frameLength = buffer.frameCapacity
                        let list = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
                        for b in list { b.mData!.assumingMemoryBound(to: Float.self).update(repeating: 0, count: Int(b.mDataByteSize) / 4) }
                        let left = list[0].mData!.assumingMemoryBound(to: Float.self)
                        for i in 0..<count {
                            let frame = offset + i, t = Double(frame)
                            left[i * (interleaved ? 2 : 1)] = Float(0.1 * sin(t * 2 * .pi * 121 / entry.rate)
                                + 0.03 * cos(t * 2 * .pi * 1997 / entry.rate) + (frame == 0 ? 0.25 : frame == 2050 ? -0.2 : 0))
                        }
                        filter.process(buffer.mutableAudioBufferList, frames: count)
                        let right = list[interleaved ? 0 : 1].mData!.assumingMemoryBound(to: Float.self)
                        for i in 0..<count {
                            let sample = left[i * (interleaved ? 2 : 1)]
                            XCTAssertTrue(sample.isFinite)
                            XCTAssertEqual(right[interleaved ? i * 2 + 1 : i], 0)
                            output.append(sample); energy += Double(sample) * Double(sample)
                        }
                        offset += count
                    }
                }
                let error = zip(reference.indices, entry.samples).map { abs(output[$0.0] - $0.1) }.max() ?? .infinity
                XCTAssertLessThan(error, 0.00002, "rate=\(entry.rate) first=\(entry.events[0]) interleaved=\(interleaved)")
                XCTAssertEqual(energy, entry.energy, accuracy: max(0.00001, entry.energy * 0.0002))
            }
        }
    }
    func testCutoffResetAndMalformedBuffersCannotLeakOldAudioOrPoisonFilters() {
        let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 128)!
        buffer.frameLength = 128
        let samples = buffer.floatChannelData!.pointee
        let filter = AudioCutoffFilters(); filter.prepare(rate: 48000, channels: 1)
        samples.update(repeating: 0, count: 128); samples[0] = 0.25
        filter.process(buffer.mutableAudioBufferList, frames: 129)
        XCTAssertEqual(samples[0], 0.25, "Short buffer must be rejected before any modification")
        filter.process(buffer.mutableAudioBufferList, frames: 128)
        samples.update(repeating: 0, count: 128)
        filter.process(buffer.mutableAudioBufferList, frames: 128, discontinuity: true)
        XCTAssertTrue((0..<128).allSatisfy { samples[$0] == 0 })
        samples[0] = .nan; samples[1] = .infinity; samples[2] = 0.25
        filter.set(highpass: .nan, lowpass: .infinity)
        filter.process(buffer.mutableAudioBufferList, frames: 128)
        XCTAssertTrue((0..<128).allSatisfy { samples[$0].isFinite })
        XCTAssertNotEqual(samples[2], 0)
        filter.prepare(rate: 48000, channels: 9); XCTAssertFalse(filter.available)
        filter.prepare(rate: .nan, channels: 1); XCTAssertFalse(filter.available)
    }
}
