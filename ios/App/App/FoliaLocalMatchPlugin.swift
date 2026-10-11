import Capacitor

// FoliaLocalMatchPlugin.swift — publish metadata after atomic storage without replacing playback occurrences.
extension PlaybackEngine {
    func localMatchChanged(_ id: String, song: [String: Any]) {
        let matches: ([String: Any]) -> Bool = { NativeProfileIdentity($0)?.localID == id }
        if queue.contains(where: matches) { queue = queue.map { matches($0) ? song : $0 } }
        if let detachedSong, matches(detachedSong) { self.detachedSong = song; queueDirty = true }
        crossfade?.localLyricsChanged(id)
        if let currentSong, matches(currentSong) { artwork.update(nil) }
        persist(); publish()
    }
}
extension FoliaNativePlugin {
    @objc func readLocalMatch(_ call: CAPPluginCall) { run(call) {
        guard let id = call.getString("id") else { throw MobileFailure("invalid-local-identity") }
        Task { @MainActor in
            do { call.resolve(try await self.engine.local.readLocalMatch(id)) }
            catch { call.reject((error as? MobileFailure)?.code ?? "local-library-unavailable") }
        }
    } }
    @objc func writeLocalMatch(_ call: CAPPluginCall) { run(call) {
        guard let id = call.getString("id"), let token = call.getString("token"), let document = call.getObject("document")
        else { throw MobileFailure("invalid-local-match") }
        Task { @MainActor in
            do {
                let song = try await self.engine.local.writeLocalMatch(id, token: token, document: document, source: call.getString("source"))
                self.engine.localMatchChanged(id, song: song)
                self.notifyListeners("localCatalog", data: [:])
                var cached = false
                if call.getBool("cacheCover") == true, let coverSong = try? await self.engine.local.onlineCoverSong(id) {
                    cached = (try? await self.engine.coverCache.cover(coverSong, local: self.engine.local)) != nil
                }
                call.resolve(["coverCached": cached])
            } catch { call.reject((error as? MobileFailure)?.code ?? "local-library-unavailable") }
        }
    } }
}
