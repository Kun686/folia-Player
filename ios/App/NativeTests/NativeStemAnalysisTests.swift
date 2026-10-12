import XCTest
import AVFoundation
@testable import App

// NativeStemAnalysisTests.swift — real Float32 input to original observations, stored windows, curves and mixer.
struct StemAnalysisReference: Decodable {
    struct Row: Decodable {
        let name: String, mode: String, options: NativeStemAnalysisContext, vocalEnd: Double?
        let outHashes: [String: String], inHashes: [String: String], mixHashes: [String]
    }
    struct Material {
        let mix: [[Float]], separated: [NativeStemName: [[Float]]]
    }
    static func load() throws -> ([Row], [[String: Any]]) {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "StemAnalysisReference", withExtension: "json"))
        let data = try Data(contentsOf: url)
        return (try JSONDecoder().decode([Row].self, from: data), try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]]))
    }
    static func material(head: Bool, mode: String) -> Material {
        let frames = 1323000
        var mix: [[Float]] = [], vocals: [[Float]] = [], drums: [[Float]] = [], bass: [[Float]] = []
        for c in 0..<2 {
            var m = [Float](repeating: 0, count: frames), v = m, d = m, b = m
            for i in 0..<frames {
                let wave = Double(i % 97 - 48) / 128 * (c == 0 ? 1 : 0.5), intro = i < 441000
                m[i] = mode == "silent" ? 0 : Float(wave * (head && intro ? 1.0 / 64 : 1))
                if mode != "silent" {
                    let level = head ? (intro && mode != "voice" ? 1.0 / 1024 : 0.5)
                        : (i >= 44100 && i < 798210 ? 0.5 : 1.0 / 4096)
                    v[i] = Float(wave * level)
                }
                if mode == "antiphase" { v[i] = Float(Double(i % 97 - 48) / 256 * (c == 0 ? 1 : -1)) }
                d[i] = m[i] / 4; b[i] = m[i] / 8
            }
            mix.append(m); vocals.append(v); drums.append(d); bass.append(b)
        }
        return Material(mix: mix, separated: [.vocals: vocals, .drums: drums, .bass: bass])
    }
    static func window(_ analysis: NativeStemAnalysis, head: Bool, mode: String) async throws -> NativeStemWindow {
        let material = material(head: head, mode: mode)
        return try await analysis.window(fromFrame: head ? 0 : 4410000, role: head ? .head : .tail,
            mix: material.mix, separated: material.separated)
    }
    static func hash(_ values: [Float]) -> String { values.withUnsafeBytes { NativeProfileCache.digest(Data($0)) } }
}

@MainActor extension NativeTests {
    func testOriginalStemMeasurementsFeedEveryGestureCurve() async throws {
        let (rows, raw) = try StemAnalysisReference.load(), analysis = NativeStemAnalysis(), planner = NativeTransitionPlanner()
        XCTAssertEqual(rows.count, 8)
        var curves = 0, observations = 0
        for (i, row) in rows.enumerated() {
            let outgoing = try await StemAnalysisReference.window(analysis, head: false, mode: row.mode)
            let incoming = try await StemAnalysisReference.window(analysis, head: true, mode: row.mode)
            XCTAssertEqual(outgoing.vocalEnd, row.vocalEnd, row.name); XCTAssertNil(incoming.vocalEnd)
            let prepared = try await analysis.request(out: outgoing, incoming: incoming, options: row.options, planner: planner)
            let data = try XCTUnwrap(prepared), expected = try XCTUnwrap(raw[i]["expected"] as? NSDictionary)
            let actual = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? NSDictionary)
            XCTAssertEqual(actual, expected, row.name)
            observations += (actual["vocals"] as! [Double]).count + (actual["mix"] as! [Double]).count
            let gesture = try await planner.stems(data)
            let handover = try JSONSerialization.jsonObject(with: JSONEncoder().encode(gesture.schedule.handover)) as! NSDictionary
            assertTransitionJSON(handover, try XCTUnwrap(raw[i]["handover"]), path: row.name)
            for stem in NativeStemName.allCases {
                XCTAssertEqual(StemAnalysisReference.hash(gesture.outgoing[stem]!), row.outHashes[stem.rawValue], row.name)
                XCTAssertEqual(StemAnalysisReference.hash(gesture.incoming[stem]!), row.inHashes[stem.rawValue], row.name); curves += 2
            }
            let offset = Int(((row.options.outAt - 100) * 44100).rounded()), length = Int((row.options.windowSec * 44100).rounded())
            let mix = try outgoing.mixed(offset: offset, count: length)
            for c in 0..<2 { XCTAssertEqual(StemAnalysisReference.hash(mix[c]), row.mixHashes[c], row.name) }
        }
        print("FOLIA_STEM_MEASUREMENTS cases=\(rows.count) curveHashes=\(curves) exactEnvelopeValues=\(observations)")
    }

    func testMeasuredStemPlanPreparesRealExpansionAndMix() async throws {
        let (rows, _) = try StemAnalysisReference.load(), analysis = NativeStemAnalysis(), planner = NativeTransitionPlanner()
        let outgoing = try await StemAnalysisReference.window(analysis, head: false, mode: "normal")
        let incoming = try await StemAnalysisReference.window(analysis, head: true, mode: "normal"), options = rows[0].options
        let request = try await analysis.request(out: outgoing, incoming: incoming, options: options, planner: planner)
        let gesture = try await planner.stems(XCTUnwrap(request)), bus = try await planner.stemBus()
        let pair = try await NativeStemWindowPair.prepare(out: outgoing, incoming: incoming, outAt: options.outAt,
            inAt: options.inAt, seconds: options.windowSec, lateBy: 0.49 / 44100, planner: planner)
        let windows = try XCTUnwrap(pair), expansion = try await NativeExpansionRenderer().render(windows, plan: XCTUnwrap(gesture.expansion))
        let mixer = try NativeStemMixer(outgoing: windows.outgoing, incoming: windows.incoming, gesture: gesture, bus: bus, expansion: expansion)
        let buffer = StemClockFixture.buffer(512)
        var peak: Float = 0
        while mixer.position < mixer.frames {
            XCTAssertTrue(mixer.render(buffer.mutableAudioBufferList, frames: 512))
            for value in UnsafeBufferPointer(start: buffer.floatChannelData![0], count: 1024) {
                XCTAssertTrue(value.isFinite); peak = max(peak, abs(value))
            }
        }
        XCTAssertGreaterThan(peak, 0.01); XCTAssertLessThanOrEqual(peak, 1)
        print("FOLIA_MEASURED_STEM_MIX frames=\(mixer.frames) peak=\(peak)")
    }

    func testStemMeasurementCancellationBoundsAndRecovery() async throws {
        let analysis = NativeStemAnalysis(), planner = NativeTransitionPlanner()
        let material = StemAnalysisReference.material(head: false, mode: "normal")
        let cancelled = Task { try await analysis.window(fromFrame: 0, role: .tail, mix: material.mix, separated: material.separated) }
        cancelled.cancel()
        do { _ = try await cancelled.value; XCTFail("Cancelled work cannot return evidence") }
        catch { XCTAssertTrue(error is CancellationError) }
        do { _ = try await NativeStemAnalysis(bundle: Bundle(for: NativeTests.self)).window(fromFrame: 0, role: .tail,
            mix: material.mix, separated: material.separated); XCTFail("Missing runtime must fail") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "transition-runtime-unavailable") }
        do { _ = try await analysis.window(fromFrame: 0, role: .tail, mix: [[.nan], [.nan]], separated: [.vocals: [[0], [0]]]); XCTFail("Nonfinite samples") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "invalid-stem-pcm") }
        var out: NativeStemWindow? = try await analysis.window(fromFrame: 4410000, role: .tail, mix: material.mix, separated: material.separated)
        weak var observed = out
        let incoming = try await analysis.window(fromFrame: 0, role: .head, mix: material.mix, separated: material.separated)
        var options = NativeStemAnalysisContext(windowSec: 6, outAt: 129, inAt: 0)
        let uncovered = try await analysis.request(out: out!, incoming: incoming, options: options, planner: planner)
        XCTAssertNil(uncovered)
        options = NativeStemAnalysisContext(windowSec: 6, outAt: 100, inAt: 0)
        options.outgoingBpm = 1e-310
        do { _ = try await analysis.request(out: out!, incoming: incoming, options: options, planner: planner); XCTFail("Invalid grid") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "invalid-stem-evidence") }
        options.outgoingBpm = 120
        let recovered = try await analysis.request(out: out!, incoming: incoming, options: options, planner: planner)
        XCTAssertNotNil(recovered)
        out = nil; XCTAssertNil(observed)
    }
}
