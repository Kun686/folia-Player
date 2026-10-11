import Capacitor

// NativeAIBridge.swift — dedicated methods expose public settings and AI responses, never stored keys or arbitrary destinations.
extension FoliaNativePlugin {
    @objc func getAISettings(_ call: CAPPluginCall) { run(call) { call.resolve(try self.ai.snapshot()) } }
    @objc func setAISettings(_ call: CAPPluginCall) { run(call) {
        guard let revision = call.getInt("revision"), let values = call.getObject("settings") else {
            throw MobileFailure("invalid-ai-settings")
        }
        call.resolve(try self.ai.configure(values, expected: revision))
    } }
    @objc func aiRequest(_ call: CAPPluginCall) { run(call) {
        guard let id = call.getString("id"), let revision = call.getInt("revision"),
              let provider = call.getString("provider"), let body = call.getString("body") else {
            throw MobileFailure("invalid-ai-request")
        }
        Task { @MainActor in
            do { call.resolve(try await self.ai.send(id: id, expected: revision, provider: provider, body: body)) }
            catch { call.reject((error as? MobileFailure)?.code ?? "ai-network") }
        }
    } }
    @objc func cancelAIRequest(_ call: CAPPluginCall) { run(call) {
        guard let id = call.getString("id") else { throw MobileFailure("invalid-ai-request") }
        self.ai.cancel(id); call.resolve()
    } }
}
