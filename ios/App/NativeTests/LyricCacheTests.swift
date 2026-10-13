import XCTest
@testable import App

// LyricCacheTests.swift — parsed renderer data survives relaunch; native playback consumes it without a WebView or gateway.
@MainActor extension NativeTests {
    func testPlayingLegacyLyricsRecoversIdentityWithoutReplacingSelections() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = NativeLyricCache(root: root)
        let lyrics: [String: Any] = ["lines": [["startTime": 1, "endTime": 3, "fullText": "用户保存的歌词", "words": []]]]
        for provider in ["qq", "netease"] {
            var track = song(provider, "42"); track["cookie"] = "private-cookie"
            track["album"] = ["name": "专辑", "coverUrl": "https://private.invalid/cover?signature=secret"]
            let token = try await cache.read(track)["token"] as! String
            try await cache.write(track, token: token, field: "state", value: ["lyricsSource": "imported", "importedLyrics": lyrics])
            let file = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: root.appendingPathComponent(provider), includingPropertiesForKeys: nil).first)
            var record = try NativeLyricExport.record(file); record.removeValue(forKey: "song")
            try JSONSerialization.data(withJSONObject: record).write(to: file)
            let snapshot = try await cache.read(track)
            XCTAssertEqual(snapshot["token"] as? String, token)
            let repaired = try NativeLyricExport.record(file)
            XCTAssertEqual(NSDictionary(dictionary: repaired["payload"] as! [String: Any]), NSDictionary(dictionary: record["payload"] as! [String: Any]))
            XCTAssertNotNil(NativeLyricExport.song(repaired))
            XCTAssertFalse(String(data: try Data(contentsOf: file), encoding: .utf8)!.contains("private"))
            let saved = try Data(contentsOf: file)
            _ = try await cache.read(track)
            XCTAssertEqual(try Data(contentsOf: file), saved)
        }
        let restored = NativeLyricCache(root: root)
        let inventory = try await restored.exportInventory(knownSongs: [])
        let items = try XCTUnwrap(inventory["entries"] as? [[String: Any]])
        XCTAssertEqual(items.count, 2)
        XCTAssertTrue(items.allSatisfy { $0["song"] != nil })
    }
    func testLegacyIdentityRepairPreservesLatestPayloadAndNeverCreatesMissingFiles() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = NativeLyricCache(root: root), track = song("qq", "42")
        let token = try await cache.read(track)["token"] as! String
        try await cache.write(track, token: token, field: "lyrics", value: ["lines": []])
        let file = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: root.appendingPathComponent("qq"), includingPropertiesForKeys: nil).first)
        var latest = try NativeLyricExport.record(file); latest.removeValue(forKey: "song")
        latest["payload"] = ["state": ["hasOnlineOverride": true, "matchedIsPureMusic": true, "onlineOverrideLyrics": NSNull()]]
        try JSONSerialization.data(withJSONObject: latest).write(to: file)
        let unchanged = try Data(contentsOf: file)
        XCTAssertThrowsError(try NativeLyricExport.recoverMetadata(song("netease", "42"), at: file))
        XCTAssertEqual(try Data(contentsOf: file), unchanged)
        try NativeLyricExport.recoverMetadata(track, at: file)
        XCTAssertEqual(NSDictionary(dictionary: try NativeLyricExport.record(file)["payload"] as! [String: Any]), NSDictionary(dictionary: latest["payload"] as! [String: Any]))
        try await cache.clear(provider: "qq")
        XCTAssertThrowsError(try NativeLyricExport.recoverMetadata(track, at: file))
        _ = try await cache.read(track)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }
    func testLyricExportInventoryRestoresIdentitiesAndRawSelectionsWithoutSecrets() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = NativeLyricCache(root: root)
        let lyrics: [String: Any] = ["lines": [["startTime": 0, "endTime": 2, "fullText": "作词：原作者", "words": []]]]
        for provider in ["qq", "netease"] {
            var track = song(provider, "42"); track["cookie"] = "private-cookie"
            track["url"] = "https://private.invalid/audio?signature=secret"
            track["album"] = ["name": "专辑", "coverUrl": "https://private.invalid/cover?signature=secret"]
            let token = try await cache.read(track)["token"] as! String
            try await cache.write(track, token: token, field: "state", value: ["lyricsSource": "imported", "importedLyrics": lyrics])
        }
        let restored = NativeLyricCache(root: root)
        let inventory = try await restored.exportInventory(knownSongs: [])
        let items = try XCTUnwrap(inventory["entries"] as? [[String: Any]])
        XCTAssertEqual(items.count, 2)
        XCTAssertFalse(String(data: try JSONSerialization.data(withJSONObject: items), encoding: .utf8)!.contains("private"))
        for item in items {
            let track = try XCTUnwrap(item["song"] as? [String: Any])
            XCTAssertEqual((track["sourceRef"] as? [String: Any])?["mediaId"] as? String, "42")
            let read = try await restored.exportRead(key: item["key"] as! String, token: inventory["token"] as! String)
            let payload = try XCTUnwrap(read["payload"] as? [String: Any])
            XCTAssertEqual((payload["state"] as? [String: Any])?["lyricsSource"] as? String, "imported")
        }
        try await restored.clear(provider: "qq")
        do { _ = try await restored.exportRead(key: items[0]["key"] as! String, token: inventory["token"] as! String); XCTFail("Stale export read") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "lyric-cache-changed") }
        do { try await restored.validateExport(inventory["token"] as! String); XCTFail("Stale export share") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "lyric-cache-changed") }
        let retained = try await restored.exportInventory(knownSongs: [])
        XCTAssertEqual((retained["entries"] as? [[String: Any]])?.count, 1)
    }
    func testLyricExportRetainsLegacyRecordsAndRecoversOnlyVerifiedQueueIdentities() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = NativeLyricCache(root: root), track = song("qq", "42")
        let token = try await cache.read(track)["token"] as! String
        try await cache.write(track, token: token, field: "lyrics", value: ["lines": []])
        let file = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: root.appendingPathComponent("qq"), includingPropertiesForKeys: nil).first)
        var record = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
        record.removeValue(forKey: "song")
        try JSONSerialization.data(withJSONObject: record).write(to: file)
        let original = try Data(contentsOf: file)
        let missing = try await cache.exportInventory(knownSongs: [song("qq", "wrong")])
        let item = try XCTUnwrap((missing["entries"] as? [[String: Any]])?.first)
        XCTAssertNil(item["song"])
        let raw = try await cache.exportRead(key: item["key"] as! String, token: missing["token"] as! String)
        XCTAssertNotNil((raw["payload"] as? [String: Any])?["lyrics"])
        let recovered = try await cache.exportInventory(knownSongs: [track])
        XCTAssertNotNil((recovered["entries"] as? [[String: Any]])?.first?["song"])
        XCTAssertEqual(try Data(contentsOf: file), original)
        for key in ["../outside", "qq/../../private", "qq/short", "/qq/" + String(repeating: "a", count: 64)] {
            do { _ = try await cache.exportRead(key: key, token: missing["token"] as! String); XCTFail("Invalid cache key accepted") }
            catch { XCTAssertEqual((error as? MobileFailure)?.code, "invalid-lyric-identity") }
        }
        try Data("corrupt".utf8).write(to: file)
        do { _ = try await cache.exportInventory(knownSongs: []); XCTFail("Corruption reported as an empty/successful export") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "invalid-lyric-cache") }
    }
    func lyricCacheFixture(_ name: String) throws -> (song: [String: Any], replies: [[String: Any]]) {
        let row = try XCTUnwrap(onlineLyricFixture().first { $0["name"] as? String == name })
        let steps = try XCTUnwrap(row["steps"] as? [[String: Any]])
        let input = try XCTUnwrap(steps.last?["input"] as? [String: Any])
        return (try XCTUnwrap(input["song"] as? [String: Any]), try XCTUnwrap(input["responses"] as? [[String: Any]]))
    }
    func testFullOnlineLyricCacheRestoresWordsTranslationsAndNativePlanningOffline() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = NativeLyricCache(root: root)
        for name in ["netease-yrc", "qq-qrc"] {
            let fixture = try lyricCacheFixture(name), gateway = LyricFixtureGateway()
            gateway.handler = { _, count in fixture.replies[count - 1] }
            let lines = try await cache.lines(fixture.song, session: ["cookie": "test-private-cookie"], gateway: gateway)
            XCTAssertEqual(lines?.last?["endTime"] as? Double, 26)
            let restored = NativeLyricCache(root: root), snapshot = try await restored.read(fixture.song)
            let payload = try XCTUnwrap(snapshot["payload"] as? [String: Any]), lyrics = try XCTUnwrap(payload["lyrics"] as? [String: Any])
            let fullLines = try XCTUnwrap(lyrics["lines"] as? [[String: Any]])
            XCTAssertFalse((fullLines.first?["words"] as? [[String: Any]])?.isEmpty ?? true)
            if name == "qq-qrc" {
                XCTAssertEqual(fullLines.first?["translation"] as? String, "翻译")
                XCTAssertEqual(fullLines.first?["romanization"] as? String, "Fan yi")
            }
            let offline = LyricFixtureGateway()
            let hits = NativeLyrics(local: LocalMediaLibrary(), gateway: offline, cache: restored, session: { _ in [:] })
            hits.update([fixture.song]); defer { hits.cancel() }
            try await waitForStream { hits.value(fixture.song) != nil }
            XCTAssertEqual(hits.value(fixture.song)?.last?["endTime"] as? Double, 26)
            XCTAssertEqual(offline.calls.count, 0)
        }
        for provider in ["qq", "netease"] {
            for file in try FileManager.default.contentsOfDirectory(at: root.appendingPathComponent(provider), includingPropertiesForKeys: nil) {
                let text = try String(contentsOf: file, encoding: .utf8)
                XCTAssertFalse(text.contains("test-private-cookie")); XCTAssertFalse(text.contains("/mobile/request"))
            }
        }
    }
    func testLateProviderLyricsCannotReplaceImportedSelectionOrInstrumentalState() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = try lyricCacheFixture("netease-yrc"), gateway = LyricFixtureGateway(), cache = NativeLyricCache(root: root)
        gateway.handler = { _, _ in try? await Task.sleep(nanoseconds: 200_000_000); return fixture.replies[0] }
        let work = Task { try await cache.lines(fixture.song, session: [:], gateway: gateway) }
        try await waitForStream { gateway.calls.count == 1 }
        let snapshot = try await cache.read(fixture.song), token = try XCTUnwrap(snapshot["token"] as? String)
        let imported: [String: Any] = ["lines": [["startTime": 4, "endTime": 12, "fullText": "导入选择", "words": []]]]
        try await cache.write(fixture.song, token: token, field: "state", value: ["lyricsSource": "imported", "importedLyrics": imported])
        let result = try await work.value; XCTAssertEqual(result?.first?["fullText"] as? String, "导入选择")
        let persisted = try await cache.read(fixture.song)
        XCTAssertNotNil((persisted["payload"] as? [String: Any])?["lyrics"])
        try await cache.write(fixture.song, token: token, field: "state", value: ["lyricsSource": "online", "hasOnlineOverride": true,
            "onlineOverrideLyrics": NSNull(), "matchedIsPureMusic": true])
        let pure = try await cache.lines(fixture.song, session: [:], gateway: gateway)
        XCTAssertNil(pure); XCTAssertEqual(gateway.calls.count, 1)
    }
    func testLyricClearRevokesTokensAndLateResponsesWithoutClearingAnotherProvider() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = NativeLyricCache(root: root), qq = song("qq", "same"), netease = song("netease", "42")
        let empty: [String: Any] = ["lines": []]
        let qqToken = try await cache.read(qq)["token"] as! String
        try await cache.write(qq, token: qqToken, field: "lyrics", value: empty)
        let token = try await cache.read(netease)["token"] as! String
        let fixture = try lyricCacheFixture("netease-yrc"), gateway = LyricFixtureGateway()
        gateway.handler = { _, _ in try? await Task.sleep(nanoseconds: 200_000_000); return fixture.replies[0] }
        let work = Task { try await cache.lines(netease, session: [:], gateway: gateway) }
        try await waitForStream { gateway.calls.count == 1 }
        try await cache.clear(provider: "netease")
        do { _ = try await work.value; XCTFail("Old response published") } catch { XCTAssertTrue(error is CancellationError) }
        do { try await cache.write(netease, token: token, field: "lyrics", value: empty); XCTFail("Old token accepted") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "lyric-cache-changed") }
        let retained = await cache.summary(); XCTAssertEqual(retained["count"], 1)
        let old = try await cache.read(netease)["payload"] as? [String: Any]; XCTAssertEqual(old?.count, 0)
        let other = try await cache.read(qq)["payload"] as? [String: Any]; XCTAssertNotNil(other?["lyrics"])
    }
    func testLyricCacheSeparatesVariantsAndRepairsCorruptionWithinItsLimit() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = NativeLyricCache(root: root), fixture = try lyricCacheFixture("netease-yrc")
        let clean = fixture.song; var cloud = clean
        var ref = cloud["sourceRef"] as! [String: Any]; ref["variant"] = "cloud"; cloud["sourceRef"] = ref
        for song in [clean, cloud] {
            let token = try await cache.read(song)["token"] as! String
            try await cache.write(song, token: token, field: "lyrics", value: ["lines": []])
        }
        let summary = await cache.summary(); XCTAssertEqual(summary["count"], 2)
        for file in try FileManager.default.contentsOfDirectory(at: root.appendingPathComponent("netease"), includingPropertiesForKeys: nil) {
            var record = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
            record["payload"] = ["state": ["lyricsSource": "broken"]]
            try JSONSerialization.data(withJSONObject: record).write(to: file)
        }
        let repaired = try await cache.read(clean)
        XCTAssertEqual((repaired["payload"] as? [String: Any])?.count, 0)
        try await cache.write(clean, token: repaired["token"] as! String, field: "lyrics", value: ["lines": []])
        let recovered = try await cache.read(clean); XCTAssertNotNil((recovered["payload"] as? [String: Any])?["lyrics"])
        let limited = NativeLyricCache(root: root, limit: 1)
        let token = try await limited.read(clean)["token"] as! String
        try await limited.write(clean, token: token, field: "lyrics", value: ["lines": []])
        let evicted = await limited.summary(); XCTAssertEqual(evicted["count"], 0)
        try await limited.write(clean, token: token, field: "state", value: ["lyricsSource": "imported", "importedLyrics": ["lines": []]])
        let protected = await limited.summary(); XCTAssertEqual(protected["count"], 1)
        try await limited.clear()
        let cleared = await limited.summary(); XCTAssertEqual(cleared["count"], 0)
    }
    func testCachedOnlineLyricsScheduleCrossProviderQueueWithoutGatewayOrWebView() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), audio = try sharedConstantFile(seconds: 30, stereo: true)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let cache = NativeLyricCache(root: root); var songs: [[String: Any]] = []
        for name in ["netease-yrc", "qq-qrc"] {
            let fixture = try lyricCacheFixture(name), gateway = LyricFixtureGateway()
            gateway.handler = { _, count in fixture.replies[count - 1] }
            _ = try await cache.lines(fixture.song, session: [:], gateway: gateway); songs.append(fixture.song)
        }
        let offline = LyricFixtureGateway(); offline.audioURL = audio
        let restored = NativeLyricCache(root: root), local = LocalMediaLibrary()
        let lyrics = NativeLyrics(local: local, gateway: offline, cache: restored, session: { _ in [:] })
        let suite = "folia.offline-lyrics." + UUID().uuidString, storage = UserDefaults(suiteName: suite)!
        defer { storage.removePersistentDomain(forName: suite) }
        let engine = PlaybackEngine(gateway: offline, storage: storage, local: local, usesStereoOutput: true, lyricCache: restored)
        engine.network.cancel(); engine.crossfade = NativeCrossfade(owner: engine, lyrics: lyrics)
        defer { engine.stop(); engine.clearOutput() }
        _ = try engine.setTransitionSettings(["enabled": true, "mode": "automix", "crossfadeMaxSec": 5.0])
        try engine.setQueue(songs, at: 0)
        try await waitForStream { engine.outputIsPlaying && engine.preparedStream != nil && lyrics.value(songs[0]) != nil && lyrics.value(songs[1]) != nil }
        try engine.command("seek", position: 23)
        try await waitForStream { engine.playbackPosition > 24 || engine.index == 1 }
        XCTAssertEqual(engine.index, 0)
        let outgoing = try XCTUnwrap(engine.stream)
        try engine.command("seek", position: 25.4)
        try await waitForStream { engine.index == 1 && engine.crossfade?.isFading == true }
        XCTAssertGreaterThanOrEqual(outgoing.position, 25.9); XCTAssertLessThan(outgoing.position, 26.8)
        XCTAssertEqual(offline.calls.count, 0)
    }
    func testOrdinaryQueueSchedulesCurrentAndNextLyricsWithoutCrossfadeOrPreparedAudio() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = NativeLyricCache(root: root), local = LocalMediaLibrary(), offline = LyricFixtureGateway()
        let songs = [song("netease", "42"), song("qq", "43")]
        for (index, track) in songs.enumerated() {
            let snapshot = try await cache.read(track)
            try await cache.write(track, token: snapshot["token"] as! String, field: "lyrics",
                value: ["lines": [["startTime": 0, "endTime": 4 + index, "fullText": "缓存", "words": []]]])
        }
        let suite = "folia.lyric-queue." + UUID().uuidString, storage = UserDefaults(suiteName: suite)!
        defer { storage.removePersistentDomain(forName: suite) }
        let engine = PlaybackEngine(gateway: offline, storage: storage, local: local, usesStereoOutput: true, lyricCache: cache)
        engine.network.cancel()
        defer { engine.stop(); engine.clearOutput() }
        let lyrics = NativeLyrics(local: local, gateway: offline, cache: cache, session: { _ in [:] })
        engine.crossfade = NativeCrossfade(owner: engine, lyrics: lyrics)
        XCTAssertFalse(engine.crossfade!.enabled)
        engine.queue = songs; engine.index = 0; engine.intentToPlay = true; engine.repeatMode = "one"
        engine.publish()
        try await waitForStream { lyrics.value(songs[0]) != nil }
        XCTAssertNil(lyrics.value(songs[1]))
        engine.repeatMode = "off"; engine.publish()
        try await waitForStream { lyrics.value(songs[1]) != nil }
        XCTAssertEqual(lyrics.value(songs[1])?.first?["endTime"] as? Double, 5)
        engine.index = 1; engine.publish()
        try await waitForStream { lyrics.value(songs[0]) == nil }
        XCTAssertNotNil(lyrics.value(songs[1]))
        _ = lyrics.setSettings(NativeLyricSettings(autoUseBestLyric: true, preferredAlternativeLyricSource: "qq"))
        engine.index = 0; engine.publish()
        try await waitForStream { lyrics.value(songs[0]) != nil && lyrics.value(songs[1]) != nil }
        lyrics.invalidateProvider("kugou")
        XCTAssertNil(lyrics.value(songs[0])); XCTAssertNil(lyrics.value(songs[1]))
        XCTAssertEqual(offline.calls.count, 0)
    }

}
