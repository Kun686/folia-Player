import XCTest
@testable import App

// LocalFolderTransactionTests.swift — real audio copies exercise visibility, stable identity and edit conflicts.
@MainActor extension NativeTests {
    func folderPlan(_ path: String = "song.wav") -> LocalFolderTrackPlan {
        LocalFolderTrackPlan(path: path, audioSignature: "audio-v1", sidecarSignature: "", coverSignature: "")
    }
    func folderRecord(_ id: String, source: URL, tracks: [LocalFolderTrack]) throws -> LocalFolderRecord {
        let access = try LocalFolderAuthorization.Access(url: source)
        defer { access.close() }
        return LocalFolderRecord(id: id, name: source.lastPathComponent, bookmark: access.bookmark,
            ignoredPaths: [], directories: [], tracks: tracks)
    }
    func seedFolder(_ local: LocalMediaLibrary, audio: URL) async throws -> LocalFolderRecord {
        let rootID = UUID().uuidString, tx = try await local.beginFolderUpdate()
        let track = try await local.stageFolderAudio(audio, transactionID: tx, rootID: rootID, plan: folderPlan())
        let root = await local.root, metadata = root.appendingPathComponent(".folder-staging/" + tx + "/" + track.generation + "/song.json")
        var tagged = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: metadata)) as? [String: Any])
        tagged["artists"] = [["id": "", "name": "File artist"]]
        tagged["album"] = ["id": "", "name": "File album"]
        try JSONSerialization.data(withJSONObject: tagged).write(to: metadata, options: .atomic)
        let record = try folderRecord(rootID, source: audio.deletingLastPathComponent(), tracks: [track])
        _ = try await local.commitFolderUpdate(tx, roots: [record])
        return record
    }
    func testFolderBookmarkReopensAndDoesNotMergeSameNamedDirectories() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let a = root.appendingPathComponent("a/Music"), b = root.appendingPathComponent("b/Music")
        for url in [a, b] { try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true) }
        let access = try LocalFolderAuthorization.Access(url: a), bookmark = access.bookmark
        access.close(); access.close()
        let reopened = try LocalFolderAuthorization.open(bookmark)
        defer { reopened.close() }
        XCTAssertTrue(try LocalFolderAuthorization.sameDirectory(a, reopened.url))
        XCTAssertFalse(try LocalFolderAuthorization.sameDirectory(a, b))
        XCTAssertThrowsError(try LocalFolderAuthorization.open(Data("broken".utf8)))
    }
    func testFolderBatchIsInvisibleUntilCommitAndCoexistsWithDirectImports() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), audio = try silentAudio()
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), direct = try await local.importAudio(audio)
        let rootID = UUID().uuidString, tx = try await local.beginFolderUpdate()
        let track = try await local.stageFolderAudio(audio, transactionID: tx, rootID: rootID, plan: folderPlan())
        let before = try await local.catalog(requireComplete: true)
        XCTAssertEqual(before.count, 1)
        XCTAssertEqual(before.first?["id"] as? String, direct["id"] as? String)
        do { _ = try await local.resolve(track.id); XCTFail("Staging became playable before commit") } catch {}
        let record = try folderRecord(rootID, source: audio.deletingLastPathComponent(), tracks: [track])
        _ = try await local.commitFolderUpdate(tx, roots: [record])
        let reopened = LocalMediaLibrary(root: root), songs = try await reopened.catalog(requireComplete: true)
        XCTAssertEqual(Set(songs.compactMap { $0["id"] as? String }), [track.id, direct["id"] as! String])
        let copied = try await reopened.resolve(track.id)
        XCTAssertEqual(try Data(contentsOf: copied), try Data(contentsOf: audio))
        XCTAssertNotEqual(copied, audio)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(".folder-staging/" + tx).path))
    }
    func testFolderReplacementKeepsIdentityEditsAndOldPlaybackFileUntilRestart() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), audio = try silentAudio()
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root)
        var record = try await seedFolder(local, audio: audio)
        let id = record.tracks[0].id, oldURL = try await local.resolve(id)
        let originalLyrics = "[00:00.00]User lyrics"
        let lyrics = try await local.readLyricSources(id)
        _ = try await local.saveDecodedLyrics(originalLyrics, fileName: "user.lrc", for: id,
            token: XCTUnwrap(lyrics["token"] as? String))
        // A manual match supplies a named artist so its entity can be split independently of file tags.
        let match = try await local.readLocalMatch(id)
        let matchDoc: [String: Any] = ["title": "Matched title", "titleOrigin": "manual-match",
            "artistNames": ["Matched artist"], "albumName": "Matched album"]
        _ = try await local.writeLocalMatch(id, token: XCTUnwrap((match["lyrics"] as? [String: Any])?["token"] as? String),
            document: matchDoc, source: "local", libraryRevision: match["libraryRevision"] as? String)
        let snapshot = try await local.librarySnapshot()
        let assignment = try XCTUnwrap((snapshot["assignments"] as? [[String: Any]])?.first)
        let artist = try XCTUnwrap((assignment["artistEntityIds"] as? [String])?.first)
        let edited = try await local.editLibrary(revision: XCTUnwrap(snapshot["revision"] as? String), operation: [
            "type": "artists", "entityId": artist, "songIds": [id], "targets": [["displayName": "Organized artist"]], "mode": "replace"])
        let tx = try await local.beginFolderUpdate(), staleToken = await local.lyricToken(id)
        let replacement = try await local.stageFolderAudio(audio, transactionID: tx, rootID: record.id, plan: folderPlan(), replacing: id)
        XCTAssertEqual(replacement.id, id); XCTAssertNotEqual(replacement.generation, record.tracks[0].generation)
        record.tracks = [replacement]
        _ = try await local.commitFolderUpdate(tx, roots: [record])
        let url = try await local.resolve(id), saved = try await local.readLyricSources(id)
        XCTAssertNotEqual(url, oldURL)
        XCTAssertTrue(FileManager.default.fileExists(atPath: oldURL.path))
        XCTAssertEqual(saved["content"] as? String, originalLyrics)
        XCTAssertNotEqual(saved["token"] as? String, staleToken)
        let after = try await local.librarySnapshot()
        XCTAssertEqual((after["assignments"] as? NSArray), (edited["assignments"] as? NSArray))
        let song = try XCTUnwrap((after["songs"] as? [[String: Any]])?.first)
        XCTAssertEqual(song["name"] as? String, "Matched title")
        XCTAssertEqual((song["artists"] as? [[String: Any]])?.first?["name"] as? String, "Organized artist")
        let reopened = LocalMediaLibrary(root: root), restored = try await reopened.resolve(id)
        XCTAssertEqual(restored, url)
        XCTAssertFalse(FileManager.default.fileExists(atPath: oldURL.path))
        let restoredLyrics = try await reopened.readLyricSources(id)
        XCTAssertEqual(restoredLyrics["content"] as? String, originalLyrics)
    }
    func testFolderPendingBatchCannotOverwriteLaterLyricsOrEntityEdits() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), audio = try silentAudio()
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), record = try await seedFolder(local, audio: audio), id = record.tracks[0].id
        let original = try Data(contentsOf: root.appendingPathComponent("folders.json"))
        for edit in ["lyrics", "entity"] {
            let tx = try await local.beginFolderUpdate()
            let pending = try await local.stageFolderAudio(audio, transactionID: tx, rootID: record.id, plan: folderPlan(), replacing: id)
            if edit == "lyrics" {
                let sources = try await local.readLyricSources(id)
                _ = try await local.saveDecodedLyrics("[00:00.00]Later edit", fileName: "edit.lrc", for: id,
                    token: XCTUnwrap(sources["token"] as? String))
            } else {
                let snapshot = try await local.librarySnapshot()
                let assignment = try XCTUnwrap((snapshot["assignments"] as? [[String: Any]])?.first)
                let album = try XCTUnwrap(assignment["albumEntityId"] as? String)
                _ = try await local.editLibrary(revision: XCTUnwrap(snapshot["revision"] as? String),
                    operation: ["type": "split", "entityId": album, "songIds": [id], "displayName": "Later album"])
            }
            var next = record; next.tracks = [pending]
            do { _ = try await local.commitFolderUpdate(tx, roots: [next]); XCTFail("Stale folder batch accepted") }
            catch { XCTAssertEqual((error as? MobileFailure)?.code, "local-library-changed") }
            XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("folders.json")), original)
            XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(".folder-staging/" + tx).path))
        }
        let content = try await local.readLyricSources(id), snapshot = try await local.librarySnapshot()
        XCTAssertEqual(content["content"] as? String, "[00:00.00]Later edit")
        XCTAssertEqual(((snapshot["songs"] as? [[String: Any]])?.first?["album"] as? [String: Any])?["name"] as? String, "Later album")
        let tx = try await local.beginFolderUpdate()
        await local.cancelFolderUpdate(tx)
    }
    func testFolderCancellationReleasesBatchAndNeverDeletesSource() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), audio = try silentAudio()
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), tx = try await local.beginFolderUpdate()
        _ = try await local.stageFolderAudio(audio, transactionID: tx, rootID: UUID().uuidString, plan: folderPlan())
        do { _ = try await local.beginFolderUpdate(); XCTFail("Overlapping batch accepted") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "folder-busy") }
        await local.cancelFolderUpdate(tx)
        do { _ = try await local.commitFolderUpdate(tx, roots: []); XCTFail("Cancelled batch accepted") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "folder-cancelled") }
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(".folder-staging/" + tx).path))
        let record = try await seedFolder(local, audio: audio), id = record.tracks[0].id
        let playing = try await local.resolve(id)
        try await local.remove(id)
        do { _ = try await local.resolve(id); XCTFail("Removed identity resolved") } catch {}
        XCTAssertTrue(FileManager.default.fileExists(atPath: playing.path))
        let restarted = LocalMediaLibrary(root: root), catalog = try await restarted.catalog(requireComplete: true)
        XCTAssertTrue(catalog.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: playing.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: audio.path))
    }
}
