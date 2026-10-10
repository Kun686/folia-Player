import XCTest
@testable import App

// EffectRampTests.swift — direct AudioParam output oracle, independent of filter/compressor tolerances.
private struct EffectRampReference: Decodable {
    struct Case: Decodable {
        struct Event: Decodable { let frame: Int; let target: Double }
        let rate: Double; let seconds: Double; let initial: Double; let events: [Event]; let samples: [Float]
    }
    let frames: Int; let indices: [Int]; let cases: [Case]
}
@MainActor extension NativeTests {
    func testEffectRampsFollowWebKitFloat32AudioRateRecurrence() throws {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "EffectRampReference", withExtension: "json"))
        let reference = try JSONDecoder().decode(EffectRampReference.self, from: Data(contentsOf: url))
        for entry in reference.cases {
            var ramp = AudioEffectRamp(entry.initial, rate: entry.rate, seconds: entry.seconds)
            var samples = [Float]()
            for frame in 0..<reference.frames {
                if let event = entry.events.first(where: { $0.frame == frame }) { ramp.set(event.target) }
                samples.append(Float(ramp.next()))
            }
            for (index, value) in zip(reference.indices, entry.samples) {
                // Floating event-time conversion can round a change one sample forward, leaving a one-ULP residue.
                XCTAssertEqual(samples[index], value, accuracy: max(Float.leastNormalMagnitude, value.ulp * 2),
                               "rate=\(entry.rate) seconds=\(entry.seconds) initial=\(entry.initial) frame=\(index)")
            }
        }
    }
}
