import Capacitor

// FoliaNativeLyricsPlugin.swift — packaged frontend gets parsed data and revocable write tokens, never platform sessions.
extension FoliaNativePlugin {
    @objc func readLyricCache(_ call: CAPPluginCall) { run(call) {
        guard let raw = call.getObject("song") else { throw MobileFailure("invalid-lyric-identity") }
        let song = try PlaybackEngine.sanitizedSong(raw)
        Task { @MainActor in
            do { call.resolve(try await self.engine.lyricCache.read(song)) }
            catch { call.reject((error as? MobileFailure)?.code ?? "lyric-cache-unavailable") }
        }
    } }
    @objc func writeLyricCache(_ call: CAPPluginCall) { run(call) {
        guard let raw = call.getObject("song"), let token = call.getString("token"), let field = call.getString("field"),
              let value = call.options["value"] else { throw MobileFailure("invalid-lyric-cache") }
        let song = try PlaybackEngine.sanitizedSong(raw)
        Task { @MainActor in
            do {
                try await self.engine.lyricCache.write(song, token: token, field: field, value: value)
                self.engine.crossfade?.songLyricsChanged(song)
                call.resolve()
            } catch { call.reject((error as? MobileFailure)?.code ?? "lyric-cache-unavailable") }
        }
    } }
    @objc func lyricCacheState(_ call: CAPPluginCall) { run(call) {
        Task { @MainActor in call.resolve(await self.engine.lyricCache.summary()) }
    } }
    @objc func clearLyricCache(_ call: CAPPluginCall) { run(call) {
        self.engine.crossfade?.cancelLyricRequests()
        Task { @MainActor in
            do { try await self.engine.lyricCache.clear(); call.resolve() }
            catch { call.reject("cache-clear-failed") }
        }
    } }
}
