import XCTest
import AVFoundation
@testable import App

// LocalTrackOrderTests.swift — actual tagged audio, desktop golden values, retained-file upgrade and edit preservation.
@MainActor extension NativeTests {
    private func orderSamples() throws -> [[String: Any]] {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "LocalTrackOrderReference", withExtension: "json"))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        return try XCTUnwrap(json["cases"] as? [[String: Any]])
    }
    private func orderAudio(_ sample: [String: Any]) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            .appendingPathExtension(try XCTUnwrap(sample["extension"] as? String))
        try XCTUnwrap(Data(base64Encoded: XCTUnwrap(sample["audioBase64"] as? String))).write(to: url)
        try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSince1970: 1_500_000_000)], ofItemAtPath: url.path)
        return url
    }
    private func legacyOrderFile(_ local: LocalMediaLibrary, id: String) async throws -> URL {
        let file = try await local.directory(id).appendingPathComponent("song.json")
        var song = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        for key in ["trackNumber", "discNumber", "trackOrderVersion", "fileLastModified", "fileSize"] { song.removeValue(forKey: key) }
        try JSONSerialization.data(withJSONObject: song).write(to: file, options: .atomic)
        return file
    }
    func testRealMP3M4AFLACTrackOrderMatchesDesktopAndSurvivesRestart() async throws {
        for sample in try orderSamples() {
            let audio = try orderAudio(sample), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
            let local = LocalMediaLibrary(root: root), song = try await local.importAudio(audio)
            let expected = try XCTUnwrap(sample["expected"] as? [String: Int]), label = sample["extension"] as? String ?? ""
            for key in ["trackNumber", "discNumber"] { XCTAssertEqual(song[key] as? Int, expected[key], label) }
            XCTAssertEqual(song["trackOrderVersion"] as? Int, LocalMediaLibrary.trackOrderVersion)
            XCTAssertEqual(try XCTUnwrap(song["fileLastModified"] as? Double), 1_500_000_000_000, accuracy: 1)
            XCTAssertEqual(song["fileSize"] as? Int, try Data(contentsOf: audio).count)
            let snapshot = try await LocalMediaLibrary(root: root).librarySnapshot()
            let editor = try XCTUnwrap((snapshot["editorSongs"] as? [[String: Any]])?.first)
            for key in ["trackNumber", "discNumber"] { XCTAssertEqual(editor[key] as? Int, expected[key], label) }
        }
    }
    func testLegacyTrackOrderUpgradePreservesImportedLyricsMatchesEntitiesAndAudio() async throws {
        let audio = try orderAudio(XCTUnwrap(orderSamples().first)), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), song = try await local.importAudio(audio), id = try XCTUnwrap(song["id"] as? String)
        let lyric = root.appendingPathComponent("manual.lrc"); try Data("[00:01]Manual lyric".utf8).write(to: lyric)
        _ = try await local.importLyrics(lyric, for: id)
        let before = try await local.readLocalMatch(id)
        let document: [String: Any] = ["title": "Manual title", "titleOrigin": "manual-match", "artistNames": ["Matched artist"], "albumName": "Matched album"]
        _ = try await local.writeLocalMatch(id, token: XCTUnwrap((before["lyrics"] as? [String: Any])?["token"] as? String), document: document, source: "local")
        let matched = try await local.librarySnapshot()
        let artist = try XCTUnwrap(((matched["assignments"] as? [[String: Any]])?.first?["artistEntityIds"] as? [String])?.first)
        _ = try await local.editLibrary(revision: XCTUnwrap(matched["revision"] as? String),
            operation: ["type": "rename", "entityId": artist, "displayName": "Manual artist"])
        let folder = try await local.directory(id), audioFile = try await local.resolve(id)
        let protected = [folder.appendingPathComponent("lyrics.json"), root.appendingPathComponent("library-entities.json"), audioFile]
        let bytes = try protected.map { try Data(contentsOf: $0) }
        let file = try await legacyOrderFile(local, id: id)
        async let first: Void = local.refreshTrackOrder()
        async let second: Void = local.refreshTrackOrder()
        _ = try await (first, second)
        let upgraded = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        XCTAssertEqual(upgraded["trackNumber"] as? Int, 2); XCTAssertEqual(upgraded["discNumber"] as? Int, 3)
        XCTAssertEqual(upgraded["fileLastModified"] as? Double, 1_500_000_000_000)
        XCTAssertEqual(try protected.map { try Data(contentsOf: $0) }, bytes)
        let reopened = LocalMediaLibrary(root: root), snapshot = try await reopened.librarySnapshot()
        XCTAssertEqual((snapshot["songs"] as? [[String: Any]])?.first?["name"] as? String, "Manual title")
        XCTAssertEqual(((snapshot["songs"] as? [[String: Any]])?.first?["artists"] as? [[String: Any]])?.first?["name"] as? String, "Manual artist")
        let stable = try Data(contentsOf: file)
        try await reopened.refreshTrackOrder(); XCTAssertEqual(try Data(contentsOf: file), stable)
        var future = upgraded; future["trackOrderVersion"] = 2; future["trackNumber"] = 99
        try JSONSerialization.data(withJSONObject: future).write(to: file)
        let newer = try Data(contentsOf: file)
        try await reopened.refreshTrackOrder(); XCTAssertEqual(try Data(contentsOf: file), newer)
    }
    func testTrackOrderCancellationAndMissingAudioRetainCatalog() async throws {
        let audio = try silentAudio(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), song = try await local.importAudio(audio), id = try XCTUnwrap(song["id"] as? String)
        let file = try await legacyOrderFile(local, id: id), original = try Data(contentsOf: file)
        let task = Task { withUnsafeCurrentTask { $0?.cancel() }; try await local.refreshTrackOrder() }
        do { try await task.value; XCTFail("Cancelled upgrade succeeded") } catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(try Data(contentsOf: file), original)
        let retained = try await local.resolve(id); try FileManager.default.removeItem(at: retained)
        try await local.refreshTrackOrder()
        XCTAssertEqual(try Data(contentsOf: file), original)
        let catalog = try await local.catalog(); XCTAssertEqual(catalog.count, 1)
        try FileManager.default.copyItem(at: audio, to: retained)
        try await local.refreshTrackOrder()
        let upgraded = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        XCTAssertNil(upgraded["trackNumber"]); XCTAssertEqual(upgraded["trackOrderVersion"] as? Int, 1)
        try await local.remove(id); try await local.refreshTrackOrder()
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }
    func testSystemTrackTagBoundsAndParserRecovery() async throws {
        let parser = NativeLyricParser(), bad = AVMutableMetadataItem()
        bad.identifier = .iTunesMetadataTrackNumber; bad.value = Data(count: 9) as NSData
        do { _ = try await LocalMediaLibrary.trackOrder([bad], parser: parser); XCTFail("Oversize binary accepted") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "invalid-track-metadata") }
        let valid = AVMutableMetadataItem(); valid.identifier = .id3MetadataTrackNumber; valid.value = "02/12" as NSString
        let recovered = try await LocalMediaLibrary.trackOrder([valid], parser: parser)
        XCTAssertEqual(recovered["trackNumber"] as? Int, 2)
    }
}
