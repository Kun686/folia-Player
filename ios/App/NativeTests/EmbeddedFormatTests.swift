import XCTest
import AVFoundation
@testable import App

// EmbeddedFormatTests.swift — same actual audio bytes and desktop expectations as embeddedFormats.test.ts.
@MainActor extension NativeTests {
    private func embeddedFormatCases() throws -> [[String: Any]] {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "EmbeddedFormatReference", withExtension: "json"))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        return try XCTUnwrap(json["cases"] as? [[String: Any]])
    }
    private func embeddedFormatAudio(_ sample: [String: Any]) throws -> URL {
        let data = try XCTUnwrap(Data(base64Encoded: XCTUnwrap(sample["audioBase64"] as? String)))
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            .appendingPathExtension(try XCTUnwrap(sample["extension"] as? String))
        try data.write(to: url); return url
    }
    func testSystemFLACAndSYLTTagsMatchOriginalDesktopReference() async throws {
        let parser = NativeLyricParser()
        for sample in try embeddedFormatCases() {
            let name = try XCTUnwrap(sample["name"] as? String), url = try embeddedFormatAudio(sample)
            defer { try? FileManager.default.removeItem(at: url) }
            let asset = AVURLAsset(url: url), playable = try await asset.load(.isPlayable)
            XCTAssertTrue(playable, name)
            let metadata = try await asset.load(.metadata)
            let selected = try await LocalMediaLibrary.embeddedLyrics(metadata, parser: parser, fileURL: url)
            let expected = try XCTUnwrap(sample["expected"] as? [String: String])
            XCTAssertEqual(selected.lyrics, expected["lyrics"], name)
            XCTAssertEqual(selected.translationLyrics, expected["translationLyrics"], name)
            if sample["extension"] as? String == "flac" {
                // Systems that do not expose Vorbis metadata must still recover both lyric fields.
                let withoutSystemTags = try await LocalMediaLibrary.embeddedLyrics([], parser: parser, fileURL: url)
                XCTAssertEqual(withoutSystemTags.lyrics, expected["lyrics"], name)
                XCTAssertEqual(withoutSystemTags.translationLyrics, expected["translationLyrics"], name)
            }
        }
    }
    func testFLACAndSYLTImportPersistenceAndVersionTwoUpgrade() async throws {
        for sample in try embeddedFormatCases() where ["flac-native-fallback", "sylt-v24-utf8", "flac-priority-over-id3", "flac-hidden-no-uslt"].contains(sample["name"] as? String ?? "") {
            let url = try embeddedFormatAudio(sample), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: url); try? FileManager.default.removeItem(at: root) }
            let local = LocalMediaLibrary(root: root), song = try await local.importAudio(url), id = try XCTUnwrap(song["id"] as? String)
            let expected = try XCTUnwrap(sample["expected"] as? [String: String])
            let fresh = try await LocalMediaLibrary(root: root).readLyricSources(id)
            XCTAssertEqual(fresh["embeddedContent"] as? String, expected["lyrics"])
            XCTAssertEqual(fresh["embeddedTranslation"] as? String, expected["translationLyrics"])
            let old = LocalMediaLibrary.LyricSource(content: "[00:00.00]Keep imported", fileName: "keep.lrc",
                embeddedScanned: true, embeddedScanVersion: 2, lyricsSource: "local")
            try await local.writeLyricSources(old, id: id)
            let migrated = try await local.readLyricSources(id)
            XCTAssertEqual(migrated["content"] as? String, old.content); XCTAssertEqual(migrated["lyricsSource"] as? String, "local")
            XCTAssertEqual(migrated["embeddedTranslation"] as? String, expected["translationLyrics"])
            let saved = try await local.lyricSource(id); XCTAssertEqual(saved?.embeddedScanVersion, LocalMediaLibrary.embeddedScanVersion)
            let selected = try await local.selectLyricSource("embedded", id: id, token: XCTUnwrap(migrated["token"] as? String))
            let data = try await NativeLyricParser().localSources(selected)
            let lines = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(data)) as? [[String: Any]])
            XCTAssertTrue(lines.contains { ($0["fullText"] as? String)?.hasSuffix("original") == true })
        }
    }
    func testMalformedSYLTRejectsAndNativeParserRecovers() async throws {
        let sample = try XCTUnwrap(embeddedFormatCases().first { $0["name"] as? String == "sylt-v24-utf8" })
        let tags = try XCTUnwrap(sample["tags"] as? [[String: String]]), parser = NativeLyricParser()
        var broken = try XCTUnwrap(tags.first)
        let data = try XCTUnwrap(Data(base64Encoded: XCTUnwrap(broken["value"])))
        broken["value"] = data.dropLast().base64EncodedString()
        do { _ = try await parser.embeddedTags([broken]); XCTFail("Truncated timestamp accepted") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "invalid-local-lyrics") }
        let recovered = try await parser.embeddedTags(tags)
        XCTAssertEqual(recovered.translationLyrics, (sample["expected"] as? [String: String])?["translationLyrics"])
        let item = AVMutableMetadataItem(); item.identifier = .id3MetadataSynchronizedLyric
        item.value = Data(count: 262145) as NSData
        do { _ = try await LocalMediaLibrary.embeddedLyrics([item], parser: parser); XCTFail("Excessive SYLT accepted") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "lyrics-too-large") }
    }
    func testNativeFlacFileReaderRejectsTruncationCancellationAndRecovers() async throws {
        let sample = try XCTUnwrap(embeddedFormatCases().first { $0["name"] as? String == "flac-common" })
        let url = try embeddedFormatAudio(sample), broken = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".flac")
        defer { try? FileManager.default.removeItem(at: url); try? FileManager.default.removeItem(at: broken) }
        try Data(contentsOf: url).prefix(50).write(to: broken)
        let parser = NativeLyricParser()
        do { _ = try await parser.flacTags(broken); XCTFail("Incomplete FLAC accepted") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "invalid-local-lyrics") }
        let task = Task { withUnsafeCurrentTask { $0?.cancel() }; return try await parser.flacTags(url) }
        do { _ = try await task.value; XCTFail("Cancelled metadata read accepted") } catch { XCTAssertTrue(error is CancellationError) }
        let recovered = try await parser.flacTags(url)
        XCTAssertEqual(recovered.lyrics, (sample["expected"] as? [String: String])?["lyrics"])
    }
}
