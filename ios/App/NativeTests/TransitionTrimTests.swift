import XCTest
import AVFoundation
@testable import App

// TransitionTrimTests.swift — original WebKit ramp oracle and actual native balance lifecycle.
private struct TrimReference: Decodable {
    struct Case: Decodable {
        struct Action: Decodable { let at: Int; let db: Double }
        let rate: Double, cancel: Int?, actions: [Action], indices: [Int], samples: [Float]
    }
    let frames: Int, cases: [Case]
}

@MainActor extension NativeTests {
    func testTransitionBalanceGainMatchesWebKitIncludingReplacementAndCancel() throws {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "TransitionTrimReference", withExtension: "json"))
        let reference = try JSONDecoder().decode(TrimReference.self, from: Data(contentsOf: url))
        var maximum: Float = 0
        for row in reference.cases {
            for pattern in [[128], [7, 255, 31, 512, 3, 89]] {
                let gain = TransitionGain(), out = UUID(), incoming = UUID()
                let epoch = gain.cancel()
                XCTAssertTrue(gain.schedule(try TransitionGainCurve(outgoing: out, incoming: incoming,
                    out: [1, 1], input: [1, 1], rate: row.rate, seconds: 10), generation: epoch))
                let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: row.rate, channels: 2, interleaved: true)!
                let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512)!
                let pcm = buffer.floatChannelData![0]
                var at = 0, block = 0, next = 0
                while at < reference.frames {
                    if let action = row.actions.first(where: { $0.at == at }) {
                        XCTAssertTrue(gain.trim(gain: pow(10, action.db / 20), seconds: 0.4, generation: epoch))
                    }
                    if row.cancel == at {
                        gain.cancel()
                        XCTAssertFalse(gain.trim(gain: 0.5, seconds: 0.4, generation: epoch))
                    }
                    let events = row.actions.map(\.at) + (row.cancel.map { [$0] } ?? [])
                    let nextEvent = events.filter { $0 > at }.min() ?? reference.frames
                    let count = min(pattern[block % pattern.count], nextEvent - at, reference.frames - at)
                    buffer.frameLength = AVAudioFrameCount(count)
                    var end = next
                    for isIncoming in block % 2 == 0 ? [false, true] : [true, false] {
                        for i in 0..<count { pcm[i * 2] = 1; pcm[i * 2 + 1] = -0.5 }
                        XCTAssertTrue(gain.process(buffer.mutableAudioBufferList, frames: count,
                            sampleTime: 1_000_000_000 + Double(at), rate: row.rate, source: isIncoming ? incoming : out))
                        var cursor = next
                        while cursor < row.indices.count && row.indices[cursor] < at + count {
                            let i = row.indices[cursor] - at, expected: Float = isIncoming ? 1 : row.samples[cursor]
                            maximum = max(maximum, abs(pcm[i * 2] - expected), abs(pcm[i * 2 + 1] + expected * 0.5))
                            cursor += 1
                        }
                        end = cursor
                    }
                    next = end; at += count; block += 1
                }
                XCTAssertEqual(next, row.indices.count)
            }
        }
        XCTAssertLessThan(maximum, 0.000002)
        print("Original WebKit balance gain maximum PCM error=\(maximum)")
    }

    func testNativeBalanceUsesOriginalPolicyAndRejectsInvalidInput() async throws {
        let planner = NativeTransitionPlanner()
        func input(_ applied: Double, _ overlap: Double = 2) throws -> Data {
            try JSONSerialization.data(withJSONObject: ["version": 1, "outgoingDb": -5,
                "incomingDb": -12, "appliedDb": applied, "overlap": overlap])
        }
        let first = try await planner.balance(input(0))
        XCTAssertEqual(first.adjustment?.trimDb, 6); XCTAssertEqual(first.intervalMs, 100)
        XCTAssertEqual(first.adjustment?.seconds, 0.4)
        let monotonic = try await planner.balance(input(6))
        XCTAssertNil(monotonic.adjustment)
        let cut = try await planner.balance(input(0, 0.7))
        XCTAssertNil(cut.adjustment)
        do { _ = try await planner.balance(input(-1)); XCTFail("Invalid applied trim must be rejected") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "invalid-transition-input") }
        let gain = TransitionGain(), epoch = gain.cancel()
        for target in [Double.nan, -.infinity, -0.1, 1.1] {
            XCTAssertFalse(gain.trim(gain: target, seconds: 0.4, generation: epoch))
        }
    }

    func testNativeBalanceUsesProfilesWithoutWebViewAndCancelsWithoutTouchingIncoming() async throws {
        let url = try sharedConstantFile(seconds: 6)
        defer { try? FileManager.default.removeItem(at: url) }
        let output = try await StreamMixOutput.make(), measured = OutputMeasurement()
        let first = try await StreamOccurrence.prepare(url: url, output: output)
        let second = try await StreamOccurrence.prepare(url: url, output: output)
        let balance = NativeBalanceCorrection(), planner = NativeTransitionPlanner()
        defer {
            balance.cancel(); first.dispose(); second.dispose()
            output.engine.mainMixerNode.removeTap(onBus: 0); output.close()
        }
        output.engine.mainMixerNode.installTap(onBus: 0, bufferSize: 512, format: nil) { buffer, _ in measured.consume(buffer) }
        try first.play(); try second.play()
        try await waitForStream { measured.read().rms > 0.24 }
        let envelope = NativeTransitionEnvelope(style: "plainBlend", hold: 0, overlap: 2,
            crossover: 0.5, together: 0, shapeBands: false, sweepOut: false, snappedToBeat: false,
            gain: .init(out: [1, 1], in: [1, 1]), bands: nil)
        let epoch = output.transitionGain.cancel()
        XCTAssertTrue(try output.scheduleGain(outgoing: first.audio, incoming: second.audio, envelope: envelope, generation: epoch))
        first.pause()
        balance.start(planner: planner, output: output, outgoing: first, incoming: second,
            outgoingReference: -6, incomingReference: -12, overlap: 2, generation: epoch, current: { true })
        try await Task.sleep(nanoseconds: 250_000_000)
        try first.play()
        try await Task.sleep(nanoseconds: 700_000_000)
        measured.reset(); try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertGreaterThan(measured.read().frames, 0)
        XCTAssertEqual(measured.read().rms, 0.125 * (1 + pow(10, -6.0 / 20)), accuracy: 0.0001)
        balance.cancel(); let cancelled = output.transitionGain.cancel()
        XCTAssertFalse(output.transitionGain.trim(gain: 0.5, seconds: 0.4, generation: epoch))
        try await Task.sleep(nanoseconds: 100_000_000)
        measured.reset(); try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertEqual(measured.read().rms, 0.25, accuracy: 0.0001)
        balance.start(planner: planner, output: output, outgoing: first, incoming: second,
            outgoingReference: -6, incomingReference: -12, overlap: 0.7, generation: cancelled, current: { true })
        try await Task.sleep(nanoseconds: 600_000_000)
        measured.reset(); try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(measured.read().rms, 0.25, accuracy: 0.0001, "Cuts/short overlaps cannot acquire a balance trim")
    }
}
