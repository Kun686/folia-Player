import XCTest
@testable import App

// LocalAutomaticMatchTests.swift — actual JSCore, atomic storage and stereo playback; provider replies stay offline.
private func localAutomaticGateway(title: String, delay: UInt64 = 0,
    beforeReply: @escaping (LyricFixtureGateway) async throws -> Void = { _ in }) throws -> LyricFixtureGateway {
    var records: [String: [String: Any]] = [:]
    let store = NativeGatewayStore(read: { records[$0] ?? [:] }, write: { records[$0] = $1 }, remove: { records.removeValue(forKey: $0) })
    _ = try store.configure(server: "https://gateway.invalid", token: String(repeating: "test-", count: 8), expected: store.snapshot().scope)
    let gateway = LyricFixtureGateway(credentials: store)
    gateway.handler = { [weak gateway] request, _ in
        guard let gateway else { throw MobileFailure("fixture-released") }
        XCTAssertEqual(request["provider"] as? String, "netease")
        let body: [String: Any]
        switch request["path"] as? String {
        case "/cloudsearch":
            if delay > 0 { try await Task.sleep(nanoseconds: delay) }
            try await beforeReply(gateway)
            body = ["code": 200, "result": ["songCount": 1, "songs": [["id": 42, "name": title,
                "ar": [["id": 1, "name": "Matched artist"]], "al": ["id": 2, "name": "Matched album"], "dt": 20000]]]]
        case "/lyric/new": body = ["code": 200, "lrc": ["lyric": "[00:01.00]Automatic lyric\n[00:03.00]Second line"]]
        case "/song/chorus": body = ["code": 200, "chorus": []]
        default: throw MobileFailure("unexpected-local-match-request")
        }
        return ["status": 200, "body": String(decoding: try JSONSerialization.data(withJSONObject: body), as: UTF8.self)]
    }
    return gateway
}
private let localAutomaticSettings = NativeLyricSettings(autoUseBestLyric: false, preferredAlternativeLyricSource: "qq")

@MainActor extension NativeTests {
    func testLocalAutomaticMatchKeepsStereoPlaybackAndPersistsMetadataAndLyrics() async throws {
        let audio = try streamingTone(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let local = LocalMediaLibrary(root: root), song = try await local.importAudio(audio), id = try XCTUnwrap(song["id"] as? String)
        let gateway = try localAutomaticGateway(title: XCTUnwrap(song["name"] as? String), delay: 600_000_000)
        let suite = "folia.local-auto." + UUID().uuidString, storage = UserDefaults(suiteName: suite)!
        let tested = PlaybackEngine(gateway: gateway, storage: storage, local: local, usesStereoOutput: true)
        tested.network.cancel()
        var catalogChanges = 0, lyricChanges = 0
        tested.localCatalogChanged = { catalogChanges += 1 }; tested.lyricsChanged = { _ in lyricChanges += 1 }
        defer {
            tested.stop(); tested.clearOutput(); storage.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio)
        }
        _ = try tested.setLyricSettings(localAutomaticSettings.dictionary)
        try tested.setQueue([song], at: 0)
        try await waitForStream { tested.outputIsPlaying && tested.playbackPosition > 0.1 }
        let entry = try XCTUnwrap(tested.stream), output = try XCTUnwrap(tested.streamOutput)
        let generation = tested.generation, position = tested.playbackPosition
        try await waitForStream { catalogChanges == 1 }
        XCTAssertTrue(tested.stream === entry); XCTAssertTrue(tested.streamOutput === output)
        XCTAssertEqual(tested.generation, generation); XCTAssertTrue(tested.outputIsPlaying)
        XCTAssertGreaterThan(tested.playbackPosition, position); XCTAssertEqual(lyricChanges, 1)
        XCTAssertEqual((tested.currentSong?["artists"] as? [[String: Any]])?.first?["name"] as? String, "Matched artist")
        XCTAssertEqual(gateway.calls.count, 3)
        tested.stop()
        let reopened = LocalMediaLibrary(root: root), snapshot = try await reopened.readLocalMatch(id)
        let document = try XCTUnwrap(snapshot["document"] as? [String: Any])
        XCTAssertEqual(document["titleOrigin"] as? String, "auto-match")
        XCTAssertEqual(document["matchedLyricsSongId"] as? Int, 42)
        XCTAssertNil(document["hasManualLyricSelection"])
        let native = NativeLyrics(local: reopened, gateway: gateway); defer { native.cancel() }
        _ = native.setSettings(localAutomaticSettings); native.update([song])
        try await waitForStream { native.value(song)?.first?["fullText"] as? String == "Automatic lyric" }
        try await Task.sleep(nanoseconds: 100_000_000)
        // No cover was returned, so another cover-only search is permitted by the original policy.
        XCTAssertNotNil((snapshot["lyrics"] as? [String: Any])?["matched"])
    }

    func testLocalAutomaticBaselineAndExplicitFileSelectionRemainUsableDuringSearch() async throws {
        let audio = try silentAudio(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), song = try await local.importAudio(audio), id = try XCTUnwrap(song["id"] as? String)
        let file = root.appendingPathComponent("file.lrc"); try Data("[00:01.00]Imported lyric".utf8).write(to: file)
        _ = try await local.importLyrics(file, for: id)
        let sources = try await local.readLyricSources(id)
        _ = try await local.selectLyricSource("local", id: id, token: XCTUnwrap(sources["token"] as? String))
        let gateway = try localAutomaticGateway(title: XCTUnwrap(song["name"] as? String), delay: 200_000_000)
        let native = NativeLyrics(local: local, gateway: gateway); defer { native.cancel() }
        var saved = false
        native.localMatched = { _, _ in saved = true }
        _ = native.setSettings(NativeLyricSettings(localLyricsPriority: "online", autoUseBestLyric: false, preferredAlternativeLyricSource: "qq"))
        native.update([song])
        try await waitForStream { native.value(song)?.first?["fullText"] as? String == "Imported lyric" }
        XCTAssertFalse(saved)
        try await waitForStream { saved }
        XCTAssertEqual(native.value(song)?.first?["fullText"] as? String, "Imported lyric")
        let snapshot = try await local.readLyricSources(id)
        XCTAssertEqual(snapshot["lyricsSource"] as? String, "local")
        XCTAssertEqual(snapshot["content"] as? String, "[00:01.00]Imported lyric")
        XCTAssertNotNil(snapshot["matched"])
    }

    func testLocalAutomaticLateResultsRejectManualEditsLibraryChangesLogoutAndCancellation() async throws {
        for kind in ["manual", "library", "logout", "cancel"] {
            let audio = try silentAudio(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
            let local = LocalMediaLibrary(root: root), song = try await local.importAudio(audio), id = try XCTUnwrap(song["id"] as? String)
            var tagged = song; tagged["artists"] = [["id": "", "name": "Imported artist"]]
            try JSONSerialization.data(withJSONObject: tagged).write(to: root.appendingPathComponent(id + "/song.json"), options: .atomic)
            let file = root.appendingPathComponent("manual.lrc"); try Data("[00:01.00]User edit".utf8).write(to: file)
            let gateway = try localAutomaticGateway(title: XCTUnwrap(song["name"] as? String), delay: kind == "cancel" ? 300_000_000 : 0, beforeReply: { gateway in
                switch kind {
                case "manual": _ = try await local.importLyrics(file, for: id)
                case "library":
                    let library = try await local.librarySnapshot()
                    let assignment = try XCTUnwrap((library["assignments"] as? [[String: Any]])?.first { $0["songId"] as? String == id })
                    let artist = try XCTUnwrap((assignment["artistEntityIds"] as? [String])?.first)
                    _ = try await local.editLibrary(revision: XCTUnwrap(library["revision"] as? String),
                        operation: ["type": "rename", "entityId": artist, "displayName": "User artist"])
                case "logout": try gateway.credentials.clearSession("qq", expected: gateway.credentials.snapshot().scope)
                default: break
                }
            })
            var saved = false
            let baseline: [[String: Any]] = [["fullText": "Already available"]]
            let work = Task { await NativeLocalAutomaticMatch.load(id, local: local, parser: NativeLyricParser(), gateway: gateway,
                settings: localAutomaticSettings, baseline: baseline, saved: { _, _ in saved = true }) }
            if kind == "cancel" { try await waitForStream { !gateway.calls.isEmpty }; work.cancel() }
            let result = await work.value
            XCTAssertEqual(result?.first?["fullText"] as? String, "Already available", kind)
            XCTAssertFalse(saved, kind)
            let latest = try await local.readLocalMatch(id)
            XCTAssertNil(latest["document"], kind)
            if kind == "manual" { XCTAssertEqual((latest["lyrics"] as? [String: Any])?["content"] as? String, "[00:01.00]User edit") }
        }
    }

    func testConcurrentCurrentAndNextLocalMatchesBothCommitWithoutDiscardingEachOther() async throws {
        let audio = try silentAudio(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), first = try await local.importAudio(audio), second = try await local.importAudio(audio)
        let gateway = try localAutomaticGateway(title: XCTUnwrap(first["name"] as? String), beforeReply: { gateway in
            for _ in 0..<100 {
                if gateway.calls.count >= 2 { return }
                try await Task.sleep(nanoseconds: 10_000_000)
            }
            throw MobileFailure("second-local-match-missing")
        })
        let parser = NativeLyricParser()
        var saved = 0
        let complete: ([String: Any], [[String: Any]]?) async -> Void = { _, _ in await MainActor.run { saved += 1 } }
        async let a = NativeLocalAutomaticMatch.load(XCTUnwrap(first["id"] as? String), local: local, parser: parser, gateway: gateway,
            settings: localAutomaticSettings, baseline: nil, saved: complete)
        async let b = NativeLocalAutomaticMatch.load(XCTUnwrap(second["id"] as? String), local: local, parser: parser, gateway: gateway,
            settings: localAutomaticSettings, baseline: nil, saved: complete)
        let result = try await (a, b)
        XCTAssertEqual(result.0?.first?["fullText"] as? String, "Automatic lyric")
        XCTAssertEqual(result.1?.first?["fullText"] as? String, "Automatic lyric")
        XCTAssertEqual(saved, 2); XCTAssertEqual(gateway.calls.count, 6)
    }

    func testLocalAutomaticCommitRevalidatesSessionAfterParserHop() async throws {
        let audio = try silentAudio(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), song = try await local.importAudio(audio), id = try XCTUnwrap(song["id"] as? String)
        let gateway = try localAutomaticGateway(title: "unused"), transport = try NativeLyricMatchTransport(gateway: gateway)
        let snapshot = try await local.readLyricSources(id)
        var validations = 0
        do {
            _ = try await local.writeLocalMatch(id, token: XCTUnwrap(snapshot["token"] as? String),
                document: ["title": "Late", "titleOrigin": "auto-match", "artistNames": []], source: nil, validate: {
                    validations += 1
                    if validations == 2 { try gateway.credentials.clearSession("qq", expected: transport.record.scope) }
                    try transport.validate()
                })
            XCTFail("Revoked session committed")
        } catch { XCTAssertEqual((error as? MobileFailure)?.code, "lyric-session-changed") }
        XCTAssertEqual(validations, 2)
        let latest = try await local.readLocalMatch(id); XCTAssertNil(latest["document"])
    }
}
