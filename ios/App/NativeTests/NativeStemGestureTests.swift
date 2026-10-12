import XCTest
@testable import App

// NativeStemGestureTests.swift — all original curve samples through Apple's JS engine without WKWebView.
@MainActor extension NativeTests {
    private func stemFixtures() throws -> [[String: Any]] {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "StemGestureReference", withExtension: "json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [[String: Any]])
    }

    func testOriginalStemGesturesInJavaScriptCore() async throws {
        let planner = NativeTransitionPlanner(), rows = try stemFixtures()
        XCTAssertEqual(rows.count, 9)
        for row in rows {
            let gesture = try await planner.stems(JSONSerialization.data(withJSONObject: XCTUnwrap(row["input"])))
            assertTransitionJSON(try JSONSerialization.jsonObject(with: JSONEncoder().encode(gesture.schedule)),
                try XCTUnwrap(row["expected"]), path: row["name"] as? String ?? "stem")
            for (direction, curves) in [("out", gesture.outgoing), ("in", gesture.incoming)] {
                let expected = try XCTUnwrap(row[direction] as? [String: String])
                for name in NativeStemName.allCases {
                    let bytes = try XCTUnwrap(Data(base64Encoded: XCTUnwrap(expected[name.rawValue])))
                    let curve = try XCTUnwrap(curves[name])
                    XCTAssertEqual(bytes.count, curve.count * 4)
                    let samples = bytes.withUnsafeBytes { buffer in
                        stride(from: 0, to: bytes.count, by: 4).map {
                            Float(bitPattern: UInt32(littleEndian: buffer.loadUnaligned(fromByteOffset: $0, as: UInt32.self)))
                        }
                    }
                    for (actual, reference) in zip(curve, samples) {
                        XCTAssertEqual(actual, reference, accuracy: 0.000001, "\(row["name"]!) \(direction) \(name)")
                    }
                }
            }
        }
    }

    func testStemRuntimeRejectsInvalidInputAndRecovers() async throws {
        let planner = NativeTransitionPlanner()
        for data in [Data("{".utf8), Data("null".utf8), Data(repeating: 32, count: 262145), Data([0xff])] {
            do { _ = try await planner.stems(data); XCTFail("Invalid evidence must fail") }
            catch { XCTAssertEqual((error as? MobileFailure)?.code, "invalid-transition-input") }
        }
        let input = try JSONSerialization.data(withJSONObject: XCTUnwrap(stemFixtures().last?["input"]))
        let result = try await planner.stems(input)
        XCTAssertEqual(result.schedule.windowSec, 30)
        XCTAssertEqual(result.outgoing[.vocals]?.count, 6000)
        let missing = NativeTransitionPlanner(bundle: Bundle(for: NativeTests.self))
        do { _ = try await missing.stems(input); XCTFail("Missing runtime must fail") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "transition-runtime-unavailable") }
    }

    func testStemCancellationAndConcurrentRequests() async throws {
        let planner = NativeTransitionPlanner(), rows = try stemFixtures()
        let inputs = try rows.map { try JSONSerialization.data(withJSONObject: XCTUnwrap($0["input"])) }
        let task = Task { @MainActor in try await planner.stems(inputs.last!) }
        task.cancel()
        do { _ = try await task.value; XCTFail("Cancelled work must not return a gesture") }
        catch { XCTAssertTrue(error is CancellationError) }
        let values = try await withThrowingTaskGroup(of: (Int, NativeStemGesture).self) { group in
            for (index, input) in inputs.enumerated() { group.addTask { (index, try await planner.stems(input)) } }
            var result: [Int: NativeStemGesture] = [:]
            for try await (index, gesture) in group { result[index] = gesture }
            return result
        }
        XCTAssertEqual(values.count, rows.count)
        for (index, gesture) in values {
            assertTransitionJSON(try JSONSerialization.jsonObject(with: JSONEncoder().encode(gesture.schedule)),
                try XCTUnwrap(rows[index]["expected"]))
        }
    }
}
