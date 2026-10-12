import XCTest
@testable import App

// NativeORTTests.swift — real runtime in the Folia QA host; optional fixed model fixtures live only in its sandbox.
@MainActor extension NativeTests {
    private func ortFixtures() throws -> URL {
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("ORTQA")
        guard FileManager.default.fileExists(atPath: url.appendingPathComponent("beat_this.onnx").path) else {
            throw XCTSkip("Stage verified ORTQA fixtures in the independent QA sandbox first")
        }
        XCTAssertNotEqual(Bundle.main.bundleIdentifier, "app.folia.personal")
        return url
    }
    func testORTVersionValidationAndQueuedCancellation() async throws {
        XCTAssertEqual(NativeORTInference.runtimeVersion, "1.30.0")
        let service = NativeORTInference(), absent = URL(fileURLWithPath: "/missing.onnx")
        do { _ = try await service.infer(.beatThis, model: absent, input: Data(), frames: 1501); XCTFail("Accepted invalid tensor") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "ort-invalid-input") }
        let task = Task { try await service.infer(.beatThis, model: absent, input: Data(count: 128 * 4), frames: 1) }
        task.cancel()
        do { _ = try await task.value; XCTFail("Accepted cancelled work") } catch is CancellationError {} catch { XCTFail("\(error)") }
    }
    func testORTRejectsUnapprovedModelBeforeLoading() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".onnx")
        try Data("not a model".utf8).write(to: url); defer { try? FileManager.default.removeItem(at: url) }
        do { _ = try await NativeORTInference().infer(.beatThis, model: url, input: Data(count: 128 * 4), frames: 1); XCTFail("Accepted bad hash") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "ort-model-hash-mismatch") }
    }
    func testORTOriginalBeatAndStemOutputsInFoliaHost() async throws {
        let dir = try ortFixtures(), service = NativeORTInference()
        for (kind, frames, inputName, outputNames) in [
            (NativeORTInference.Kind.beatThis, 1500, "beat-input.f32", ["beat.0.f32", "beat.1.f32"]),
            (.htdemucs, 172032, "htdemucs-input.f32", ["htdemucs.0.f32"]),
        ] {
            let input = try Data(contentsOf: dir.appendingPathComponent(inputName))
            let start = ProcessInfo.processInfo.systemUptime
            let outputs = try await service.infer(kind, model: dir.appendingPathComponent(kind.rawValue + ".onnx"), input: input, frames: frames)
            XCTAssertEqual(outputs.count, outputNames.count)
            for (data, name) in zip(outputs, outputNames) {
                let reference = try Data(contentsOf: dir.appendingPathComponent(name))
                XCTAssertEqual(data.count, reference.count)
                guard data.count == reference.count else { continue }
                let maximum = data.withUnsafeBytes { actual in reference.withUnsafeBytes { expected in
                    zip(actual.bindMemory(to: Float.self), expected.bindMemory(to: Float.self)).reduce(Float(0)) { max($0, abs($1.0 - $1.1)) }
                } }
                XCTAssertLessThanOrEqual(maximum, 0.0001)
                print("FOLIA_ORT model=\(kind.rawValue) bytes=\(data.count) maxAbs=\(maximum) exact=\(data == reference) elapsed=\(ProcessInfo.processInfo.systemUptime-start)")
            }
        }
    }
    func testORTLiveTerminateReleasesSessionAndNextJobWorks() async throws {
        let dir = try ortFixtures(), model = dir.appendingPathComponent("htdemucs.onnx")
        let input = try Data(contentsOf: dir.appendingPathComponent("htdemucs-input.f32"))
        // This low-level cancellation test verifies the pinned model before entering the same C++ boundary.
        XCTAssertEqual(NativeProfileCache.digest(try Data(contentsOf: model)), "099b5be76c1f6922124d07f850250f39d1f33f254a0b8cc90f4ec0dfd0912329")
        let job = FoliaORTJob()
        let run = Task.detached { try job.run(model: model, kind: "htdemucs", input: input, frames: 172032) }
        let deadline = ProcessInfo.processInfo.systemUptime + 10
        while !job.running && ProcessInfo.processInfo.systemUptime < deadline { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertTrue(job.running)
        let start = ProcessInfo.processInfo.systemUptime
        job.cancel()
        do { _ = try await run.value; XCTFail("Run ignored termination") }
        catch { XCTAssertTrue(error.localizedDescription.contains("ort-cancelled")) }
        XCTAssertFalse(job.running)
        XCTAssertLessThan(ProcessInfo.processInfo.systemUptime - start, 5)
        let interrupted = Task { try await NativeORTInference().infer(.htdemucs, model: model, input: input, frames: 172032) }
        try await Task.sleep(for: .milliseconds(250))
        interrupted.cancel()
        do { _ = try await interrupted.value; XCTFail("Swift cancellation was ignored") }
        catch is CancellationError {} catch { XCTFail("Cancellation escaped as \(error)") }
        let output = try await NativeORTInference().infer(.beatThis, model: dir.appendingPathComponent("beat_this.onnx"),
            input: Data(contentsOf: dir.appendingPathComponent("beat-input.f32")), frames: 1500)
        XCTAssertEqual(output.count, 2)
        print("FOLIA_ORT liveCancel=PASS recovery=PASS")
    }
}
