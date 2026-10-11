import XCTest
import AVFoundation
@testable import App

// LocalLyricSourcesTests.swift — actual audio tags, legacy provenance, source persistence and native playback lyrics.
@MainActor extension NativeTests {
    private func audioWithLyrics(_ text: String) async throws -> URL {
        let input = try silentAudio(), output = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".m4a")
        defer { try? FileManager.default.removeItem(at: input) }
        let session = try XCTUnwrap(AVAssetExportSession(asset: AVURLAsset(url: input), presetName: AVAssetExportPresetAppleM4A))
        let tag = AVMutableMetadataItem(); tag.identifier = .iTunesMetadataLyrics; tag.value = text as NSString
        session.metadata = [tag]; session.outputURL = output; session.outputFileType = .m4a
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            session.exportAsynchronously { continuation.resume() }
        }
        guard session.status == .completed else {
            try? FileManager.default.removeItem(at: output)
            throw session.error ?? NSError(domain: "FoliaTestExport", code: 1)
        }
        return output
    }
    func testEmbeddedAndImportedLyricsKeepIndependentPayloadsAcrossSelectionAndRestart() async throws {
        let text = "[00:00.00]Embedded lyric\n[00:01.00]Tag ending"
        let audio = try await audioWithLyrics(text), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), song = try await local.importAudio(audio), id = try XCTUnwrap(song["id"] as? String)
        let initial = try await local.readLyricSources(id)
        XCTAssertEqual(initial["embeddedContent"] as? String, text); XCTAssertEqual(initial["content"] as? String, "")
        let compatibility = try await local.lyricSource(id)
        XCTAssertEqual(compatibility?.content, text) // Older builds ignore new fields but still see the original text.
        do { _ = try await local.selectLyricSource("local", id: id, token: XCTUnwrap(initial["token"] as? String)); XCTFail("Compatibility text offered as an imported source") } catch {}
        let file = root.appendingPathComponent("import.lrc"); try Data("[00:00.00]Imported lyric".utf8).write(to: file)
        let picked = try await local.readLyricFile(file, for: id)
        _ = try await local.saveDecodedLyrics("[00:00.00]Imported lyric", fileName: "import.lrc", for: id, token: XCTUnwrap(picked["token"] as? String))
        let imported = try await local.readLyricSources(id)
        XCTAssertEqual(imported["embeddedContent"] as? String, text); XCTAssertEqual(imported["lyricsSource"] as? String, "local")
        let selected = try await local.selectLyricSource("embedded", id: id, token: XCTUnwrap(imported["token"] as? String))
        XCTAssertEqual(selected["content"] as? String, "[00:00.00]Imported lyric")
        let reopened = LocalMediaLibrary(root: root), snapshot = try await reopened.readLyricSources(id)
        XCTAssertEqual(snapshot["lyricsSource"] as? String, "embedded"); XCTAssertEqual(snapshot["fileName"] as? String, "import.lrc")
        let native = NativeLyrics(local: reopened); defer { native.cancel() }
        native.update([song])
        try await waitForStream { native.value(song)?.first?["fullText"] as? String == "Embedded lyric" }
        _ = try await reopened.selectLyricSource("local", id: id, token: XCTUnwrap(snapshot["token"] as? String))
        native.invalidate(id); native.update([song])
        try await waitForStream { native.value(song)?.first?["fullText"] as? String == "Imported lyric" }
        do { _ = try await reopened.selectLyricSource("embedded", id: id, token: XCTUnwrap(snapshot["token"] as? String)); XCTFail("Stale selection accepted") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "local-lyrics-changed") }
        let next = try await reopened.readLyricFile(file, for: id)
        _ = try await reopened.saveDecodedLyrics("[00:00.00]New import", fileName: "new.lrc", for: id, token: XCTUnwrap(next["token"] as? String))
        let saved = try await reopened.readLyricSources(id)
        XCTAssertEqual(saved["lyricsSource"] as? String, "local"); XCTAssertEqual(saved["embeddedContent"] as? String, text)
    }
    func testLegacyLyricMigrationChecksAudioTagInsteadOfGuessingTextProvenance() async throws {
        let text = "[00:00.00]Original audio tag", audio = try await audioWithLyrics(text)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root)
        for legacyText in [text, "[00:00.00]Legacy manual import"] {
            let song = try await local.importAudio(audio), id = try XCTUnwrap(song["id"] as? String), folder = root.appendingPathComponent(id)
            try FileManager.default.removeItem(at: folder.appendingPathComponent("lyrics.json"))
            try Data(legacyText.utf8).write(to: folder.appendingPathComponent("lyrics.txt"))
            let result = try await local.readLyricSources(id)
            XCTAssertEqual(result["content"] as? String, legacyText == text ? "" : legacyText)
            XCTAssertEqual(result["embeddedContent"] as? String, text)
            let compatibility = try await local.lyricSource(id)
            XCTAssertEqual(compatibility?.content, legacyText)
            let reopened = try await LocalMediaLibrary(root: root).readLyricSources(id)
            XCTAssertEqual(reopened["content"] as? String, result["content"] as? String)
        }
    }
    func testLocalLyricSourceRejectsUnavailableSelectionAndConcurrentStaleWrites() async throws {
        let audio = try silentAudio(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), song = try await local.importAudio(audio), id = try XCTUnwrap(song["id"] as? String)
        let file = root.appendingPathComponent("import.lrc"); try Data("[00:00.00]Kept".utf8).write(to: file)
        _ = try await local.importLyrics(file, for: id)
        let snapshot = try await local.readLyricSources(id), token = try XCTUnwrap(snapshot["token"] as? String)
        for source in ["embedded", "online", "invalid"] {
            do { _ = try await local.selectLyricSource(source, id: id, token: token); XCTFail("Unavailable source accepted") } catch {}
        }
        let tasks = (0..<2).map { _ in Task { () -> Bool in
            do { _ = try await local.selectLyricSource("local", id: id, token: token); return true } catch { return false }
        } }
        var successes = 0
        for task in tasks { if await task.value { successes += 1 } }
        XCTAssertEqual(successes, 1)
        let saved = try await local.readLyricSources(id); XCTAssertEqual(saved["content"] as? String, "[00:00.00]Kept")
        try await local.remove(id)
        do { _ = try await local.selectLyricSource("local", id: id, token: XCTUnwrap(saved["token"] as? String)); XCTFail("Deleted song recreated") } catch {}
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(id).path))
    }
    func testOversizeEmbeddedTagDoesNotHideOrBlockImportedLyrics() async throws {
        let audio = try await audioWithLyrics(String(repeating: "x", count: 2_000_001))
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), song = try await local.importAudio(audio), id = try XCTUnwrap(song["id"] as? String)
        let metadata = try await AVURLAsset(url: audio).load(.metadata)
        do { _ = try await LocalMediaLibrary.embeddedLyrics(metadata, parser: NativeLyricParser()); XCTFail("Oversize tag accepted") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "lyrics-too-large") }
        let legacy = root.appendingPathComponent(id).appendingPathComponent("lyrics.txt")
        try Data("[00:00.00]Kept import".utf8).write(to: legacy)
        let snapshot = try await local.readLyricSources(id)
        XCTAssertEqual(snapshot["content"] as? String, "[00:00.00]Kept import")
        XCTAssertNil(snapshot["embeddedContent"])
        _ = try await local.saveDecodedLyrics("[00:00.00]Replacement", fileName: "new.lrc", for: id,
            token: XCTUnwrap(snapshot["token"] as? String))
        let reopened = try await LocalMediaLibrary(root: root).readLyricSources(id)
        XCTAssertEqual(reopened["content"] as? String, "[00:00.00]Replacement")
        XCTAssertEqual(reopened["lyricsSource"] as? String, "local")
        let parser = NativeLyricParser(), data = try await parser.localSources(reopened)
        let lines = try JSONSerialization.jsonObject(with: XCTUnwrap(data)) as? [[String: Any]]
        XCTAssertEqual(lines?.first?["fullText"] as? String, "Replacement")
    }
}
