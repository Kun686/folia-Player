import Foundation

// LocalLibraryEntities.swift — one actor owns complete input snapshots, conflict checks, and entity commits.
extension LocalMediaLibrary {
    struct LibraryInputs {
        var songs: [[String: Any]] = []
        var bases: [[String: Any]] = []
        var inputs: [[String: Any]] = []
        var documents: [String: Any] = [:]
    }
    func libraryInput(_ id: String, base: [String: Any], record: LyricSource?) throws -> [String: Any] {
        if let text = record?.libraryMetadataJSON {
            guard let data = text.data(using: .utf8), let input = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  input["songId"] as? String == id else { throw MobileFailure("invalid-local-library") }
            return input
        }
        let doc = try matchDocument(record)
        let origin = doc?["titleOrigin"] as? String ?? "import"
        return ["songId": id, "artistNames": doc?["artistNames"] as? [String]
                    ?? (base["artists"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String },
                "albumName": doc?["albumName"] as? String ?? (base["album"] as? [String: Any])?["name"] as? String ?? "",
                "origin": origin, "metadataRevision": ""]
    }
    func libraryInputs(overrides: [String: LyricSource] = [:]) throws -> LibraryInputs {
        var result = LibraryInputs()
        // Complete reads fail for partial imports, corrupt match records or missing audio; never prune on a partial view.
        for song in try rawCatalog(requireComplete: true) {
            guard let id = (song["sourceRef"] as? [String: String])?["mediaId"] else { throw MobileFailure("local-library-incomplete") }
            let base = try importedSong(id), record = try overrides[id] ?? lyricSource(id)
            result.bases.append(base)
            result.songs.append(try matchedSong(id, base: base, record: record))
            result.inputs.append(try libraryInput(id, base: base, record: record))
            if let doc = try matchDocument(record) { result.documents[id] = doc }
        }
        return result
    }
    func librarySnapshot(overrides: [String: LyricSource] = [:]) throws -> [String: Any] {
        let value = try libraryInputs(overrides: overrides)
        let snapshot = try libraryStore.snapshot(inputs: value.inputs)
        return try libraryStore.project(snapshot, songs: value.songs, bases: value.bases, documents: value.documents)
    }
    func editLibrary(revision: String, operation: [String: Any]) throws -> [String: Any] {
        let value = try libraryInputs()
        var result: [String: Any] = [:]
        _ = try libraryStore.apply(inputs: value.inputs, expectedRevision: revision, operation: operation) { snapshot in
            result = try libraryStore.project(snapshot, songs: value.songs, bases: value.bases, documents: value.documents)
        }
        return result
    }
    func displayedSong(_ id: String, base: [String: Any]? = nil) throws -> [String: Any] {
        guard let song = (try librarySnapshot()["songs"] as? [[String: Any]])?.first(where: { $0["id"] as? String == id })
        else { throw MobileFailure("invalid-local-identity") }
        return song
    }
}
