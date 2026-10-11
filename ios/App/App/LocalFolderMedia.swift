import Foundation

// LocalFolderMedia.swift — reuse the existing audio importer while preserving stable identity and explicit user edits.
extension LocalMediaLibrary {
    func stageFolderAudio(_ source: URL, transactionID: String, rootID: String,
                          plan: LocalFolderTrackPlan, replacing songID: String? = nil,
                          sidecars: LocalFolderSidecars? = nil) async throws -> LocalFolderTrack {
        let transaction = try currentFolderUpdate(transactionID)
        guard UUID(uuidString: rootID) != nil else { throw MobileFailure("invalid-folder-catalog") }
        try LocalFoldersDocument.validatePath(plan.path)
        if let songID {
            guard try folderStore.snapshot().document.roots.first(where: { $0.id == rootID })?.tracks.contains(where: { $0.id == songID }) == true
            else { throw MobileFailure("invalid-local-identity") }
        }
        let original = try songID.map { try importedSong($0) }
        let record = try songID.flatMap { try lyricSource($0) }
        let input = try songID.map { try libraryInput($0, base: original!, record: record) }
        let policy = try folderLyricPolicy(transactionID: transactionID, rootID: rootID, plan: plan, replacing: songID)
        if let sidecars {
            guard try sidecars.files.checkedURL(plan.path).standardizedFileURL == source.standardizedFileURL
            else { throw MobileFailure("folder-file-changed") }
        }
        transaction.pending += 1
        defer { finishFolderPreparation(transaction) }
        let importer = LocalMediaLibrary(root: transaction.url)
        let imported = try await importer.importAudio(source)
        guard let generation = imported["id"] as? String else { throw MobileFailure("invalid-folder-media") }
        let stagedURL = transaction.url.appendingPathComponent(generation, isDirectory: true)
        do {
            _ = try currentFolderUpdate(transactionID)
            let embedded = try await importer.lyricSource(generation)
            _ = try currentFolderUpdate(transactionID)
            let id = songID ?? UUID().uuidString
            var warnings: [String] = []
            var song = imported
            song["id"] = id; song["sourceRef"] = ["kind": "local", "mediaId": id]
            song["folderRootID"] = rootID; song["folderRelativePath"] = plan.path
            var next = record ?? embedded ?? LyricSource(content: "", fileName: nil)
            next.embeddedContent = embedded?.embeddedContent; next.embeddedTranslation = embedded?.embeddedTranslation
            next.embeddedScanned = true; next.embeddedScanVersion = Self.embeddedScanVersion
            if next.contentIsEmbedded == true { next.content = embedded?.embeddedContent ?? "" }
            next = try policy.apply(sidecars?.contents ?? LocalFolderLyricContents(), to: next, plan: plan)
            // Reuse the original parser before committing browser-decoded text; untimed/empty files remain valid sidecars.
            _ = try await lyricImportParser.parse(next.content, fileName: next.fileName, translation: next.translationContent)
            _ = try currentFolderUpdate(transactionID)
            if let sidecars {
                for path in [policy.keepLyric ? nil : plan.lyric, policy.keepTranslation ? nil : plan.translation].compactMap({ $0 }) {
                    _ = try sidecars.files.checkedURL(path)
                }
            }
            if let path = plan.cover {
                guard let sidecars else { throw MobileFailure("invalid-folder-cover") }
                if let cover = try sidecars.cover(path) {
                    try cover.write(to: stagedURL.appendingPathComponent("cover.jpg"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                } else { warnings.append("folder-cover-unavailable") }
            }
            if let sidecars { _ = try sidecars.files.checkedURL(plan.path) }
            if let input {
                var updated = input
                let assignment = transaction.assignments[id]
                // Imported tags may refresh import-owned fields. Matched/manual/split relationships retain their source keys.
                if assignment?["artistOrigin"] as? String == "import" {
                    updated["artistNames"] = (song["artists"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String }
                }
                if assignment?["albumOrigin"] as? String == "import" { updated["albumName"] = (song["album"] as? [String: Any])?["name"] as? String ?? "" }
                next.libraryMetadataJSON = String(data: try JSONSerialization.data(withJSONObject: updated), encoding: .utf8)
            }
            if let text = next.matchJSON, var match = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
               match["titleOrigin"] as? String == "import" {
                match["title"] = song["name"]
                next.matchJSON = String(data: try JSONSerialization.data(withJSONObject: match), encoding: .utf8)
            }
            try Task.checkCancellation()
            try JSONEncoder().encode(next).write(to: stagedURL.appendingPathComponent("lyrics.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            try JSONSerialization.data(withJSONObject: song).write(to: stagedURL.appendingPathComponent("song.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            transaction.warnings[id] = warnings
            return LocalFolderTrack(id: id, generation: generation, source: plan)
        } catch { try? FileManager.default.removeItem(at: stagedURL); throw error }
    }
}
