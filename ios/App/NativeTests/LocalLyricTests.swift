import XCTest
@testable import App

// LocalLyricTests.swift — original lyric references plus actual decoded handovers, with no WebView.
@MainActor extension NativeTests {
    func localLyricFixture() throws -> [String: Any] {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "LocalLyricReference", withExtension: "json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    func testOriginalLocalLyricFormatsExecuteInJavaScriptCore() async throws {
        let parser = NativeLocalLyricParser()
        let rows = try XCTUnwrap(try localLyricFixture()["rows"] as? [[String: Any]])
        XCTAssertEqual(rows.count, 12)
        for row in rows {
            let data = try await parser.parse(XCTUnwrap(row["content"] as? String), fileName: row["fileName"] as? String)
            let actual: Any = try data.map { try JSONSerialization.jsonObject(with: $0) } ?? NSNull()
            assertTransitionJSON(actual, try XCTUnwrap(row["expected"]), path: row["name"] as? String ?? "lyrics")
        }
    }

    func testLocalLyricParserRejectsOversizeObservesCancellationAndRecovers() async throws {
        let parser = NativeLocalLyricParser()
        for text in [String(repeating: "字", count: 700_000), "[00:01.00]" + String(repeating: "a", count: 5000)] {
            do { _ = try await parser.parse(text); XCTFail("Oversize lyrics accepted") } catch {}
        }
        let cancelled = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await parser.parse("[00:01.00]Cancelled")
        }
        do { _ = try await cancelled.value; XCTFail("Cancelled parser succeeded") }
        catch { XCTAssertTrue(error is CancellationError) }
        let data = try await parser.parse("[00:01.00]Recovered")
        let lines = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(data)) as? [[String: Any]])
        XCTAssertEqual(lines.last?["fullText"] as? String, "Recovered")
    }

    func testLocalLyricImportKeepsFormatAtomicallyAndReadsLegacyEmbeddedText() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let file = try silentAudio(), local = LocalMediaLibrary(root: root)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: file) }
        let song = try await local.importAudio(file), id = try XCTUnwrap(song["id"] as? String)
        let folder = root.appendingPathComponent(id), legacy = folder.appendingPathComponent("lyrics.txt")
        try Data("[00:01.00]Embedded".utf8).write(to: legacy)
        let old = try await local.lyricSource(id)
        XCTAssertEqual(old?.content, "[00:01.00]Embedded"); XCTAssertNil(old?.fileName)
        let sidecar = root.appendingPathComponent("测试.YRC"), text = "[1000,2000](1000,2000,0)新歌词"
        try XCTUnwrap(text.data(using: .utf16)).write(to: sidecar)
        let detail = try await local.importLyrics(sidecar, for: id)
        XCTAssertEqual(detail["fileName"] as? String, "测试.YRC"); XCTAssertEqual(detail["content"] as? String, text)
        let reopened = LocalMediaLibrary(root: root), source = try await reopened.lyricSource(id)
        XCTAssertEqual(source?.fileName, "测试.YRC"); XCTAssertEqual(source?.content, text)
        let replacement = root.appendingPathComponent("replacement.lrc")
        try Data("[00:01.00]Replacement".utf8).write(to: replacement)
        _ = try await reopened.importLyrics(replacement, for: id)
        let changed = try await reopened.lyricSource(id)
        XCTAssertEqual(changed?.fileName, "replacement.lrc")
        // UTF-16 can fit the byte limit while the converted UTF-8 representation exceeds it.
        try XCTUnwrap(String(repeating: "字", count: 700_000).data(using: .utf16)).write(to: replacement)
        do { _ = try await reopened.importLyrics(replacement, for: id); XCTFail("Oversized conversion accepted") } catch {}
        let preserved = try await reopened.lyricSource(id)
        XCTAssertEqual(preserved?.content, changed?.content)
        let record = folder.appendingPathComponent("lyrics.json")
        try FileManager.default.removeItem(at: record)
        try FileManager.default.createSymbolicLink(at: record, withDestinationURL: replacement)
        do { _ = try await reopened.lyricSource(id); XCTFail("Symbolic lyric record accepted") } catch {}
    }

    func testLocalLyricScopeCancelsOldTasksAndRefreshesSameIdentity() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let file = try silentAudio(), local = LocalMediaLibrary(root: root)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: file) }
        var songs: [[String: Any]] = []
        for _ in 0..<3 { songs.append(try await local.importAudio(file)) }
        let sidecar = root.appendingPathComponent("lyrics.lrc")
        try Data("[00:01.00]First".utf8).write(to: sidecar)
        for song in songs { _ = try await local.importLyrics(sidecar, for: XCTUnwrap(song["id"] as? String)) }
        let lyrics = NativeLocalLyrics(local: local)
        defer { lyrics.cancel() }
        lyrics.update([songs[0]]); lyrics.cancel(); lyrics.update(Array(songs[1...]))
        try await waitForStream { lyrics.value(songs[1]) != nil && lyrics.value(songs[2]) != nil }
        XCTAssertNil(lyrics.value(songs[0])); XCTAssertEqual(lyrics.revision, 2)
        let id = try XCTUnwrap(songs[1]["id"] as? String)
        try Data("[00:01.00]Replacement".utf8).write(to: sidecar)
        _ = try await local.importLyrics(sidecar, for: id)
        lyrics.invalidate(id); lyrics.update([songs[1]])
        lyrics.invalidate(id); lyrics.update([songs[1]])
        try await waitForStream { lyrics.value(songs[1])?.last?["fullText"] as? String == "Replacement" }
        XCTAssertNil(lyrics.value(songs[2])); XCTAssertEqual(lyrics.revision, 5)
        try await local.remove(id); lyrics.invalidate(id); lyrics.update([songs[1]])
        try await waitForStream { lyrics.revision == 7 }
        XCTAssertNil(lyrics.value(songs[1]))
    }

    // Controlled profiles isolate the lyric constraint; AVFoundation/AudioStreaming decode actual local PCM.
    func testNativeAutomixReplansImportedLyricFloorAndPinsActiveHandover() async throws {
        let reference = try XCTUnwrap(try localLyricFixture()["queue"] as? [String: Any])
        let baseline = try XCTUnwrap(reference["baseline"] as? [String: Any])
        let delayed = try XCTUnwrap(reference["delayed"] as? [String: Any])
        let earlyStart = try XCTUnwrap(baseline["outStart"] as? Double), lateStart = try XCTUnwrap(delayed["outStart"] as? Double)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let file = try sharedConstantFile(seconds: 30, stereo: true), local = LocalMediaLibrary(root: root)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: file) }
        let songs = [try await local.importAudio(file), try await local.importAudio(file)]
        let folder = root.appendingPathComponent("profiles"), cache = NativeProfileCache(directory: folder)
        for (index, name) in ["fromProfile", "toProfile"].enumerated() {
            let url = try await local.resolve(XCTUnwrap(songs[index]["id"] as? String))
            cache.save(try JSONSerialization.data(withJSONObject: XCTUnwrap(reference[name])), key: try cache.key(for: url))
        }
        let suite = "folia.lyric-queue." + UUID().uuidString, storage = UserDefaults(suiteName: suite)!
        defer { storage.removePersistentDomain(forName: suite) }
        let gateway = FailingGateway(), lyrics = NativeLocalLyrics(local: local)
        let tested = PlaybackEngine(gateway: gateway, storage: storage, local: local, usesStereoOutput: true)
        tested.network.cancel()
        tested.crossfade = NativeCrossfade(owner: tested, profiler: NativeTrackProfiler(cacheDirectory: folder), lyrics: lyrics)
        defer { tested.stop(); tested.clearOutput() }
        _ = try tested.setTransitionSettings(["enabled": true, "mode": "automix", "crossfadeMaxSec": 5.0])
        try tested.setQueue(songs, at: 0)
        try await waitForStream { tested.outputIsPlaying && tested.preparedStream != nil && lyrics.revision == 2 }
        try tested.command("seek", position: earlyStart - 1.5)
        try await waitForStream { tested.outputIsPlaying && tested.stream?.seeking == false }
        let sidecar = root.appendingPathComponent(try XCTUnwrap(reference["fileName"] as? String))
        try Data(XCTUnwrap(reference["content"] as? String).utf8).write(to: sidecar)
        let id = try XCTUnwrap(songs[0]["id"] as? String)
        _ = try await local.importLyrics(sidecar, for: id)
        tested.crossfade?.localLyricsChanged(id)
        try await waitForStream { lyrics.value(songs[0])?.last?["endTime"] as? Double == 26 }
        try await waitForStream { tested.playbackPosition > earlyStart + 0.4 || tested.index == 1 }
        XCTAssertEqual(tested.index, 0, "New lyric ending must supersede the earlier no-lyric schedule")
        XCTAssertFalse(tested.crossfade!.isFading)
        let outgoing = try XCTUnwrap(tested.stream)
        try tested.command("seek", position: lateStart - 0.6)
        try await waitForStream { tested.index == 1 && tested.crossfade?.cueSnapshot != nil }
        XCTAssertGreaterThanOrEqual(outgoing.position, lateStart - 0.1)
        XCTAssertLessThan(outgoing.position, lateStart + 0.75)
        XCTAssertEqual(tested.streamOutput?.attachedCount, 2)
        let cue = try XCTUnwrap(tested.crossfade?.cueSnapshot)
        try Data("[1000,1000](1000,1000,0)Earlier".utf8).write(to: sidecar)
        _ = try await local.importLyrics(sidecar, for: id)
        tested.crossfade?.localLyricsChanged(id)
        try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertEqual(tested.crossfade?.cueSnapshot?["id"] as? Int, cue["id"] as? Int)
        XCTAssertTrue(tested.crossfade!.isFading); XCTAssertEqual(tested.streamOutput?.attachedCount, 2)
        XCTAssertEqual(gateway.count, 0)
        print("FOLIA_LOCAL_LYRIC_QUEUE noLyricsStart=\(earlyStart) lyricStart=\(lateStart) actual=\(outgoing.position) activeHandoverPinned=PASS")
    }
}
