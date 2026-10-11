import XCTest
@testable import App

// LocalFolderStoreTests.swift — corruption and interrupted commits must preserve the last authoritative index.
@MainActor extension NativeTests {
    func testFolderMoveFailureRollsBackOnlyNewGenerations() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), audio = try silentAudio()
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), record = try await seedFolder(local, audio: audio)
        let manifest = root.appendingPathComponent("folders.json"), original = try Data(contentsOf: manifest)
        let tx = try await local.beginFolderUpdate()
        let first = try await local.stageFolderAudio(audio, transactionID: tx, rootID: record.id, plan: folderPlan("a.wav"))
        let second = try await local.stageFolderAudio(audio, transactionID: tx, rootID: record.id, plan: folderPlan("b.wav"))
        let generations = root.appendingPathComponent(".folder-generations")
        // Force failure after the first move. Existing data at the collision must not be deleted by rollback.
        let collision = generations.appendingPathComponent(second.generation)
        try FileManager.default.createDirectory(at: collision, withIntermediateDirectories: false)
        try Data("retain".utf8).write(to: collision.appendingPathComponent("marker"))
        var next = record; next.tracks += [first, second]
        do { _ = try await local.commitFolderUpdate(tx, roots: [next]); XCTFail("Generation collision accepted") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "invalid-folder-transaction") }
        XCTAssertEqual(try Data(contentsOf: manifest), original)
        XCTAssertFalse(FileManager.default.fileExists(atPath: generations.appendingPathComponent(first.generation).path))
        XCTAssertEqual(try Data(contentsOf: collision.appendingPathComponent("marker")), Data("retain".utf8))
        let prior = try await local.catalog(requireComplete: true)
        XCTAssertEqual(prior.count, 1); XCTAssertEqual(prior.first?["id"] as? String, record.tracks[0].id)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(".folder-staging/" + tx).path))
        let resumed = try await local.beginFolderUpdate()
        await local.cancelFolderUpdate(resumed)
    }
    func testFolderManifestCorruptionNeverResetsOrDeletesMedia() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), audio = try silentAudio()
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), record = try await seedFolder(local, audio: audio)
        let url = try await local.resolve(record.tracks[0].id), manifest = root.appendingPathComponent("folders.json")
        let original = try Data(contentsOf: manifest)
        for corrupt in [Data(), Data("broken".utf8), Data("{\"version\":999,\"roots\":[]}".utf8)] {
            try corrupt.write(to: manifest, options: .atomic)
            let reopened = LocalMediaLibrary(root: root)
            do { _ = try await reopened.catalog(requireComplete: true); XCTFail("Corruption interpreted as empty library") } catch {}
            do { _ = try await reopened.beginFolderUpdate(); XCTFail("Corrupt index overwritten") } catch {}
            XCTAssertEqual(try Data(contentsOf: manifest), corrupt)
            XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
        }
        try FileManager.default.removeItem(at: manifest)
        _ = LocalMediaLibrary(root: root)
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path), "An absent index is not authority to delete copies")
        try original.write(to: manifest, options: .atomic)
        let restored = try await LocalMediaLibrary(root: root).catalog(requireComplete: true)
        XCTAssertEqual(restored.count, 1)
    }
    func testFolderStartupRecoversAbandonedStagingAndOrphanWithoutFollowingLinks() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), audio = try silentAudio()
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), record = try await seedFolder(local, audio: audio)
        let tx = try await local.beginFolderUpdate()
        _ = try await local.stageFolderAudio(audio, transactionID: tx, rootID: record.id, plan: folderPlan("abandoned.wav"))
        let orphan = root.appendingPathComponent(".folder-generations/" + UUID().uuidString)
        try FileManager.default.createSymbolicLink(at: orphan, withDestinationURL: audio.deletingLastPathComponent())
        let reopened = LocalMediaLibrary(root: root), snapshot = try await reopened.folderSnapshot()
        XCTAssertEqual(snapshot.tracks.count, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: orphan.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(".folder-staging/" + tx).path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: audio.path))
        let copied = try await reopened.resolve(record.tracks[0].id)
        XCTAssertTrue(FileManager.default.fileExists(atPath: copied.path))
    }
    func testFolderCommitRejectsCorruptLyricsMissingAudioAndStaleManifest() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), audio = try silentAudio()
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), record = try await seedFolder(local, audio: audio)
        let manifest = root.appendingPathComponent("folders.json"), original = try Data(contentsOf: manifest)
        for corruption in ["lyrics", "audio", "revision"] {
            let tx = try await local.beginFolderUpdate()
            let replacement = try await local.stageFolderAudio(audio, transactionID: tx, rootID: record.id, plan: folderPlan(), replacing: record.tracks[0].id)
            let staged = root.appendingPathComponent(".folder-staging/" + tx + "/" + replacement.generation)
            if corruption == "lyrics" { try Data("broken".utf8).write(to: staged.appendingPathComponent("lyrics.json")) }
            if corruption == "audio" { try FileManager.default.removeItem(at: staged.appendingPathComponent("audio.wav")) }
            var expectedManifest = original
            if corruption == "revision" {
                var changed = record; changed.name = "New name"
                expectedManifest = try JSONEncoder().encode(LocalFoldersDocument(roots: [changed]))
                try expectedManifest.write(to: manifest, options: .atomic)
            }
            var next = record; next.tracks = [replacement]
            do { _ = try await local.commitFolderUpdate(tx, roots: [next]); XCTFail("Invalid batch committed: " + corruption) } catch {}
            XCTAssertEqual(try Data(contentsOf: manifest), expectedManifest)
            XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(".folder-generations/" + replacement.generation).path))
            XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(".folder-staging/" + tx).path))
            try original.write(to: manifest, options: .atomic)
        }
    }
    func testFolderCatalogRejectsInvalidPathsDuplicateIdentitiesAndGenerationReassignment() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), audio = try silentAudio()
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), record = try await seedFolder(local, audio: audio)
        for path in ["../song.wav", "/song.wav", "sub//song.wav", "./song.wav", "sub\\song.wav", "song\n.wav"] {
            var invalid = record; invalid.tracks[0].source.path = path
            XCTAssertThrowsError(try LocalFoldersDocument(roots: [invalid]).validated())
        }
        XCTAssertThrowsError(try LocalFoldersDocument(roots: [record, record]).validated())
        let tx = try await local.beginFolderUpdate()
        var reassigned = record; reassigned.tracks[0].id = UUID().uuidString
        do { _ = try await local.commitFolderUpdate(tx, roots: [reassigned]); XCTFail("Generation reassigned") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "invalid-folder-transaction") }
        let current = try await local.folderSnapshot()
        XCTAssertEqual(current.tracks[record.tracks[0].id]?.generation, record.tracks[0].generation)
    }
}
