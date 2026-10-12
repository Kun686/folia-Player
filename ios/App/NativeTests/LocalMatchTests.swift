import XCTest
import AVFoundation
@testable import App

// LocalMatchTests.swift — atomic matching, immutable imported assets and background parsing without a WebView.
@MainActor extension NativeTests {
    private func matchDocument() -> [String: Any] {
        ["title": "Matched title", "titleOrigin": "manual-match", "artistNames": ["Matched artist"], "albumName": "Matched album",
         "useOnlineCover": true, "onlineMetadata": ["source": "qq", "songId": "qq-mid", "artists": [["name": "Matched artist"]],
            "coverUrl": "https://example.invalid/cover.jpg", "matchMode": "manual", "matchedAt": 1000],
         "matchedLyricsSource": "qq", "matchedLyricsSongId": "qq-mid", "matchedIsPureMusic": false,
         "matchedLyrics": ["lines": [["startTime": 1, "endTime": 3, "fullText": "Matched lyric", "words": []]]]]
    }
    func testNativeLyricPrioritySettingsInvalidateLocalPlansAndPreserveExplicitSource() async throws {
        let audio = try silentAudio(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), song = try await local.importAudio(audio), id = try XCTUnwrap(song["id"] as? String)
        let file = root.appendingPathComponent("priority.lrc"); try Data("[00:01.00]Imported lyric".utf8).write(to: file)
        _ = try await local.importLyrics(file, for: id)
        let source = try await local.readLyricSources(id)
        _ = try await local.writeLocalMatch(id, token: XCTUnwrap(source["token"] as? String), document: matchDocument(), source: nil)
        let storage = UserDefaults(suiteName: UUID().uuidString)!
        let player = PlaybackEngine(gateway: FailingGateway(), storage: storage, local: local)
        let lyrics = NativeLyrics(local: local)
        player.network.cancel(); player.crossfade = NativeCrossfade(owner: player, lyrics: lyrics)
        defer { lyrics.cancel(); player.stop(); player.clearOutput() }
        lyrics.update([song])
        try await waitForStream { lyrics.value(song)?.first?["fullText"] as? String == "Imported lyric" }
        _ = try player.setLyricSettings(["localLyricsPriority": "online"])
        XCTAssertNil(lyrics.value(song))
        lyrics.update([song])
        try await waitForStream { lyrics.value(song)?.first?["fullText"] as? String == "Matched lyric" }
        let saved = storage.data(forKey: "folia.lyrics")
        for invalid in ["unknown", 1, NSNull()] as [Any] {
            XCTAssertThrowsError(try player.setLyricSettings(["localLyricsPriority": invalid]))
            XCTAssertEqual(storage.data(forKey: "folia.lyrics"), saved)
            XCTAssertEqual(player.lyricSettings.localLyricsPriority, "online")
        }
        let restored = PlaybackEngine(gateway: FailingGateway(), storage: storage, local: local)
        restored.network.cancel(); defer { restored.stop(); restored.clearOutput() }
        XCTAssertEqual(restored.lyricSettings.localLyricsPriority, "online")
        // A cancelled old read must not overwrite the final priority.
        for priority in ["local", "online", "local"] {
            _ = try player.setLyricSettings(["localLyricsPriority": priority]); lyrics.update([song])
        }
        try await waitForStream { lyrics.value(song)?.first?["fullText"] as? String == "Imported lyric" }
        let snapshot = try await local.readLyricSources(id)
        _ = try await local.selectLyricSource("local", id: id, token: XCTUnwrap(snapshot["token"] as? String))
        player.crossfade?.localLyricsChanged(id)
        _ = try player.setLyricSettings(["localLyricsPriority": "online"]); lyrics.update([song])
        try await waitForStream { lyrics.value(song)?.first?["fullText"] as? String == "Imported lyric" }
    }
    func testLocalMatchPersistsAtomicallyAndBackgroundLyricsUseMatchedSource() async throws {
        let audio = try silentAudio(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), song = try await local.importAudio(audio), id = try XCTUnwrap(song["id"] as? String)
        let folder = root.appendingPathComponent(id), originalData = try Data(contentsOf: folder.appendingPathComponent("song.json"))
        let originalAudio = try await local.resolve(id), audioData = try Data(contentsOf: originalAudio)
        let file = root.appendingPathComponent("import.lrc"); try Data("[00:01.00]Imported lyric".utf8).write(to: file)
        _ = try await local.importLyrics(file, for: id)
        let before = try await local.readLocalMatch(id), snapshot = try XCTUnwrap(before["lyrics"] as? [String: Any])
        let saved = try await local.writeLocalMatch(id, token: XCTUnwrap(snapshot["token"] as? String), document: matchDocument(), source: "online")
        XCTAssertEqual(saved["name"] as? String, "Matched title")
        XCTAssertEqual((saved["sourceRef"] as? [String: String])?["mediaId"], id)
        XCTAssertEqual(try Data(contentsOf: folder.appendingPathComponent("song.json")), originalData)
        XCTAssertEqual(try Data(contentsOf: originalAudio), audioData)
        let reopened = LocalMediaLibrary(root: root), read = try await reopened.readLocalMatch(id)
        XCTAssertEqual((read["base"] as? [String: Any])?["name"] as? String, song["name"] as? String)
        XCTAssertEqual(read["fileName"] as? String, audio.lastPathComponent)
        let lyrics = try XCTUnwrap(read["lyrics"] as? [String: Any])
        XCTAssertEqual(lyrics["content"] as? String, "[00:01.00]Imported lyric")
        XCTAssertEqual(lyrics["lyricsSource"] as? String, "online")
        let native = NativeLyrics(local: reopened); defer { native.cancel() }
        native.update([song])
        try await waitForStream { native.value(song)?.first?["fullText"] as? String == "Matched lyric" }
        _ = try await reopened.selectLyricSource("local", id: id, token: XCTUnwrap(lyrics["token"] as? String))
        native.invalidate(id); native.update([song])
        try await waitForStream { native.value(song)?.first?["fullText"] as? String == "Imported lyric" }
        let next = try await reopened.readLyricSources(id)
        XCTAssertNotNil(next["matched"])
        _ = try await reopened.selectLyricSource("online", id: id, token: XCTUnwrap(next["token"] as? String))
        native.invalidate(id); native.update([song])
        try await waitForStream { native.value(song)?.first?["fullText"] as? String == "Matched lyric" }
    }
    func testLocalMatchRejectsMalformedUnavailableStaleAndDeletedWrites() async throws {
        let audio = try silentAudio(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), song = try await local.importAudio(audio), id = try XCTUnwrap(song["id"] as? String)
        let snapshot = try await local.readLyricSources(id), token = try XCTUnwrap(snapshot["token"] as? String)
        var invalid = matchDocument(); invalid["matchedLyrics"] = ["lines": [["fullText": "missing times"]]]
        do { _ = try await local.writeLocalMatch(id, token: token, document: invalid, source: "online"); XCTFail("Malformed match accepted") } catch {}
        for source in ["local", "embedded", "invalid"] {
            do { _ = try await local.writeLocalMatch(id, token: token, document: matchDocument(), source: source); XCTFail("Unavailable source accepted") } catch {}
        }
        var unavailable = matchDocument(); unavailable.removeValue(forKey: "matchedLyrics")
        do { _ = try await local.writeLocalMatch(id, token: token, document: unavailable, source: "online"); XCTFail("Missing online lyrics accepted") } catch {}
        let valid = matchDocument()
        let tasks = (0..<2).map { _ in Task { () -> Bool in
            do { _ = try await local.writeLocalMatch(id, token: token, document: valid, source: "online"); return true } catch { return false }
        } }
        var count = 0
        for task in tasks { if await task.value { count += 1 } }
        XCTAssertEqual(count, 1)
        let current = try await local.readLyricSources(id)
        do { _ = try await local.writeLocalMatch(id, token: token, document: valid, source: "online"); XCTFail("Stale write accepted") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "local-lyrics-changed") }
        try await local.remove(id)
        do { _ = try await local.writeLocalMatch(id, token: XCTUnwrap(current["token"] as? String), document: valid, source: "online"); XCTFail("Deleted song recreated") } catch {}
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(id).path))
    }
    func testLocalMatchedCoverCachesSeparatelyAndFallsBackToEmbedded() async throws {
        let audio = try silentAudio(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root.appendingPathComponent("imports"))
        let song = try await local.importAudio(audio), id = try XCTUnwrap(song["id"] as? String)
        let embedded = try NativeCoverCache.thumbnail(coverFixture(.blue).bytes)
        try embedded.write(to: root.appendingPathComponent("imports/" + id + "/cover.jpg"))
        let fixture = try coverFixture(.red), url = ProfileHTTPProtocol.add(fixture)
        defer { ProfileHTTPProtocol.remove(url) }
        let cache = NativeCoverCache(root: root.appendingPathComponent("cache"), configuration: profileNetworkConfiguration())
        var doc = matchDocument(), online = doc["onlineMetadata"] as! [String: Any]; online["coverUrl"] = url.absoluteString
        doc["onlineMetadata"] = online
        let snapshot = try await local.readLyricSources(id)
        _ = try await local.writeLocalMatch(id, token: XCTUnwrap(snapshot["token"] as? String), document: doc, source: "online")
        let fetched = try await cache.cover(song, local: local)
        XCTAssertNotNil(fetched); XCTAssertNotEqual(fetched, embedded); XCTAssertEqual(fixture.stats.requests, 1)
        let offline = try await cache.cover(song, local: local, allowNetwork: false)
        XCTAssertEqual(offline, fetched)
        XCTAssertNil(fixture.stats.first?.value(forHTTPHeaderField: "Cookie"))
        XCTAssertNil(fixture.stats.first?.value(forHTTPHeaderField: "Authorization"))
        online["coverUrl"] = "https://example.invalid/new-cover.jpg"; doc["onlineMetadata"] = online
        let next = try await local.readLyricSources(id)
        _ = try await local.writeLocalMatch(id, token: XCTUnwrap(next["token"] as? String), document: doc, source: "online")
        let fallback = try await cache.cover(song, local: local, allowNetwork: false)
        XCTAssertEqual(fallback, embedded, "Changed URLs must not reuse the old matched cover")
        let imported = try await local.cover(id); XCTAssertEqual(imported, embedded)
    }
    func testLocalMatchUpdatesQueueAndDetachedMetadataWithoutReplacingAudio() async throws {
        let tested = engine(); tested.network.cancel(); defer { tested.stop() }
        let audio = try silentAudio(); defer { try? FileManager.default.removeItem(at: audio) }
        let id = UUID().uuidString
        let original: [String: Any] = ["id": id, "name": "Original", "artists": [], "durationMs": 1000,
            "sourceRef": ["kind": "local", "mediaId": id]]
        tested.queue = [original, original]; tested.index = 0
        let item = AVPlayerItem(url: audio); tested.player.insert(item, after: nil)
        await tested.player.seek(to: CMTime(seconds: 0.4, preferredTimescale: 600))
        let generation = tested.generation, position = tested.player.currentTime().seconds
        var matched = original; matched["name"] = "Matched"
        tested.localMatchChanged(id, song: matched)
        XCTAssertTrue(tested.player.currentItem === item)
        XCTAssertEqual(tested.player.currentTime().seconds, position, accuracy: 0.03)
        XCTAssertEqual(tested.generation, generation); XCTAssertFalse(tested.intentToPlay)
        XCTAssertEqual(tested.queue.compactMap { $0["name"] as? String }, ["Matched", "Matched"])
        try tested.editQueue([], currentIndex: -1, expectedRevision: tested.queueRevision)
        matched["name"] = "Restored"; tested.localMatchChanged(id, song: matched)
        XCTAssertEqual(tested.currentSong?["name"] as? String, "Restored")
        XCTAssertTrue(tested.player.currentItem === item); XCTAssertEqual(tested.generation, generation)
    }
    func testLocalMatchKeepsStereoDecoderAndAudiblePositionDuringPlayback() async throws {
        let audio = try streamingTone(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let suite = "folia.local-match-tests", storage = UserDefaults(suiteName: "folia.local-match-tests")!
        storage.removePersistentDomain(forName: suite)
        let local = LocalMediaLibrary(root: root), song = try await local.importAudio(audio), id = try XCTUnwrap(song["id"] as? String)
        let tested = PlaybackEngine(gateway: FailingGateway(), storage: storage, local: local, usesStereoOutput: true)
        tested.network.cancel()
        defer {
            tested.stop(); tested.clearOutput(); storage.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio)
        }
        try tested.setQueue([song, song], at: 0)
        try await waitForStream { tested.outputIsPlaying && tested.playbackPosition > 0.1 }
        let entry = try XCTUnwrap(tested.stream), output = try XCTUnwrap(tested.streamOutput)
        let position = tested.playbackPosition, generation = tested.generation
        var doc = matchDocument(); doc["useOnlineCover"] = false
        let snapshot = try await local.readLyricSources(id)
        let saved = try await local.writeLocalMatch(id, token: XCTUnwrap(snapshot["token"] as? String), document: doc, source: "online")
        tested.localMatchChanged(id, song: saved)
        XCTAssertTrue(tested.stream === entry); XCTAssertTrue(tested.streamOutput === output)
        XCTAssertEqual(tested.generation, generation); XCTAssertTrue(tested.outputIsPlaying)
        XCTAssertGreaterThanOrEqual(tested.playbackPosition, position)
        XCTAssertEqual(tested.currentSong?["name"] as? String, "Matched title")
        try await waitForStream { tested.playbackPosition > position + 0.2 }
        XCTAssertTrue(tested.stream === entry); XCTAssertNil(tested.error)
    }

}
