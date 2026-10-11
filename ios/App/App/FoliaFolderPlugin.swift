import Capacitor

// FoliaFolderPlugin.swift — token/index requests cannot supply paths, bookmarks or arbitrary files to the importer.
extension FoliaNativePlugin {
    @objc func readLocalFolders(_ call: CAPPluginCall) { run(call) {
        Task { @MainActor in
            do { call.resolve(try await self.engine.local.folderCatalog()) }
            catch { call.reject((error as? MobileFailure)?.code ?? "folder-unavailable") }
        }
    } }
    @objc func beginFolderImport(_ call: CAPPluginCall) { run(call) { try self.folders.begin(call) } }
    @objc func readFolderImport(_ call: CAPPluginCall) { run(call) {
        guard let token = call.getString("token"), let index = call.getInt("index") else { throw MobileFailure("invalid-folder-transaction") }
        self.folders.perform(call, token: token) { try await self.engine.local.readFolderImport(token, index: index) }
    } }
    @objc func prepareFolderImport(_ call: CAPPluginCall) { run(call) {
        guard let token = call.getString("token"), let index = call.getInt("index"), let contents = call.getObject("contents"),
              let skipped = call.getArray("skipped", String.self) else { throw MobileFailure("invalid-folder-transaction") }
        let decoded = try JSONDecoder().decode(LocalFolderLyricContents.self, from: JSONSerialization.data(withJSONObject: contents))
        self.folders.perform(call, token: token) {
            try await self.engine.local.prepareFolderImport(token, index: index, contents: decoded, skipped: skipped)
        }
    } }
    @objc func cancelFolderImport(_ call: CAPPluginCall) { run(call) {
        guard let token = call.getString("token") else { throw MobileFailure("invalid-folder-transaction") }
        if self.folders.token == token { self.folders.abort() }
        Task { @MainActor in await self.engine.local.cancelFolderImport(token); call.resolve() }
    } }
    @objc func finishFolderImport(_ call: CAPPluginCall) { run(call) {
        guard let token = call.getString("token") else { throw MobileFailure("invalid-folder-transaction") }
        self.folders.perform(call, token: token, finished: true) {
            let result = try await self.engine.local.finishFolderImport(token)
            await self.publishFolderChange()
            return result
        }
    } }
    @objc func removeLocalFolder(_ call: CAPPluginCall) { run(call) {
        guard let id = call.getString("rootID"), let revision = call.getString("revision"), self.folders.token == nil
        else { throw MobileFailure("invalid-folder-transaction") }
        Task { @MainActor in
            do {
                try await self.engine.local.removeFolder(id, revision: revision)
                await self.publishFolderChange()
                call.resolve()
            } catch { call.reject((error as? MobileFailure)?.code ?? "folder-remove-failed") }
        }
    } }
    @MainActor private func publishFolderChange() async {
        // A successful atomic commit must not be reported as failed just because a subsequent view refresh fails.
        if let snapshot = try? await engine.refreshLocalLibrary(), let songs = snapshot["songs"] as? [[String: Any]] {
            let live = Set(songs.compactMap { NativeProfileIdentity($0)?.localID })
            engine.removeSongs { song in NativeProfileIdentity(song)?.localID.map { !live.contains($0) } ?? false }
            for id in live { engine.crossfade?.localLyricsChanged(id) }
        }
        notifyListeners("localCatalog", data: [:])
    }
}
