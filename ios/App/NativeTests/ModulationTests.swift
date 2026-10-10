import XCTest
import AVFoundation
@testable import App

// ModulationTests.swift — original WebKit modulation oracle plus lifecycle and buffer-boundary checks.
private struct ModulationReference: Decodable {
    struct Case: Decodable {
        struct Event: Decodable { let frame: Int; let amount: Double }
        struct Channel: Decodable { let samples: [Float]; let energy: Double }
        let rate: Double; let kind: String; let inputs: [Int]; let events: [Event]; let channels: [Channel]
    }
    let frames: Int; let indices: [Int]; let cases: [Case]
}
@MainActor extension NativeTests {
    func testWowAndWidthMatchOriginalWebKitAcrossRatesAndBufferLayouts() throws {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "ModulationReference", withExtension: "json"))
        let reference = try JSONDecoder().decode(ModulationReference.self, from: Data(contentsOf: url))
        for entry in reference.cases {
            for interleaved in [false, true] {
                let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: entry.rate, channels: AVAudioChannelCount(entry.inputs.count), interleaved: interleaved)!
                let wow = AudioWowDelay(); wow.prepare(rate: entry.rate, channels: entry.inputs.count)
                let width = AudioStereoWidth(); width.prepare(rate: entry.rate)
                var output = [[Float](), [Float]()], energy = [0.0, 0.0]
                for (eventIndex, event) in entry.events.enumerated() {
                    wow.set(event.amount); width.set(event.amount)
                    let end = eventIndex + 1 < entry.events.count ? entry.events[eventIndex + 1].frame : reference.frames
                    var offset = event.frame
                    while offset < end {
                        let count = min(interleaved ? 73 : 257, end - offset)
                        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count))!
                        buffer.frameLength = buffer.frameCapacity
                        let list = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
                        for channel in entry.inputs.indices {
                            let data = list[interleaved ? 0 : channel].mData!.assumingMemoryBound(to: Float.self)
                            for i in 0..<count {
                                let t = Double(offset + i)
                                data[interleaved ? i * entry.inputs.count + channel : i] = Float((entry.inputs[channel] == 0 ? 0.1 : -0.07) * sin(t * 2 * .pi * 121 / entry.rate)
                                    + (entry.inputs[channel] == 0 ? 0.03 : 0.02) * cos(t * 2 * .pi * 799 / entry.rate))
                            }
                        }
                        if entry.kind == "wow" { wow.process(buffer.mutableAudioBufferList, frames: count) }
                        else { width.process(buffer.mutableAudioBufferList, frames: count) }
                        for channel in entry.inputs.indices {
                            let data = list[interleaved ? 0 : channel].mData!.assumingMemoryBound(to: Float.self)
                            for i in 0..<count {
                                let sample = data[interleaved ? i * entry.inputs.count + channel : i]
                                output[channel].append(sample); energy[channel] += Double(sample) * Double(sample)
                            }
                        }
                        offset += count
                    }
                }
                for channel in entry.inputs.indices {
                    let error = zip(reference.indices, entry.channels[channel].samples).map { abs(output[channel][$0.0] - $0.1) }.max() ?? .infinity
                    XCTAssertLessThan(error, 0.00002, "\(entry.kind) rate=\(entry.rate) initial=\(entry.events[0].amount) channel=\(channel)")
                    XCTAssertEqual(energy[channel], entry.channels[channel].energy, accuracy: max(0.00001, entry.channels[channel].energy * 0.0002))
                }
            }
        }
    }
    func testWowReleaseCancellationAndDiscontinuity() {
        let format = AVAudioFormat(standardFormatWithSampleRate: 8000, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 6400)!
        buffer.frameLength = 6400
        let samples = buffer.floatChannelData!.pointee
        samples.update(repeating: 0.1, count: 6400)
        let wow = AudioWowDelay(); wow.prepare(rate: 8000, channels: 1)
        wow.set(1); wow.process(buffer.mutableAudioBufferList, frames: 6400)
        wow.set(0); wow.process(buffer.mutableAudioBufferList, frames: 6399)
        XCTAssertTrue(wow.oscillatorsActive)
        wow.set(0.5); wow.process(buffer.mutableAudioBufferList, frames: 6400)
        XCTAssertTrue(wow.oscillatorsActive, "Re-enabling must cancel the old release")
        wow.set(0); wow.process(buffer.mutableAudioBufferList, frames: 6400)
        XCTAssertFalse(wow.oscillatorsActive)
        wow.set(1)
        samples.update(repeating: 0, count: 6400)
        wow.process(buffer.mutableAudioBufferList, frames: 6400, discontinuity: true)
        XCTAssertTrue((0..<6400).allSatisfy { samples[$0] == 0 }, "Seek must discard pre-seek audio history")
        wow.unprepare(); XCTAssertFalse(wow.available); XCTAssertFalse(wow.oscillatorsActive)
    }
    func testWowNeutralBypassAndStereoWidthRejectsMono() {
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 256)!
        buffer.frameLength = 256
        let samples = buffer.floatChannelData!.pointee
        for i in 0..<256 { samples[i] = Float(sin(Double(i))) * 0.25 }
        let wow = AudioWowDelay(); wow.prepare(rate: 44100, channels: 1)
        wow.process(buffer.mutableAudioBufferList, frames: 257)
        wow.process(buffer.mutableAudioBufferList, frames: 256)
        let width = AudioStereoWidth(); width.prepare(rate: 44100); width.set(2)
        width.process(buffer.mutableAudioBufferList, frames: 256)
        for i in 0..<256 { XCTAssertEqual(samples[i], Float(sin(Double(i))) * 0.25) }
    }
    func testWowSharesOneModulationTimelineAcrossStereoChannels() {
        for interleaved in [false, true] {
            let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 2, interleaved: interleaved)!
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096)!
            buffer.frameLength = 4096
            let list = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
            let left = list[0].mData!.assumingMemoryBound(to: Float.self)
            let right = list[interleaved ? 0 : 1].mData!.assumingMemoryBound(to: Float.self)
            let wow = AudioWowDelay(); wow.prepare(rate: 48000, channels: 2)
            for amount in [0.35, 0, 0.8] {
                wow.set(amount)
                for i in 0..<4096 {
                    let value = Float(sin(Double(i))) * 0.1
                    left[interleaved ? i * 2 : i] = value
                    right[interleaved ? i * 2 + 1 : i] = value
                }
                wow.process(buffer.mutableAudioBufferList, frames: 4096)
                for i in 0..<4096 { XCTAssertEqual(left[interleaved ? i * 2 : i], right[interleaved ? i * 2 + 1 : i]) }
            }
        }
    }
}
