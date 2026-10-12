import Capacitor

// NativeModelBridge.swift — model names and picker results only; no arbitrary model URLs or file paths from JavaScript.
extension FoliaNativePlugin {
    private func modelController() throws -> PlaybackModels {
        guard let models else { throw MobileFailure("ort-manifest-unavailable") }
        return models
    }
    private func modelName(_ call: CAPPluginCall) throws -> NativeModelManifest.Name {
        guard let name = call.getString("name").flatMap(NativeModelManifest.Name.init(rawValue:)) else { throw MobileFailure("invalid-model") }
        return name
    }
    @objc func getModels(_ call: CAPPluginCall) { run(call) {
        let models = try self.modelController()
        call.resolve(models.snapshot())
    } }
    @objc func downloadModel(_ call: CAPPluginCall) { run(call) {
        let models = try self.modelController(), name = try self.modelName(call)
        Task { @MainActor in
            do { try await models.download(name); call.resolve(models.snapshot()) }
            catch is CancellationError { call.resolve(models.snapshot()) }
            catch { call.reject((error as? MobileFailure)?.code ?? "model-download-failed") }
        }
    } }
    @objc func cancelModel(_ call: CAPPluginCall) { run(call) {
        let models = try self.modelController(), name = try self.modelName(call)
        Task { @MainActor in await models.cancel(name); call.resolve(models.snapshot()) }
    } }
    @objc func removeModels(_ call: CAPPluginCall) { run(call) {
        let models = try self.modelController()
        Task { @MainActor in
            do { try await models.removeAll(); call.resolve(models.snapshot()) }
            catch { call.reject((error as? MobileFailure)?.code ?? "model-remove-failed") }
        }
    } }
    @objc func importModel(_ call: CAPPluginCall) { run(call) {
        let models = try self.modelController()
        guard let controller = self.bridge?.viewController else { throw MobileFailure("import-unavailable") }
        try self.picker.present(on: controller, lyrics: true) { urls in
            guard let url = urls.first else { call.resolve(["cancelled": true]); return }
            Task { @MainActor in
                do { try await models.install(url); call.resolve(["cancelled": false]) }
                catch { call.reject((error as? MobileFailure)?.code ?? "model-file-unavailable") }
            }
        }
    } }
}
