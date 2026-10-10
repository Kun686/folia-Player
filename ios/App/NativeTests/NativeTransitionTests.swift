import XCTest
@testable import App

// NativeTransitionTests.swift — compare Apple's JS engine with committed outputs from original TS rules.
@MainActor extension NativeTests {
    func transitionFixture() throws -> [String: Any] {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "TransitionReference", withExtension: "json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }
    func assertTransitionJSON(_ actual: Any, _ expected: Any, path: String = "root", file: StaticString = #filePath, line: UInt = #line) {
        if let lhs = actual as? [String: Any], let rhs = expected as? [String: Any] {
            // Codable omits optional nil properties; JSON's explicit null is the same boundary value.
            let keys = Set(rhs.filter { !($0.value is NSNull) }.keys)
            XCTAssertEqual(Set(lhs.filter { !($0.value is NSNull) }.keys), keys, path, file: file, line: line)
            for key in keys { if let value = lhs[key] { assertTransitionJSON(value, rhs[key]!, path: path + "." + key, file: file, line: line) } }
        } else if let lhs = actual as? [Any], let rhs = expected as? [Any] {
            XCTAssertEqual(lhs.count, rhs.count, path, file: file, line: line)
            for (index, pair) in zip(lhs, rhs).enumerated() { assertTransitionJSON(pair.0, pair.1, path: path + "[\(index)]", file: file, line: line) }
        } else if let lhs = actual as? NSNumber, let rhs = expected as? NSNumber {
            XCTAssertEqual(lhs.doubleValue, rhs.doubleValue, accuracy: 0.000001, path, file: file, line: line)
        } else { XCTAssertEqual(String(describing: actual), String(describing: expected), path, file: file, line: line) }
    }

    func testOriginalTransitionPlansExecuteWithoutWebView() async throws {
        let planner = NativeTransitionPlanner(), fixture = try transitionFixture()
        let rows = try XCTUnwrap(fixture["plans"] as? [[String: Any]])
        XCTAssertEqual(rows.count, 80)
        for row in rows {
            let input = try JSONSerialization.data(withJSONObject: XCTUnwrap(row["input"]))
            let plan = try await planner.plan(input)
            let encoded = try JSONEncoder().encode(plan)
            assertTransitionJSON(try JSONSerialization.jsonObject(with: encoded), try XCTUnwrap(row["expected"]), path: row["name"] as? String ?? "plan")
        }
    }
    func testOriginalTransitionCurvesAndBeatShapesInJavaScriptCore() async throws {
        let planner = NativeTransitionPlanner(), fixture = try transitionFixture()
        let rows = try XCTUnwrap(fixture["envelopes"] as? [[String: Any]])
        XCTAssertEqual(rows.count, 36)
        for row in rows {
            let input = try JSONSerialization.data(withJSONObject: XCTUnwrap(row["input"]))
            let envelope = try await planner.envelope(input)
            XCTAssertEqual(envelope.gain.out.count, 64); XCTAssertEqual(envelope.gain.in.count, 64)
            assertTransitionJSON(try JSONSerialization.jsonObject(with: JSONEncoder().encode(envelope)), try XCTUnwrap(row["expected"]), path: row["name"] as? String ?? "envelope")
        }
    }
    func testTransitionRuntimeRejectsInvalidInputsAndRecovers() async throws {
        let planner = NativeTransitionPlanner()
        for data in [Data("{".utf8), Data("null".utf8), Data(repeating: 32, count: 262145), Data([0xff])] {
            do { _ = try await planner.plan(data); XCTFail("Invalid input must fail") }
            catch { XCTAssertEqual((error as? MobileFailure)?.code, "invalid-transition-input") }
        }
        let row = try XCTUnwrap((try transitionFixture())["plans"] as? [[String: Any]]).first!
        let input = try JSONSerialization.data(withJSONObject: XCTUnwrap(row["input"]))
        let plan = try await planner.plan(input)
        XCTAssertEqual(plan.outStart, 188); XCTAssertEqual(plan.overlap, 12)
        let missing = NativeTransitionPlanner(bundle: Bundle(for: NativeTests.self))
        do { _ = try await missing.plan(input); XCTFail("Missing local runtime must not use network or substitute rules") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "transition-runtime-unavailable") }
    }
    func testTransitionRuntimeCancellationAndConcurrentCallIsolation() async throws {
        let planner = NativeTransitionPlanner(), fixture = try transitionFixture()
        let rows = try XCTUnwrap(fixture["plans"] as? [[String: Any]])
        let input = try JSONSerialization.data(withJSONObject: XCTUnwrap(rows[0]["input"]))
        let cancelled = Task { @MainActor in try await planner.plan(input) }
        cancelled.cancel()
        do { _ = try await cancelled.value; XCTFail("Cancelled work must not return a plan") }
        catch { XCTAssertTrue(error is CancellationError) }
        let inputs = try rows.prefix(16).map { try JSONSerialization.data(withJSONObject: XCTUnwrap($0["input"])) }
        let plans = try await withThrowingTaskGroup(of: (Int, NativeTransitionPlan).self) { group in
            for (index, data) in inputs.enumerated() { group.addTask { (index, try await planner.plan(data)) } }
            var result: [Int: NativeTransitionPlan] = [:]
            for try await (index, plan) in group { result[index] = plan }
            return result
        }
        XCTAssertEqual(plans.count, inputs.count)
        for (index, plan) in plans {
            assertTransitionJSON(try JSONSerialization.jsonObject(with: JSONEncoder().encode(plan)), try XCTUnwrap(rows[index]["expected"]))
        }
    }
}
