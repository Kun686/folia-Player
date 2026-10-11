import Foundation
import CryptoKit

// LocalFolderStore.swift — one actor owns the index; its atomic swap is the sole visibility/commit point.
final class LocalFolderStore {
    struct Snapshot {
        let revision: String
        let document: LocalFoldersDocument
        let tracks: [String: LocalFolderTrack]
    }
    let root: URL
    var generations: URL { root.appendingPathComponent(".folder-generations", isDirectory: true) }
    var staging: URL { root.appendingPathComponent(".folder-staging", isDirectory: true) }
    private var file: URL { root.appendingPathComponent("folders.json") }
    private var cached: Snapshot?
    init(root: URL) { self.root = root }

    func snapshot(refresh: Bool = false) throws -> Snapshot {
        if let cached, !refresh { return cached }
        let data: Data
        do { data = try read(file, limit: 32_000_000) }
        catch let error as CocoaError where error.code == .fileReadNoSuchFile || error.code == .fileNoSuchFile { data = Data() }
        let document = try (data.isEmpty ? LocalFoldersDocument() : JSONDecoder().decode(LocalFoldersDocument.self, from: data)).validated()
        // An existing zero-byte document is corruption, never an empty library.
        guard !data.isEmpty || !FileManager.default.fileExists(atPath: file.path) else { throw MobileFailure("invalid-folder-catalog") }
        let tracks = Dictionary(uniqueKeysWithValues: document.roots.flatMap(\.tracks).map { ($0.id, $0) })
        let value = Snapshot(revision: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(), document: document, tracks: tracks)
        cached = value
        return value
    }
    func location(_ track: LocalFolderTrack) throws -> URL {
        guard UUID(uuidString: track.generation) != nil else { throw MobileFailure("invalid-folder-catalog") }
        let result = generations.appendingPathComponent(track.generation, isDirectory: true)
        try requireDirectory(generations); try requireDirectory(result)
        return result
    }
    func begin() throws -> URL {
        _ = try snapshot()
        try createDirectory(root); try createDirectory(staging)
        let transaction = staging.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try createDirectory(transaction)
        return transaction
    }
    func discard(_ transaction: URL) throws {
        try validateTransaction(transaction)
        if FileManager.default.fileExists(atPath: transaction.path) { try FileManager.default.removeItem(at: transaction) }
    }
    // New generations are prepared out of view. On any pre-commit failure only those new generations are removed.
    func commit(_ document: LocalFoldersDocument, expectedRevision: String, transaction: URL? = nil) throws -> Snapshot {
        let current = try snapshot(refresh: true)
        guard current.revision == expectedRevision else { throw MobileFailure("local-library-changed") }
        let checked = try document.validated(), encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(checked)
        guard data.count <= 32_000_000 else { throw MobileFailure("folder-too-large") }
        let priorGenerations = Set(current.tracks.values.map(\.generation)), nextTracks = checked.roots.flatMap(\.tracks)
        let added = nextTracks.filter { !priorGenerations.contains($0.generation) }
        if let transaction { try validateTransaction(transaction); try requireDirectory(transaction) }
        guard added.isEmpty || transaction != nil else { throw MobileFailure("invalid-folder-transaction") }
        // Existing generations cannot be reassigned to another song id.
        let owners = Dictionary(uniqueKeysWithValues: current.tracks.values.map { ($0.generation, $0.id) })
        let rootsBySong = Dictionary(uniqueKeysWithValues: checked.roots.flatMap { root in root.tracks.map { ($0.id, root.id) } })
        for track in nextTracks {
            guard owners[track.generation] == nil || owners[track.generation] == track.id,
                  !FileManager.default.fileExists(atPath: root.appendingPathComponent(track.id).path)
            else { throw MobileFailure("invalid-folder-transaction") }
            let directory = priorGenerations.contains(track.generation) ? try location(track)
                : transaction!.appendingPathComponent(track.generation, isDirectory: true)
            try validateMedia(directory, id: track.id, rootID: rootsBySong[track.id]!, path: track.source.path)
        }
        let result = Snapshot(revision: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(), document: checked,
            tracks: Dictionary(uniqueKeysWithValues: nextTracks.map { ($0.id, $0) }))
        var moved: [URL] = []
        do {
            try Task.checkCancellation()
            try createDirectory(root); try createDirectory(generations)
            for track in added {
                try Task.checkCancellation()
                let target = generations.appendingPathComponent(track.generation, isDirectory: true)
                guard !FileManager.default.fileExists(atPath: target.path) else { throw MobileFailure("invalid-folder-transaction") }
                try FileManager.default.moveItem(at: transaction!.appendingPathComponent(track.generation), to: target)
                moved.append(target)
            }
            try Task.checkCancellation()
            try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            for url in moved { try? FileManager.default.removeItem(at: url) }
            throw error
        }
        cached = result
        // No throwing work after the atomic commit: cleanup cannot misreport a successful import as a failure.
        if let transaction { try? discard(transaction) }
        return result
    }
    // Call only during startup, before playback obtains file URLs. Old generations stay readable until then.
    func recoverBeforePlayback() throws {
        let current = try snapshot(refresh: true), live = Set(current.tracks.values.map(\.generation))
        for (directory, keep) in [(staging, Set<String>()), (generations, live)] {
            // Missing index is also possible after external damage; retain media until an authoritative index exists.
            if directory == generations, !FileManager.default.fileExists(atPath: file.path) { continue }
            guard FileManager.default.fileExists(atPath: directory.path) else { continue }
            try requireDirectory(directory)
            for child in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isSymbolicLinkKey]) {
                guard UUID(uuidString: child.lastPathComponent) != nil, !keep.contains(child.lastPathComponent) else { continue }
                // removeItem on a symlink removes only that link; never enumerate or follow its target.
                try FileManager.default.removeItem(at: child)
            }
        }
    }
}
