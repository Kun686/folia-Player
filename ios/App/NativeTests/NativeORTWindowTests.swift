import XCTest
@testable import App

// NativeORTWindowTests.swift — actual full-window ORT in the independent Folia host, using original-function references.
@MainActor extension NativeTests {
    private func ortWindowFixtures() throws -> URL {
        XCTAssertEqual(Bundle.main.bundleIdentifier, "app.folia.validation.App")
        let root = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("ORTQA")
        guard FileManager.default.fileExists(atPath: root.appendingPathComponent("windows/music/report.json").path) else {
            throw XCTSkip("Stage original ORT window references in the independent QA sandbox first")
        }
        return root
    }

    func testORTFullWindowsMatchOriginalStitchingAndBoundaries() async throws {
        let root = try ortWindowFixtures(), service = NativeORTInference()
        for name in ["synthetic", "music", "one-frame", "stride-exact", "stride-plus-one"] {
            let directory = root.appendingPathComponent("windows/" + name)
            let input = try Data(contentsOf: directory.appendingPathComponent("input.f32"))
            let report = try JSONSerialization.jsonObject(with: Data(contentsOf: directory.appendingPathComponent("report.json"))) as! [String: Any]
            XCTAssertEqual(report["status"] as? String, "PASS_ORIGINAL_STITCHING_REFERENCE")
            XCTAssertEqual(NativeProfileCache.digest(input), report["inputSHA256"] as? String)
            let start = ProcessInfo.processInfo.systemUptime
            let output = try await service.separateWindow(model: root.appendingPathComponent("htdemucs.onnx"), input: input, frames: input.count / 8)
            XCTAssertEqual(output.count, 3)
            let references = report["outputs"] as! [[String: Any]]
            var exact = output.count == 3
            for (data, stem) in zip(output, ["drums", "bass", "vocals"]) {
                let reference = try Data(contentsOf: directory.appendingPathComponent(stem + ".f32"))
                XCTAssertEqual(NativeProfileCache.digest(reference), references.first(where: { $0["name"] as? String == stem })?["sha256"] as? String)
                XCTAssertEqual(data.count, input.count)
                exact = exact && data == reference
                XCTAssertTrue(data == reference, "\(name)/\(stem) differs from original-function reference")
            }
            print("FOLIA_ORT_WINDOW name=\(name) frames=\(input.count / 8) exact=\(exact) seconds=\(ProcessInfo.processInfo.systemUptime-start)")
        }
    }

    func testORTMusicMaterialUsesOriginalPackingAndVocalExit() async throws {
        let root = try ortWindowFixtures(), directory = root.appendingPathComponent("windows/music")
        func channels(_ name: String) throws -> [[Float]] {
            let data = try Data(contentsOf: directory.appendingPathComponent(name + ".f32"))
            var values = [Float](repeating: 0, count: data.count / 4)
            _ = values.withUnsafeMutableBytes { data.copyBytes(to: $0) }
            let frames = values.count / 2
            return [Array(values[..<frames]), Array(values[frames...])]
        }
        let mix = try channels("input"), frames = mix[0].count, from = 4541768
        let material = try await NativeStemMedia().read(file: root.appendingPathComponent("music.wav"), role: .tail)
        XCTAssertEqual(material.totalFrames, 5864768); XCTAssertEqual(material.fromFrame, from)
        XCTAssertTrue(material.channels == mix, "Complete-file decoder differs from the reference's 44.1kHz tail")
        XCTAssertEqual(material.mediaRevision, "d7db2870d3ab5c1b56f793288c045a34043c1e1cfda468010a3e200f4e8c38a2")
        let actual = try await NativeStemInference().separate(material, model: root.appendingPathComponent("htdemucs.onnx"))
        let reference = try await NativeStemAnalysis().window(fromFrame: from, role: .tail, mix: mix,
            separated: [.drums: channels("drums"), .bass: channels("bass"), .vocals: channels("vocals")])
        XCTAssertEqual(actual.frames, frames); XCTAssertEqual(actual.fromFrame, from); XCTAssertEqual(actual.role, .tail)
        // Exact original stemGesture.ts result, before decimal display rounding.
        XCTAssertEqual(actual.vocalEnd, 23.650000000000002); XCTAssertEqual(actual.vocalEnd, reference.vocalEnd)
        for stem in NativeStemName.allCases {
            XCTAssertEqual(actual.packed[stem]?.gain, reference.packed[stem]?.gain)
            XCTAssertTrue(actual.packed[stem]?.pcm == reference.packed[stem]?.pcm, "Stored \(stem) differs")
        }
        print("FOLIA_ORT_WINDOW originalPCM=exact vocalEnd=\(actual.vocalEnd!) storedBytes=\(actual.storedBytes)")
    }

    func testORTWindowCancellationAfterFirstChunkAndRecovery() async throws {
        let root = try ortWindowFixtures(), model = root.appendingPathComponent("htdemucs.onnx")
        XCTAssertEqual(NativeProfileCache.digest(try Data(contentsOf: model)), "099b5be76c1f6922124d07f850250f39d1f33f254a0b8cc90f4ec0dfd0912329")
        let input = try Data(contentsOf: root.appendingPathComponent("windows/music/input.f32")), job = FoliaORTJob()
        let work = Task.detached { try job.separateWindow(model: model, input: input, frames: input.count / 8) }
        let deadline = ProcessInfo.processInfo.systemUptime + 15
        while job.completedSegments < 1 && ProcessInfo.processInfo.systemUptime < deadline { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertGreaterThanOrEqual(job.completedSegments, 1); XCTAssertTrue(job.running)
        let start = ProcessInfo.processInfo.systemUptime
        job.cancel()
        do { _ = try await work.value; XCTFail("Cancelled window returned partial output") }
        catch { XCTAssertTrue(error.localizedDescription.contains("ort-cancelled")) }
        XCTAssertFalse(job.running); XCTAssertLessThan(job.completedSegments, 11)
        XCTAssertLessThan(ProcessInfo.processInfo.systemUptime - start, 5)
        let recovery = try await NativeORTInference().separateWindow(model: model,
            input: Data(contentsOf: root.appendingPathComponent("windows/one-frame/input.f32")), frames: 1)
        XCTAssertEqual(recovery.count, 3)
        for data in recovery { XCTAssertEqual(data, Data(count: 8)) }
        print("FOLIA_ORT_WINDOW completedBeforeCancel=\(job.completedSegments) recovery=PASS")
    }

    func testORTWindowRejectsInvalidDimensionsAndNonfiniteInput() async throws {
        let service = NativeORTInference(), absent = URL(fileURLWithPath: "/absent.onnx")
        for (frames, data) in [(0, Data()), (1, Data(count: 7)), (1_323_001, Data()), (Int.max, Data())] {
            do { _ = try await service.separateWindow(model: absent, input: data, frames: frames); XCTFail("Accepted invalid window") }
            catch { XCTAssertEqual((error as? MobileFailure)?.code, "ort-invalid-input") }
        }
        let nan = [Float.nan, Float(0)].withUnsafeBytes { Data($0) }
        do { _ = try await Task.detached { try FoliaORTJob().separateWindow(model: absent, input: nan, frames: 1) }.value; XCTFail("Accepted NaN") }
        catch { XCTAssertTrue(error.localizedDescription.contains("ort-invalid-input")) }
        let bad = NativeStemMaterial(mediaRevision: "", role: .head, fromFrame: 0, totalFrames: 0, channels: [])
        do { _ = try await NativeStemInference().separate(bad, model: absent); XCTFail("Accepted empty material") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "invalid-stem-window") }
    }
}
