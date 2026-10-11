import XCTest
import AVFoundation
@testable import App

// EmbeddedMetadataTests.swift — real system ID3/M4A reading, original JS selection, persistence and migration.
@MainActor extension NativeTests {
    private var taggedOriginal: String { "[00:00.00]<00:00.00>Original<00:00.60> lyric\n[00:01.00]End" }
    private var taggedTranslation: String { "[00:00.00]译文\n[00:01.00]结束" }

    // Test-only ID3v2.4 frames plus valid silent MPEG frames; production never implements an ID3 parser.
    private func multiTagMP3() throws -> URL {
        func size(_ value: Int) -> Data { Data([21, 14, 7, 0].map { UInt8((value >> $0) & 127) }) }
        var frames = Data()
        for (language, descriptor, text) in [("eng", "plain", "Untimed fallback"),
            ("zho", "translation", taggedTranslation), ("eng", "original", taggedOriginal)] {
            let payload = Data([3]) + Data(language.utf8) + Data(descriptor.utf8) + Data([0]) + Data(text.utf8)
            frames.append(Data("USLT".utf8) + size(payload.count) + Data([0, 0]) + payload)
        }
        var bytes = Data([73, 68, 51, 4, 0, 0]) + size(frames.count) + frames
        for _ in 0..<80 { bytes.append(Data([255, 251, 144, 100]) + Data(count: 413)) }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mp3")
        try bytes.write(to: url); return url
    }

    func testMultipleUSLTPreservesTranslationAndSelectsTimedOriginalWithoutWebView() async throws {
        let audio = try multiTagMP3(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), song = try await local.importAudio(audio), id = try XCTUnwrap(song["id"] as? String)
        let snapshot = try await local.readLyricSources(id)
        XCTAssertEqual(snapshot["embeddedContent"] as? String, taggedOriginal)
        XCTAssertEqual(snapshot["embeddedTranslation"] as? String, taggedTranslation)
        XCTAssertEqual(snapshot["content"] as? String, "")
        let record = try await local.lyricSource(id)
        XCTAssertEqual(record?.content, taggedOriginal); XCTAssertEqual(record?.embeddedScanVersion, LocalMediaLibrary.embeddedScanVersion)
        let reopened = try await LocalMediaLibrary(root: root).readLyricSources(id)
        XCTAssertEqual(reopened["embeddedTranslation"] as? String, taggedTranslation)
        let result = try await NativeLyricParser().localSources(reopened)
        let lines = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(result)) as? [[String: Any]])
        XCTAssertEqual(lines.first?["fullText"] as? String, "Original lyric")
        let lyrics = NativeLyrics(local: local); defer { lyrics.cancel() }
        lyrics.update([song]); try await waitForStream { lyrics.value(song)?.first?["fullText"] as? String == "Original lyric" }
    }

    func testOldEmbeddedScanUpgradesAndPreservesImportedLyricsSelection() async throws {
        let audio = try multiTagMP3(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), song = try await local.importAudio(audio), id = try XCTUnwrap(song["id"] as? String)
        var old = LocalMediaLibrary.LyricSource(content: "[00:00.00]Imported", fileName: "original.lrc",
            embeddedContent: "Untimed fallback", embeddedScanned: true, lyricsSource: "local")
        try await local.writeLyricSources(old, id: id)
        let snapshot = try await local.readLyricSources(id)
        XCTAssertEqual(snapshot["content"] as? String, old.content); XCTAssertEqual(snapshot["fileName"] as? String, old.fileName)
        XCTAssertEqual(snapshot["lyricsSource"] as? String, "local")
        XCTAssertEqual(snapshot["embeddedContent"] as? String, taggedOriginal)
        XCTAssertEqual(snapshot["embeddedTranslation"] as? String, taggedTranslation)
        let refreshed = try await local.lyricSource(id); XCTAssertEqual(refreshed?.embeddedScanVersion, LocalMediaLibrary.embeddedScanVersion)
        let selected = try await local.selectLyricSource("embedded", id: id, token: XCTUnwrap(snapshot["token"] as? String))
        XCTAssertEqual(selected["content"] as? String, old.content)
        // Current/newer scans are retained; running an older app must not downgrade newer metadata.
        old = try XCTUnwrap(refreshed); old.embeddedTranslation = "[00:00.00]Stored translation"
        for version in [LocalMediaLibrary.embeddedScanVersion, LocalMediaLibrary.embeddedScanVersion + 1] {
            old.embeddedScanVersion = version
            try await local.writeLyricSources(old, id: id)
            let stable = try await LocalMediaLibrary(root: root).readLyricSources(id)
            XCTAssertEqual(stable["embeddedTranslation"] as? String, old.embeddedTranslation)
            let stored = try await local.lyricSource(id); XCTAssertEqual(stored?.embeddedScanVersion, version)
        }
    }

    func testLegacyFirstTagProvenanceSurvivesSelectingABetterTag() async throws {
        let audio = try multiTagMP3(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), song = try await local.importAudio(audio), id = try XCTUnwrap(song["id"] as? String)
        let folder = root.appendingPathComponent(id)
        try FileManager.default.removeItem(at: folder.appendingPathComponent("lyrics.json"))
        try Data("Untimed fallback".utf8).write(to: folder.appendingPathComponent("lyrics.txt"))
        let migrated = try await local.readLyricSources(id)
        XCTAssertEqual(migrated["content"] as? String, "")
        XCTAssertEqual(migrated["embeddedContent"] as? String, taggedOriginal)
        XCTAssertEqual(migrated["embeddedTranslation"] as? String, taggedTranslation)
        let saved = try await local.lyricSource(id); XCTAssertEqual(saved?.content, "Untimed fallback")
    }

    func testMultipleM4ATagsPreferTimedText() async throws {
        let input = try silentAudio(), output = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".m4a")
        defer { try? FileManager.default.removeItem(at: input); try? FileManager.default.removeItem(at: output) }
        let session = try XCTUnwrap(AVAssetExportSession(asset: AVURLAsset(url: input), presetName: AVAssetExportPresetAppleM4A))
        session.metadata = ["Untimed fallback", taggedOriginal].map { text in
            let item = AVMutableMetadataItem(); item.identifier = .iTunesMetadataLyrics; item.value = text as NSString; return item
        }
        session.outputURL = output; session.outputFileType = .m4a
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in session.exportAsynchronously { continuation.resume() } }
        guard session.status == .completed else { throw session.error ?? NSError(domain: "FoliaTestExport", code: 1) }
        let metadata = try await AVURLAsset(url: output).load(.metadata)
        XCTAssertEqual(metadata.filter { $0.identifier == .iTunesMetadataLyrics }.count, 2)
        let selected = try await LocalMediaLibrary.embeddedLyrics(metadata, parser: NativeLyricParser())
        XCTAssertEqual(selected.lyrics, taggedOriginal); XCTAssertNil(selected.translationLyrics)
    }

    func testEmbeddedTagLimitsAndCancellation() async throws {
        let parser = NativeLyricParser()
        for texts in [Array(repeating: "Small", count: 65), Array(repeating: String(repeating: "x", count: 1_400_000), count: 3)] {
            let metadata = texts.map { text in
                let item = AVMutableMetadataItem(); item.identifier = .iTunesMetadataLyrics; item.value = text as NSString; return item
            }
            do { _ = try await LocalMediaLibrary.embeddedLyrics(metadata, parser: parser); XCTFail("Excessive metadata accepted") }
            catch { XCTAssertEqual((error as? MobileFailure)?.code, "lyrics-too-large") }
        }
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await LocalMediaLibrary.embeddedLyrics([], parser: parser)
        }
        do { _ = try await task.value; XCTFail("Cancelled scan accepted") } catch { XCTAssertTrue(error is CancellationError) }
        let recovered = try await parser.embeddedTags([["value": taggedOriginal]])
        XCTAssertEqual(recovered.lyrics, taggedOriginal)
    }

    func testOversizeStoredTranslationIsRejected() async throws {
        let audio = try silentAudio(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), song = try await local.importAudio(audio), id = try XCTUnwrap(song["id"] as? String)
        let record = LocalMediaLibrary.LyricSource(content: "", fileName: nil, embeddedTranslation: String(repeating: "x", count: 2_000_001))
        try JSONEncoder().encode(record).write(to: root.appendingPathComponent(id).appendingPathComponent("lyrics.json"))
        do { _ = try await local.readLyricSources(id); XCTFail("Oversize translation accepted") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "invalid-lyrics") }
    }
}
