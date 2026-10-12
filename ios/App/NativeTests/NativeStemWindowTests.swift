import XCTest
@testable import App

// NativeStemWindowTests.swift — exact original Int16 storage and actual WebKit fractional source reads.
struct StemStorageReference: Decodable {
    struct Packed: Decodable { let gain: Double, pcm: [Int16], restored: [Float] }
    struct Row: Decodable { let name: String, mix: [[Float]], separated: [String: [[Float]]], packed: [String: Packed] }
    struct Offset: Decodable { let offset: Double, channels: [[Float]] }
    struct Policy: Decodable { let keys: [String], wanted: [String], arriving: String, victim: String }
    let maxWindows: Int, windowSeconds: Int, cases: [Row], offsets: [Offset], policies: [Policy]
    static func load() throws -> Self {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "StemStorageReference", withExtension: "json"))
        return try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
    }
    static func window(frames: Int, role: NativeStemRole = .tail, from: Int = 0) throws -> NativeStemWindow {
        let mix: [[Float]] = (0..<2).map { c -> [Float] in
            let divisor: Float = c == 0 ? 32 : -64
            return (0..<frames).map { i -> Float in Float((i % 31) - 15) / divisor }
        }
        let zero = Array(repeating: Array(repeating: Float(0), count: frames), count: 2)
        return try NativeStemWindow(fromFrame: from, role: role, mix: mix,
            separated: [.drums: mix, .bass: zero, .vocals: zero])
    }
}

@MainActor extension NativeTests {
    func testStemWindowPackingExactlyMatchesOriginal() throws {
        let reference = try StemStorageReference.load()
        XCTAssertEqual(reference.windowSeconds, 30); XCTAssertEqual(reference.cases.count, 4)
        var checked = 0
        for row in reference.cases {
            let parts = Dictionary(uniqueKeysWithValues: row.separated.map { (NativeStemName(rawValue: $0.key)!, $0.value) })
            let window = try NativeStemWindow(fromFrame: 4410000, role: .tail, mix: row.mix, separated: parts)
            let decoded = try window.decoded()
            for name in NativeStemName.allCases {
                let expected = try XCTUnwrap(row.packed[name.rawValue]), actual = try XCTUnwrap(window.packed[name])
                XCTAssertEqual(actual.gain, expected.gain, row.name); XCTAssertEqual(actual.pcm, expected.pcm, row.name)
                XCTAssertEqual(decoded.stems[name]!.flatMap { $0 }, expected.restored, row.name); checked += expected.pcm.count
            }
        }
        print("FOLIA_STEM_STORAGE exactInt16=\(checked) exactRestoredFloat=\(checked)")
    }

    func testStemWindowFractionalOffsetsMatchOriginalWebKit() throws {
        let reference = try StemStorageReference.load()
        let mix = (0..<2).map { c in (0..<1024).map { i -> Float in
            if i >= 1021 { return [Float(0.5), -0.75, 0.125][i - 1021] * (c == 0 ? 1 : -0.5) }
            return Float(i % 17 - 8) / (c == 0 ? 32 : -64)
        } }
        let zero = Array(repeating: Array(repeating: Float(0), count: 1024), count: 2)
        let window = try NativeStemWindow(fromFrame: 0, role: .head, mix: mix, separated: [.drums: mix, .bass: zero, .vocals: zero])
        var error: Float = 0
        for entry in reference.offsets {
            let decoded = try window.decoded(offset: entry.offset, count: 128)
            for c in 0..<2 { for i in 0..<128 {
                error = max(error, abs(decoded.stems[.drums]![c][i] - entry.channels[c][i]))
                for name in [NativeStemName.bass, .vocals, .other] { XCTAssertEqual(decoded.stems[name]![c][i], 0) }
            } }
        }
        XCTAssertEqual(reference.offsets.count, 7); XCTAssertLessThan(error, 0.000001)
        print("FOLIA_STEM_FRACTIONAL maxPCM=\(error)")
    }

    func testStemWindowAlignmentUsesOriginalCoverageAndLateClamp() async throws {
        let out = try StemStorageReference.window(frames: 52920, from: 4410000)
        let incoming = try StemStorageReference.window(frames: 39690, role: .head), planner = NativeTransitionPlanner()
        let prepared = try await NativeStemWindowPair.prepare(out: out, incoming: incoming, outAt: 100.1, inAt: 0.05,
            seconds: 0.8, lateBy: 1, planner: planner)
        let pair = try XCTUnwrap(prepared)
        XCTAssertEqual(pair.late, 0.05); XCTAssertEqual(pair.outgoing.frames, 35280)
        XCTAssertEqual(pair.outgoing.stems[.drums], try out.decoded(offset: (100.1 + 0.05 - 100) * 44100, count: 35280).stems[.drums])
        XCTAssertEqual(pair.incoming.stems[.drums], try incoming.decoded(offset: (0.05 + 0.05) * 44100, count: 35280).stems[.drums])
        let uncovered = try await NativeStemWindowPair.prepare(out: out, incoming: incoming, outAt: 100.1, inAt: 0.2,
            seconds: 0.8, planner: planner)
        XCTAssertNil(uncovered)
        let fractional = try await NativeStemWindowPair.prepare(out: out, incoming: incoming, outAt: 100, inAt: 0,
            seconds: 35280.25 / 44100, planner: planner)
        XCTAssertEqual(fractional?.outgoing.frames, 35281)
        let cancelled = Task { try await NativeStemWindowPair.prepare(out: out, incoming: incoming, outAt: 100, inAt: 0,
            seconds: 0.8, planner: planner) }
        cancelled.cancel()
        do { _ = try await cancelled.value; XCTFail("Cancelled alignment must not publish a pair") }
        catch { XCTAssertTrue(error is CancellationError) }
    }

    func testStemWindowBoundsStorageAndInvalidSamples() throws {
        let full = try StemStorageReference.window(frames: 1323000)
        XCTAssertEqual(full.duration, 30); XCTAssertEqual(full.storedBytes, 21168000)
        XCTAssertThrowsError(try full.decoded(offset: .nan)); XCTAssertThrowsError(try full.decoded(offset: -1))
        XCTAssertThrowsError(try full.decoded(offset: Double(full.frames)))
        XCTAssertThrowsError(try full.decoded(count: 1323001))
        let mix: [[Float]] = [[0.1, -0.2], [0.3, -0.4]], parts: [NativeStemName: [[Float]]] = [.drums: mix, .bass: mix, .vocals: mix]
        XCTAssertThrowsError(try NativeStemWindow(fromFrame: 1, role: .head, mix: mix, separated: parts))
        XCTAssertThrowsError(try NativeStemWindow(fromFrame: 0, role: .head, mix: mix, separated: parts, vocalEnd: 0))
        XCTAssertThrowsError(try NativeStemWindow(fromFrame: 0, role: .tail, mix: [[.nan, 0], [0, 0]], separated: parts))
        XCTAssertThrowsError(try NativeStemWindow(fromFrame: 0, role: .tail, mix: mix, separated: [.drums: mix]))
        XCTAssertThrowsError(try NativeStemWindow(fromFrame: 0, role: .tail, mix: [[0], [0]], separated: parts))
        let huge: [[Float]] = [[-.greatestFiniteMagnitude], [-.greatestFiniteMagnitude]]
        XCTAssertThrowsError(try NativeStemWindow(fromFrame: 0, role: .tail, mix: [[.greatestFiniteMagnitude], [.greatestFiniteMagnitude]],
            separated: [.drums: huge, .bass: huge, .vocals: huge]))
    }
}
