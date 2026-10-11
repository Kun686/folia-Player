import Foundation

// LocalFolderImport.swift — select/reopen, scan and atomically commit; bookmarks and absolute paths never cross the bridge.
extension LocalMediaLibrary {
    func beginFolderImport(token: String, source: URL? = nil, rootID: String? = nil,
                           ignoredPaths: [String]? = nil, order: [String] = []) async throws -> [String: Any] {
        guard UUID(uuidString: token) != nil, folderImport == nil else { throw MobileFailure("folder-busy") }
        guard order.count <= 16, order.allSatisfy({ $0.utf8.count <= 16 }) else { throw MobileFailure("invalid-folder-scan") }
        let roots = try folderSnapshot().document.roots
        var existing = roots.first { $0.id == rootID }
        if rootID != nil, existing == nil { throw MobileFailure("folder-not-found") }
        let access: LocalFolderAuthorization.Access
        if let source {
            access = try LocalFolderAuthorization.Access(url: source)
            existing = nil
            // Identity, never the display name, decides whether a selected directory is an existing root.
            for root in roots {
                // One offline provider/root must not prevent importing a different available directory.
                guard let candidate = try? LocalFolderAuthorization.open(root.bookmark) else {
                    if root.id == rootID { throw MobileFailure("folder-access-required") }
                    continue
                }
                defer { candidate.close() }
                if try LocalFolderAuthorization.sameDirectory(access.url, candidate.url) { existing = root; break }
            }
            if let rootID, existing?.id != rootID { throw MobileFailure("folder-identity-mismatch") }
        } else if let existing { access = try LocalFolderAuthorization.open(existing.bookmark) }
        else { throw MobileFailure("folder-access-required") }
        var root = existing ?? LocalFolderRecord(id: UUID().uuidString, name: access.url.lastPathComponent,
            bookmark: access.bookmark, ignoredPaths: [], directories: [], tracks: [])
        root.bookmark = access.bookmark
        if let ignoredPaths {
            guard existing != nil, ignoredPaths.count <= 50_000 else { throw MobileFailure("invalid-folder-path") }
            for path in ignoredPaths { try LocalFoldersDocument.validatePath(path) }
            root.ignoredPaths = Array(Set(ignoredPaths)).sorted()
        }
        let transaction = try beginFolderUpdate()
        let session = LocalFolderImportSession(token: token, transaction: transaction, access: access, roots: roots, root: root, order: order)
        folderImport = session
        do {
            let scan = try await scanFolder(access.url, ignoredPaths: root.ignoredPaths, lyricFormatOrder: order, previous: session.previous)
            _ = try currentFolderImport(token)
            let plans = try JSONDecoder().decode([LocalFolderTrackPlan].self, from: JSONSerialization.data(withJSONObject: scan.plan["tracks"] ?? []))
            let files = try JSONDecoder().decode([LocalFolderFile].self, from: JSONSerialization.data(withJSONObject: scan.files))
            let directories = try JSONDecoder().decode([LocalFolderNode].self, from: JSONSerialization.data(withJSONObject: scan.directories))
            guard let changed = scan.plan["changed"] as? [String] else { throw MobileFailure("invalid-folder-scan") }
            let changedPaths = Set(changed), prior = Dictionary(uniqueKeysWithValues: root.tracks.map { ($0.source.path, $0) })
            for plan in plans {
                if !changedPaths.contains(plan.path), let old = prior[plan.path], (try? resolve(old.id)) != nil { session.prepared[plan.path] = old }
                else { session.work.append(plan) }
            }
            session.scan = scan; session.plans = plans; session.root.directories = directories
            session.files = try LocalFolderFiles(root: access.url, files: files)
            return session.progress()
        } catch { cancelFolderImport(token); throw error }
    }
    func currentFolderImport(_ token: String) throws -> LocalFolderImportSession {
        try Task.checkCancellation()
        guard let session = folderImport, session.token == token else { throw MobileFailure("folder-cancelled") }
        _ = try currentFolderUpdate(session.transaction)
        return session
    }
    func cancelFolderImport(_ token: String) {
        guard let session = folderImport, session.token == token else { return }
        folderImport = nil
        cancelFolderUpdate(session.transaction)
        // The final in-flight task retains access until its coordinated read/copy returns.
    }
    func finishFolderImport(_ token: String) async throws -> [String: Any] {
        let session = try currentFolderImport(token)
        guard !session.busy, session.scan != nil, session.index == session.work.count else { throw MobileFailure("folder-incomplete") }
        session.busy = true
        defer { session.busy = false }
        do {
            let fresh = try await scanFolder(session.access.url, ignoredPaths: session.root.ignoredPaths,
                lyricFormatOrder: session.order, previous: session.previous)
            _ = try currentFolderImport(token)
            guard try fresh.fingerprint() == session.scan!.fingerprint() else { throw MobileFailure("folder-file-changed") }
            session.root.tracks = session.plans.compactMap { session.prepared[$0.path] }
            var roots = session.roots
            if let index = roots.firstIndex(where: { $0.id == session.root.id }) { roots[index] = session.root }
            else { roots.append(session.root) }
            let warnings = try folderPreparationWarnings(session.transaction)
            for track in session.root.tracks {
                for code in warnings[track.id] ?? [] { session.warn(track.source.path, code) }
            }
            _ = try commitFolderUpdate(session.transaction, roots: roots)
            folderImport = nil
            return ["rootID": session.root.id, "count": session.root.tracks.count, "warnings": session.warnings]
        } catch { cancelFolderImport(token); throw error }
    }
    func folderCatalog() throws -> [String: Any] {
        let snapshot = try folderSnapshot()
        return ["revision": snapshot.revision, "roots": snapshot.document.roots.map { root -> [String: Any] in
            ["id": root.id, "name": root.name, "ignoredPaths": root.ignoredPaths,
             "directories": root.directories.map { ["path": $0.path, "ignored": $0.ignored] as [String: Any] },
             "tracks": root.tracks.map { ["id": $0.id, "path": $0.source.path] }]
        }]
    }
    func removeFolder(_ rootID: String, revision: String) throws {
        guard folderImport == nil else { throw MobileFailure("folder-busy") }
        let snapshot = try folderSnapshot()
        guard snapshot.revision == revision else { throw MobileFailure("local-library-changed") }
        guard snapshot.document.roots.contains(where: { $0.id == rootID }) else { throw MobileFailure("folder-not-found") }
        let tx = try beginFolderUpdate()
        defer { cancelFolderUpdate(tx) }
        _ = try commitFolderUpdate(tx, roots: snapshot.document.roots.filter { $0.id != rootID })
    }
}
