import XCTest
@testable import App

// OversamplingTests.swift — independent WebKit signal/latency oracle plus reset and invalid-input boundaries.
private struct OversamplingReference: Decodable {
    struct Case: Decodable {
        struct Event: Decodable { let frame: Int; let amount: Double }
        let rate: Double; let kind: String; let events: [Event]; let peak: Int; let samples: [Float]; let energy: Double
    }
    let indices: [Int]; let cases: [Case]
}
@MainActor extension NativeTests {
    func testOversamplingAndCrushMatchWebKitWithArbitraryCallbackSizes() throws {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "OversamplingReference", withExtension: "json"))
        let reference = try JSONDecoder().decode(OversamplingReference.self, from: Data(contentsOf: url))
        for entry in reference.cases {
            for chunk in [1, 73, 128] {
                let processor = WebAudioOversampling()
                var samples = [Float](repeating: 0, count: 8192), output = samples
                for i in samples.indices {
                    samples[i] = i == 0 ? 0.25 : i < 1024 ? 0
                        : Float(0.5 * sin(Double(i) * 0.41 * .pi) + 0.2 * sin(Double(i) * 2 * .pi * 997 / entry.rate))
                }
                for (eventIndex, event) in entry.events.enumerated() {
                    let curve = (entry.kind == "drive" ? AudioEffectSources.saturation(event.amount) : AudioEffectSources.bitCrush(event.amount)) ?? []
                    let end = eventIndex + 1 < entry.events.count ? entry.events[eventIndex + 1].frame : 8192
                    samples.withUnsafeBufferPointer { input in
                        output.withUnsafeMutableBufferPointer { result in
                            curve.withUnsafeBufferPointer { shape in
                                var start = event.frame
                                while start < end {
                                    let count = min(chunk, end - start)
                                    if entry.kind == "drive" {
                                        XCTAssertTrue(processor.process(UnsafeBufferPointer(start: input.baseAddress! + start, count: count),
                                            into: UnsafeMutableBufferPointer(start: result.baseAddress! + start, count: count), curve: shape))
                                    } else {
                                        (result.baseAddress! + start).update(from: input.baseAddress! + start, count: count)
                                        WebAudioWaveShaper.process(result.baseAddress! + start, count: count, curve: shape)
                                    }
                                    start += count
                                }
                            }
                        }
                    }
                }
                let maximum = zip(reference.indices, entry.samples).map { abs(output[$0.0] - $0.1) }.max() ?? .infinity
                XCTAssertLessThan(maximum, 0.00002, "\(entry.kind) rate=\(entry.rate) amount=\(entry.events[0].amount) chunk=\(chunk)")
                let energy = output.reduce(0.0) { $0 + Double($1) * Double($1) }
                XCTAssertEqual(energy, entry.energy, accuracy: max(0.00001, entry.energy * 0.0002))
                let peak = (0..<1024).max { abs(output[$0]) < abs(output[$1]) }
                XCTAssertEqual(peak, entry.peak)
                if entry.kind == "drive" && entry.events[0].amount == 0 { XCTAssertEqual(peak, WebAudioOversampling.latencyFrames) }
            }
        }
    }
    func testOversamplingResetAndNonfiniteInput() {
        let processor = WebAudioOversampling(), empty = [Float]()
        var input = [Float](repeating: 0.5, count: 128), output = [Float](repeating: 0, count: 128)
        func render() {
            input.withUnsafeBufferPointer { source in output.withUnsafeMutableBufferPointer { result in
                empty.withUnsafeBufferPointer { curve in XCTAssertTrue(processor.process(source, into: result, curve: curve)) }
            } }
        }
        render(); render(); processor.reset(); input = Array(repeating: 0, count: 128)
        render(); XCTAssertTrue(output.allSatisfy { $0 == 0 })
        input[0] = .nan; input[1] = .infinity
        render(); render(); XCTAssertTrue(output.allSatisfy { $0.isFinite && $0 == 0 })
        input = Array(repeating: 1, count: 129)
        input.withUnsafeBufferPointer { source in output.withUnsafeMutableBufferPointer { result in
            empty.withUnsafeBufferPointer { curve in XCTAssertFalse(processor.process(source, into: result, curve: curve)) }
        } }
        XCTAssertTrue(output.allSatisfy { $0 == 0 })
        var shaped: [Float] = [-2, -1, 0, 1, 2, .nan, .infinity]
        let curve: [Float] = [-0.5, 0, 0.5]
        shaped.withUnsafeMutableBufferPointer { pcm in curve.withUnsafeBufferPointer { shape in
            WebAudioWaveShaper.process(pcm.baseAddress!, count: pcm.count, curve: shape)
        } }
        XCTAssertEqual(shaped, [-0.5, -0.5, 0, 0.5, 0.5, 0, 0])
    }
}
