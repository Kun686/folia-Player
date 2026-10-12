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
        let prepared = try await NativeStemHandover().prepare(outgoing: outgoing, incoming: incoming,
            options: options, lateBy: 0.49 / 44100, planner: planner)
        let program = try XCTUnwrap(prepared), windows = program.windows
        XCTAssertNotNil(program.expansion)
        let mixer = try NativeStemMixer(outgoing: windows.outgoing, incoming: windows.incoming,
            gesture: program.gesture, bus: program.bus, expansion: program.expansion)
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

    func testStemHandoverDeclinesUncoveredPairRejectsInvalidIntentAndRecovers() async throws {
        let out = try StemStorageReference.window(frames: 52920, from: 4410000)
        let incoming = try StemStorageReference.window(frames: 39690, role: .head)
        let preparation = NativeStemHandover(), planner = NativeTransitionPlanner()
        let uncovered = try await preparation.prepare(outgoing: out, incoming: incoming,
            options: .init(windowSec: 0.8, outAt: 100.1, inAt: 0.2), lateBy: 0, planner: planner)
        XCTAssertNil(uncovered, "An incomplete pair must leave the master path available")
        let options = NativeStemAnalysisContext(windowSec: 0.8, outAt: 100.1, inAt: 0.05)
        for late in [-1.0, .nan, .infinity] {
            do {
                _ = try await preparation.prepare(outgoing: out, incoming: incoming,
                    options: options, lateBy: late, planner: planner)
                XCTFail("Invalid alignment must not publish a program")
            } catch { XCTAssertEqual((error as? MobileFailure)?.code, "invalid-stem-alignment") }
        }
        do {
            _ = try await preparation.prepare(outgoing: incoming, incoming: out,
                options: options, lateBy: 0, planner: planner)
            XCTFail("Reversed roles must not publish a program")
        } catch { XCTAssertEqual((error as? MobileFailure)?.code, "invalid-stem-window") }
        let cancelled = Task {
            try await preparation.prepare(outgoing: out, incoming: incoming, options: options, lateBy: 0, planner: planner)
        }
        cancelled.cancel()
        do { _ = try await cancelled.value; XCTFail("Cancelled work must not publish a program") }
        catch { XCTAssertTrue(error is CancellationError) }
        let recovered = try await preparation.prepare(outgoing: out, incoming: incoming,
            options: options, lateBy: 1, planner: planner)
        let program = try XCTUnwrap(recovered)
        XCTAssertNil(program.expansion); XCTAssertEqual(program.windows.late, 0.05)
        XCTAssertEqual(program.windows.outgoing.stems[.drums],
            try out.decoded(offset: (100.1 + 0.05 - 100) * 44100, count: 35280).stems[.drums])
        XCTAssertEqual(program.windows.incoming.stems[.drums],
            try incoming.decoded(offset: (0.05 + 0.05) * 44100, count: 35280).stems[.drums])
    }

    func testStemHandoverKeepsOriginalObservationsBeforeLateCompensationAndReleasesWindows() async throws {
        let (rows, _) = try StemAnalysisReference.load(), analysis = NativeStemAnalysis()
        let planner = NativeTransitionPlanner(), preparation = NativeStemHandover()
        var out: NativeStemWindow? = try await StemAnalysisReference.window(analysis, head: false, mode: "normal")
        var incoming: NativeStemWindow? = try await StemAnalysisReference.window(analysis, head: true, mode: "normal")
        weak var releasedOut = out, releasedIncoming = incoming
        var onTime = try await preparation.prepare(outgoing: out!, incoming: incoming!, options: rows[0].options, lateBy: 0, planner: planner)
        var late = try await preparation.prepare(outgoing: out!, incoming: incoming!, options: rows[0].options, lateBy: 0.05, planner: planner)
        XCTAssertNotNil(onTime); XCTAssertNotNil(late)
        XCTAssertEqual(onTime?.gesture.outgoing, late?.gesture.outgoing)
        XCTAssertEqual(onTime?.gesture.incoming, late?.gesture.incoming)
        XCTAssertNotEqual(onTime?.windows.outgoing.stems[.drums], late?.windows.outgoing.stems[.drums])
        XCTAssertEqual(onTime?.expansion?.plan, late?.expansion?.plan)
        out = nil; incoming = nil; onTime = nil; late = nil
        XCTAssertNil(releasedOut); XCTAssertNil(releasedIncoming, "The preparation actor must not retain obsolete windows")
    }
}
