import Foundation

// LocalFolderTransactions.swift — staging is invisible; user edits invalidate a pending batch instead of being overwritten.
final class LocalFolderTransaction {
    let url: URL
    let revision: String
    let epoch: UUID
    let assignments: [String: [String: Any]]
    var pending = 0
    var warnings: [String: [String]] = [:]
    init(url: URL, revision: String, epoch: UUID, assignments: [String: [String: Any]]) {
        self.url = url; self.revision = revision; self.epoch = epoch; self.assignments = assignments
    }
    var id: String { url.lastPathComponent }
}
extension LocalMediaLibrary {
    func folderPreparationWarnings(_ id: String) throws -> [String: [String]] { try currentFolderUpdate(id).warnings }
    func folderSnapshot() throws -> LocalFolderStore.Snapshot { try folderStore.snapshot(refresh: true) }
    func beginFolderUpdate() throws -> String {
        guard folderTransaction == nil else { throw MobileFailure("folder-busy") }
        let folders = try folderStore.snapshot(refresh: true), library = try librarySnapshot()
        let assignments = (library["assignments"] as? [[String: Any]] ?? []).reduce(into: [String: [String: Any]]()) { result, item in
            if let id = item["songId"] as? String { result[id] = item }
        }
        let transaction = LocalFolderTransaction(url: try folderStore.begin(), revision: folders.revision, epoch: mediaEpoch, assignments: assignments)
        folderTransaction = transaction
        return transaction.id
    }
    func currentFolderUpdate(_ id: String) throws -> LocalFolderTransaction {
        guard let transaction = folderTransaction, transaction.id == id else { throw MobileFailure("folder-cancelled") }
        guard transaction.epoch == mediaEpoch else { throw MobileFailure("local-library-changed") }
        return transaction
    }
    func cancelFolderUpdate(_ id: String) {
        guard let transaction = folderTransaction, transaction.id == id else { return }
        folderTransaction = nil
        if transaction.pending == 0 { try? folderStore.discard(transaction.url) }
    }
    func finishFolderPreparation(_ transaction: LocalFolderTransaction) {
        transaction.pending -= 1
        if transaction.pending == 0, folderTransaction !== transaction { try? folderStore.discard(transaction.url) }
    }
    func commitFolderUpdate(_ id: String, roots: [LocalFolderRecord]) throws -> LocalFolderStore.Snapshot {
        guard let transaction = folderTransaction, transaction.id == id else { throw MobileFailure("folder-cancelled") }
        guard transaction.pending == 0 else { throw MobileFailure("folder-busy") }
        defer { cancelFolderUpdate(id) }
        _ = try currentFolderUpdate(id)
        let old = try folderStore.snapshot()
        let result = try folderStore.commit(LocalFoldersDocument(roots: roots), expectedRevision: transaction.revision, transaction: transaction.url)
        mediaEpoch = UUID()
        // Pending lyric parsing must not write to a generation that has just been replaced or removed.
        for (songID, track) in old.tracks where result.tracks[songID]?.generation != track.generation { lyricEditTokens[songID] = UUID().uuidString }
        return result
    }
}
