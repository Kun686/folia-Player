import Capacitor

// NativeNavidromeBridge.swift — read-only Subsonic calls from bundled app content; no raw URL or authentication override.
extension FoliaNativePlugin {
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
