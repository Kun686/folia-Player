import XCTest
import AVFoundation
@testable import App

// TransitionEchoTests.swift — frozen original WebKit return and real native routing before the dry fade.
private struct EchoReference: Decodable {
    struct Case: Decodable {
        let rate: Double, at: Double, period: Double?
        let frames: Int, stop: Int, cancel: Int?, indices: [Int], channels: [[Float]]
    }
    let cases: [Case]
}

@MainActor extension NativeTests {
    func testTransitionEchoMatchesOriginalWebKitIncludingFeedbackTailAndCancel() async throws {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "TransitionEchoReference", withExtension: "json"))
        let reference = try JSONDecoder().decode(EchoReference.self, from: Data(contentsOf: url))
        XCTAssertEqual(reference.cases.count, 24)
        let planner = NativeTransitionPlanner()
        var maximum: Float = 0
        for (rowIndex, row) in reference.cases.enumerated() {
            let request: [String: Any] = ["version": 1, "at": row.at, "periodSec": row.period as Any? ?? NSNull()]
            let schedule = try await planner.echo(JSONSerialization.data(withJSONObject: request))
            for block in [128, 257] {
                let echo = TransitionEcho(rate: row.rate)
                var at = 0, cursor = 0, error: Float = 0
                while at < row.frames {
                    let stop = row.cancel.flatMap { $0 > at ? $0 : nil } ?? row.frames
                    let count = min(block, stop - at, row.frames - at)
                    let cancelled = row.cancel.map { at >= $0 } ?? false
                    echo.adopt(cancelled ? nil : schedule, generation: cancelled ? 1 : 0,
                        anchor: 1_000_000_000, sampleTime: 1_000_000_000 + Double(at), immediate: false)
                    for i in at..<at + count {
                        let left: Float = i >= row.stop ? 0 : Float(0.1 * sin(Double(i) * 2 * .pi * 97 / row.rate)
                            + 0.03 * cos(Double(i) * 2 * .pi * 997 / row.rate))
                        let (a, b) = echo.next(left: left, right: -0.25 * left, frame: 1_000_000_000 + Double(i))
                        if cursor < row.indices.count, i == row.indices[cursor] {
                            error = max(error, abs(a - row.channels[0][cursor]), abs(b - row.channels[1][cursor]))
                            cursor += 1
                        }
                    }
                    at += count
                }
                maximum = max(maximum, error)
                XCTAssertEqual(cursor, row.indices.count)
                XCTAssertLessThan(error, 0.00001, "row=\(rowIndex), block=\(block)")
            }
        }
        print("Original WebKit echo maximum PCM error=\(maximum)")
    }

    func testTransitionEchoRejectsInvalidScheduleAndNeutralReturnIsSilent() async throws {
        let echo = TransitionEcho(rate: 44100)
        for i in 0..<512 {
            let wet = echo.next(left: 0.25, right: -0.5, frame: Double(i))
            XCTAssertEqual(wet.0, 0); XCTAssertEqual(wet.1, 0)
        }
        let planner = NativeTransitionPlanner()
        for input in [#"{"version":1,"at":-1,"periodSec":null}"#, #"{"version":1,"at":1,"periodSec":"fast"}"#] {
            do { _ = try await planner.echo(Data(input.utf8)); XCTFail("Invalid echo request accepted") }
            catch { XCTAssertEqual((error as? MobileFailure)?.code, "invalid-transition-input") }
        }
        for delay in [Double.nan, -1, 1.01] {
            XCTAssertThrowsError(try NativeEchoSchedule(delay: delay, opensAt: 0, peaksAt: 0.15,
                closesAt: 0.18, send: 0.6, feedback: 0.45, defaultDelay: 0.25).validate())
        }
    }
}
