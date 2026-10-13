import Capacitor

// FoliaNativeLyricsPlugin.swift — packaged frontend gets parsed data and revocable write tokens, never platform sessions.
extension FoliaNativePlugin {
    @objc func listExportLyrics(_ call: CAPPluginCall) { run(call) {
        let songs = self.engine.queue + (self.engine.currentSong.map { [$0] } ?? [])
        Task { @MainActor in
            do { call.resolve(try await self.engine.lyricCache.exportInventory(knownSongs: songs)) }
            catch { call.reject((error as? MobileFailure)?.code ?? "lyric-cache-unavailable") }
        }
    } }
    @objc func readExportLyrics(_ call: CAPPluginCall) { run(call) {
        guard let key = call.getString("key"), let token = call.getString("token") else { throw MobileFailure("invalid-lyric-identity") }
        Task { @MainActor in
            do { call.resolve(try await self.engine.lyricCache.exportRead(key: key, token: token)) }
            catch { call.reject((error as? MobileFailure)?.code ?? "lyric-cache-unavailable") }
        }
    } }
    @objc func shareLyricArchive(_ call: CAPPluginCall) { run(call) {
        guard let name = call.getString("fileName"), let data = call.getString("data"),
              let controller = self.bridge?.viewController else { throw MobileFailure("invalid-lyric-file") }
        let token = call.getString("token")
        Task { @MainActor in
            do {
                if let token { try await self.engine.lyricCache.validateExport(token) }
                try self.lyricFileShare.presentArchive(fileName: name, encoded: data, on: controller) { result in
                    switch result {
                    case .success(let completed): call.resolve(["completed": completed])
                    case .failure: call.reject("share-failed")
                    }
                }
            } catch { call.reject((error as? MobileFailure)?.code ?? "share-failed") }
        }
    } }
    @objc func readLyricCache(_ call: CAPPluginCall) { run(call) {
        guard let raw = call.getObject("song") else { throw MobileFailure("invalid-lyric-identity") }
        let song = try PlaybackEngine.sanitizedSong(raw)
        Task { @MainActor in
            do {
                let transport = try NativeLyricMatchTransport(gateway: self.engine.gateway)
                var snapshot = try await self.engine.lyricCache.read(song)
                try transport.validate()
                snapshot["sessionToken"] = transport.sessionToken
                call.resolve(snapshot)
            }
            catch { call.reject((error as? MobileFailure)?.code ?? "lyric-cache-unavailable") }
        }
    } }
    @objc func writeLyricCache(_ call: CAPPluginCall) { run(call) {
        guard let raw = call.getObject("song"), let token = call.getString("token"), let field = call.getString("field"),
              let value = call.options["value"] else { throw MobileFailure("invalid-lyric-cache") }
        let song = try PlaybackEngine.sanitizedSong(raw)
        Task { @MainActor in
            do {
                let selection = call.getString("selectionToken")
                let transport = try NativeLyricMatchTransport(gateway: self.engine.gateway)
                let expectedSession = call.getString("sessionToken")
                try await self.engine.lyricCache.write(song, token: token, field: field, value: value,
                    selectionToken: selection, validate: {
                        if selection != nil {
                            guard expectedSession == transport.sessionToken else { throw MobileFailure("lyric-session-changed") }
                            try transport.validate()
                        }
                    })
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
