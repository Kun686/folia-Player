import XCTest
import UIKit
@testable import App

// LocalFolderContentsTests.swift — actual scanned files, sidecar provenance, translation, covers and stale-source rejection.
@MainActor extension NativeTests {
    private func contentSource(_ root: URL) throws -> URL {
        let source = root.appendingPathComponent("Source"), audio = try silentAudio()
        defer { try? FileManager.default.removeItem(at: audio) }
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: audio, to: source.appendingPathComponent("song.wav"))
        try Data("[00:00.00]Original\n[00:01.00]End".utf8).write(to: source.appendingPathComponent("song.lrc"))
        return source
    }
    private func contentPlan(_ source: URL, order: [String] = ["lrc", "yrc"]) async throws -> (LocalFolderTrackPlan, LocalFolderFiles) {
        let snapshot = try await LocalFolderScanner().scan(source, lyricFormatOrder: order)
        let plans = try JSONDecoder().decode([LocalFolderTrackPlan].self, from: JSONSerialization.data(withJSONObject: snapshot.plan["tracks"]!))
        let files = try JSONDecoder().decode([LocalFolderFile].self, from: JSONSerialization.data(withJSONObject: snapshot.files))
        return (try XCTUnwrap(plans.first), try LocalFolderFiles(root: source, files: files))
    }
    private func commitContents(_ local: LocalMediaLibrary, source: URL, plan: LocalFolderTrackPlan,
                                files: LocalFolderFiles, contents: LocalFolderLyricContents,
                                prior: LocalFolderRecord? = nil) async throws -> LocalFolderRecord {
        let tx = try await local.beginFolderUpdate(), rootID = prior?.id ?? UUID().uuidString
        do {
            let track = try await local.stageFolderAudio(source.appendingPathComponent(plan.path), transactionID: tx,
                rootID: rootID, plan: plan, replacing: prior?.tracks.first?.id,
                sidecars: LocalFolderSidecars(files: files, contents: contents))
            let record = try folderRecord(rootID, source: source, tracks: [track])
            _ = try await local.commitFolderUpdate(tx, roots: [record])
            return record
        } catch { await local.cancelFolderUpdate(tx); throw error }
    }
    private func coverBytes() throws -> Data {
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let image = UIGraphicsImageRenderer(size: CGSize(width: 32, height: 32), format: format).image { context in
            UIColor.green.setFill(); context.fill(CGRect(x: 0, y: 0, width: 32, height: 32))
        }
        return try XCTUnwrap(image.pngData())
    }
    func testFolderReadPreservesRawBytesAndRejectsChangedOrEscapingFiles() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try contentSource(root), file = source.appendingPathComponent("song.lrc")
        let gbk = Data([0x5b, 0x30, 0x30, 0x3a, 0x30, 0x30, 0x5d, 0xb9, 0xfd, 0xbb, 0xf0])
        try gbk.write(to: file)
        let (plan, files) = try await contentPlan(source), policy = LocalFolderLyricPolicy(record: nil, old: nil, new: plan)
        let raw = try XCTUnwrap(policy.read(files, plan: plan)["lyric"] as? [String: String])
        XCTAssertEqual(raw["fileName"], "song.lrc"); XCTAssertEqual(raw["data"], gbk.base64EncodedString())
        try FileManager.default.setAttributes([.modificationDate: Date().addingTimeInterval(10)], ofItemAtPath: file.path)
        XCTAssertThrowsError(try files.read("song.lrc", limit: 2_000_000))
        let (_, fresh) = try await contentPlan(source)
        try FileManager.default.removeItem(at: file)
        try FileManager.default.createSymbolicLink(at: file, withDestinationURL: source.appendingPathComponent("song.wav"))
        XCTAssertThrowsError(try fresh.read("song.lrc", limit: 2_000_000))
        XCTAssertThrowsError(try fresh.read("../Source/song.wav", limit: 2_000_000))
        let nested = source.appendingPathComponent("nested")
        try FileManager.default.createDirectory(at: nested, withIntermediateDirectories: true)
        try gbk.write(to: nested.appendingPathComponent("song.lrc"))
        let (_, nestedFiles) = try await contentPlan(source)
        try FileManager.default.removeItem(at: nested)
        try FileManager.default.createSymbolicLink(at: nested, withDestinationURL: root)
        XCTAssertThrowsError(try nestedFiles.read("nested/song.lrc", limit: 2_000_000))
    }
    func testFolderSidecarsPersistTranslationAndPreferredFolderCover() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try contentSource(root), cover = try coverBytes(), translation = "[00:00.00]译文\n[00:01.00]结束"
        try Data(translation.utf8).write(to: source.appendingPathComponent("song.t.lrc"))
        try cover.write(to: source.appendingPathComponent("cover.png"))
        let (plan, files) = try await contentPlan(source), local = LocalMediaLibrary(root: root.appendingPathComponent("Library"))
        let content = try String(contentsOf: source.appendingPathComponent("song.lrc"), encoding: .utf8)
        let record = try await commitContents(local, source: source, plan: plan, files: files,
            contents: LocalFolderLyricContents(lyric: content, translation: translation))
        let id = record.tracks[0].id, snapshot = try await local.readLyricSources(id)
        XCTAssertEqual(snapshot["content"] as? String, content)
        XCTAssertEqual(snapshot["translationContent"] as? String, translation)
        let saved = try await local.lyricSource(id), image = try await local.cover(id)
        XCTAssertEqual(saved?.contentOrigin, "sidecar"); XCTAssertEqual(saved?.translationOrigin, "sidecar")
        XCTAssertEqual(image, try NativeCoverCache.thumbnail(cover))
        let parser = NativeLyricParser(), lines = try await parser.localSources(snapshot)
        let expected = try await parser.parse(content, fileName: "song.lrc", translation: translation)
        XCTAssertEqual(try XCTUnwrap(lines), expected)
        let reopened = LocalMediaLibrary(root: root.appendingPathComponent("Library")), restored = try await reopened.readLyricSources(id)
        XCTAssertEqual(restored["translationContent"] as? String, translation)
        let restoredCover = try await reopened.cover(id)
        XCTAssertEqual(restoredCover, image)
    }
    func testFolderReadRejectsOversizeAndCancellationWithoutReturningPartialData() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try contentSource(root)
        try Data(repeating: 65, count: 2_000_001).write(to: source.appendingPathComponent("song.lrc"))
        let (_, files) = try await contentPlan(source)
        XCTAssertThrowsError(try files.lyric("song.lrc")) { error in
            XCTAssertEqual((error as? MobileFailure)?.code, "folder-file-too-large")
        }
        let cancelled = Task { try files.read("song.lrc", limit: 8_000_000) }
        cancelled.cancel()
        do { _ = try await cancelled.value; XCTFail("Cancelled read returned data") }
        catch { XCTAssertTrue(error is CancellationError) }
    }
    func testFolderFormatRerankingKeepsUploadUntilActualSidecarChange() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try contentSource(root), yrc = source.appendingPathComponent("song.yrc")
        try Data("[0,1000](0,1000,0)旧逐字".utf8).write(to: yrc)
        let (first, firstFiles) = try await contentPlan(source), local = LocalMediaLibrary(root: root.appendingPathComponent("Library"))
        var record = try await commitContents(local, source: source, plan: first, files: firstFiles,
            contents: LocalFolderLyricContents(lyric: "[00:00.00]Original\n[00:01.00]End"))
        let id = record.tracks[0].id, snapshot = try await local.readLyricSources(id)
        _ = try await local.saveDecodedLyrics("[00:00.00]Uploaded", fileName: "user.lrc", for: id, token: XCTUnwrap(snapshot["token"] as? String))
        let (reranked, rerankedFiles) = try await contentPlan(source, order: ["yrc", "lrc"])
        XCTAssertNotEqual(reranked.lyric, first.lyric); XCTAssertEqual(reranked.sidecarSignature, first.sidecarSignature)
        let saved = try await local.lyricSource(id), policy = LocalFolderLyricPolicy(record: saved, old: first, new: reranked)
        XCTAssertTrue(policy.keepLyric)
        XCTAssertNil(try policy.read(rerankedFiles, plan: reranked)["lyric"])
        record = try await commitContents(local, source: source, plan: reranked, files: rerankedFiles,
            contents: LocalFolderLyricContents(), prior: record)
        let retained = try await local.readLyricSources(id)
        XCTAssertEqual(retained["content"] as? String, "[00:00.00]Uploaded"); XCTAssertEqual(retained["fileName"] as? String, "user.lrc")
        let changedText = "[0,1000](0,1000,0)磁盘新的逐字歌词"
        try Data(changedText.utf8).write(to: yrc, options: .atomic)
        let (changed, changedFiles) = try await contentPlan(source, order: ["yrc", "lrc"])
        XCTAssertNotEqual(changed.sidecarSignature, reranked.sidecarSignature)
        record = try await commitContents(local, source: source, plan: changed, files: changedFiles,
            contents: LocalFolderLyricContents(lyric: changedText), prior: record)
        XCTAssertEqual(record.tracks[0].id, id)
        let updated = try await local.readLyricSources(id), updatedRecord = try await local.lyricSource(id)
        XCTAssertEqual(updated["content"] as? String, changedText); XCTAssertEqual(updated["fileName"] as? String, "song.yrc")
        XCTAssertEqual(updatedRecord?.contentOrigin, "sidecar")
    }
    func testFolderSidecarRemovalClearsOnlySidecarsAndKeepsUserSourceFiles() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try contentSource(root), local = LocalMediaLibrary(root: root.appendingPathComponent("Library"))
        try Data("[00:00.00]译文".utf8).write(to: source.appendingPathComponent("song.t.lrc"))
        try coverBytes().write(to: source.appendingPathComponent("cover.png"))
        let (plan, files) = try await contentPlan(source)
        let record = try await commitContents(local, source: source, plan: plan, files: files,
            contents: LocalFolderLyricContents(lyric: "[00:00.00]Original", translation: "[00:00.00]译文"))
        for path in ["song.lrc", "song.t.lrc", "cover.png"] { try FileManager.default.removeItem(at: source.appendingPathComponent(path)) }
        let (removed, removedFiles) = try await contentPlan(source)
        _ = try await commitContents(local, source: source, plan: removed, files: removedFiles,
            contents: LocalFolderLyricContents(), prior: record)
        let id = record.tracks[0].id, saved = try await local.lyricSource(id), cover = try await local.cover(id)
        XCTAssertEqual(saved?.content, ""); XCTAssertNil(saved?.translationContent)
        XCTAssertNil(saved?.contentOrigin); XCTAssertNil(saved?.translationOrigin); XCTAssertNil(cover)
        XCTAssertTrue(FileManager.default.fileExists(atPath: source.appendingPathComponent("song.wav").path))
    }
    func testFolderStagingRejectsChangedSidecarsAndMissingDecodedContent() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try contentSource(root), local = LocalMediaLibrary(root: root.appendingPathComponent("Library"))
        let (initial, firstFiles) = try await contentPlan(source)
        let record = try await commitContents(local, source: source, plan: initial, files: firstFiles,
            contents: LocalFolderLyricContents(lyric: "[00:00.00]Original"))
        let manifest = root.appendingPathComponent("Library/folders.json"), original = try Data(contentsOf: manifest)
        for failure in ["changed", "missing"] {
            let (plan, files) = try await contentPlan(source)
            if failure == "changed" { try Data("[00:00.00]Changed source".utf8).write(to: source.appendingPathComponent("song.lrc"), options: .atomic) }
            do {
                _ = try await commitContents(local, source: source, plan: plan, files: files,
                    contents: LocalFolderLyricContents(lyric: failure == "missing" ? nil : "[00:00.00]Decoded"), prior: record)
                XCTFail("Invalid folder preparation accepted: " + failure)
            } catch {}
            XCTAssertEqual(try Data(contentsOf: manifest), original)
            let staged = try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("Library/.folder-staging").path)
            XCTAssertTrue(staged.isEmpty)
        }
    }
    func testFolderInvalidOptionalCoverWarnsWithoutDiscardingPlayableAudio() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try contentSource(root), local = LocalMediaLibrary(root: root.appendingPathComponent("Library"))
        try Data("bad image".utf8).write(to: source.appendingPathComponent("cover.png"))
        let (plan, files) = try await contentPlan(source), tx = try await local.beginFolderUpdate(), rootID = UUID().uuidString
        let track = try await local.stageFolderAudio(source.appendingPathComponent("song.wav"), transactionID: tx,
            rootID: rootID, plan: plan, sidecars: LocalFolderSidecars(files: files,
                contents: LocalFolderLyricContents(lyric: "[00:00.00]Original")))
        let warnings = try await local.folderPreparationWarnings(tx)
        XCTAssertEqual(warnings[track.id], ["folder-cover-unavailable"])
        _ = try await local.commitFolderUpdate(tx, roots: [folderRecord(rootID, source: source, tracks: [track])])
        let audio = try await local.resolve(track.id), image = try await local.cover(track.id)
        XCTAssertTrue(FileManager.default.fileExists(atPath: audio.path)); XCTAssertNil(image)
    }
}
