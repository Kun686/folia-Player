import XCTest
import AVFoundation
@testable import App

// NativeVorbisTests.swift — generated real Vorbis audio, bounded conversion and the existing native playback decoder.
@MainActor extension NativeTests {
    private func vorbisFixture() throws -> URL {
        try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "VorbisFixture", withExtension: "ogg"))
    }
    func testVorbisConversionPreservesStereoSamplesDurationAndMetadata() async throws {
        let input = try vorbisFixture(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let output = root.appendingPathComponent("decoded.caf"), before = try Data(contentsOf: input)
        let result = try await NativeVorbisFile().decode(input, output: output)
        XCTAssertEqual(result.frames, 352800); XCTAssertEqual(result.duration, 8); XCTAssertEqual(result.channels, 2)
        XCTAssertTrue(result.comments.contains("TRACKNUMBER=2/8")); XCTAssertTrue(result.comments.contains("TITLE=Generated Vorbis"))
        XCTAssertEqual(try Data(contentsOf: input), before)
        let file = try AVAudioFile(forReading: output)
        XCTAssertEqual(file.length, result.frames); XCTAssertEqual(file.processingFormat.channelCount, 2)
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 4096))
        var count = 0, squared = [Double](repeating: 0, count: 2), correlation = squared
        while file.framePosition < file.length {
            try file.read(into: buffer, frameCount: AVAudioFrameCount(min(4096, file.length - file.framePosition)))
            let lanes = try XCTUnwrap(buffer.floatChannelData)
            for frame in 0..<Int(buffer.frameLength) {
                for channel in 0..<2 {
                    let value = Double(lanes[channel][frame]), reference = sin(2 * Double.pi * (channel == 0 ? 440 : 660) * Double(count + frame) / 44100)
                    squared[channel] += value * value; correlation[channel] += value * reference
                }
            }
            count += Int(buffer.frameLength)
        }
        XCTAssertEqual(sqrt(squared[0] / Double(count)), 0.15 / sqrt(2), accuracy: 0.003)
        XCTAssertEqual(sqrt(squared[1] / Double(count)), 0.10 / sqrt(2), accuracy: 0.003)
        XCTAssertEqual(correlation[0] / Double(count), 0.075, accuracy: 0.003)
        XCTAssertEqual(correlation[1] / Double(count), 0.050, accuracy: 0.003)
        let bytes = try output.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        XCTAssertLessThanOrEqual(bytes, count * 8 + 4096)
        print("VORBIS_QA frames=\(count) compressed=\(before.count) pcmCAF=\(bytes)")
    }
    func testVorbisRejectsCancellationCorruptionLimitsAndExistingDestination() async throws {
        let input = try vorbisFixture(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let decoder = NativeVorbisFile(), output = root.appendingPathComponent("decoded.caf")
        do { _ = try await decoder.decode(input, output: output, maximumBytes: 1000); XCTFail("Size limit bypassed") } catch {}
        XCTAssertFalse(FileManager.default.fileExists(atPath: output.path))
        let task = Task { withUnsafeCurrentTask { $0?.cancel() }; return try await decoder.decode(input, output: output) }
        do { _ = try await task.value; XCTFail("Cancellation bypassed") } catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: output.path))
        let broken = root.appendingPathComponent("broken.ogg"); try Data(contentsOf: input).prefix(100).write(to: broken)
        do { _ = try await decoder.decode(broken, output: output); XCTFail("Broken file accepted") } catch {}
        var corrupt = try Data(contentsOf: input); corrupt[15000] ^= 1
        try corrupt.write(to: broken)
        do { _ = try await decoder.decode(broken, output: output); XCTFail("Corrupt middle page accepted") } catch {}
        XCTAssertFalse(FileManager.default.fileExists(atPath: output.path), "Partial conversion must be removed")
        do { _ = try await decoder.decode(input, output: output, timeout: 0); XCTFail("Expired deadline ignored") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "local-decode-timeout") }
        let original = Data("keep".utf8); try original.write(to: output)
        do { _ = try await decoder.decode(input, output: output); XCTFail("Existing destination overwritten") } catch {}
        XCTAssertEqual(try Data(contentsOf: output), original)
    }

    func testVorbisImportPersistsTagsAndLyricsAndRescansRetainedOriginal() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let input = try vorbisFixture(), before = try Data(contentsOf: input), local = LocalMediaLibrary(root: root)
        let song = try await local.importAudio(input), id = try XCTUnwrap(song["id"] as? String)
        XCTAssertEqual(song["name"] as? String, "Generated Vorbis")
        XCTAssertEqual((song["artists"] as? [[String: String]])?.compactMap { $0["name"] }, ["Left 440 Hz", "Right 660 Hz"])
        XCTAssertEqual(song["trackNumber"] as? Int, 2); XCTAssertEqual(song["discNumber"] as? Int, 3)
        XCTAssertEqual((song["replayGain"] as? [String: Double])?["trackGain"], -3)
        let carrier = try await local.resolve(id), original = try await local.metadataAudio(id)
        XCTAssertEqual(carrier.pathExtension, "caf"); XCTAssertEqual(original.pathExtension, "ogg")
        XCTAssertEqual(try Data(contentsOf: original), before); XCTAssertEqual(try Data(contentsOf: input), before)
        let initial = try await local.readLyricSources(id)
        XCTAssertEqual(initial["embeddedContent"] as? String, "[00:00.00]Generated lyric\n[00:04.00]Second line")
        _ = try await local.saveDecodedLyrics("[00:00.00]Manual", fileName: "manual.lrc", for: id,
            token: XCTUnwrap(initial["token"] as? String))
        let savedRecord = try await local.lyricSource(id)
        var legacy = try XCTUnwrap(savedRecord)
        legacy.embeddedScanVersion = 0; legacy.embeddedContent = nil
        try await local.writeLyricSources(legacy, id: id)
        let restarted = LocalMediaLibrary(root: root), restored = try await restarted.readLyricSources(id)
        XCTAssertEqual(restored["content"] as? String, "[00:00.00]Manual")
        XCTAssertEqual(restored["embeddedContent"] as? String, initial["embeddedContent"] as? String)
        XCTAssertEqual(restored["lyricsSource"] as? String, "local")
        try await restarted.writeLyricSources(legacy, id: id)
        try FileManager.default.removeItem(at: original)
        let unavailableOriginal = try await restarted.readLyricSources(id)
        XCTAssertEqual(unavailableOriginal["content"] as? String, "[00:00.00]Manual")
        let stillPlayable = try await restarted.resolve(id)
        XCTAssertEqual(stillPlayable, carrier)
        let invalid = root.appendingPathComponent("invalid.ogg"); try before.prefix(100).write(to: invalid)
        do { _ = try await restarted.importAudio(invalid); XCTFail("Invalid Ogg imported") } catch {}
        let entries = try FileManager.default.contentsOfDirectory(atPath: root.path).filter { UUID(uuidString: $0) != nil }
        XCTAssertEqual(entries, [id], "Failed imports leave no library entry")
    }

    func testVorbisImportedCarrierSeeksAndAdvancesMixedLocalQueueOffline() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), wav = try silentAudio()
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: wav) }
        let local = LocalMediaLibrary(root: root), first = try await local.importAudio(vorbisFixture()), next = try await local.importAudio(wav)
        let gateway = FailingGateway(), tested = PlaybackEngine(gateway: gateway, storage: engine().storage, local: local, usesStereoOutput: true)
        tested.network.cancel(); defer { tested.stop(); tested.clearOutput() }
        try tested.setQueue([first, next], at: 0)
        try await waitForStream { tested.outputIsPlaying && tested.playbackPosition > 0.1 }
        try tested.command("seek", position: 4)
        try await waitForStream { tested.playbackPosition >= 4 && tested.playbackPosition < 5 }
        try tested.command("pause")
        try tested.command("seek", position: 1)
        try await waitForStream { !tested.outputIsPlaying && abs(tested.playbackPosition - 1) < 0.15 }
        try tested.command("play")
        try await waitForStream { tested.outputIsPlaying }
        try tested.command("seek", position: 7.7)
        try await waitForStream { tested.index == 1 }
        XCTAssertEqual(tested.currentSong?["id"] as? String, next["id"] as? String)
        try await waitForStream { !tested.intentToPlay }
        XCTAssertNil(tested.error); XCTAssertEqual(gateway.count, 0)
    }

    func testVorbisFolderImportRescanAndReplacementKeepIdentityAndManualLyrics() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("Source"), input = source.appendingPathComponent("song.ogg")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: vorbisFixture(), to: input)
        let local = LocalMediaLibrary(root: root.appendingPathComponent("Library")), token = UUID().uuidString
        let progress = try await local.beginFolderImport(token: token, source: source)
        XCTAssertEqual(progress["total"] as? Int, 1)
        _ = try await local.readFolderImport(token, index: 0)
        _ = try await local.prepareFolderImport(token, index: 0, contents: LocalFolderLyricContents())
        let result = try await local.finishFolderImport(token), rootID = try XCTUnwrap(result["rootID"] as? String)
        let snapshot = try await local.folderSnapshot(), track = try XCTUnwrap(snapshot.tracks.values.first), id = track.id
        let lyrics = try await local.readLyricSources(id)
        _ = try await local.saveDecodedLyrics("[00:00.00]Keep manual", fileName: "manual.lrc", for: id,
            token: XCTUnwrap(lyrics["token"] as? String))
        let rescan = UUID().uuidString, same = try await local.beginFolderImport(token: rescan, rootID: rootID)
        XCTAssertEqual(same["reused"] as? Int, 1); XCTAssertEqual(same["total"] as? Int, 0)
        _ = try await local.finishFolderImport(rescan)
        try FileManager.default.setAttributes([.modificationDate: Date().addingTimeInterval(10)], ofItemAtPath: input.path)
        let replace = UUID().uuidString, changed = try await local.beginFolderImport(token: replace, rootID: rootID)
        XCTAssertEqual(changed["total"] as? Int, 1)
        _ = try await local.readFolderImport(replace, index: 0)
        _ = try await local.prepareFolderImport(replace, index: 0, contents: LocalFolderLyricContents())
        _ = try await local.finishFolderImport(replace)
        let updated = try await local.folderSnapshot(), saved = try await local.readLyricSources(id)
        XCTAssertEqual(updated.tracks.count, 1); XCTAssertNotEqual(updated.tracks[id]?.generation, track.generation)
        XCTAssertEqual(saved["content"] as? String, "[00:00.00]Keep manual")
        let original = try await local.metadataAudio(id)
        XCTAssertEqual(try Data(contentsOf: original), try Data(contentsOf: input))
    }
}
