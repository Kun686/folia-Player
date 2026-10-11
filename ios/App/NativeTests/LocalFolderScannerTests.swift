import XCTest
@testable import App

// LocalFolderScannerTests.swift — real coordinated filesystem reads and bundled original JavaScript rules.
@MainActor extension NativeTests {
    private func assertFolderScanFails(_ scanner: LocalFolderScanner, _ source: URL, file: StaticString = #filePath, line: UInt = #line) async {
        do { _ = try await scanner.scan(source); XCTFail("Invalid scan succeeded", file: file, line: line) }
        catch { XCTAssertFalse(error is CancellationError, file: file, line: line) }
    }
    private func folderFixture(_ root: URL, _ path: String, _ text: String = "audio candidate") throws {
        let file = root.appendingPathComponent(path)
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(text.utf8).write(to: file)
    }
    func testFolderScanInheritsIgnoreAndSelectsOriginalSidecars() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try folderFixture(root, ".foliaignore", "cache/\n*.mp3\n")
        try folderFixture(root, "disc/.foliaignore", "!keep.mp3")
        for name in ["disc/keep.mp3", "disc/skip.mp3", "cache/hidden.wav", "disc/keep.lrc", "disc/keep.mp3.fia",
                     "disc/keep.t.vtt", "disc/cover.jpg", "disc/cover.png", "removed/song.wav"] { try folderFixture(root, name) }
        let scan = try await LocalFolderScanner().scan(root, ignoredPaths: ["removed"])
        let tracks = try XCTUnwrap(scan.plan["tracks"] as? [[String: Any]])
        XCTAssertEqual(tracks.count, 1)
        XCTAssertEqual(tracks[0]["path"] as? String, "disc/keep.mp3")
        XCTAssertEqual(tracks[0]["lyric"] as? String, "disc/keep.mp3.fia")
        XCTAssertEqual(tracks[0]["translation"] as? String, "disc/keep.t.vtt")
        XCTAssertEqual(tracks[0]["cover"] as? String, "disc/cover.png")
        XCTAssertTrue(scan.directories.contains { $0["path"] as? String == "removed" && $0["ignored"] as? Bool == true })
        XCTAssertFalse(scan.directories.contains { $0["path"] as? String == "cache" })
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("cache/hidden.wav").path))
    }
    func testFolderScanReusesSignaturesAndDetectsSidecarAndAudioRemoval() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        for path in ["a/song.wav", "a/song.lrc", "b/song.wav"] { try folderFixture(root, path) }
        let scanner = LocalFolderScanner(), first = try await scanner.scan(root)
        let tracks = try XCTUnwrap(first.plan["tracks"] as? [[String: Any]])
        let repeated = try await scanner.scan(root, previous: tracks)
        XCTAssertEqual(repeated.plan["changed"] as? [String], [])
        try folderFixture(root, "a/song.lrc", "[00:00.00]changed lyrics")
        try FileManager.default.removeItem(at: root.appendingPathComponent("b/song.wav"))
        let second = try await scanner.scan(root, previous: tracks)
        XCTAssertEqual(second.plan["changed"] as? [String], ["a/song.wav"])
        XCTAssertEqual(second.plan["removed"] as? [String], ["b/song.wav"])
        let next = try XCTUnwrap((second.plan["tracks"] as? [[String: Any]])?.first)
        XCTAssertEqual(next["audioSignature"] as? String, tracks[0]["audioSignature"] as? String)
    }
    func testFolderScanNeverFollowsSymlinksOrAcceptsMissingRoot() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let outside = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: outside) }
        try folderFixture(root, "song.wav"); try folderFixture(outside, "secret.wav")
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("escape"), withDestinationURL: outside)
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("alias.wav"), withDestinationURL: outside.appendingPathComponent("secret.wav"))
        let scan = try await LocalFolderScanner().scan(root)
        XCTAssertEqual((scan.plan["tracks"] as? [[String: Any]])?.count, 1)
        await assertFolderScanFails(LocalFolderScanner(), root.appendingPathComponent("escape"))
        await assertFolderScanFails(LocalFolderScanner(), root.appendingPathComponent("missing"))
    }
    func testFolderScanLimitsAndInvalidIgnoreFailWithoutChangingFiles() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try folderFixture(root, "a/b/song.wav")
        await assertFolderScanFails(LocalFolderScanner(maximumDepth: 1), root)
        await assertFolderScanFails(LocalFolderScanner(maximumEntries: 1), root)
        let ignore = root.appendingPathComponent(".foliaignore")
        try Data([0xff, 0xfe, 0xfd]).write(to: ignore)
        await assertFolderScanFails(LocalFolderScanner(), root)
        try Data(repeating: 65, count: 262_145).write(to: ignore)
        await assertFolderScanFails(LocalFolderScanner(), root)
        XCTAssertEqual(try String(contentsOf: root.appendingPathComponent("a/b/song.wav"), encoding: .utf8), "audio candidate")
    }
    func testFolderScanCancellationReturnsNoPlan() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try folderFixture(root, "song.wav")
        let work = Task { @MainActor in
            withUnsafeCurrentTask { $0?.cancel() }
            return try await LocalFolderScanner().scan(root)
        }
        do { _ = try await work.value; XCTFail("Cancelled scan returned a plan") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("song.wav").path))
    }
}
