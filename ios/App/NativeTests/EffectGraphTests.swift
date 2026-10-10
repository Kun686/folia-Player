import XCTest
import AVFoundation
@testable import App

// EffectGraphTests.swift — compose the actual original post-EQ graph, with independent PCM fixtures and arbitrary callback sizes.
private struct EffectGraphReference: Decodable {
    struct Case: Decodable {
        struct Event: Decodable { let frame: Int; let enabled: Bool; let values: [String: Double] }
        struct Channel: Decodable { let samples: [Float]; let energy: Double }
        let rate: Double; let preset: String; let events: [Event]; let channels: [Channel]
        let stages: [String: [Channel]]?
    }
    let frames: Int; let indices: [Int]; let cases: [Case]
}
@MainActor extension NativeTests {
    func testCombinedEffectsMatchOriginalGraphAcrossPresetsAndRates() throws {
        try combinedEffects(trace: false)
    }
    #if DEBUG
    func testCombinedEffectStagesMatchOriginalGraph() throws { try combinedEffects(trace: true) }
    #endif
    private func combinedEffects(trace: Bool) throws {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "EffectGraphReference", withExtension: "json"))
        let reference = try JSONDecoder().decode(EffectGraphReference.self, from: Data(contentsOf: url))
        for entry in reference.cases {
            if trace && (entry.rate != 44100 || entry.preset != "flat") { continue }
            for interleaved in [false, true] {
                if trace && interleaved { continue }
                var seed: UInt32 = 0x12345678
                let random: () -> Double = { seed = seed &* 1664525 &+ 1013904223; return Double(seed) / 4294967296 }
                let initial = try XCTUnwrap(AudioEffectProgram(rate: entry.rate, values: entry.events[0].values, random: random))
                let graph = try XCTUnwrap(AudioEffectGraph(program: initial))
                var traces: [String: [[Float]]] = [:]
                #if DEBUG
                if trace {
                    graph.trace = { stage, buffers, count in
                        let list = UnsafeMutableAudioBufferListPointer(buffers)
                        var pair = traces[stage] ?? [[], []]
                        for channel in 0..<2 { pair[channel].append(contentsOf: UnsafeBufferPointer(start: list[channel].mData!.assumingMemoryBound(to: Float.self), count: count)) }
                        traces[stage] = pair
                    }
                }
                #endif
                var programs = [initial] // retain until rendering ends, like the eventual control-side retirement mailbox
                var source = initial.noise, kernel = initial.reverb
                let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: entry.rate, channels: 2, interleaved: interleaved)!
                var output = [[Float](), [Float]()], energy = [0.0, 0.0]
                for (eventIndex, event) in entry.events.enumerated() {
                    if eventIndex > 0 {
                        let program = try XCTUnwrap(AudioEffectProgram(rate: entry.rate,
                            values: event.enabled ? event.values : NativeEqualizerSettings.neutral, noise: source, reverb: kernel, random: random))
                        programs.append(program); XCTAssertTrue(graph.apply(program)); source = program.noise; kernel = program.reverb
                    }
                    let end = eventIndex + 1 < entry.events.count ? entry.events[eventIndex + 1].frame : reference.frames
                    var offset = event.frame
                    while offset < end {
                        let count = min(interleaved ? 73 : 257, end - offset)
                        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count))!
                        buffer.frameLength = buffer.frameCapacity
                        let list = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
                        for channel in 0..<2 {
                            let data = list[interleaved ? 0 : channel].mData!.assumingMemoryBound(to: Float.self)
                            for i in 0..<count {
                                let frame = offset + i, t = Double(frame)
                                let input = frame < 16384 ? (channel == 0 ? 0.1 : -0.07) * sin(t * 2 * .pi * 221 / entry.rate)
                                    + (channel == 0 ? 0.03 : 0.02) * cos(t * 2 * .pi * 1997 / entry.rate) : 0
                                data[interleaved ? i * 2 + channel : i] = Float(input)
                            }
                        }
                        graph.process(buffer.mutableAudioBufferList, frames: count)
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
                    if trace {
                        for stage in ["cutoff", "drive", "crush", "wow", "width", "makeup", "output"] {
                            let expected = try XCTUnwrap(entry.stages?[stage]?[channel].samples), actual = try XCTUnwrap(traces[stage]?[channel])
                            let worst = zip(reference.indices, expected).map { (abs(actual[$0.0] - $0.1), $0.0, actual[$0.0], $0.1) }.max(by: { $0.0 < $1.0 })!
                            print("FOLIA_STAGE \(stage) channel=\(channel) error=\(worst.0) frame=\(worst.1) native=\(worst.2) reference=\(worst.3)")
                            XCTAssertLessThan(worst.0, 0.00002, "stage=\(stage) channel=\(channel) frame=\(worst.1)")
                        }
                        continue
                    }
                    let maximum = zip(reference.indices, entry.channels[channel].samples).map { abs(output[channel][$0.0] - $0.1) }.max() ?? .infinity
                    XCTAssertLessThan(maximum, 0.00002, "preset=\(entry.preset) rate=\(entry.rate) channel=\(channel)")
                    XCTAssertEqual(energy[channel], entry.channels[channel].energy, accuracy: max(0.00001, entry.channels[channel].energy * 0.0002))
                }
                withExtendedLifetime(programs) {}
            }
        }
    }
    func testEffectProgramValidationAndGraphDiscontinuity() throws {
        var invalid = NativeEqualizerSettings.neutral; invalid["drive"] = .nan
        XCTAssertNil(AudioEffectProgram(rate: 44100, values: invalid))
        XCTAssertNil(AudioEffectProgram(rate: .infinity, values: NativeEqualizerSettings.neutral))
        XCTAssertNil(AudioEffectProgram(rate: 44100, values: [:]))
        var values = NativeEqualizerSettings.neutral; values["space"] = 0.7; values["drive"] = 0.3; values["wow"] = 0.5
        let program = try XCTUnwrap(AudioEffectProgram(rate: 44100, values: values, random: { 0.6 }))
        let graph = try XCTUnwrap(AudioEffectGraph(program: program))
        XCTAssertEqual(graph.latencyFrames, 456)
        let incompatible = try XCTUnwrap(AudioEffectProgram(rate: 48000, values: NativeEqualizerSettings.neutral))
        XCTAssertFalse(graph.apply(incompatible))
        let buffer = AVAudioPCMBuffer(pcmFormat: AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!, frameCapacity: 8192)!
        buffer.frameLength = buffer.frameCapacity; let data = buffer.floatChannelData!
        data[0].update(repeating: 0, count: 8192); data[1].update(repeating: 0, count: 8192); data[0][0] = 0.5
        graph.process(buffer.mutableAudioBufferList, frames: 8193); XCTAssertEqual(data[0][0], 0.5)
        graph.process(buffer.mutableAudioBufferList, frames: 8192)
        data[0].update(repeating: 0, count: 8192); data[1].update(repeating: 0, count: 8192)
        graph.process(buffer.mutableAudioBufferList, frames: 8192, discontinuity: true)
        XCTAssertTrue((0..<8192).allSatisfy { data[0][$0] == 0 && data[1][$0] == 0 })
    }
    func testCombinedGraphKeepsIdenticalStereoLinkedDuringAutomation() throws {
        let initial = try XCTUnwrap(AudioEffectProgram(rate: 44100, values: NativeEqualizerSettings.neutral))
        let graph = try XCTUnwrap(AudioEffectGraph(program: initial))
        let buffer = AVAudioPCMBuffer(pcmFormat: AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!, frameCapacity: 128)!
        buffer.frameLength = 128; let data = buffer.floatChannelData!
        var values = NativeEqualizerSettings.neutral, retained = [initial]
        for block in 0..<128 {
            if block % 32 == 0 {
                values["highpass"] = block == 64 ? 900 : 90; values["lowpass"] = block == 32 ? 500 : 6000
                values["drive"] = 0.3; values["crush"] = 0.4; values["wow"] = block == 96 ? 0 : 0.6; values["punch"] = 0.5
                let program = try XCTUnwrap(AudioEffectProgram(rate: 44100, values: values))
                retained.append(program); XCTAssertTrue(graph.apply(program))
            }
            for i in 0..<128 { let value = Float(sin(Double(block * 128 + i) * 0.15) * 0.3); data[0][i] = value; data[1][i] = value }
            graph.process(buffer.mutableAudioBufferList, frames: 128)
            XCTAssertTrue((0..<128).allSatisfy { data[0][$0] == data[1][$0] })
        }
        withExtendedLifetime(retained) {}
    }
}
