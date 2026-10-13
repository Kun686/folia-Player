import Capacitor

// NativeNavidromeBridge.swift — allowlisted Subsonic calls from bundled app content; no raw URL or authentication override.
extension FoliaNativePlugin {
    @objc func navidromeMutation(_ call: CAPPluginCall) { run(call) {
        guard let id = call.getString("id"), let revision = call.getInt("revision"), let scope = call.getString("scope"),
              let operation = call.getString("operation"), let parameters = call.getObject("parameters") else { throw MobileFailure("invalid-navidrome-request") }
        Task { @MainActor in
            do { call.resolve(try await self.navidrome.mutate(id: id, expected: revision, scope: scope, operation: operation, parameters: parameters)) }
            catch { call.reject((error as? MobileFailure)?.code ?? "navidrome-network") }
        }
    } }
    @objc func navidromeArtwork(_ call: CAPPluginCall) { run(call) {
        guard let id = call.getString("id"), let scope = call.getString("scope"), NativeNavidromeRequest.validMediaID(id) else {
            throw MobileFailure("invalid-cover-identity")
        }
        let epoch = try self.navidrome.validateResource(scope)
        Task { @MainActor in
            do {
                try await self.engine.mediaCachePurges["navidrome"]?.value
                let data = try await self.engine.coverCache.navidromeArtwork(id, scope: scope, client: self.navidrome)
                _ = try self.navidrome.validateResource(scope, expected: epoch)
                call.resolve(data.map { ["url": "data:image/jpeg;base64," + $0.base64EncodedString()] } ?? [:])
            } catch { call.reject((error as? MobileFailure)?.code ?? "cover-unavailable") }
        }
    } }

    @objc func readNavidromeLyrics(_ call: CAPPluginCall) { run(call) {
        guard let raw = call.getObject("song") else { throw MobileFailure("invalid-lyric-identity") }
        let song = try PlaybackEngine.sanitizedSong(raw)
        Task { @MainActor in
            do { call.resolve(try await self.engine.navidromeLyrics(song, refresh: call.getBool("refresh") == true)) }
            catch { call.reject((error as? MobileFailure)?.code ?? "lyric-cache-unavailable") }
        }
    } }
    @objc func getNavidromeSettings(_ call: CAPPluginCall) { run(call) { call.resolve(try self.navidrome.snapshot()) } }
    @objc func setNavidromeSettings(_ call: CAPPluginCall) { run(call) {
        guard let revision = call.getInt("revision"), let scope = call.getString("scope"), let values = call.getObject("settings") else {
            throw MobileFailure("invalid-navidrome-settings")
        }
        call.resolve(try self.navidrome.configure(values, expected: revision, scope: scope))
    } }
    @objc func navidromeRequest(_ call: CAPPluginCall) { run(call) {
        guard let id = call.getString("id"), let revision = call.getInt("revision"), let scope = call.getString("scope"),
              let operation = call.getString("operation"), let parameters = call.getObject("parameters") as? [String: String] else {
            throw MobileFailure("invalid-navidrome-request")
        }
        Task { @MainActor in
            do { call.resolve(try await self.navidrome.send(id: id, expected: revision, scope: scope, operation: operation, parameters: parameters)) }
            catch { call.reject((error as? MobileFailure)?.code ?? "navidrome-network") }
        }
    } }
    @objc func cancelNavidromeRequest(_ call: CAPPluginCall) { run(call) {
        guard let id = call.getString("id") else { throw MobileFailure("invalid-navidrome-request") }
        self.navidrome.cancel(id); call.resolve()
    } }
}
