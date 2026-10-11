import XCTest
import AVFoundation
@testable import App

// LocalLibraryEntitiesTests.swift — actual imported files, match transactions and metadata-only queue reconciliation.
@MainActor extension NativeTests {
    private func entityFixture(_ local: LocalMediaLibrary, audio: URL) async throws -> String {
        let song = try await local.importAudio(audio), id = try XCTUnwrap(song["id"] as? String)
        var tagged = song
        tagged["artists"] = [["id": "", "name": "Original artist"]]
        tagged["album"] = ["id": "", "name": "Original album"]
        let root = await local.root
        try JSONSerialization.data(withJSONObject: tagged).write(to: root.appendingPathComponent(id + "/song.json"), options: .atomic)
        return id
    }
    private func assignment(_ snapshot: [String: Any], _ id: String) throws -> [String: Any] {
        try XCTUnwrap((snapshot["assignments"] as? [[String: Any]])?.first { $0["songId"] as? String == id })
    }
    private func splitArtist(_ local: LocalMediaLibrary, snapshot: [String: Any], id: String) async throws -> [String: Any] {
        let artist = try XCTUnwrap(assignment(snapshot, id)["artistEntityIds"] as? [String]).first!
        return try await local.editLibrary(revision: XCTUnwrap(snapshot["revision"] as? String), operation: [
            "type": "artists", "entityId": artist, "songIds": [id], "targets": [["displayName": "Organized artist"]], "mode": "replace"])
    }
    func testLibraryIntegrationRestoresEntitiesAndRejectsIncompleteOrStaleEdits() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), audio = try silentAudio()
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), id = try await entityFixture(local, audio: audio)
        let initial = try await local.librarySnapshot(), split = try await splitArtist(local, snapshot: initial, id: id)
        let fresh = try await LocalMediaLibrary(root: root).librarySnapshot()
        XCTAssertEqual(fresh["revision"] as? String, split["revision"] as? String)
        let song = try XCTUnwrap((fresh["songs"] as? [[String: Any]])?.first)
        XCTAssertEqual((song["artists"] as? [[String: Any]])?.first?["name"] as? String, "Organized artist")
        let file = root.appendingPathComponent("library-entities.json"), bytes = try Data(contentsOf: file)
        let artist = try XCTUnwrap(assignment(split, id)["artistEntityIds"] as? [String]).first!
        do {
            _ = try await local.editLibrary(revision: XCTUnwrap(initial["revision"] as? String),
                operation: ["type": "rename", "entityId": artist, "displayName": "Stale"])
            XCTFail("Stale edit accepted")
        } catch { XCTAssertEqual((error as? MobileFailure)?.code, "local-library-changed") }
        let incomplete = root.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: incomplete, withIntermediateDirectories: true)
        do {
            _ = try await local.editLibrary(revision: XCTUnwrap(split["revision"] as? String),
                operation: ["type": "rename", "entityId": artist, "displayName": "Incomplete"])
            XCTFail("Incomplete catalog accepted")
        } catch { XCTAssertEqual((error as? MobileFailure)?.code, "local-library-incomplete") }
        XCTAssertEqual(bytes, try Data(contentsOf: file))
        let playable = try await local.catalog()
        XCTAssertEqual(playable.count, 1)
    }
    func testLibraryMatchKeepsManualAssignmentsAndRejectsStaleRevision() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), audio = try silentAudio()
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), id = try await entityFixture(local, audio: audio)
        let before = try await local.readLocalMatch(id), split = try await splitArtist(local, snapshot: local.librarySnapshot(), id: id)
        let doc: [String: Any] = ["title": "Original title", "titleOrigin": "import", "artistNames": ["Original artist"], "albumName": "Original album"]
        let token = try XCTUnwrap((before["lyrics"] as? [String: Any])?["token"] as? String)
        do {
            _ = try await local.writeLocalMatch(id, token: token, document: doc, source: nil,
                libraryRevision: before["libraryRevision"] as? String, metadata: "online")
            XCTFail("Match overwrote a later manual edit")
        } catch { XCTAssertEqual((error as? MobileFailure)?.code, "local-library-changed") }
        let fresh = try await local.readLocalMatch(id)
        XCTAssertEqual((fresh["assignment"] as? [String: Any])?["artistOrigin"] as? String, "split")
        let kept = try await local.writeLocalMatch(id, token: token, document: doc, source: nil,
            libraryRevision: fresh["libraryRevision"] as? String, metadata: "keep")
        XCTAssertEqual((kept["artists"] as? [[String: Any]])?.first?["name"] as? String, "Organized artist")
        let reopened = LocalMediaLibrary(root: root), saved = try await reopened.librarySnapshot()
        XCTAssertEqual(try assignment(saved, id)["artistEntityIds"] as? [String], try assignment(split, id)["artistEntityIds"] as? [String])
        let current = try await reopened.readLocalMatch(id)
        let restored = try await reopened.writeLocalMatch(id, token: XCTUnwrap((current["lyrics"] as? [String: Any])?["token"] as? String),
            document: doc, source: nil, libraryRevision: current["libraryRevision"] as? String, metadata: "imported")
        XCTAssertEqual((restored["artists"] as? [[String: Any]])?.first?["name"] as? String, "Original artist")
    }
    func testLibraryPartialMatchAndProtectedOriginsPreserveUntouchedAssignments() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), audio = try silentAudio()
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio) }
        let local = LocalMediaLibrary(root: root), id = try await entityFixture(local, audio: audio)
        let initial = try await local.librarySnapshot()
        let split = try await splitArtist(local, snapshot: initial, id: id)
        let album = try XCTUnwrap(assignment(split, id)["albumEntityId"] as? String)
        _ = try await local.editLibrary(revision: XCTUnwrap(split["revision"] as? String),
            operation: ["type": "split", "entityId": album, "songIds": [id], "displayName": "Organized album"])
        let before = try await local.readLocalMatch(id)
        let doc: [String: Any] = ["title": "Matched", "titleOrigin": "manual-match", "artistNames": ["AC/DC"], "albumName": "Original album"]
        let first = try await local.writeLocalMatch(id, token: XCTUnwrap((before["lyrics"] as? [String: Any])?["token"] as? String),
            document: doc, source: nil, libraryRevision: before["libraryRevision"] as? String, metadata: "online",
            updateArtists: true, updateAlbum: false, protectOrigins: ["split"])
        XCTAssertEqual((first["artists"] as? [[String: Any]])?.first?["name"] as? String, "Organized artist")
        let next = try await local.readLocalMatch(id)
        let second = try await local.writeLocalMatch(id, token: XCTUnwrap((next["lyrics"] as? [String: Any])?["token"] as? String),
            document: doc, source: nil, libraryRevision: next["libraryRevision"] as? String, metadata: "online",
            updateArtists: true, updateAlbum: false)
        XCTAssertEqual((second["artists"] as? [[String: Any]])?.count, 1)
        XCTAssertEqual((second["artists"] as? [[String: Any]])?.first?["name"] as? String, "AC/DC")
        XCTAssertEqual((second["album"] as? [String: Any])?["name"] as? String, "Organized album")
    }
    func testLibraryEditingPreservesPlayingOccurrenceAndCanonicalizesStaleQueueMetadata() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), audio = try silentAudio()
        let suite = "folia.entities." + UUID().uuidString, defaults = UserDefaults(suiteName: suite)!
        defer {
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: audio)
        }
        let local = LocalMediaLibrary(root: root), id = try await entityFixture(local, audio: audio)
        let tested = PlaybackEngine(gateway: FailingGateway(), storage: defaults, local: local)
        tested.network.cancel(); defer { tested.stop() }
        let initial = try await tested.refreshLocalLibrary(), songs = try XCTUnwrap(initial["songs"] as? [[String: Any]])
        tested.queue = [songs[0], songs[0]]; tested.index = 0
        let item = AVPlayerItem(url: audio); tested.player.insert(item, after: nil)
        await tested.player.seek(to: CMTime(seconds: 0.4, preferredTimescale: 600))
        let generation = tested.generation, position = tested.playbackPosition
        let changed = try await splitArtist(local, snapshot: initial, id: id)
        tested.localLibraryChanged(try XCTUnwrap(changed["songs"] as? [[String: Any]]))
        XCTAssertTrue(tested.player.currentItem === item)
        XCTAssertEqual(tested.generation, generation)
        XCTAssertEqual(tested.playbackPosition, position, accuracy: 0.03)
        XCTAssertEqual((tested.currentSong?["artists"] as? [[String: Any]])?.first?["name"] as? String, "Organized artist")
        try tested.editQueue([songs[0], songs[0]], currentIndex: 0, expectedRevision: tested.queueRevision)
        XCTAssertTrue(tested.player.currentItem === item)
        XCTAssertEqual((tested.queue[1]["artists"] as? [[String: Any]])?.first?["name"] as? String, "Organized artist")
        try tested.editQueue([], currentIndex: -1, expectedRevision: tested.queueRevision)
        _ = try await tested.refreshLocalLibrary()
        XCTAssertEqual((tested.currentSong?["artists"] as? [[String: Any]])?.first?["name"] as? String, "Organized artist")
        let restored = PlaybackEngine(gateway: FailingGateway(), storage: defaults, local: LocalMediaLibrary(root: root))
        restored.network.cancel(); defer { restored.stop() }
        _ = try await restored.refreshLocalLibrary()
        XCTAssertEqual((restored.currentSong?["artists"] as? [[String: Any]])?.first?["name"] as? String, "Organized artist")
    }
}
