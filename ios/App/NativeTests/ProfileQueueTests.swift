import XCTest
import AVFoundation
@testable import App

// ProfileQueueTests.swift — measured local bytes drive the original silence-edge plan; manual intent stays at zero.
@MainActor extension NativeTests {
    func profileAudio(seconds: Double = 10, head: Double = 0, tail: Double = 0) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        let format = AVAudioFormat(standardFormatWithSampleRate: 22050, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(seconds * 22050))!
        buffer.frameLength = buffer.frameCapacity
        for index in 0..<Int(buffer.frameLength) {
            let t = Double(index) / 22050
            buffer.floatChannelData![0][index] = t < head || t >= seconds - tail ? 0 : (index % 100 < 50 ? 0.125 : -0.125)
        }
        let file = try AVAudioFile(forWriting: url, settings: format.settings); try file.write(from: buffer)
        return url
    }
    func testProfileCacheRestoresInvalidatesChangedBytesAndRejectsCorruption() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let url = try profileAudio(seconds: 4, head: 1)
        defer { try? FileManager.default.removeItem(at: url); try? FileManager.default.removeItem(at: folder) }
        let profiler = NativeTrackProfiler(cacheDirectory: folder)
        let data = try await profiler.profile(file: url)
        XCTAssertNotNil(data)
        // A host with no analysis resource can only return the already-measured disk record.
        let offline = NativeTrackProfiler(bundle: Bundle(for: NativeTests.self), cacheDirectory: folder)
        let restored = try await offline.profile(file: url)
        XCTAssertEqual(data, restored)
        let record = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil).first)
        try Data("corrupt".utf8).write(to: record)
        do { _ = try await offline.profile(file: url); XCTFail("Corrupt cache must be remeasured") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "profile-runtime-unavailable") }
        _ = try await profiler.profile(file: url)
        try FileManager.default.setAttributes([.modificationDate: Date().addingTimeInterval(10)], ofItemAtPath: url.path)
        do { _ = try await offline.profile(file: url); XCTFail("Changed representation must invalidate cached analysis") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "profile-runtime-unavailable") }
    }
    func testProfileScopeDropsObsoleteWorkAndKeepsOnlyWantedResults() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let file = try profileAudio(seconds: 24, head: 2)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: file) }
        let local = LocalMediaLibrary(root: root)
        let a = try await local.importAudio(file), b = try await local.importAudio(file)
        let profiles = NativeTrackProfiles(local: local, profiler: NativeTrackProfiler(cacheDirectory: root.appendingPathComponent("profiles")))
        profiles.update([a]); profiles.cancel(); profiles.update([b])
        try await waitForStream { profiles.value(b) != nil }
        XCTAssertNil(profiles.value(a)); XCTAssertEqual(profiles.revision, 1)
        profiles.cancel()
    }
    func localProfileQueue() async throws -> (PlaybackEngine, URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let outgoing = try profileAudio(tail: 2), incoming = try profileAudio(head: 2)
        defer { try? FileManager.default.removeItem(at: outgoing); try? FileManager.default.removeItem(at: incoming) }
        let local = LocalMediaLibrary(root: root)
        do {
            let songs = [try await local.importAudio(outgoing), try await local.importAudio(incoming)]
            let storage = UserDefaults(suiteName: "folia.profile-queue-tests")!
            storage.removePersistentDomain(forName: "folia.profile-queue-tests")
            let tested = PlaybackEngine(gateway: FailingGateway(), storage: storage, local: local, usesStereoOutput: true)
            tested.network.cancel()
            let started = ProcessInfo.processInfo.systemUptime
            var samples: [[String: Any]] = [], lastSample = -1.0
            func sample(_ phase: String) {
                var row = tested.crossfade?.analysisDiagnostics ?? [:]
                row["phase"] = phase; row["elapsed"] = ProcessInfo.processInfo.systemUptime - started
                row["thermal"] = ProcessInfo.processInfo.thermalState.rawValue
                row["playing"] = tested.outputIsPlaying; row["position"] = tested.playbackPosition
                row["prepared"] = tested.preparedStream != nil
                row["preparedPosition"] = tested.preparedStream?.entry.preparedPosition ?? -1
                row["preparedBuffered"] = tested.preparedStream?.entry.audio.bufferedDuration ?? -1
                row["preparedSeeking"] = tested.preparedStream?.entry.seeking ?? false
                row["streamFailed"] = tested.stream?.hasFailed ?? false
                samples.append(row)
                if let data = try? JSONSerialization.data(withJSONObject: row, options: [.sortedKeys]) {
                    print("FOLIA_PROFILE_PREPARATION " + String(decoding: data, as: UTF8.self))
                }
            }
            defer {
                if let data = try? JSONSerialization.data(withJSONObject: samples, options: [.sortedKeys]) {
                    let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                    attachment.name = "profile-preparation"; attachment.lifetime = .keepAlways; add(attachment)
                }
            }
            sample("created")
            _ = try tested.setTransitionSettings(["enabled": true, "mode": "crossfade", "crossfadeMaxSec": 1.0])
            try tested.setQueue(songs, at: 0)
            do { try await waitForStream {
                let elapsed = ProcessInfo.processInfo.systemUptime - started
                if elapsed - lastSample >= 1 { sample("waiting"); lastSample = elapsed }
                return tested.outputIsPlaying && (tested.preparedStream?.entry.preparedPosition ?? 0) > 1
            } }
            catch { sample("failed"); tested.stop(); tested.clearOutput(); throw error }
            sample("ready")
            return (tested, root)
        } catch { try? FileManager.default.removeItem(at: root); throw error }
    }
    func testMeasuredLocalSilenceEdgesReachNativeQueueAndOriginalCrossfade() async throws {
        let (tested, root) = try await localProfileQueue()
        defer { tested.stop(); tested.clearOutput(); try? FileManager.default.removeItem(at: root) }
        let outgoing = tested.stream
        // Leave more than the original planner's 0.8s minimum after the measured sounding end.
        try tested.command("seek", position: 6.5)
        try await waitForStream { tested.index == 1 && tested.crossfade?.isFading == true && tested.outputIsPlaying }
        XCTAssertGreaterThan(tested.playbackPosition, 1)
        XCTAssertLessThan(outgoing!.position, 8.5)
        XCTAssertEqual(tested.streamOutput?.attachedCount, 2)
        print("FOLIA_PROFILE_QUEUE leadingSilence=SKIPPED trailingSilence=SKIPPED originalPlanner=PASS")
    }
    func testPreparedSilenceTrimDoesNotChangeManualSelectionOrDisabledPlaybackStart() async throws {
        for automatic in [false, true] {
            let (tested, root) = try await localProfileQueue()
            defer { tested.stop(); tested.clearOutput(); try? FileManager.default.removeItem(at: root) }
            let buffered = tested.preparedStream?.entry
            if automatic {
                _ = try tested.setTransitionSettings(["enabled": false, "mode": "crossfade", "crossfadeMaxSec": 1.0])
                try tested.command("seek", position: 9.8)
            } else { try tested.selectQueue(1, expectedRevision: tested.queueRevision) }
            try await waitForStream { tested.index == 1 && tested.outputIsPlaying }
            XCTAssertLessThan(tested.playbackPosition, 1)
            XCTAssertFalse(tested.stream === buffered)
            XCTAssertFalse(tested.crossfade!.isFading)
        }
    }

    func testCancelledPreparedSeekCannotBeReusedAsZeroStart() async throws {
        let url = try profileAudio()
        defer { try? FileManager.default.removeItem(at: url) }
        let tested = stereoEngine(AudioFixtureGateway(url: url))
        defer { tested.stop(); tested.clearOutput() }
        try tested.setQueue([song("qq", "a"), song("netease", "b")], at: 0)
        try await waitForStream { tested.outputIsPlaying && tested.preparedStream != nil }
        let buffered = try XCTUnwrap(tested.preparedStream?.entry)
        let work = Task { @MainActor in
            // Cancel at the first suspension after issuing the decoder seek, before PCM is ready.
            withUnsafeCurrentTask { $0?.cancel() }
            try await buffered.preparePosition(1.9)
        }
        do { try await work.value; XCTFail("Preparation should observe cancellation") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(buffered.preparedPosition, 1.9)
        try tested.selectQueue(1, expectedRevision: tested.queueRevision)
        try await waitForStream { tested.index == 1 && tested.outputIsPlaying }
        XCTAssertFalse(tested.stream === buffered)
        XCTAssertLessThan(tested.playbackPosition, 1)
    }
}
