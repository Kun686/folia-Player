import XCTest
@testable import App

// NativeModelStoreTests.swift — controlled transport/lifecycle tests plus unchanged real weights in the QA host.
@MainActor extension NativeTests {
    private func modelManifest(_ bytes: Data, mirrors: [URL]) throws -> NativeModelManifest {
        let models: [[String: Any]] = NativeModelManifest.Name.allCases.map { name in
            let content = name == .beatThis ? bytes : Data("second-model".utf8)
            return ["name": name.rawValue, "file": name.rawValue + ".onnx", "bytes": content.count,
                    "sha256": NativeProfileCache.digest(content), "enables": name == .beatThis ? "beatGrid" : "stems", "license": "MIT"]
        }
        return try NativeModelManifest(data: JSONSerialization.data(withJSONObject: ["models": models,
            "mirrors": mirrors.map { $0.absoluteString.replacingOccurrences(of: "beat_this.onnx", with: "{file}") }]))
    }
    func testModelManifestUsesOriginalWeightsAndExcludesDesktopPython() throws {
        let manifest = try NativeModelManifest()
        XCTAssertEqual(manifest.entries.count, 2)
        XCTAssertEqual(manifest.entry(.beatThis).bytes + manifest.entry(.htdemucs).bytes, 191_722_428)
        for entry in manifest.entries {
            XCTAssertEqual(entry.sha256, try NativeORTInference.modelDigest(entry.name))
            XCTAssertEqual(entry.mirrors.count, 3)
            XCTAssertTrue(entry.mirrors.allSatisfy { $0.scheme == "https" && $0.lastPathComponent == entry.file })
        }
        for bad in ["http://example.com/beat_this.onnx", "https://user:secret@example.com/beat_this.onnx", "https://example.com/no-template"] {
            XCTAssertThrowsError(try modelManifest(Data([1]), mirrors: [URL(string: bad)!]))
        }
    }
    func testModelInstallIsAtomicVerifiedAndRestoresAfterRelaunch() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let bytes = Data(repeating: 4, count: 65536), source = root.appendingPathComponent("renamed.download")
        try bytes.write(to: source)
        let manifest = try modelManifest(bytes, mirrors: [URL(string: "https://example.com/beat_this.onnx")!])
        let home = root.appendingPathComponent("models"), store = try NativeModelStore(directory: home, manifest: manifest)
        try await store.install(.beatThis, from: source)
        let path = await store.model(.beatThis)
        let installed = try XCTUnwrap(path)
        XCTAssertEqual(try Data(contentsOf: source), bytes)
        XCTAssertEqual(try Data(contentsOf: installed), bytes)
        XCTAssertEqual(try home.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
        #if !targetEnvironment(simulator)
        let protection = try FileManager.default.attributesOfItem(atPath: installed.path)[.protectionKey]
        let raw = (protection as? FileProtectionType)?.rawValue ?? protection as? String
        XCTAssertEqual(raw, FileProtectionType.completeUntilFirstUserAuthentication.rawValue)
        #endif
        let restored = try NativeModelStore(directory: home, manifest: manifest)
        let before = await restored.model(.beatThis); XCTAssertNil(before)
        await restored.restore()
        let after = await restored.model(.beatThis); XCTAssertEqual(after, installed)
        // Same size but wrong hash must not replace the verified generation.
        try Data(repeating: 5, count: bytes.count).write(to: source)
        do { try await restored.install(.beatThis, from: source); XCTFail("Accepted substituted weights") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "model-hash-mismatch") }
        XCTAssertEqual(try Data(contentsOf: installed), bytes)
        // Simulate corrupt storage between launches, then require a new hash check.
        try Data(repeating: 6, count: bytes.count).write(to: installed, options: .atomic)
        await restored.restore()
        let corrupt = await restored.model(.beatThis); XCTAssertNil(corrupt)
        try await restored.remove(.beatThis)
        XCTAssertFalse(FileManager.default.fileExists(atPath: installed.path))
    }
    func testModelDownloadSharesTransferReportsProgressAndKeepsCredentialsOut() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = ProfileHTTPFixture(Data(repeating: 7, count: 512000)); fixture.status = 200; fixture.delay = 0.015
        let url = ProfileHTTPProtocol.add(fixture, route: "beat_this.onnx"); defer { ProfileHTTPProtocol.remove(url) }
        let store = try NativeModelStore(directory: root, manifest: modelManifest(fixture.bytes, mirrors: [url]), configuration: profileNetworkConfiguration())
        async let first: Void = store.download(.beatThis)
        async let second: Void = store.download(.beatThis)
        try await waitForStream { fixture.stats.sent > 0 }
        try await Task.sleep(for: .milliseconds(230))
        let during = await store.status()[0]
        XCTAssertEqual(during.phase, "downloading"); XCTAssertGreaterThan(during.received, 0)
        _ = try await (first, second)
        let status = await store.status()[0]
        XCTAssertTrue(status.installed); XCTAssertEqual(status.phase, "installed"); XCTAssertEqual(status.received, Int64(fixture.bytes.count))
        XCTAssertEqual(fixture.stats.requests, 1)
        XCTAssertNil(fixture.stats.first?.value(forHTTPHeaderField: "Authorization"))
        XCTAssertNil(fixture.stats.first?.value(forHTTPHeaderField: "Cookie"))
        XCTAssertNil(fixture.stats.first?.value(forHTTPHeaderField: "Range"))
    }
    func testModelDownloadFallsThroughWrongHashAndRejectsAllFailedMirrors() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let wrong = ProfileHTTPFixture(Data(repeating: 1, count: 32768)), right = ProfileHTTPFixture(Data(repeating: 2, count: 32768))
        wrong.status = 200; right.status = 200
        let bad = ProfileHTTPProtocol.add(wrong, route: "beat_this.onnx"), good = ProfileHTTPProtocol.add(right, route: "beat_this.onnx")
        defer { ProfileHTTPProtocol.remove(bad); ProfileHTTPProtocol.remove(good) }
        let store = try NativeModelStore(directory: root, manifest: modelManifest(right.bytes, mirrors: [bad, good]), configuration: profileNetworkConfiguration())
        try await store.download(.beatThis)
        let path = await store.model(.beatThis)
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(path)), right.bytes)
        XCTAssertEqual(wrong.stats.requests, 1); XCTAssertEqual(right.stats.requests, 1)
        let failed = try NativeModelStore(directory: root.appendingPathComponent("failed"), manifest: modelManifest(right.bytes, mirrors: [bad]), configuration: profileNetworkConfiguration())
        do { try await failed.download(.beatThis); XCTFail("Accepted bad mirrors") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "model-download-failed") }
        let status = await failed.status()[0]
        XCTAssertFalse(status.installed); XCTAssertEqual(status.phase, "error")
        XCTAssertEqual(status.failures, ["profile.invalid: model-hash-mismatch"])
    }
    func testModelCancelAndRemoveCannotRepublishAndCanRetry() async throws {
        for remove in [false, true] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: root) }
            let fixture = ProfileHTTPFixture(Data(repeating: 3, count: 500000)); fixture.status = 200; fixture.delay = 0.01
            let url = ProfileHTTPProtocol.add(fixture, route: "beat_this.onnx"); defer { ProfileHTTPProtocol.remove(url) }
            let store = try NativeModelStore(directory: root, manifest: modelManifest(fixture.bytes, mirrors: [url]), configuration: profileNetworkConfiguration())
            let first = Task { try await store.download(.beatThis) }
            try await waitForStream { fixture.stats.sent > 0 }
            do { try await store.install(.beatThis, from: URL(fileURLWithPath: "/must-not-start")); XCTFail("Queued an unowned install") }
            catch { XCTAssertEqual((error as? MobileFailure)?.code, "model-busy") }
            if remove { try await store.remove(.beatThis) } else { await store.cancel(.beatThis) }
            do { try await first.value; XCTFail("Cancelled transfer succeeded") } catch { XCTAssertTrue(error is CancellationError) }
            let status = await store.status()[0]
            XCTAssertFalse(status.installed); XCTAssertEqual(status.phase, "absent")
            XCTAssertLessThan(fixture.stats.sent, fixture.bytes.count)
            try await store.download(.beatThis)
            let ready = await store.model(.beatThis); XCTAssertNotNil(ready)
            try await store.remove(.beatThis)
            XCTAssertFalse(FileManager.default.fileExists(atPath: try XCTUnwrap(ready).path))
        }
    }
    func testModelImportsRejectSymlinksAndDirectories() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("source"), link = root.appendingPathComponent("link"), bytes = Data([1, 2])
        try bytes.write(to: source); try FileManager.default.createSymbolicLink(at: link, withDestinationURL: source)
        let store = try NativeModelStore(directory: root.appendingPathComponent("models"), manifest: modelManifest(bytes, mirrors: [URL(string: "https://example.com/beat_this.onnx")!]))
        for url in [root, link] {
            do { try await store.install(.beatThis, from: url); XCTFail("Accepted nonregular source") }
            catch { XCTAssertEqual((error as? MobileFailure)?.code, "model-hash-mismatch") }
        }
    }
    func testOriginalModelsInstallRestoreAndFeedRealInference() async throws {
        XCTAssertEqual(Bundle.main.bundleIdentifier, "app.folia.validation.App")
        let fixtures = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("ORTQA")
        guard FileManager.default.fileExists(atPath: fixtures.appendingPathComponent("beat_this.onnx").path) else {
            throw XCTSkip("Stage approved original ORTQA assets in the independent QA sandbox")
        }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = try NativeModelStore(directory: root)
        for name in NativeModelManifest.Name.allCases { try await store.install(name, from: fixtures.appendingPathComponent(name.rawValue + ".onnx")) }
        let restored = try NativeModelStore(directory: root); await restored.restore()
        let status = await restored.status(); XCTAssertTrue(status.allSatisfy { $0.installed })
        let model = await restored.model(.beatThis)
        let output = try await NativeORTInference().infer(.beatThis, model: XCTUnwrap(model),
            input: Data(contentsOf: fixtures.appendingPathComponent("beat-input.f32")), frames: 1500)
        // Storage parity is byte-exact on the same runtime/device. Cross-device ORT arithmetic uses
        // the existing NativeORTTests 1e-4 contract; preserve and measure that distinction explicitly.
        let original = try await NativeORTInference().infer(.beatThis, model: fixtures.appendingPathComponent("beat_this.onnx"),
            input: Data(contentsOf: fixtures.appendingPathComponent("beat-input.f32")), frames: 1500)
        XCTAssertEqual(output.count, 2); XCTAssertEqual(original.count, 2)
        for (index, actual) in output.enumerated() {
            XCTAssertEqual(actual, original[index])
            let reference = try Data(contentsOf: fixtures.appendingPathComponent("beat.\(index).f32"))
            XCTAssertEqual(actual.count, reference.count)
            guard actual.count == reference.count else { continue }
            let maximum = actual.withUnsafeBytes { a in reference.withUnsafeBytes { b in
                zip(a.bindMemory(to: Float.self), b.bindMemory(to: Float.self)).reduce(Float(0)) { max($0, abs($1.0 - $1.1)) }
            } }
            XCTAssertLessThanOrEqual(maximum, 0.0001)
            #if targetEnvironment(simulator)
            XCTAssertEqual(actual, reference)
            #endif
            print("FOLIA_MODEL_STORE output=\(index) installedMatchesOriginal=\(actual == original[index]) nodeExact=\(actual == reference) nodeMaxAbs=\(maximum)")
        }
        try await restored.remove(.htdemucs)
        let remaining = await restored.status(); XCTAssertTrue(remaining[0].installed); XCTAssertFalse(remaining[1].installed)
    }
}
