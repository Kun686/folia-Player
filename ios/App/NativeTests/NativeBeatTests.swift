import XCTest
import AVFoundation
@testable import App

// NativeBeatTests.swift — original desktop preprocessing + real Node model outputs versus the actual Folia host.
@MainActor extension NativeTests {
    private func beatFixtures() throws -> URL {
        XCTAssertEqual(Bundle.main.bundleIdentifier, "app.folia.validation.App")
        let root = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("BeatQA")
        guard FileManager.default.fileExists(atPath: root.appendingPathComponent("report.json").path) else {
            throw XCTSkip("Stage the fixed original beat reference in the independent QA sandbox first")
        }
        return root
    }
    private func beatData(_ root: URL, _ name: String) throws -> Data {
        let data = try Data(contentsOf: root.appendingPathComponent(name))
        let report = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("report.json"))) as! [String: Any]
        let files = report["files"] as! [String: [String: Any]]
        XCTAssertEqual(data.count, files[name]?["bytes"] as? Int)
        XCTAssertEqual(NativeProfileCache.digest(data), files[name]?["sha256"] as? String)
        return data
    }
    private func floatMaximum(_ actual: Data, _ reference: Data) -> Float {
        XCTAssertEqual(actual.count, reference.count)
        guard actual.count == reference.count else { return .infinity }
        var a = [Float](repeating: 0, count: actual.count / 4), b = a
        _ = a.withUnsafeMutableBytes { actual.copyBytes(to: $0) }
        _ = b.withUnsafeMutableBytes { reference.copyBytes(to: $0) }
        XCTAssertTrue(a.allSatisfy(\.isFinite))
        return zip(a, b).reduce(Float(0)) { max($0, abs($1.0 - $1.1)) }
    }
    func testNativeMelPreparationPreservesDenseBytesAndMeasuresCost() async throws {
        let root = try beatFixtures(), script = root.appendingPathComponent("dense-profiles.js")
        guard FileManager.default.fileExists(atPath: script.path) else { throw XCTSkip("Stage the fixed pre-optimization runtime") }
        XCTAssertEqual(NativeProfileCache.digest(try Data(contentsOf: script)), "e808b91deba8211bfae1e9a1281c3fb43d099b65ddcc462fe53b955d8ef69080")
        guard ProcessInfo.processInfo.thermalState.rawValue < ProcessInfo.ThermalState.serious.rawValue else {
            throw XCTSkip("Preparation timing requires a device below serious thermal pressure")
        }
        let pcm = try beatData(root, "mid.f32") as NSData
        let thermalBefore = ProcessInfo.processInfo.thermalState.rawValue
        let started = ProcessInfo.processInfo.systemUptime
        let dense = try await NativeBeatAnalysis(scriptURL: script).prepare(pcm)
        let denseSeconds = ProcessInfo.processInfo.systemUptime - started
        guard ProcessInfo.processInfo.thermalState.rawValue < ProcessInfo.ThermalState.serious.rawValue else {
            throw XCTSkip("Thermal pressure rose during baseline preparation")
        }
        let optimizedStart = ProcessInfo.processInfo.systemUptime
        let optimized = try await NativeBeatAnalysis().prepare(pcm)
        let optimizedSeconds = ProcessInfo.processInfo.systemUptime - optimizedStart
        XCTAssertEqual(optimized.frames, dense.frames); XCTAssertEqual(optimized.starts, dense.starts)
        XCTAssertEqual(optimized.lengths, dense.lengths); XCTAssertEqual(optimized.inputs, dense.inputs)
        let metrics: [String: Any] = ["denseSeconds": denseSeconds, "optimizedSeconds": optimizedSeconds,
            "thermalBefore": thermalBefore, "thermalAfter": ProcessInfo.processInfo.thermalState.rawValue,
            "frames": dense.frames, "chunks": dense.inputs.count, "pcmFrames": pcm.length / 4]
        let data = try JSONSerialization.data(withJSONObject: metrics, options: [.sortedKeys])
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "mel-preparation-timing"; attachment.lifetime = .keepAlways; add(attachment)
        print("FOLIA_MEL_TIMING " + String(decoding: data, as: UTF8.self))
    }
    func testNativeBeatMelModelAggregationMatchesOriginalMusic() async throws {
        let root = try beatFixtures(), analyzer = NativeBeatAnalysis()
        let prepared = try await analyzer.prepare(beatData(root, "mid.f32") as NSData)
        let report = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("report.json"))) as! [String: Any]
        let chunks = report["chunks"] as! [[String: Int]]
        XCTAssertEqual(prepared.frames, report["melFrames"] as? Int)
        XCTAssertEqual(prepared.lengths, chunks.map { $0["frames"]! }); XCTAssertEqual(prepared.starts, chunks.map { $0["start"]! })
        var melError: Float = 0, logitError: Float = 0
        for (i, data) in prepared.inputs.enumerated() { melError = max(melError, floatMaximum(data, try beatData(root, "input-\(i).f32"))) }
        XCTAssertLessThanOrEqual(melError, 0.000001)
        let outputs = try await NativeORTInference().inferBeatChunks(model: root.appendingPathComponent("beat_this.onnx"), inputs: prepared.inputs, frames: prepared.lengths)
        XCTAssertEqual(outputs.count, chunks.count * 2)
        for (i, data) in outputs.enumerated() {
            logitError = max(logitError, floatMaximum(data, try beatData(root, "\(i % 2 == 0 ? "beat" : "downbeat")-\(i / 2).f32")))
        }
        XCTAssertLessThanOrEqual(logitError, 0.0001)
        let grid = try await analyzer.finish(prepared, outputs: outputs)
        let expected = try beatData(root, "grid.json")
        XCTAssertEqual(try JSONSerialization.jsonObject(with: grid) as? NSDictionary, try JSONSerialization.jsonObject(with: expected) as? NSDictionary)
        print("FOLIA_BEAT chunks=\(chunks.count) melMaxAbs=\(melError) logitsMaxAbs=\(logitError) grid=exact")
    }
    func testNativeModelProfilesMatchOriginalAndPreservePartialFields() async throws {
        let root = try beatFixtures(), profiler = NativeTrackProfiler()
        let pcm = NativeProfilePCM(mid: try beatData(root, "mid.f32") as NSData, side: try beatData(root, "side.f32") as NSData)
        for partial in [false, true] {
            let data = try await profiler.analyse(pcm, partial: partial, beatModel: root.appendingPathComponent("beat_this.onnx"))
            let actual = try JSONSerialization.jsonObject(with: XCTUnwrap(data))
            let reference = try JSONSerialization.jsonObject(with: beatData(root, partial ? "partial.json" : "profile.json"))
            assertTransitionJSON(actual, reference, path: partial ? "model-partial" : "model-complete")
            XCTAssertEqual((actual as? [String: Any])?["gridless"] as? Bool, false)
        }
        print("FOLIA_BEAT originalProfiles=2 fieldTolerance=1e-6")
    }
    func testNativeModelProfileCacheDoesNotReuseGridlessResults() async throws {
        let root = try beatFixtures(), data = try beatData(root, "mid.f32")
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("fixture.wav"), format = AVAudioFormat(standardFormatWithSampleRate: 22050, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(data.count / 4))!
        buffer.frameLength = buffer.frameCapacity
        data.copyBytes(to: UnsafeMutableRawBufferPointer(start: buffer.floatChannelData![0], count: data.count))
        do { let writer = try AVAudioFile(forWriting: file, settings: format.settings); try writer.write(from: buffer) }
        let cacheDirectory = directory.appendingPathComponent("cache"), profiler = NativeTrackProfiler(cacheDirectory: cacheDirectory)
        let fallback = try await profiler.profile(file: file)
        let model = root.appendingPathComponent("beat_this.onnx")
        let measured = try await profiler.profile(file: file, beatModel: model)
        for (data, gridless) in [(fallback, true), (measured, false)] {
            let fields = try JSONSerialization.jsonObject(with: XCTUnwrap(data)) as! [String: Any]
            XCTAssertEqual(fields["gridless"] as? Bool, gridless)
        }
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: cacheDirectory.path).count, 2)
        // This bundle has no profile script: success proves the appropriate persisted records are being used.
        let cached = NativeTrackProfiler(bundle: Bundle(for: NativeTests.self), cacheDirectory: cacheDirectory)
        let readModel = try await cached.profile(file: file, beatModel: model), readFallback = try await cached.profile(file: file)
        XCTAssertEqual(readModel, measured); XCTAssertEqual(readFallback, fallback)
        print("FOLIA_BEAT cacheNamespaces=2 persistedHits=2")
    }
    func testNativeBeatBatchCancelRejectsPartialResultsAndRecovers() async throws {
        let root = try beatFixtures(), model = root.appendingPathComponent("beat_this.onnx")
        XCTAssertEqual(NativeProfileCache.digest(try Data(contentsOf: model)), try NativeORTInference.modelDigest(.beatThis))
        let input = try beatData(root, "input-0.f32"), frames = input.count / (128 * 4)
        let job = FoliaORTJob(), inputs = Array(repeating: input, count: 8), lengths = Array(repeating: NSNumber(value: frames), count: 8)
        let work = Task.detached { try job.runBeatChunks(model: model, inputs: inputs, frames: lengths) }
        let deadline = ProcessInfo.processInfo.systemUptime + 15
        while job.completedSegments < 1 && ProcessInfo.processInfo.systemUptime < deadline { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertGreaterThanOrEqual(job.completedSegments, 1); XCTAssertTrue(job.running)
        job.cancel()
        do { _ = try await work.value; XCTFail("Returned partial model batch") }
        catch { XCTAssertTrue(error.localizedDescription.contains("ort-cancelled")) }
        XCTAssertFalse(job.running); XCTAssertLessThan(job.completedSegments, 8)
        let result = try await NativeORTInference().inferBeatChunks(model: model, inputs: [input], frames: [frames])
        XCTAssertEqual(result.count, 2)
        print("FOLIA_BEAT batchCancel=PASS recovery=PASS")
    }
    func testNativeBeatRejectsInvalidBatchAndCancelledPreparation() async throws {
        let service = NativeORTInference(), absent = URL(fileURLWithPath: "/missing.onnx")
        for (inputs, frames) in [([Data](), [Int]()), ([Data()], [1]), ([Data()], [Int.max]), ([Data()], [])] {
            do { _ = try await service.inferBeatChunks(model: absent, inputs: inputs, frames: frames); XCTFail("Accepted invalid beat batch") }
            catch { XCTAssertEqual((error as? MobileFailure)?.code, "ort-invalid-input") }
        }
        let input = profilePCM(["name": "groove", "seconds": 60.0, "stereo": false]), analyzer = NativeBeatAnalysis()
        let work = Task.detached { try await analyzer.prepare(input.mid) }
        try await Task.sleep(for: .milliseconds(10)); work.cancel()
        do { _ = try await work.value; XCTFail("Returned cancelled preparation") } catch is CancellationError {} catch { XCTFail("\(error)") }
        let empty = try await analyzer.prepare(NSData())
        XCTAssertEqual(empty.frames, 0); XCTAssertTrue(empty.inputs.isEmpty)
        let profile = try await NativeTrackProfiler().analyse(NativeProfilePCM(mid: NSData(), side: nil))
        XCTAssertNil(profile)
    }
    func testNativeBeatPreparationReleasesPCMOwner() async throws {
        let analyzer = NativeBeatAnalysis()
        var pcm: NativeProfilePCM? = profilePCM(["name": "groove", "seconds": 3.0, "stereo": false])
        weak var owner = pcm?.mid
        let prepared = try await analyzer.prepare(pcm!.mid)
        XCTAssertFalse(prepared.inputs.isEmpty)
        pcm = nil
        XCTAssertNil(owner, "A completed mel stage must not retain the native PCM through its JS callback")
    }
}
