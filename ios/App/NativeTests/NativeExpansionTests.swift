import XCTest
import AVFoundation
import JavaScriptCore
@testable import App

// NativeExpansionTests.swift — original full-render hashes plus selected WebKit output samples.
struct ExpansionReference: Decodable {
    struct Row: Decodable {
        let name: String, seconds: Double, level: Double, outLevel: Double, inLevel: Double
        let plan: NativeExpansionPlan?, frames: Int, indices: [Int], output: [[Float]], renderedFrames: Int, renderedHashes: [String]
        func pcm(deck: Int) throws -> NativeStemPCM {
            var result: [NativeStemName: [[Float]]] = [:]
            for (stem, name) in [NativeStemName.drums, .bass, .other, .vocals].enumerated() {
                result[name] = (0..<2).map { c in (0..<frames).map { i -> Float in
                    let integer = ((i * (stem + 3) + deck * 17) % 257) - 128
                    return Float(Double(integer) * level * (c == 0 ? 1 : -0.375) / 512)
                } }
            }
            return try NativeStemPCM(result)
        }
    }
    let cases: [Row]
    static func load() throws -> (Self, [[String: Any]]) {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "ExpansionReference", withExtension: "json"))
        let data = try Data(contentsOf: url), dictionary = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        return (try JSONDecoder().decode(Self.self, from: data), try XCTUnwrap(dictionary["cases"] as? [[String: Any]]))
    }
}

@MainActor extension NativeTests {
    func testOriginalExpansionRenderAndOutputMatchWebKit() async throws {
        let (reference, rows) = try ExpansionReference.load(), planner = NativeTransitionPlanner(), renderer = NativeExpansionRenderer()
        let bus = try await planner.stemBus(); var maximum: Float = 0, hashes = 0, samples = 0
        XCTAssertEqual(reference.cases.count, 7)
        for (index, entry) in reference.cases.enumerated() {
            let gesture = try await planner.stems(JSONSerialization.data(withJSONObject: XCTUnwrap(rows[index]["input"])))
            XCTAssertEqual(gesture.expansion, entry.plan)
            let outgoing = try entry.pcm(deck: 0), incoming = try entry.pcm(deck: 1)
            let rendered: NativeExpansionPCM?
            if let plan = gesture.expansion {
                rendered = try await renderer.render(outgoing, plan: plan)
                XCTAssertEqual(rendered!.channels[0].count, entry.renderedFrames)
                for channel in 0..<2 {
                    let bytes = rendered!.channels[channel].withUnsafeBytes { Data($0) }
                    XCTAssertEqual(NativeProfileCache.digest(bytes), entry.renderedHashes[channel], entry.name); hashes += 1
                }
                XCTAssertThrowsError(try NativeStemMixer(outgoing: outgoing, incoming: incoming, gesture: gesture, bus: bus),
                    "A masked plan cannot silently run without its replacement PCM")
            } else { rendered = nil }
            for block in [128, 257, 8192] {
                let mixer = try NativeStemMixer(outgoing: outgoing, incoming: incoming, gesture: gesture, bus: bus,
                    outLevel: entry.outLevel, inLevel: entry.inLevel, expansion: rendered)
                let buffer = StemClockFixture.buffer(block), pcm = buffer.floatChannelData![0]
                var cursor = 0, error: Float = 0
                while mixer.position < mixer.frames {
                    let at = mixer.position
                    XCTAssertTrue(mixer.render(buffer.mutableAudioBufferList, frames: block))
                    while cursor < entry.indices.count && entry.indices[cursor] < at + block {
                        for channel in 0..<2 {
                            error = max(error, abs(pcm[(entry.indices[cursor] - at) * 2 + channel] - entry.output[channel][cursor]))
                        }
                        cursor += 1
                    }
                }
                XCTAssertEqual(cursor, entry.indices.count); XCTAssertLessThan(error, 0.00001, entry.name)
                maximum = max(maximum, error)
            }
            samples += entry.indices.count * 2
        }
        print("FOLIA_EXPANSION hashes=\(hashes) referenceSamples=\(samples) maxPCM=\(maximum)")
    }

    func testExpansionUsesRoundedMaterialAndCancelsBeforeRendering() async throws {
        let (reference, rows) = try ExpansionReference.load(), planner = NativeTransitionPlanner()
        let input = try JSONSerialization.data(withJSONObject: XCTUnwrap(rows[0]["input"]))
        let gesture = try await planner.stems(input), plan = try XCTUnwrap(gesture.expansion)
        let outgoing = try StemStorageReference.window(frames: 529201), incoming = try StemStorageReference.window(frames: 529201, role: .head)
        let pair = try await NativeStemWindowPair.prepare(out: outgoing, incoming: incoming, outAt: 0.25 / 44100,
            inAt: 0, seconds: 12, lateBy: 0.49 / 44100, planner: planner)
        let windows = try XCTUnwrap(pair)
        let material = try windows.expansionChannels(.drums)
        XCTAssertEqual(material, try outgoing.decodedStem(.drums, count: 529200))
        XCTAssertNotEqual(material[0][1], windows.outgoing.stems[.drums]![0][1])
        let renderer = NativeExpansionRenderer()
        let fromWindow = try await renderer.render(windows, plan: plan)
        let expected = try await renderer.render(outgoing.decoded(count: 529200), plan: plan)
        XCTAssertEqual(fromWindow.channels, expected.channels)
        let pcm = try reference.cases[0].pcm(deck: 0)
        let cancelled = Task { try await renderer.render(pcm, plan: plan) }; cancelled.cancel()
        do { _ = try await cancelled.value; XCTFail("Cancelled work cannot return a build") }
        catch { XCTAssertTrue(error is CancellationError) }
        do { _ = try await NativeExpansionRenderer(bundle: Bundle(for: NativeTests.self)).render(pcm, plan: plan); XCTFail("Missing runtime must fail") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "transition-runtime-unavailable") }
        XCTAssertThrowsError(try NativeExpansionPCM(plan: plan, channels: [[Float.nan], [Float.nan]]))
    }

    func testTypedExpansionArraysReleaseOwnersAndRejectWrongType() throws {
        weak var owner: NSData?
        try autoreleasepool {
            let context = JSContext()!
            var data: NSData? = [Float(0.25), -0.75].withUnsafeBytes { NSData(bytes: $0.baseAddress!, length: $0.count) }
            owner = data
            let array = try NativeFloat32Bridge.make(data!, in: context, errorCode: "test-memory")
            data = nil; XCTAssertNotNil(owner)
            XCTAssertEqual(try NativeFloat32Bridge.copy(array, count: 2), [0.25, -0.75])
            XCTAssertThrowsError(try NativeFloat32Bridge.copy(array, count: 3))
            XCTAssertThrowsError(try NativeFloat32Bridge.copy(context.evaluateScript("new Float64Array(2)")!, count: 2))
        }
        XCTAssertNil(owner)
    }
}
