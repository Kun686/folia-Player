import XCTest
import Capacitor
import WebKit
@testable import App

// NativeModelQueueTests.swift — real approved beat weights, capability changes, and the existing identity queue.
@MainActor extension NativeTests {
    func testPackagedModelBridgeReadsNativeStateAndRejectsUnknownModels() async throws {
        XCTAssertEqual(Bundle.main.bundleIdentifier, "app.folia.validation.App")
        let controller = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).compactMap { $0.rootViewController as? CAPBridgeViewController }.first)
        let web = try XCTUnwrap(controller.webView)
        try await waitForStream({ !web.isLoading && web.url?.scheme == "capacitor" }, seconds: 15)
        let plugin = try XCTUnwrap(controller.bridge?.plugin(withName: "FoliaNative") as? FoliaNativePlugin)
        try await waitForStream({ plugin.models?.ready == true }, seconds: 15)
        let result = try await web.callAsyncJavaScript("""
            const read = () => window.Capacitor.nativePromise('FoliaNative', 'getModels', {});
            const first = await read();
            for (let i = 0; i < 10; i++) await read();
            const last = await read();
            let invalid = '';
            try { await window.Capacitor.nativePromise('FoliaNative', 'downloadModel', {name: '../unknown.onnx'}); }
            catch (error) { invalid = error.message; }
            return {first, last, invalid};
            """, arguments: [:], in: nil, contentWorld: .page)
        let values = try XCTUnwrap(result as? [String: Any])
        let first = try XCTUnwrap(values["first"] as? [String: Any]), last = try XCTUnwrap(values["last"] as? [String: Any])
        XCTAssertEqual(first["ready"] as? Bool, true)
        XCTAssertEqual((first["models"] as? [[String: Any]])?.count, 2)
        XCTAssertEqual(first["revision"] as? Int, last["revision"] as? Int)
        XCTAssertEqual(values["invalid"] as? String, "invalid-model")
    }
    private func queueBeatModel() throws -> URL {
        XCTAssertEqual(Bundle.main.bundleIdentifier, "app.folia.validation.App")
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("ORTQA/beat_this.onnx")
        guard FileManager.default.fileExists(atPath: url.path) else { throw XCTSkip("Stage approved original beat weights in the independent QA sandbox") }
        return url
    }
    func testModelCapabilityUpgradesExistingQueueAndRestoresGridlessCache() async throws {
        let model = try queueBeatModel(), file = try profileAudio(seconds: 4, head: 0.5)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: file) }
        let local = LocalMediaLibrary(root: root), song = try await local.importAudio(file)
        let profiles = NativeTrackProfiles(local: local, profiler: NativeTrackProfiler(cacheDirectory: root.appendingPathComponent("profiles")))
        defer { profiles.cancel() }
        profiles.update([song]); try await waitForStream { profiles.value(song) != nil }
        XCTAssertEqual(profiles.value(song)?["gridless"] as? Bool, true)
        XCTAssertTrue(profiles.useBeatModel(model)); XCTAssertNil(profiles.value(song))
        profiles.update([song]); try await waitForStream({ profiles.value(song) != nil }, seconds: 45)
        XCTAssertEqual(profiles.value(song)?["gridless"] as? Bool, false)
        let revision = profiles.revision
        XCTAssertFalse(profiles.useBeatModel(model)); XCTAssertEqual(profiles.revision, revision)
        XCTAssertTrue(profiles.useBeatModel(nil)); profiles.update([song])
        try await waitForStream { profiles.value(song) != nil }
        XCTAssertEqual(profiles.value(song)?["gridless"] as? Bool, true)
        print("FOLIA_MODEL_QUEUE gridless->model->gridless=PASS")
    }
    func testRemovingModelDropsInFlightQueueResultsAndKeepsNewIntent() async throws {
        let model = try queueBeatModel(), file = try profileAudio(seconds: 20)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: file) }
        let local = LocalMediaLibrary(root: root)
        let old = try await local.importAudio(file), next = try await local.importAudio(file)
        let profiles = NativeTrackProfiles(local: local, profiler: NativeTrackProfiler(cacheDirectory: root.appendingPathComponent("profiles")))
        defer { profiles.cancel() }
        profiles.useBeatModel(model); profiles.update([old])
        try await Task.sleep(for: .milliseconds(200))
        profiles.useBeatModel(nil); profiles.update([next])
        try await waitForStream({ profiles.value(next) != nil }, seconds: 30)
        XCTAssertNil(profiles.value(old)); XCTAssertEqual(profiles.value(next)?["gridless"] as? Bool, true)
        try await Task.sleep(for: .milliseconds(250))
        XCTAssertNil(profiles.value(old)); XCTAssertEqual(profiles.value(next)?["gridless"] as? Bool, true)
    }
    func testPlayerModelControllerRestoresNativeQueueCapabilityAndDeletesWithoutWebView() async throws {
        let model = try queueBeatModel(), file = try profileAudio(seconds: 4)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: file) }
        let local = LocalMediaLibrary(root: root.appendingPathComponent("library")), song = try await local.importAudio(file)
        let profiles = NativeTrackProfiles(local: local, profiler: NativeTrackProfiler(cacheDirectory: root.appendingPathComponent("profiles")))
        let storage = UserDefaults(suiteName: UUID().uuidString)!
        let player = PlaybackEngine(gateway: FailingGateway(), storage: storage, local: local, usesStereoOutput: true)
        player.network.cancel(); player.crossfade = NativeCrossfade(owner: player, profiles: profiles)
        defer { profiles.cancel(); player.stop(); player.clearOutput() }
        let store = try NativeModelStore(directory: root.appendingPathComponent("models"))
        try await store.install(.beatThis, from: model)
        let controller = try PlaybackModels(engine: player, store: store); controller.start()
        try await waitForStream({ controller.ready }, seconds: 15)
        let caps = controller.snapshot()["capabilities"] as? [String: Bool]
        XCTAssertEqual(caps?["beatGrid"], true); XCTAssertEqual(caps?["stems"], false); XCTAssertEqual(caps?["full"], false)
        let revision = controller.snapshot()["revision"] as? Int
        var notifications = 0
        controller.changed = { notifications += 1 }
        for _ in 0..<20 { _ = controller.snapshot() }
        XCTAssertEqual(controller.snapshot()["revision"] as? Int, revision)
        XCTAssertEqual(notifications, 0, "Reading status must not trigger bridge feedback events")
        profiles.update([song]); try await waitForStream { profiles.value(song) != nil }
        XCTAssertEqual(profiles.value(song)?["gridless"] as? Bool, true, "Stored models must not run while Automix is off")
        try player.crossfade?.configure(enabled: true, maximumSeconds: 5, mode: "automix")
        profiles.update([song]); try await waitForStream({ profiles.value(song) != nil }, seconds: 45)
        XCTAssertEqual(profiles.value(song)?["gridless"] as? Bool, false)
        try player.crossfade?.configure(enabled: true, maximumSeconds: 5, mode: "crossfade")
        profiles.update([song]); try await waitForStream { profiles.value(song) != nil }
        XCTAssertEqual(profiles.value(song)?["gridless"] as? Bool, true, "Ordinary crossfade must use its model-free profile")
        try player.crossfade?.configure(enabled: true, maximumSeconds: 5, mode: "automix")
        profiles.update([song]); try await waitForStream { profiles.value(song) != nil }
        XCTAssertEqual(profiles.value(song)?["gridless"] as? Bool, false)
        let state = try JSONSerialization.data(withJSONObject: controller.snapshot())
        XCTAssertFalse(String(decoding: state, as: UTF8.self).contains(root.path))
        try await controller.removeAll(); XCTAssertNil(profiles.value(song))
        profiles.update([song]); try await waitForStream { profiles.value(song) != nil }
        XCTAssertEqual(profiles.value(song)?["gridless"] as? Bool, true)
        XCTAssertEqual((controller.snapshot()["capabilities"] as? [String: Bool])?["beatGrid"], false)
    }
}
