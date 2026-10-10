import XCTest
import AVFoundation
@testable import App

// TransitionToneTests.swift — independent original WebKit PCM oracle for curves, tails and cancellation.
private struct ToneReference: Decodable {
    struct Case: Decodable {
        let rate: Double, start: Double, duration: Double
        let cancel: Int?
        let indices: [Int], bands: NativeTransitionEnvelope.Bands, channels: [[Float]]
    }
    let frames: Int, cases: [Case]
}

@MainActor extension NativeTests {
    func testTransitionToneMatchesOriginalWebKitAcrossCurvesAndCancellation() throws {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "TransitionToneReference", withExtension: "json"))
        let reference = try JSONDecoder().decode(ToneReference.self, from: Data(contentsOf: url))
        XCTAssertEqual(reference.cases.count, 48)
        var maximum: Float = 0
        for (caseIndex, entry) in reference.cases.enumerated() {
            let curve = try TransitionBandCurve(entry.bands)
            for block in [128, 257] {
                for deck in 0..<2 {
                    let tone = TransitionTone()
                    let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: entry.rate, channels: 2, interleaved: true)!
                    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(block))!
                    let pcm = buffer.floatChannelData![0]
                    var next = 0, at = 0
                    var error: Float = 0
                    while at < reference.frames {
                        let stop = entry.cancel.flatMap { $0 > at ? $0 : nil } ?? reference.frames
                        let count = min(block, stop - at, reference.frames - at)
                        buffer.frameLength = AVAudioFrameCount(count)
                        for i in 0..<count {
                            let frame = Double(at + i)
                            let value = 0.1 * sin(frame * 2 * .pi * 97 / entry.rate)
                                + 0.03 * cos(frame * 2 * .pi * 997 / entry.rate)
                                + 0.02 * sin(frame * 2 * .pi * 2701 / entry.rate)
                            pcm[i * 2] = Float(value); pcm[i * 2 + 1] = Float(-0.25 * value)
                        }
                        let cancelled = entry.cancel.map { at >= $0 } ?? false
                        tone.process(pcm, frames: count, sampleTime: Double(at), rate: entry.rate,
                            curve: cancelled ? nil : curve, incoming: deck == 1, start: entry.start,
                            duration: entry.duration, generation: cancelled ? 1 : 0, immediate: false)
                        while next < entry.indices.count && entry.indices[next] < at + count {
                            let index = entry.indices[next] - at
                            for channel in 0..<2 {
                                error = max(error, abs(pcm[index * 2 + channel] - entry.channels[deck * 2 + channel][next]))
                            }
                            next += 1
                        }
                        at += count
                    }
                    maximum = max(maximum, error)
                    XCTAssertLessThan(error, 0.00001, "case=\(caseIndex) block=\(block) deck=\(deck)")
                    XCTAssertEqual(next, entry.indices.count)
                }
            }
        }
        print("Original WebKit transition tone maximum PCM error=\(maximum)")
    }

    func testTransitionToneNeutralWarmupAndInvalidBands() throws {
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 44100, channels: 2, interleaved: true)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512)!
        buffer.frameLength = 512
        let pcm = buffer.floatChannelData![0]
        for i in 0..<1024 { pcm[i] = Float(sin(Double(i))) * 0.1 }
        let original = Array(UnsafeBufferPointer(start: pcm, count: 1024)), tone = TransitionTone()
        tone.consumeNeutral(pcm, frames: 512)
        tone.process(pcm, frames: 512, sampleTime: 512, rate: 44100, curve: nil,
            incoming: false, start: 512, duration: 0, generation: 1, immediate: false)
        XCTAssertEqual(Array(UnsafeBufferPointer(start: pcm, count: 1024)), original)
        for invalid in [
            NativeTransitionEnvelope.Bands(out: [], in: []),
            .init(out: [[0, -25], [0, 0], [0, 0]], in: [[0, 0], [0, 0], [0, 0]]),
            .init(out: [[0, 0], [0, 0], [0, 0]], in: [[0, .nan], [0, 0], [0, 0]]),
        ] { XCTAssertThrowsError(try TransitionBandCurve(invalid)) }
    }
}
