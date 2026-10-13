import Capacitor

// FoliaNativeLyricsPlugin.swift — packaged frontend gets parsed data and revocable write tokens, never platform sessions.
extension FoliaNativePlugin {
    @MainActor private func lyricExportScope() throws -> String {
        let settings = try navidrome.snapshot()
        return settings["enabled"] as? Bool == true ? settings["scope"] as? String ?? "" : ""
    }
    @objc func listExportLyrics(_ call: CAPPluginCall) { run(call) {
        let songs = self.engine.queue + (self.engine.currentSong.map { [$0] } ?? [])
        Task { @MainActor in
            do {
                let scope = try self.lyricExportScope()
                try await self.engine.mediaCachePurges["navidrome"]?.value
                let result = try await self.engine.lyricCache.exportInventory(knownSongs: songs, navidromeScope: scope)
                guard scope == (try self.lyricExportScope()) else { throw MobileFailure("lyric-cache-changed") }
                call.resolve(result)
            }
            catch { call.reject((error as? MobileFailure)?.code ?? "lyric-cache-unavailable") }
        }
    } }
    @objc func readExportLyrics(_ call: CAPPluginCall) { run(call) {
        guard let key = call.getString("key"), let token = call.getString("token") else { throw MobileFailure("invalid-lyric-identity") }
        Task { @MainActor in
            do {
                let scope = try self.lyricExportScope()
                let result = try await self.engine.lyricCache.exportRead(key: key, token: token, navidromeScope: scope)
                guard scope == (try self.lyricExportScope()) else { throw MobileFailure("lyric-cache-changed") }
                call.resolve(result)
            }
            catch { call.reject((error as? MobileFailure)?.code ?? "lyric-cache-unavailable") }
        }
    } }
    @objc func shareLyricArchive(_ call: CAPPluginCall) { run(call) {
        guard let name = call.getString("fileName"), let data = call.getString("data"),
              let controller = self.bridge?.viewController else { throw MobileFailure("invalid-lyric-file") }
        let token = call.getString("token")
        Task { @MainActor in
            do {
                if let token {
                    let scope = try self.lyricExportScope()
                    try await self.engine.mediaCachePurges["navidrome"]?.value
                    try await self.engine.lyricCache.validateExport(token, navidromeScope: scope)
                    guard scope == (try self.lyricExportScope()) else { throw MobileFailure("lyric-cache-changed") }
                }
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
                if (song["sourceRef"] as? [String: Any])?["kind"] as? String == "navidrome" {
                    let epoch = try self.navidrome.validatePlayback(song)
                    try await self.engine.mediaCachePurges["navidrome"]?.value
                    var snapshot = try await self.engine.lyricCache.read(song)
                    _ = try self.navidrome.validatePlayback(song, expected: epoch)
                    snapshot["sessionToken"] = "navidrome:\(epoch)"
                    call.resolve(snapshot); return
                }
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
                let client = (song["sourceRef"] as? [String: Any])?["kind"] as? String == "navidrome" ? self.navidrome : nil
                let epoch = try client?.validatePlayback(song)
                if client != nil { try await self.engine.mediaCachePurges["navidrome"]?.value }
                let transport = client == nil ? try NativeLyricMatchTransport(gateway: self.engine.gateway) : nil
                let expectedSession = call.getString("sessionToken")
                try await self.engine.lyricCache.write(song, token: token, field: field, value: value,
                    selectionToken: selection, validate: {
                        if let client {
                            _ = try await client.validatePlayback(song, expected: epoch)
                            if selection != nil, expectedSession != "navidrome:\(epoch!)" { throw MobileFailure("lyric-session-changed") }
                        } else if selection != nil, let transport {
                            guard expectedSession == transport.sessionToken else { throw MobileFailure("lyric-session-changed") }
                            try transport.validate()
                        }
                    })
                self.engine.crossfade?.songLyricsChanged(song, automatic: field == "lyrics" || selection != nil)
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
