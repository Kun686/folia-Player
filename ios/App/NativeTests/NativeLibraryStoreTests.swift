import XCTest
@testable import App

// NativeLibraryStoreTests.swift — real JavaScriptCore and disk transactions without WKWebView or music accounts.
@MainActor extension NativeTests {
    private func libraryInputs() -> [[String: Any]] {
        ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"].map {
            ["songId": $0, "artistNames": ["Artist"], "albumName": "Album", "origin": "import", "metadataRevision": ""]
        }
    }
    private func libraryArtist(_ snapshot: NativeLibraryStore.Snapshot) throws -> [String: Any] {
        let entities = try XCTUnwrap(snapshot.record["entities"] as? [[String: Any]])
        return try XCTUnwrap(entities.first { $0["kind"] as? String == "artist" })
    }
    func testNativeLibraryStableIdentityAndRestart() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = NativeLibraryStore(root: root), inputs = libraryInputs()
        let initial = try store.snapshot(inputs: inputs)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.path))
        XCTAssertEqual(initial.revision, try store.snapshot(inputs: Array(inputs.reversed())).revision)
        let id = try XCTUnwrap(libraryArtist(initial)["id"] as? String)
        let saved = try store.apply(inputs: inputs, expectedRevision: initial.revision,
            operation: ["type": "rename", "entityId": id, "displayName": "整理后的歌手"])
        let restarted = try NativeLibraryStore(root: root).snapshot(inputs: inputs)
        XCTAssertEqual(saved.revision, restarted.revision)
        XCTAssertEqual(try libraryArtist(restarted)["id"] as? String, id)
        XCTAssertEqual(try libraryArtist(restarted)["displayName"] as? String, "整理后的歌手")
        let attrs = try FileManager.default.attributesOfItem(atPath: root.appendingPathComponent("library-entities.json").path)
        let protection = (attrs[.protectionKey] as? FileProtectionType)?.rawValue ?? attrs[.protectionKey] as? String
        #if targetEnvironment(simulator)
        // Simulator can omit iOS Data Protection attributes; only a device can prove that policy.
        if let protection { XCTAssertEqual(protection, FileProtectionType.completeUntilFirstUserAuthentication.rawValue) }
        else { print("NOT_RUN_SIMULATOR: file Data Protection attribute unavailable") }
        #else
        XCTAssertEqual(protection, FileProtectionType.completeUntilFirstUserAuthentication.rawValue)
        #endif
    }
    func testNativeLibraryRejectsStaleMetadataAndStaleEdits() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = NativeLibraryStore(root: root), inputs = libraryInputs(), before = try store.snapshot(inputs: inputs)
        let id = try XCTUnwrap(libraryArtist(before)["id"] as? String)
        let operation: [String: Any] = ["type": "rename", "entityId": id, "displayName": "New"]
        var changed = inputs; changed[0]["metadataRevision"] = "new-match"
        XCTAssertThrowsError(try store.apply(inputs: changed, expectedRevision: before.revision, operation: operation)) {
            XCTAssertEqual(($0 as? MobileFailure)?.code, "local-library-changed")
        }
        _ = try store.apply(inputs: inputs, expectedRevision: before.revision, operation: operation)
        let file = root.appendingPathComponent("library-entities.json"), data = try Data(contentsOf: file)
        XCTAssertThrowsError(try store.apply(inputs: inputs, expectedRevision: before.revision, operation: operation)) {
            XCTAssertEqual(($0 as? MobileFailure)?.code, "local-library-changed")
        }
        XCTAssertEqual(data, try Data(contentsOf: file))
    }
    func testNativeLibraryCorruptOrUnsupportedStateNeverResets() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("library-entities.json"), store = NativeLibraryStore(root: root)
        for content in ["broken json", "null", "{\"version\":2,\"entities\":[],\"assignments\":[],\"sources\":[]}"] {
            let data = Data(content.utf8); try data.write(to: file, options: .atomic)
            XCTAssertThrowsError(try store.snapshot(inputs: libraryInputs()))
            XCTAssertEqual(data, try Data(contentsOf: file))
        }
    }
    func testNativeLibraryFailedWriteKeepsCommittedBytes() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer {
            try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
            try? FileManager.default.removeItem(at: root)
        }
        let store = NativeLibraryStore(root: root), inputs = libraryInputs(), initial = try store.snapshot(inputs: inputs)
        let id = try XCTUnwrap(libraryArtist(initial)["id"] as? String)
        let saved = try store.apply(inputs: inputs, expectedRevision: initial.revision,
            operation: ["type": "rename", "entityId": id, "displayName": "Committed"])
        let file = root.appendingPathComponent("library-entities.json"), data = try Data(contentsOf: file)
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: root.path)
        XCTAssertThrowsError(try store.apply(inputs: inputs, expectedRevision: saved.revision,
            operation: ["type": "rename", "entityId": id, "displayName": "Should not persist"]))
        XCTAssertEqual(data, try Data(contentsOf: file))
        XCTAssertEqual(try store.snapshot(inputs: inputs).revision, saved.revision)
    }
    func testNativeLibrarySplitAndDeletedMemberCleanupWithoutWebView() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = NativeLibraryStore(root: root), inputs = libraryInputs(), initial = try store.snapshot(inputs: inputs)
        let id = try XCTUnwrap(libraryArtist(initial)["id"] as? String)
        let saved = try store.apply(inputs: inputs, expectedRevision: initial.revision, operation: ["type": "artists",
            "entityId": id, "songIds": [inputs[0]["songId"]!], "targets": [["displayName": "One"], ["displayName": "Two"]], "mode": "replace"])
        let assignments = try XCTUnwrap(saved.record["assignments"] as? [[String: Any]])
        XCTAssertEqual((assignments[0]["artistEntityIds"] as? [String])?.count, 2)
        XCTAssertEqual(assignments[0]["artistOrigin"] as? String, "split")
        let remaining = try store.snapshot(inputs: [inputs[1]])
        XCTAssertEqual((remaining.record["assignments"] as? [[String: Any]])?.count, 1)
        XCTAssertEqual((remaining.record["entities"] as? [[String: Any]])?.count, 2)
    }
}
