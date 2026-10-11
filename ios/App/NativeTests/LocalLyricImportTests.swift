import XCTest
@testable import App

// LocalLyricImportTests.swift — real file coordination, native validation, atomic persistence and edit ownership.
@MainActor extension NativeTests {
    func testLocalLyricPickPreservesRawBytesUntilValidatedCommit() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let audio = try silentAudio(), local = LocalMediaLibrary(root: root)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let song = try await local.importAudio(audio), id = try XCTUnwrap(song["id"] as? String)
        let file = root.appendingPathComponent("原歌词.lrc")
        try Data("[00:01.00]Previous".utf8).write(to: file)
        _ = try await local.importLyrics(file, for: id)
        let raw = Data(Array("[00:01.00]".utf8) + [0xb9, 0xfd, 0xbb, 0xf0])
        try raw.write(to: file)
        let picked = try await local.readLyricFile(file, for: id)
        XCTAssertEqual(Data(base64Encoded: try XCTUnwrap(picked["data"] as? String)), raw)
        let before = try await local.lyricSource(id)
        XCTAssertEqual(before?.content, "[00:01.00]Previous")
        let result = try await local.saveDecodedLyrics("[00:01.00]过火", fileName: "原歌词.lrc", for: id,
            token: XCTUnwrap(picked["token"] as? String))
        XCTAssertEqual(result["content"] as? String, "[00:01.00]过火")
        let reopened = try await LocalMediaLibrary(root: root).lyricSource(id)
        XCTAssertEqual(reopened?.content, "[00:01.00]过火"); XCTAssertEqual(reopened?.fileName, "原歌词.lrc")
        let native = NativeLyrics(local: local)
        defer { native.cancel() }
        native.update([song])
        try await waitForStream { native.value(song)?.last?["fullText"] as? String == "过火" }
    }

    func testDecodedLyricCommitRejectsInvalidAndStaleEditsWithoutLosingSavedText() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let audio = try silentAudio(), local = LocalMediaLibrary(root: root)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let song = try await local.importAudio(audio), id = try XCTUnwrap(song["id"] as? String)
        let file = root.appendingPathComponent("source.krc")
        try Data("krc1raw".utf8).write(to: file)
        let pick = try await local.readLyricFile(file, for: id), token = try XCTUnwrap(pick["token"] as? String)
        for content in ["", "<unrelated/>", String(repeating: "字", count: 700_000), "[00:01.00]" + String(repeating: "a", count: 5000)] {
            do { _ = try await local.saveDecodedLyrics(content, fileName: "bad.lrc", for: id, token: token); XCTFail("Invalid lyrics accepted") }
            catch {}
        }
        let text = "[1000,2000]<0,2000,0>Decoded"
        _ = try await local.saveDecodedLyrics(text, fileName: "source.KRC", for: id, token: token)
        do { _ = try await local.saveDecodedLyrics("[00:01.00]Stale", fileName: "old.lrc", for: id, token: token); XCTFail("Stale edit accepted") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "local-lyrics-changed") }
        let preserved = try await local.lyricSource(id)
        XCTAssertEqual(preserved?.content, text); XCTAssertEqual(preserved?.fileName, "source.KRC")
        let next = try await local.readLyricFile(file, for: id), nextToken = try XCTUnwrap(next["token"] as? String)
        try Data("[00:01.00]Other importer".utf8).write(to: file)
        _ = try await local.importLyrics(file, for: id)
        do { _ = try await local.saveDecodedLyrics(text, fileName: "source.KRC", for: id, token: nextToken); XCTFail("Legacy write did not revoke edit") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "local-lyrics-changed") }
        let removed = try await local.readLyricFile(file, for: id)
        try await local.remove(id)
        do { _ = try await local.saveDecodedLyrics(text, fileName: "source.KRC", for: id, token: XCTUnwrap(removed["token"] as? String)); XCTFail("Deleted song resurrected") }
        catch {}
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(id).path))
    }

    func testLocalLyricPickBoundsAndConcurrentCommitHasSingleWinner() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let audio = try silentAudio(), local = LocalMediaLibrary(root: root)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let song = try await local.importAudio(audio), id = try XCTUnwrap(song["id"] as? String)
        let file = root.appendingPathComponent("source.lrc")
        for data in [Data(), Data(repeating: 97, count: 2_000_001)] {
            try data.write(to: file)
            do { _ = try await local.readLyricFile(file, for: id); XCTFail("Invalid file picked") } catch {}
        }
        try Data("[00:01.00]Valid".utf8).write(to: file)
        let pick = try await local.readLyricFile(file, for: id), token = try XCTUnwrap(pick["token"] as? String)
        let tasks = ["First", "Second"].map { name in Task {
            do { _ = try await local.saveDecodedLyrics("[00:01.00]" + name, fileName: "source.lrc", for: id, token: token); return true }
            catch { return false }
        } }
        var succeeded = 0
        for task in tasks { if await task.value { succeeded += 1 } }
        XCTAssertEqual(succeeded, 1)
        let saved = try await local.lyricSource(id)
        XCTAssertTrue(["[00:01.00]First", "[00:01.00]Second"].contains(saved?.content ?? ""))
    }
}
