import XCTest
import AVFoundation
@testable import App

// CompressorTests.swift — actual WebKit envelope oracle, callback independence and linked-channel boundaries.
private struct CompressorReference: Decodable {
    struct Case: Decodable {
        struct Event: Decodable { let frame: Int; let amount: Double }
        struct Channel: Decodable { let samples: [Float]; let energy: Double }
        struct Parameters: Decodable { let frame: Int; let threshold: Float; let knee: Float; let ratio: Float }
        let rate: Double; let kind: String; let events: [Event]; let channels: [Channel]
        let parameters: [Parameters]
    }
    let frames: Int; let indices: [Int]; let cases: [Case]
}
@MainActor extension NativeTests {
    func testCompressorStaticEnvelopeMatchesOriginalWebKit() throws { try checkCompressor("static") }
    func testCompressorPunchAutomationMatchesOriginalWebKit() throws { try checkCompressor("automated") }

    func testCompressorControlParametersMatchWebKitExactly() throws {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "CompressorReference", withExtension: "json"))
        let reference = try JSONDecoder().decode(CompressorReference.self, from: Data(contentsOf: url))
        for entry in reference.cases where entry.kind == "automated" {
            var threshold = AudioEffectControlRamp(0, rate: entry.rate)
            var knee = AudioEffectControlRamp(30, rate: entry.rate)
            var ratio = AudioEffectControlRamp(1, rate: entry.rate)
            for snapshot in entry.parameters {
                if let event = entry.events.first(where: { $0.frame == snapshot.frame }) {
                    threshold.set(-6 - event.amount * 26); knee.set(30 - event.amount * 18)
                    ratio.set(1 + event.amount * 7)
                }
                XCTAssertEqual(threshold.next(), snapshot.threshold, "threshold rate=\(entry.rate) frame=\(snapshot.frame)")
                XCTAssertEqual(knee.next(), snapshot.knee, "knee rate=\(entry.rate) frame=\(snapshot.frame)")
                XCTAssertEqual(ratio.next(), snapshot.ratio, "ratio rate=\(entry.rate) frame=\(snapshot.frame)")
            }
        }
    }

    private func checkCompressor(_ kind: String) throws {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "CompressorReference", withExtension: "json"))
        let reference = try JSONDecoder().decode(CompressorReference.self, from: Data(contentsOf: url))
        for entry in reference.cases where entry.kind == kind {
            for interleaved in [false, true] {
                let kernel = WebAudioCompressor(); kernel.prepare(rate: entry.rate, channels: 2)
                let punch = AudioPunch(); punch.prepare(rate: entry.rate, channels: 2)
                let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: entry.rate, channels: 2, interleaved: interleaved)!
                var output = [[Float](), [Float]()], energy = [0.0, 0.0]
                for (eventIndex, event) in entry.events.enumerated() {
                    kernel.set(threshold: Float(-6 - 26 * event.amount), knee: Float(30 - 18 * event.amount), ratio: Float(1 + 7 * event.amount))
                    punch.set(event.amount)
                    let externalGain = Float(pow(10, event.amount * 3 / 20))
                    let end = eventIndex + 1 < entry.events.count ? entry.events[eventIndex + 1].frame : reference.frames
                    var offset = event.frame
                    while offset < end {
                        let count = min(interleaved ? 73 : 257, end - offset)
                        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count))!
                        buffer.frameLength = buffer.frameCapacity
                        let list = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
                        let left = list[0].mData!.assumingMemoryBound(to: Float.self)
                        let right = list[interleaved ? 0 : 1].mData!.assumingMemoryBound(to: Float.self)
                        for i in 0..<count {
                            let frame = offset + i, t = Double(frame)
                            let amplitude = frame < 1024 ? 0.002 : frame < 6144 ? 1 : frame < 12288 ? 0.03 : frame < 18432 ? 1.3 : frame < 24576 ? 0 : 0.1
                            var a = Float(amplitude * (0.8 * sin(t * 2 * .pi * 220 / entry.rate) + 0.1 * sin(t * 2 * .pi * 799 / entry.rate)))
                            var b = Float(amplitude * (0.07 * sin(t * 2 * .pi * 117 / entry.rate) + 0.6 * cos(t * 2 * .pi * 997 / entry.rate)))
                            if kind == "static" { kernel.processFrame(left: &a, right: &b); a *= externalGain; b *= externalGain }
                            left[interleaved ? i * 2 : i] = a; right[interleaved ? i * 2 + 1 : i] = b
                        }
                        if kind == "automated" { punch.process(buffer.mutableAudioBufferList, frames: count) }
                        for i in 0..<count {
                            let a = left[interleaved ? i * 2 : i], b = right[interleaved ? i * 2 + 1 : i]
                            output[0].append(a); output[1].append(b)
                            energy[0] += Double(a) * Double(a); energy[1] += Double(b) * Double(b)
                        }
                        offset += count
                    }
                }
                for channel in 0..<2 {
                    let maximum = zip(reference.indices, entry.channels[channel].samples).map { abs(output[channel][$0.0] - $0.1) }.max() ?? .infinity
                    XCTAssertLessThan(maximum, 0.00002, "\(kind) rate=\(entry.rate) punch=\(entry.events[0].amount) channel=\(channel)")
                    XCTAssertEqual(energy[channel], entry.channels[channel].energy, accuracy: max(0.00001, entry.channels[channel].energy * 0.0002))
                }
            }
        }
    }
    func testCompressorLinkedStereoResetLookaheadAndInvalidParameters() {
        let kernel = WebAudioCompressor(); kernel.prepare(rate: 44100, channels: 2)
        XCTAssertEqual(kernel.latencyFrames, 264)
        kernel.set(threshold: -24, knee: 18, ratio: 8)
        for i in 0..<4096 {
            var a = Float(sin(Double(i) * 0.15)) * 0.9, b = -a * 0.25
            kernel.processFrame(left: &a, right: &b)
            XCTAssertEqual(b, -a * 0.25, accuracy: 0.000001)
        }
        kernel.reset(); kernel.set(threshold: .nan, knee: 30, ratio: .infinity)
        for i in 0..<512 {
            var a: Float = i == 0 ? 0.1 : 0, b = a
            kernel.processFrame(left: &a, right: &b)
            XCTAssertTrue(a.isFinite && b.isFinite)
            if i < kernel.latencyFrames { XCTAssertEqual(a, 0) }
            if i == kernel.latencyFrames { XCTAssertGreaterThan(a, 0) }
        }
        var a: Float = .nan, b: Float = .infinity
        for _ in 0..<1024 { kernel.processFrame(left: &a, right: &b); XCTAssertTrue(a.isFinite && b.isFinite) }
        kernel.prepare(rate: .infinity, channels: 2); XCTAssertFalse(kernel.available)
        kernel.prepare(rate: 44100, channels: 3); XCTAssertFalse(kernel.available)
    }
}
