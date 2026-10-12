import Capacitor

// NativeSyncBridge.swift — bounded sync operations, revision-aware configuration, and exact-ID cancellation from bundled app content.
extension FoliaNativePlugin {
    @objc func getSyncSettings(_ call: CAPPluginCall) { run(call) { call.resolve(try self.sync.snapshot()) } }
    @objc func setSyncSettings(_ call: CAPPluginCall) { run(call) {
        guard let revision = call.getInt("revision"), let values = call.getObject("settings") else {
            throw MobileFailure("invalid-sync-settings")
        }
        call.resolve(try self.sync.configure(values, expected: revision))
    } }
    @objc func syncRequest(_ call: CAPPluginCall) { run(call) {
        guard let id = call.getString("id"), let revision = call.getInt("revision"), let operation = call.getString("operation") else {
            throw MobileFailure("invalid-sync-request")
        }
        Task { @MainActor in
            do { call.resolve(try await self.sync.send(id: id, expected: revision, operation: operation, body: call.getString("body"))) }
            catch { call.reject((error as? MobileFailure)?.code ?? "sync-network") }
        }
    } }
    @objc func cancelSyncRequest(_ call: CAPPluginCall) { run(call) {
        guard let id = call.getString("id") else { throw MobileFailure("invalid-sync-request") }
        self.sync.cancel(id); call.resolve()
    } }
}
