import XCTest
import AVFoundation
@testable import App

// LocalMediaTests.swift — generated audio is test evidence, never a substitute for music-provider acceptance.
@MainActor extension NativeTests {
    func testPlaylistCatalogRejectsPartialOrMismatchedMetadata() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let library = LocalMediaLibrary(root: root), source = try silentAudio()
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: source) }
        let empty = try await library.catalog(requireComplete: true)
        XCTAssertTrue(empty.isEmpty)
        _ = try await library.importAudio(source)
        let imported = try await library.importAudio(source)
        let id = try XCTUnwrap(imported["id"] as? String)
        let metadata = root.appendingPathComponent(id).appendingPathComponent("song.json")
        let original = try Data(contentsOf: metadata)
        try FileManager.default.removeItem(at: metadata)
        do { _ = try await library.catalog(requireComplete: true); XCTFail("Missing metadata accepted") } catch {}
        let browse = try await library.catalog()
        XCTAssertEqual(browse.count, 1, "Ordinary browsing keeps readable tracks")
        try Data("broken".utf8).write(to: metadata)
        do { _ = try await library.catalog(requireComplete: true); XCTFail("Corrupt metadata accepted") } catch {}
        var wrong = imported
        wrong["sourceRef"] = ["kind": "local", "mediaId": UUID().uuidString]
        try JSONSerialization.data(withJSONObject: wrong).write(to: metadata)
        do { _ = try await library.catalog(requireComplete: true); XCTFail("Mismatched identity accepted") } catch {}
        try original.write(to: metadata)
        let restored = try await library.catalog(requireComplete: true)
        XCTAssertEqual(restored.count, 2)
        try await library.remove(id)
        let deleted = try await library.catalog(requireComplete: true)
        XCTAssertEqual(deleted.count, 1)
    }
    func testLocalImportPersistsAndRejectsPathIdentity() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let library = LocalMediaLibrary(root: root), source = try silentAudio()
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: source) }
        let imported = try await library.importAudio(source)
        let id = try XCTUnwrap(imported["id"] as? String)
        let sanitized = try PlaybackEngine.sanitizedSong(imported)
        XCTAssertEqual((sanitized["sourceRef"] as? [String: String])?["kind"], "local")
        try FileManager.default.removeItem(at: source)
        let reopened = LocalMediaLibrary(root: root)
        let songs = try await reopened.catalog(), url = try await reopened.resolve(id)
        XCTAssertEqual(songs.count, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
        let malicious: [String: Any] = ["sourceRef": ["kind": "local", "mediaId": "../../secret"]]
        XCTAssertThrowsError(try PlaybackEngine.sanitizedSong(malicious))
        do { _ = try await reopened.resolve("../../secret"); XCTFail("Path identity accepted") } catch {}
        let lyrics = root.appendingPathComponent("sidecar.lrc")
        try Data("[00:00.00]本地歌词".utf8).write(to: lyrics)
        let detail = try await reopened.importLyrics(lyrics, for: id)
        XCTAssertEqual(detail["content"] as? String, "[00:00.00]本地歌词")
        try await reopened.remove(id)
        let remaining = try await reopened.catalog()
        XCTAssertTrue(remaining.isEmpty)
        do { _ = try await reopened.resolve(id); XCTFail("Deleted file resolved") } catch {}
    }
    func testFailedLocalImportLeavesNoCatalogEntry() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let source = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mp3")
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: source) }
        try Data("not audio".utf8).write(to: source)
        let library = LocalMediaLibrary(root: root)
        do { _ = try await library.importAudio(source); XCTFail("Corrupt audio imported") } catch {}
        let songs = try await library.catalog()
        XCTAssertTrue(songs.isEmpty)
    }
    func testLocalQueuePlaysOfflineAndCrossesThreeTracksWithoutWebView() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), source = try silentAudio()
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: source) }
        let library = LocalMediaLibrary(root: root), gateway = FailingGateway()
        var songs: [[String: Any]] = []
        for _ in 0..<4 { songs.append(try await library.importAudio(source)) }
        let tested = PlaybackEngine(gateway: gateway, storage: engine().storage, local: library)
        tested.network.cancel()
        defer { tested.stop() }
        let advanced = expectation(description: "fourth local track without JS")
        var signaled = false
        tested.emit = { state in
            if state["index"] as? Int == 3, !signaled { signaled = true; advanced.fulfill() }
        }
        try tested.setQueue(songs, at: 0)
        tested.networkChanged(connected: false)
        XCTAssertTrue(tested.intentToPlay)
        XCTAssertNil(tested.networkResume)
        await fulfillment(of: [advanced], timeout: 15)
        tested.emit = nil
        XCTAssertEqual(tested.failures, 0)
        XCTAssertNil(tested.error)
        XCTAssertEqual(gateway.count, 0)
    }
    func testLoggingOutOnlineProviderDoesNotStopLocalPlayback() async throws {
        let tested = engine(); tested.network.cancel()
        let local: [String: Any] = ["sourceRef": ["kind": "local", "mediaId": UUID().uuidString]]
        tested.queue = [song("qq", "1"), local]; tested.index = 1; tested.intentToPlay = true
        tested.invalidateProvider("qq")
        XCTAssertEqual(tested.index, 0)
        XCTAssertTrue(tested.currentIsLocal)
        XCTAssertTrue(tested.intentToPlay)
        tested.stop()
    }
    func testAppendingToRestoredQueueCannotPromoteAnUnselectedTrack() async throws {
        let gateway = FailingGateway(), tested = engine()
        let restored = PlaybackEngine(gateway: gateway, storage: tested.storage)
        restored.network.cancel()
        restored.queue = [song("netease", "1"), song("qq", "2")]; restored.index = 0
        restored.prefetch()
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(gateway.count, 0)
        XCTAssertNil(restored.player.currentItem)
        XCTAssertEqual(restored.index, 0)
        restored.stop()
    }
    func testDecodedAudioProducesSpectrumAndSuspendsAnalysisWhenNotRead() async throws {
        let source = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        defer { try? FileManager.default.removeItem(at: source) }
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44100 * 3)!
        buffer.frameLength = buffer.frameCapacity
        for i in 0..<Int(buffer.frameLength) { buffer.floatChannelData!.pointee[i] = Float(sin(Double(i) * 2 * .pi * 440 / 44100)) * 0.5 }
        do { let file = try AVAudioFile(forWriting: source, settings: format.settings); try file.write(from: buffer) }
        let tested = engine(AudioFixtureGateway(url: source)); tested.network.cancel()
        defer { tested.stop() }
        try tested.setQueue([song("netease", "tone")], at: 0)
        var captured: [Int] = []
        for _ in 0..<30 {
            let sample = tested.meter?.snapshot()
            if sample?["available"] as? Bool == true {
                captured = sample?["spectrum"] as? [Int] ?? []
                if (captured.max() ?? 0) > 100 { break }
            }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTAssertEqual(captured.count, 1024)
        XCTAssertGreaterThan(captured.max() ?? 0, 100)
        let peak = captured.indices.max(by: { captured[$0] < captured[$1] }) ?? -100
        XCTAssertLessThanOrEqual(abs(peak - 20), 1, "440Hz should peak near FFT bin 20")
        try await Task.sleep(nanoseconds: 900_000_000)
        XCTAssertEqual(tested.meter?.snapshot()["available"] as? Bool, false)
    }
}
