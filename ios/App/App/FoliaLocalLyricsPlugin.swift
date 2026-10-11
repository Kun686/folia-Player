import Capacitor

// FoliaLocalLyricsPlugin.swift — source changes invalidate native planning without replacing the audio queue.
extension FoliaNativePlugin {
    @objc func readLocalLyrics(_ call: CAPPluginCall) { run(call) {
        guard let id = call.getString("id") else { throw MobileFailure("invalid-local-identity") }
        Task { @MainActor in
            do { call.resolve(try await self.engine.local.readLyricSources(id)) }
            catch { call.reject((error as? MobileFailure)?.code ?? "invalid-lyrics") }
        }
    } }
    @objc func selectLocalLyrics(_ call: CAPPluginCall) { run(call) {
        guard let id = call.getString("id"), let token = call.getString("token"), let source = call.getString("source")
        else { throw MobileFailure("invalid-lyrics") }
        Task { @MainActor in
            do {
                let result = try await self.engine.local.selectLyricSource(source, id: id, token: token)
                self.engine.crossfade?.localLyricsChanged(id)
                call.resolve(result)
            } catch { call.reject((error as? MobileFailure)?.code ?? "invalid-lyrics") }
        }
    } }
}
