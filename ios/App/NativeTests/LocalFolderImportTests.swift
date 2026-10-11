import XCTest
@testable import App

// LocalFolderImportTests.swift — whole native batches using generated WAV files, never private music or accounts.
@MainActor extension NativeTests {
    private func importFixture(_ root: URL, name: String = "Source") throws -> URL {
        let source = root.appendingPathComponent(name), audio = try silentAudio()
        defer { try? FileManager.default.removeItem(at: audio) }
        try FileManager.default.createDirectory(at: source.appendingPathComponent("Album"), withIntermediateDirectories: true)
        for path in ["first.wav", "Album/second.wav"] { try FileManager.default.copyItem(at: audio, to: source.appendingPathComponent(path)) }
        try Data("[00:00.00]Original".utf8).write(to: source.appendingPathComponent("first.lrc"))
        return source
    }
    private func prepareBatch(_ local: LocalMediaLibrary, progress: [String: Any]) async throws -> String {
        let token = try XCTUnwrap(progress["token"] as? String), total = try XCTUnwrap(progress["total"] as? Int)
        for index in 0..<total {
            let files = try await local.readFolderImport(token, index: index)
            func decode(_ key: String) throws -> String? {
                guard let file = files[key] as? [String: String] else { return nil }
                let bytes = try XCTUnwrap(Data(base64Encoded: XCTUnwrap(file["data"])))
                return try XCTUnwrap(String(data: bytes, encoding: .utf8))
            }
            _ = try await local.prepareFolderImport(token, index: index,
                contents: LocalFolderLyricContents(lyric: decode("lyric"), translation: decode("translation")))
        }
        return token
    }
    private func importBatch(_ local: LocalMediaLibrary, source: URL? = nil, rootID: String? = nil,
                             ignored: [String]? = nil) async throws -> [String: Any] {
        let progress = try await local.beginFolderImport(token: UUID().uuidString, source: source, rootID: rootID, ignoredPaths: ignored)
        return try await local.finishFolderImport(prepareBatch(local, progress: progress))
    }
    func testFolderImportCommitsReopensAndReusesStableGenerations() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try importFixture(root), location = root.appendingPathComponent("Library"), local = LocalMediaLibrary(root: location)
        let result = try await importBatch(local, source: source)
        XCTAssertEqual(result["count"] as? Int, 2)
        let initial = try await local.folderSnapshot(), rootID = try XCTUnwrap(result["rootID"] as? String)
        let restarted = LocalMediaLibrary(root: location)
        let progress = try await restarted.beginFolderImport(token: UUID().uuidString, rootID: rootID)
        XCTAssertEqual(progress["total"] as? Int, 0); XCTAssertEqual(progress["reused"] as? Int, 2)
        _ = try await restarted.finishFolderImport(XCTUnwrap(progress["token"] as? String))
        let final = try await restarted.folderSnapshot()
        // Refreshed bookmarks can change index bytes even when the media itself is unchanged.
        XCTAssertEqual(final.document.roots.map(\.id), initial.document.roots.map(\.id))
        XCTAssertEqual(final.tracks.mapValues(\.generation), initial.tracks.mapValues(\.generation))
        let publicData = try await restarted.folderCatalog(), text = String(data: try JSONSerialization.data(withJSONObject: publicData), encoding: .utf8)!
        XCTAssertFalse(text.contains("bookmark")); XCTAssertFalse(text.contains(source.path)); XCTAssertFalse(text.contains("generation"))
    }
    func testFolderImportRequiresEveryTrackAndRejectsOutOfOrderOrRepeatedPreparation() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try importFixture(root), local = LocalMediaLibrary(root: root.appendingPathComponent("Library")), token = UUID().uuidString
        _ = try await local.beginFolderImport(token: token, source: source)
        do { _ = try await local.finishFolderImport(token); XCTFail("Partial commit") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "folder-incomplete") }
        do { _ = try await local.readFolderImport(token, index: 1); XCTFail("Skipped track") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "folder-progress-changed") }
        do { _ = try await local.prepareFolderImport(token, index: 0, contents: LocalFolderLyricContents()); XCTFail("No read handshake") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "invalid-folder-lyrics") }
        _ = try await local.readFolderImport(token, index: 0)
        _ = try await local.prepareFolderImport(token, index: 0, contents: LocalFolderLyricContents())
        do { _ = try await local.prepareFolderImport(token, index: 0, contents: LocalFolderLyricContents()); XCTFail("Repeated track") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "folder-progress-changed") }
        await local.cancelFolderImport(token)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("Library/folders.json").path))
    }
    func testFolderImportCancellationAndConcurrentEditsKeepPriorCatalog() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try importFixture(root), local = LocalMediaLibrary(root: root.appendingPathComponent("Library"))
        _ = try await importBatch(local, source: source)
        let manifest = root.appendingPathComponent("Library/folders.json"), original = try Data(contentsOf: manifest)
        for mode in ["cancel", "edit"] {
            try Data(("[00:00.00]" + mode).utf8).write(to: source.appendingPathComponent("first.lrc"))
            let progress = try await local.beginFolderImport(token: UUID().uuidString, source: source)
            let token = try await prepareBatch(local, progress: progress)
            if mode == "cancel" { await local.cancelFolderImport(token) }
            else { _ = try await local.importAudio(source.appendingPathComponent("first.wav")) }
            do { _ = try await local.finishFolderImport(token); XCTFail("Stale commit") } catch {}
            await local.cancelFolderImport(token)
            XCTAssertEqual(try Data(contentsOf: manifest), original)
        }
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("Library/.folder-staging").path).isEmpty)
    }
    func testFolderImportFinalScanRejectsAddedAndChangedFiles() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try importFixture(root), local = LocalMediaLibrary(root: root.appendingPathComponent("Library"))
        _ = try await importBatch(local, source: source)
        let manifest = root.appendingPathComponent("Library/folders.json"), original = try Data(contentsOf: manifest)
        for mode in ["added", "changed"] {
            let progress = try await local.beginFolderImport(token: UUID().uuidString, source: source)
            let token = try await prepareBatch(local, progress: progress)
            if mode == "added" { try FileManager.default.copyItem(at: source.appendingPathComponent("first.wav"), to: source.appendingPathComponent("third.wav")) }
            else { try Data("[00:00.00]Changed".utf8).write(to: source.appendingPathComponent("first.lrc")) }
            do { _ = try await local.finishFolderImport(token); XCTFail("Stale scan commit") }
            catch { XCTAssertEqual((error as? MobileFailure)?.code, "folder-file-changed") }
            XCTAssertEqual(try Data(contentsOf: manifest), original)
        }
    }
    func testFolderImportOptionalLyricsAndUnsupportedAudioHaveExplicitWarnings() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try importFixture(root), local = LocalMediaLibrary(root: root.appendingPathComponent("Library"))
        try Data(repeating: 65, count: 2_000_001).write(to: source.appendingPathComponent("first.lrc"))
        try Data("[00:00.00]Translation".utf8).write(to: source.appendingPathComponent("first.t.lrc"))
        try Data("Unsupported test fixture".utf8).write(to: source.appendingPathComponent("third.opus"))
        let result = try await importBatch(local, source: source)
        XCTAssertEqual(result["count"] as? Int, 2)
        let warnings = try XCTUnwrap(result["warnings"] as? [[String: String]])
        XCTAssertTrue(warnings.contains(["path": "first.wav", "code": "folder-lyric-unavailable"]))
        XCTAssertTrue(warnings.contains(["path": "third.opus", "code": "unsupported-audio"]))
        let snapshot = try await local.folderSnapshot(), track = try XCTUnwrap(snapshot.tracks.values.first { $0.source.path == "first.wav" })
        let record = try await local.lyricSource(track.id)
        XCTAssertEqual(record?.content, ""); XCTAssertEqual(record?.translationContent, "[00:00.00]Translation")
    }
    func testFolderImportIgnoreRestoreRemoveNeverModifiesSource() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = try importFixture(root), local = LocalMediaLibrary(root: root.appendingPathComponent("Library"))
        let result = try await importBatch(local, source: source), rootID = try XCTUnwrap(result["rootID"] as? String)
        let ignored = try await importBatch(local, rootID: rootID, ignored: ["Album"])
        XCTAssertEqual(ignored["count"] as? Int, 1)
        let restored = try await importBatch(local, rootID: rootID, ignored: [])
        XCTAssertEqual(restored["count"] as? Int, 2)
        let snapshot = try await local.folderSnapshot()
        try await local.removeFolder(rootID, revision: snapshot.revision)
        let empty = try await local.folderSnapshot(); XCTAssertTrue(empty.tracks.isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: source.appendingPathComponent("Album/second.wav").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: source.appendingPathComponent("first.lrc").path))
    }
    func testFolderImportMatchesDirectoryIdentityNotName() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let first = try importFixture(root, name: "A/Music"), second = try importFixture(root, name: "B/Music")
        let local = LocalMediaLibrary(root: root.appendingPathComponent("Library"))
        let initial = try await importBatch(local, source: first), other = try await importBatch(local, source: second)
        XCTAssertNotEqual(initial["rootID"] as? String, other["rootID"] as? String)
        let repeated = try await importBatch(local, source: first)
        XCTAssertEqual(initial["rootID"] as? String, repeated["rootID"] as? String)
        do {
            _ = try await local.beginFolderImport(token: UUID().uuidString, source: second, rootID: initial["rootID"] as? String)
            XCTFail("Directory identity replaced")
        } catch { XCTAssertEqual((error as? MobileFailure)?.code, "folder-identity-mismatch") }
        let snapshot = try await local.folderSnapshot(); XCTAssertEqual(snapshot.document.roots.count, 2)
    }
}
