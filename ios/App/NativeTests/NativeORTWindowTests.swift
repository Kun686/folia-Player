import XCTest
import Darwin
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

    // System allocation counters are observations, not a leak or device-performance verdict.
    func nativeMemorySnapshot(_ phase: String) -> [String: Any] {
        var row: [String: Any] = FoliaORTJob().diagnostics
        var stats = malloc_statistics_t(); malloc_zone_statistics(nil, &stats)
        row["phase"] = phase; row["mallocInUseBytes"] = stats.size_in_use
        row["mallocAllocatedBytes"] = stats.size_allocated; row["mallocBlocksInUse"] = stats.blocks_in_use
        var addresses: UnsafeMutablePointer<vm_address_t>?, count: UInt32 = 0
        let status = malloc_get_all_zones(mach_task_self_, nil, &addresses, &count)
        row["zoneStatus"] = status
        if status == KERN_SUCCESS, let addresses {
            row["zones"] = Array(UnsafeBufferPointer(start: addresses, count: Int(count))).compactMap { address -> [String: Any]? in
                guard let zone = UnsafeMutablePointer<malloc_zone_t>(bitPattern: address) else { return nil }
                var zoneStats = malloc_statistics_t(); malloc_zone_statistics(zone, &zoneStats)
                return ["name": malloc_get_zone_name(zone).map { String(cString: $0) } ?? "unnamed",
                    "inUseBytes": zoneStats.size_in_use, "allocatedBytes": zoneStats.size_allocated]
            }
        }
        return row
    }

    // Diagnostic isolation of the original model runtime; hashes, not output tensors, survive each round.
    func testORTRepeatedOriginalWindowsMeasureAllocations() async throws {
        let root = try ortWindowFixtures(), service = NativeORTInference()
        guard Bundle.main.bundleIdentifier == "app.folia.validation.App" else { throw MobileFailure("memory-probe-requires-qa") }
        let input = try Data(contentsOf: root.appendingPathComponent("windows/music/input.f32"))
        XCTAssertEqual(NativeProfileCache.digest(input), "33ab08343bbe235478aba3835c5313083cfedf2caca038b67333bb867eb523aa")
        let expected = try ["drums", "bass", "vocals"].map {
            NativeProfileCache.digest(try Data(contentsOf: root.appendingPathComponent("windows/music/" + $0 + ".f32")))
        }
        var rows: [[String: Any]] = []
        func sample(_ phase: String) {
            let row = nativeMemorySnapshot(phase)
            rows.append(row)
            print("FOLIA_ORT_MEMORY phase=\(phase) footprint=\(row["footprintBytes"]!) mallocInUse=\(row["mallocInUseBytes"]!)")
        }
        func run() async throws -> [String] {
            let output = try await service.separateWindow(model: root.appendingPathComponent("htdemucs.onnx"),
                input: input, frames: input.count / 8)
            return output.map(NativeProfileCache.digest)
        }
        sample("baseline")
        for index in 0..<3 {
            guard ProcessInfo.processInfo.thermalState.rawValue < ProcessInfo.ThermalState.serious.rawValue else {
                throw XCTSkip("Wait for the independent QA host to cool before another full window")
            }
            let hashes = try await run()
            XCTAssertEqual(hashes, expected)
            try await Task.sleep(for: .seconds(2))
            sample("window-\(index)")
        }
        // Only this diagnostic requests allocator reclamation; production playback never calls this API.
        let reclaimed = malloc_zone_pressure_relief(nil, 0)
        try await Task.sleep(for: .seconds(2)); sample("allocator-relief")
        let data = try JSONSerialization.data(withJSONObject: ["samples": rows, "reclaimedBytes": reclaimed,
            "scope": "host-only original 30-second stem windows; no playback or WebContent"], options: [.prettyPrinted, .sortedKeys])
        try data.write(to: root.deletingLastPathComponent().appendingPathComponent("ort-memory.json"), options: .atomic)
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "ort-memory"; attachment.lifetime = .keepAlways; add(attachment)
    }

    // A bounded diagnostic contrast, not a full-window or playback acceptance test.
    func testORTWindowSchedulingFirstChunkProbe() async throws {
        let root = try ortWindowFixtures(), model = root.appendingPathComponent("htdemucs.onnx")
        XCTAssertEqual(NativeProfileCache.digest(try Data(contentsOf: model)), "099b5be76c1f6922124d07f850250f39d1f33f254a0b8cc90f4ec0dfd0912329")
        let input = try Data(contentsOf: root.appendingPathComponent("windows/music/input.f32"))
        XCTAssertEqual(NativeProfileCache.digest(input), "33ab08343bbe235478aba3835c5313083cfedf2caca038b67333bb867eb523aa")
        for qos in [DispatchQoS.utility, .userInitiated] {
            guard ProcessInfo.processInfo.thermalState.rawValue < ProcessInfo.ThermalState.serious.rawValue else {
                throw XCTSkip("Wait for the independent QA device to cool before the next scheduling probe")
            }
            let job = FoliaORTJob(), queue = DispatchQueue(label: "folia.qa.scheduling", qos: qos)
            let start = ProcessInfo.processInfo.systemUptime
            let watchdog = DispatchWorkItem { job.cancel() }
            DispatchQueue.global().asyncAfter(deadline: .now() + 25, execute: watchdog)
            defer { watchdog.cancel(); job.cancel() }
            let work = Task { () throws -> [Data] in
                try await withCheckedThrowingContinuation { continuation in
                    queue.async(qos: qos, flags: .enforceQoS) {
                        do { continuation.resume(returning: try job.separateWindow(model: model, input: input, frames: input.count / 8)) }
                        catch { continuation.resume(throwing: error) }
                    }
                }
            }
            var reported = -1
            while job.completedSegments == 0 && ProcessInfo.processInfo.systemUptime - start < 20 {
                let elapsed = Int(ProcessInfo.processInfo.systemUptime - start)
                if elapsed / 5 != reported {
                    reported = elapsed / 5
                    print("FOLIA_ORT_SCHEDULING phase=first-chunk elapsed=\(elapsed) thermal=\(ProcessInfo.processInfo.thermalState.rawValue) metrics=\(job.diagnostics)")
                }
                try await Task.sleep(for: .milliseconds(20))
            }
            let completed = job.completedSegments
            job.cancel()
            do { _ = try await work.value; XCTFail("Cancelled probe returned a complete window") }
            catch { XCTAssertTrue(error.localizedDescription.contains("ort-cancelled")) }
            XCTAssertGreaterThanOrEqual(completed, 1); XCTAssertFalse(job.running)
            print("FOLIA_ORT_SCHEDULING phase=cancelled elapsed=\(ProcessInfo.processInfo.systemUptime - start) thermal=\(ProcessInfo.processInfo.thermalState.rawValue) metrics=\(job.diagnostics)")
        }
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
