import XCTest
import UIKit
@testable import App

// NativeStemQueueTests.swift — real media/queues with explicit fake separation; one separate case uses approved original weights.
actor QueueStemSeparator: NativeStemSeparating {
    private(set) var calls = 0, active = 0, maximumActive = 0
    var delay: Duration = .zero
    func setDelay(_ value: Duration) { delay = value }
    func separate(_ material: NativeStemMaterial, model: URL) async throws -> NativeStemWindow {
        calls += 1; active += 1; maximumActive = max(maximumActive, active)
        defer { active -= 1 }
        // Deliberately ignore cancellation to test the coordinator's late-result guard.
        try? await Task.sleep(for: delay)
        let quiet = material.channels.map { $0.map { _ in Float(0) } }
        return try NativeStemWindow(fromFrame: material.fromFrame, role: material.role, mix: material.channels,
            separated: [.drums: quiet, .bass: quiet, .vocals: quiet])
    }
}

// Observes the actual model call without replacing its input, weights, limits or output.
actor MeasuredQueueStemSeparator: NativeStemSeparating {
    func separate(_ material: NativeStemMaterial, model: URL) async throws -> NativeStemWindow {
        let started = ProcessInfo.processInfo.systemUptime
        print("FOLIA_STEM_QUEUE inference=started frames=\(material.frames)")
        do {
            let window = try await NativeStemInference().separate(material, model: model)
            print("FOLIA_STEM_QUEUE inference=complete seconds=\(ProcessInfo.processInfo.systemUptime - started)")
            return window
        } catch {
            let code = (error as? MobileFailure)?.code ?? "cancelled-or-unknown"
            print("FOLIA_STEM_QUEUE inference=failed code=\(code) seconds=\(ProcessInfo.processInfo.systemUptime - started)")
            throw error
        }
    }
}

@MainActor extension NativeTests {
    func testStemPreparationFollowsActualPlayerModeQueueAndMemoryPressure() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), file = try profileAudio(seconds: 30)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: file) }
        let local = LocalMediaLibrary(root: root), a = try await local.importAudio(file), b = try await local.importAudio(file)
        let player = PlaybackEngine(gateway: FailingGateway(), storage: UserDefaults(suiteName: UUID().uuidString)!, local: local, usesStereoOutput: true)
        let profiles = NativeTrackProfiles(local: local), separator = QueueStemSeparator()
        let stems = NativeTrackStems(local: local, mediaCache: player.mediaCache, separator: separator, profilesIdle: { !profiles.hasPending })
        player.network.cancel(); player.crossfade = NativeCrossfade(owner: player, profiles: profiles, stems: stems)
        defer { player.stop(); player.clearOutput(); stems.cancel(); profiles.cancel() }
        player.crossfade?.modelsChanged(beat: nil, stems: URL(fileURLWithPath: "/test-only-fake.onnx"))
        try player.crossfade?.configure(enabled: true, maximumSeconds: 5, mode: "crossfade")
        try player.setQueue([a, b], at: 0)
        try await waitForStream { player.outputIsPlaying && player.preparedStream != nil }
        let before = await separator.calls; XCTAssertEqual(before, 0)
        // Profile work has its own budget; the five-second assertion below measures stem scheduling.
        try await waitForStream({ profiles.value(a) != nil && profiles.value(b) != nil }, seconds: 25)
        try player.crossfade?.configure(enabled: true, maximumSeconds: 5, mode: "automix")
        try await waitForStream { stems.value(a, role: .tail) != nil && stems.value(b, role: .head) != nil }
        XCTAssertTrue(player.outputIsPlaying); XCTAssertEqual(player.index, 0)
        NotificationCenter.default.post(name: UIApplication.didReceiveMemoryWarningNotification, object: nil)
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertNil(stems.value(a, role: .tail)); XCTAssertTrue(player.outputIsPlaying)
        try player.crossfade?.configure(enabled: false, maximumSeconds: 5, mode: "automix")
        XCTAssertNil(stems.value(b, role: .head)); XCTAssertTrue(player.outputIsPlaying)
    }
    func testStemQueueWaitsForProfilesKeepsFourWindowsAndReusesPreviousPair() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let file = try profileAudio(seconds: 0.2)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: file) }
        let local = LocalMediaLibrary(root: root), cache = NativeStemCache(), separator = QueueStemSeparator()
        let a = try await local.importAudio(file), b = try await local.importAudio(file), c = try await local.importAudio(file)
        var profilesBusy = true
        let queue = NativeTrackStems(local: local, mediaCache: NativeMediaCache(directory: root.appendingPathComponent("cache")),
            cache: cache, separator: separator, profilesIdle: { !profilesBusy })
        defer { queue.cancel() }
        queue.useModel(URL(fileURLWithPath: "/test-only-fake.onnx")); queue.update(outgoing: a, incoming: b)
        try await Task.sleep(for: .milliseconds(100))
        let before = await separator.calls; XCTAssertEqual(before, 0)
        profilesBusy = false; queue.update(outgoing: a, incoming: b)
        try await waitForStream { queue.value(a, role: .tail) != nil && queue.value(b, role: .head) != nil }
        for _ in 0..<20 { queue.update(outgoing: a, incoming: b) }
        queue.cancel(); queue.update(outgoing: b, incoming: c)
        try await waitForStream { queue.value(b, role: .tail) != nil && queue.value(c, role: .head) != nil }
        queue.cancel(); queue.update(outgoing: a, incoming: b)
        try await waitForStream { queue.value(a, role: .tail) != nil && queue.value(b, role: .head) != nil }
        let calls = await separator.calls, maximum = await separator.maximumActive, count = await cache.keys.count
        XCTAssertEqual(calls, 4); XCTAssertEqual(maximum, 1); XCTAssertEqual(count, 4)
    }

    func testStemQueueParksOnlineWithoutDownloadingAndWakesOnlyForCompleteCache() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), file = try profileAudio(seconds: 0.2)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: file) }
        let fixture = ProfileHTTPFixture(try Data(contentsOf: file)); fixture.status = 200
        let url = ProfileHTTPProtocol.add(fixture); defer { ProfileHTTPProtocol.remove(url) }
        let media = NativeMediaCache(directory: root, configuration: profileNetworkConfiguration(), settings: .init(enabled: true))
        let separator = QueueStemSeparator(), cache = NativeStemCache()
        let queue = NativeTrackStems(local: LocalMediaLibrary(root: root.appendingPathComponent("local")), mediaCache: media, cache: cache, separator: separator)
        defer { queue.cancel() }
        let qq = song("qq", "same"), ne = song("netease", "same"), identity = try XCTUnwrap(NativeProfileIdentity(qq))
        queue.useModel(URL(fileURLWithPath: "/test-only-fake.onnx")); queue.update(outgoing: qq, incoming: ne)
        try await waitForStream { queue.phase(qq, role: .tail) == "waiting-media" && queue.phase(ne, role: .head) == "waiting-media" }
        XCTAssertEqual(fixture.stats.requests, 0)
        _ = try await media.store(identity, song: qq, source: url)
        queue.mediaAvailable(identity.key)
        try await waitForStream { queue.value(qq, role: .tail) != nil }
        XCTAssertNil(queue.value(ne, role: .head)); XCTAssertEqual(fixture.stats.requests, 1)
        let calls = await separator.calls; XCTAssertEqual(calls, 1)
        queue.remove(provider: "qq"); try await media.clear(provider: "qq")
        queue.update(outgoing: qq, incoming: ne)
        try await waitForStream { queue.phase(qq, role: .tail) == "waiting-media" }
        XCTAssertNil(queue.value(qq, role: .tail)); let keys = await cache.keys; XCTAssertFalse(keys.contains { $0.provider == "qq" })
        XCTAssertEqual(fixture.stats.requests, 1)
    }

    func testStemQueueHardInvalidationAndPressureRejectLateResultsAndRecover() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), file = try profileAudio(seconds: 0.2)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: file) }
        let local = LocalMediaLibrary(root: root), separator = QueueStemSeparator(), cache = NativeStemCache()
        let a = try await local.importAudio(file), b = try await local.importAudio(file)
        let queue = NativeTrackStems(local: local, mediaCache: NativeMediaCache(directory: root.appendingPathComponent("cache")), cache: cache, separator: separator)
        defer { queue.cancel() }
        await separator.setDelay(.milliseconds(400))
        queue.useModel(URL(fileURLWithPath: "/test-only-fake.onnx")); queue.update(outgoing: a, incoming: b)
        try await waitForStream { queue.phase(a, role: .tail) == "preparing" }
        try await Task.sleep(for: .milliseconds(80))
        queue.resourcePressure(true)
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertNil(queue.value(a, role: .tail)); let cleared = await cache.keys; XCTAssertTrue(cleared.isEmpty)
        let start = await separator.calls
        queue.update(outgoing: a, incoming: b); try await Task.sleep(for: .milliseconds(100))
        let held = await separator.calls; XCTAssertEqual(start, held)
        queue.resourcePressure(false)
        try await waitForStream { queue.value(a, role: .tail) != nil && queue.value(b, role: .head) != nil }
        queue.remove(localID: try XCTUnwrap(NativeProfileIdentity(a)?.localID))
        queue.useModel(nil)
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertNil(queue.value(a, role: .tail)); let removed = await cache.keys; XCTAssertTrue(removed.isEmpty)
        queue.useModel(URL(fileURLWithPath: "/test-only-fake.onnx")); queue.update(outgoing: b, incoming: a)
        try await waitForStream { queue.value(b, role: .tail) != nil && queue.value(a, role: .head) != nil }
        let maximum = await separator.maximumActive; XCTAssertEqual(maximum, 1)
    }

    func testStemQueueOriginalMusicTailFeedsActualModelAndReusesPackedCache() async throws {
        XCTAssertEqual(Bundle.main.bundleIdentifier, "app.folia.validation.App")
        let assets = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("ORTQA")
        guard FileManager.default.fileExists(atPath: assets.appendingPathComponent("music.wav").path) else { throw XCTSkip("Stage approved original music and model in QA") }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let local = LocalMediaLibrary(root: root), song = try await local.importAudio(assets.appendingPathComponent("music.wav")), cache = NativeStemCache()
        let queue = NativeTrackStems(local: local, mediaCache: NativeMediaCache(directory: root.appendingPathComponent("cache")),
            cache: cache, separator: MeasuredQueueStemSeparator())
        defer { queue.cancel() }
        let missing = self.song("qq", "no-download")
        queue.useModel(assets.appendingPathComponent("htdemucs.onnx")); queue.update(outgoing: song, incoming: missing)
        // Let the existing 60-second production inference deadline report its own failure.
        // The old 55-second test timer cancelled work before that deadline and hid the failing stage.
        let started = ProcessInfo.processInfo.systemUptime
        var reported = -1
        try await waitForStream({
            let elapsed = Int(ProcessInfo.processInfo.systemUptime - started)
            if elapsed / 10 != reported {
                reported = elapsed / 10
                print("FOLIA_STEM_QUEUE elapsed=\(elapsed) phase=\(queue.phase(song, role: .tail)) thermal=\(ProcessInfo.processInfo.thermalState.rawValue)")
            }
            return queue.value(song, role: .tail) != nil || queue.failure(song, role: .tail) != nil
        }, seconds: 75)
        XCTAssertNil(queue.failure(song, role: .tail), "Original model preparation failed")
        let result = try XCTUnwrap(queue.value(song, role: .tail))
        XCTAssertEqual(result.fromFrame, 4_541_768); XCTAssertEqual(result.frames, 1_323_000)
        XCTAssertEqual(try XCTUnwrap(result.vocalEnd), 23.650000000000002, accuracy: 1e-9)
        XCTAssertEqual(result.storedBytes, 21_168_000)
        print("FOLIA_STEM_QUEUE original30SecondTail=PASS storedBytes=\(result.storedBytes)")
        queue.cancel(); queue.update(outgoing: song, incoming: missing)
        try await waitForStream({ queue.value(song, role: .tail) != nil }, seconds: 2)
        XCTAssertTrue(queue.value(song, role: .tail) === result)
        XCTAssertNil(queue.value(missing, role: .head))
        let keys = await cache.keys; XCTAssertEqual(keys.count, 1)
        XCTAssertEqual(keys.first?.mediaRevision, "d7db2870d3ab5c1b56f793288c045a34043c1e1cfda468010a3e200f4e8c38a2")
    }
}
