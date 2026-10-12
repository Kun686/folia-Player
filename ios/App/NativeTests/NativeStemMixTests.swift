import XCTest
import AVFoundation
@testable import App

// NativeStemMixTests.swift — independent original WebKit graph PCM, including the shared limiter.
private struct StemMixReference: Decodable {
    struct Case: Decodable {
        let name: String, seconds: Double, level: Double, outLevel: Double, inLevel: Double
        let solo: String?, mono: Bool
        let frames: Int, indices: [Int], channels: [[Float]]
    }
    let rate: Double, cases: [Case]
}

@MainActor extension NativeTests {
    private func stemMixReference() throws -> (StemMixReference, [[String: Any]]) {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "StemMixReference", withExtension: "json"))
        let data = try Data(contentsOf: url)
        let fields = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        return (try JSONDecoder().decode(StemMixReference.self, from: data), try XCTUnwrap(fields["cases"] as? [[String: Any]]))
    }
    private func stemPCM(_ entry: StemMixReference.Case, deck: Int) throws -> NativeStemPCM {
        var stems: [NativeStemName: [[Float]]] = [:]
        for (stem, name) in [NativeStemName.drums, .bass, .other, .vocals].enumerated() {
            stems[name] = (0..<2).map { channel in
                (0..<entry.frames).map { i in
                    guard entry.solo == nil || entry.solo == name.rawValue else { return Float(0) }
                    let polarity = channel == 1 && !entry.mono ? -0.37 : 1.0
                    let value = 0.7 * sin(Double(i) * 2 * .pi * Double(97 + stem * 301 + deck * 43) / 44100)
                        + 0.3 * cos(Double(i) * 2 * .pi * Double(41 + stem * 73 + deck * 29) / 44100)
                    return Float(polarity * entry.level * value)
                }
            }
        }
        return try NativeStemPCM(stems)
    }

    func testStemMixerMatchesOriginalWebKitPCM() async throws {
        let (reference, rows) = try stemMixReference(), planner = NativeTransitionPlanner()
        XCTAssertEqual(reference.rate, NativeStemPCM.rate); XCTAssertEqual(rows.count, 7)
        let bus = try await planner.stemBus()
        var maximum: Float = 0
        for (caseIndex, entry) in reference.cases.enumerated() {
            let gesture = try await planner.stems(JSONSerialization.data(withJSONObject: XCTUnwrap(rows[caseIndex]["input"])))
            let outgoing = try stemPCM(entry, deck: 0), incoming = try stemPCM(entry, deck: 1)
            for block in [128, 257, 8192] {
                let mixer = try NativeStemMixer(outgoing: outgoing, incoming: incoming, gesture: gesture,
                                               bus: bus, outLevel: entry.outLevel, inLevel: entry.inLevel)
                let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 44100, channels: 2, interleaved: true)!
                let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(block))!
                let pcm = buffer.floatChannelData![0]
                var next = 0, error: Float = 0
                while mixer.position < mixer.frames {
                    let at = mixer.position, count = block
                    buffer.frameLength = AVAudioFrameCount(count)
                    XCTAssertTrue(mixer.render(buffer.mutableAudioBufferList, frames: count))
                    while next < entry.indices.count && entry.indices[next] < at + count {
                        let index = entry.indices[next] - at
                        for channel in 0..<2 { error = max(error, abs(pcm[index * 2 + channel] - entry.channels[channel][next])) }
                        next += 1
                    }
                    if at + count > mixer.frames {
                        XCTAssertTrue(UnsafeBufferPointer(start: pcm + (mixer.frames - at) * 2,
                            count: (at + count - mixer.frames) * 2).allSatisfy { $0 == 0 })
                    }
                }
                maximum = max(maximum, error)
                XCTAssertEqual(next, entry.indices.count)
                XCTAssertLessThan(error, 0.00001, "\(entry.name) block=\(block) error=\(error)")
                buffer.frameLength = AVAudioFrameCount(block)
                pcm.update(repeating: 1, count: block * 2)
                XCTAssertTrue(mixer.render(buffer.mutableAudioBufferList, frames: block))
                XCTAssertTrue(UnsafeBufferPointer(start: pcm, count: block * 2).allSatisfy { $0 == 0 })
                XCTAssertEqual(mixer.position, mixer.frames)
            }
        }
        print("Original WebKit stem bus maximum PCM error=\(maximum)")
    }

    func testStemMixerValidatesPCMAndDoesNotAdvanceOnInvalidRender() async throws {
        let (reference, rows) = try stemMixReference(), planner = NativeTransitionPlanner(), entry = reference.cases[0]
        let gesture = try await planner.stems(JSONSerialization.data(withJSONObject: XCTUnwrap(rows[0]["input"])))
        let pcm = try stemPCM(entry, deck: 0), bus = try await planner.stemBus()
        let mixer = try NativeStemMixer(outgoing: pcm, incoming: pcm, gesture: gesture, bus: bus)
        XCTAssertThrowsError(try NativeStemPCM([:]))
        var invalid = pcm.stems
        invalid[.drums] = [[.nan], [.nan]]
        XCTAssertThrowsError(try NativeStemPCM(invalid))
        invalid = pcm.stems; invalid[.other] = [Array(repeating: .infinity, count: pcm.frames), pcm.stems[.other]![1]]
        XCTAssertThrowsError(try NativeStemPCM(invalid))
        let short = try NativeStemPCM(pcm.stems.mapValues { $0.map { Array($0.prefix(100)) } })
        XCTAssertThrowsError(try NativeStemMixer(outgoing: short, incoming: pcm, gesture: gesture, bus: bus))
        for level in [-1, Double.nan, Double.infinity, Double.greatestFiniteMagnitude] {
            XCTAssertThrowsError(try NativeStemMixer(outgoing: pcm, incoming: pcm, gesture: gesture, bus: bus, outLevel: level))
        }
        let mono = AVAudioPCMBuffer(pcmFormat: AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1)!, frameCapacity: 128)!
        mono.frameLength = 128
        XCTAssertFalse(mixer.render(mono.mutableAudioBufferList, frames: 128)); XCTAssertEqual(mixer.position, 0)
        let stereo = AVAudioPCMBuffer(pcmFormat: AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 44100, channels: 2, interleaved: true)!, frameCapacity: 257)!
        stereo.frameLength = 257; stereo.floatChannelData![0].update(repeating: 0.25, count: 514)
        XCTAssertFalse(mixer.render(stereo.mutableAudioBufferList, frames: 258)); XCTAssertEqual(mixer.position, 0)
        XCTAssertFalse(mixer.render(stereo.mutableAudioBufferList, frames: 0)); XCTAssertEqual(mixer.position, 0)
        XCTAssertTrue(mixer.render(stereo.mutableAudioBufferList, frames: 128)); XCTAssertEqual(mixer.position, 128)
        XCTAssertEqual(stereo.floatChannelData![0][256], 0.25, "Never write beyond the requested PCM region")
    }

    func testStemPCMTraversesOriginalNativeEffectOutputAndMasterMute() async throws {
        let (reference, rows) = try stemMixReference(), planner = NativeTransitionPlanner(), entry = reference.cases[0]
        let gesture = try await planner.stems(JSONSerialization.data(withJSONObject: XCTUnwrap(rows[0]["input"])))
        let mixer = try NativeStemMixer(outgoing: stemPCM(entry, deck: 0), incoming: stemPCM(entry, deck: 1),
                                       gesture: gesture, bus: await planner.stemBus())
        let engine = AVAudioEngine(), effect = try await AudioEffectUnit.makeNode()
        let interleaved = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 44100, channels: 2, interleaved: true)!
        let planar = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        let source = AVAudioSourceNode(format: interleaved) { silence, _, frames, output in
            let sounding = mixer.position < mixer.frames
            let valid = mixer.render(output, frames: Int(frames))
            silence.pointee = ObjCBool(!sounding || !valid)
            return valid ? noErr : kAudioUnitErr_InvalidParameter
        }
        engine.attach(source); engine.attach(effect)
        engine.connect(source, to: effect, format: planar)
        engine.connect(effect, to: engine.mainMixerNode, format: planar)
        try engine.enableManualRenderingMode(.offline, format: planar, maximumFrameCount: 512)
        defer { engine.stop(); engine.detach(source); engine.detach(effect) }
        engine.prepare(); try engine.start()
        let output = AVAudioPCMBuffer(pcmFormat: planar, frameCapacity: 512)!
        var audible: Float = 0, stereoDifference: Float = 0, blockPeaks: [Float] = []
        for index in 0..<20 {
            if index == 6 { engine.mainMixerNode.outputVolume = 0 }
            XCTAssertEqual(try engine.renderOffline(512, to: output), .success)
            let l = output.floatChannelData![0], r = output.floatChannelData![1]
            var peak: Float = 0
            for frame in 0..<512 {
                peak = max(peak, abs(l[frame]), abs(r[frame]))
                if index < 6 {
                    audible = max(audible, abs(l[frame]))
                    stereoDifference = max(stereoDifference, abs(l[frame] - r[frame]))
                }
            }
            blockPeaks.append(peak)
        }
        // AVAudioMixer ramps outputVolume. Use the same eight-block settling allowance as
        // SharedStreamOutputTests, then demand bit-exact silence rather than relaxing PCM accuracy.
        XCTAssertEqual(blockPeaks.suffix(6).max(), 0)
        print("Stem output block peaks; mute requested at block 6: \(blockPeaks)")
        XCTAssertGreaterThan(audible, 0.01); XCTAssertGreaterThan(stereoDifference, 0.01)
        XCTAssertGreaterThan(mixer.position, 0)
    }
}
