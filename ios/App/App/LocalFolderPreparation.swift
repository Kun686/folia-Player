import Foundation

// LocalFolderPreparation.swift — one pending track, original foreground decoding, optional-sidecar warnings and strict cancellation.
extension LocalMediaLibrary {
    private func folderWork(_ token: String, index: Int) throws -> (LocalFolderImportSession, LocalFolderTrackPlan, LocalFolderFiles) {
        let session = try currentFolderImport(token)
        guard !session.busy, session.index == index, index >= 0, index < session.work.count, let files = session.files
        else { throw MobileFailure("folder-progress-changed") }
        return (session, session.work[index], files)
    }
    func readFolderImport(_ token: String, index: Int) throws -> [String: Any] {
        let (session, plan, files) = try folderWork(token, index: index)
        let old = session.root.tracks.first { $0.source.path == plan.path }
        let policy = try folderLyricPolicy(transactionID: session.transaction, rootID: session.root.id, plan: plan, replacing: old?.id)
        var result: [String: Any] = [:]
        session.omitted.removeAll()
        for (key, path) in [("lyric", policy.keepLyric ? nil : plan.lyric), ("translation", policy.keepTranslation ? nil : plan.translation)] {
            guard let path else { continue }
            do { result[key] = try files.lyric(path) }
            catch let error as MobileFailure where error.code == "folder-file-too-large" {
                // Optional oversized lyrics are skipped like desktop; missing/changed files still abort the batch.
                session.omitted.insert(key)
            }
        }
        session.readIndex = index
        return result
    }
    func prepareFolderImport(_ token: String, index: Int, contents: LocalFolderLyricContents,
                             skipped: [String] = []) async throws -> [String: Any] {
        let (session, plan, files) = try folderWork(token, index: index)
        guard session.readIndex == index, skipped.count <= 2, Set(skipped).isSubset(of: ["lyric", "translation"])
        else { throw MobileFailure("invalid-folder-lyrics") }
        session.busy = true
        defer { session.busy = false }
        let old = session.root.tracks.first { $0.source.path == plan.path }
        var decoded = contents
        let omitted = session.omitted.union(skipped)
        for key in omitted {
            guard (key == "lyric" ? plan.lyric : plan.translation) != nil else { throw MobileFailure("invalid-folder-lyrics") }
            if key == "lyric" { decoded.lyric = "" } else { decoded.translation = "" }
        }
        do {
            let source = try files.checkedURL(plan.path)
            let track = try await stageFolderAudio(source, transactionID: session.transaction, rootID: session.root.id,
                plan: plan, replacing: old?.id, sidecars: LocalFolderSidecars(files: files, contents: decoded))
            _ = try currentFolderImport(token)
            session.prepared[plan.path] = track
            for key in omitted.sorted() { session.warn(plan.path, "folder-" + key + "-unavailable") }
        } catch let error as MobileFailure where error.code == "unsupported-audio" {
            _ = try currentFolderImport(token)
            _ = try files.checkedURL(plan.path)
            // An undecodable replacement must not erase the last playable app-owned version.
            if let old { session.prepared[plan.path] = old } else { session.skippedCount += 1 }
            session.warn(plan.path, "unsupported-audio")
        }
        session.index += 1; session.readIndex = nil; session.omitted.removeAll()
        return session.progress()
    }
}
