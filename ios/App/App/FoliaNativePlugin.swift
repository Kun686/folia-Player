import Capacitor
import UIKit

// FoliaNativePlugin.swift — methods are usable only from packaged capacitor://localhost content.
@objc(FoliaNativePlugin)
public class FoliaNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FoliaNativePlugin"
    public let jsName = "FoliaNative"
    public let pluginMethods: [CAPPluginMethod] = ["bootstrap", "configure", "health", "saveSession", "clearSession",
        "request", "cancelRequests", "setQueue", "command", "getState", "shareQR"].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    private let gateway = GatewayClient()
    private var engine: PlaybackEngine!
    private var requests: [String: Task<Void, Never>] = [:]
    public override func load() {
        DispatchQueue.main.async {
            self.engine = PlaybackEngine(gateway: self.gateway)
            self.engine.emit = { [weak self] state in self?.notifyListeners("playback", data: state) }
        }
    }
    private func run(_ call: CAPPluginCall, _ work: @escaping () throws -> Void) {
        DispatchQueue.main.async {
            guard self.bridge?.webView?.url?.scheme == "capacitor", self.bridge?.webView?.url?.host == "localhost" else {
                call.reject("untrusted-origin"); return
            }
            do { try work() } catch { call.reject((error as? MobileFailure)?.code ?? "operation-failed") }
        }
    }
    @objc func bootstrap(_ call: CAPPluginCall) { run(call) {
        var sessions: [String: Any] = [:]
        for provider in ["netease", "qq", "kugou"] { sessions[provider] = try SecureStore.read("session." + provider) }
        call.resolve(["server": try SecureStore.read("gateway")["server"] as? String ?? "", "sessions": sessions])
    } }
    @objc func configure(_ call: CAPPluginCall) { run(call) {
        let server = try GatewayClient.validatedServer(call.getString("server") ?? "")
        guard let token = call.getString("token"), token.count >= 32, token.count <= 4096 else { throw MobileFailure("invalid-token") }
        self.engine.stop()
        self.requests.values.forEach { $0.cancel() }; self.requests.removeAll()
        try SecureStore.write("gateway", ["server": server, "token": token])
        call.resolve()
    } }
    @objc func health(_ call: CAPPluginCall) { run(call) {
        Task { @MainActor in
            do { call.resolve(try await self.gateway.send("/mobile/health")) }
            catch { call.reject((error as? MobileFailure)?.code ?? "network") }
        }
    } }
    private func provider(_ call: CAPPluginCall) throws -> String {
        guard let provider = call.getString("provider"), ["netease", "qq", "kugou"].contains(provider) else { throw MobileFailure("invalid-provider") }
        return provider
    }
    @objc func saveSession(_ call: CAPPluginCall) { run(call) {
        let provider = try self.provider(call)
        guard let values = call.getObject("values") as? [String: String],
              values.count <= 16, values.values.allSatisfy({ $0.count <= 24000 }) else { throw MobileFailure("invalid-session") }
        try SecureStore.write("session." + provider, values); call.resolve()
    } }
    @objc func clearSession(_ call: CAPPluginCall) { run(call) {
        let provider = try self.provider(call)
        self.engine.invalidateProvider(provider)
        try SecureStore.remove("session." + provider); call.resolve()
    } }
    @objc func request(_ call: CAPPluginCall) { run(call) {
        guard let id = call.getString("id"), let payload = call.getObject("payload"), self.requests.count < 24 else { throw MobileFailure("invalid-request") }
        self.requests[id] = Task { @MainActor in
            defer { self.requests[id] = nil }
            do { call.resolve(try await self.gateway.send("/mobile/request", body: payload)) }
            catch { call.reject((error as? MobileFailure)?.code ?? "network") }
        }
    } }
    @objc func cancelRequests(_ call: CAPPluginCall) { run(call) {
        for id in call.getArray("ids", String.self) ?? [] { self.requests[id]?.cancel() }
        call.resolve()
    } }
    @objc func setQueue(_ call: CAPPluginCall) { run(call) {
        guard let songs = call.getArray("songs", JSObject.self), let index = call.getInt("index") else { throw MobileFailure("invalid-queue") }
        if call.getBool("append") == true && !self.engine.queue.isEmpty {
            guard self.engine.queue.count + songs.count <= 1000 else { throw MobileFailure("queue-full") }
            self.engine.queue.append(contentsOf: try songs.map(PlaybackEngine.sanitizedSong)); self.engine.discardPrepared(); self.engine.prefetch(); self.engine.persist(); self.engine.publish()
        } else { try self.engine.setQueue(songs, at: index) }
        call.resolve()
    } }
    @objc func command(_ call: CAPPluginCall) { run(call) {
        try self.engine.command(call.getString("action") ?? "", position: call.getDouble("position"), mode: call.getString("mode"))
        call.resolve()
    } }
    @objc func getState(_ call: CAPPluginCall) { run(call) { call.resolve(self.engine.snapshot()) } }
    @objc func shareQR(_ call: CAPPluginCall) { run(call) {
        guard let raw = call.getString("image"), raw.hasPrefix("data:image/"), raw.count <= 4_000_000,
              let encoded = raw.split(separator: ",", maxSplits: 1).last,
              let data = Data(base64Encoded: String(encoded)), let image = UIImage(data: data),
              let controller = self.bridge?.viewController else { throw MobileFailure("invalid-qr-image") }
        let share = UIActivityViewController(activityItems: [image], applicationActivities: nil)
        share.popoverPresentationController?.sourceView = controller.view
        share.popoverPresentationController?.sourceRect = CGRect(x: controller.view.bounds.midX, y: controller.view.bounds.midY, width: 1, height: 1)
        share.completionWithItemsHandler = { _, _, _, error in
            if error != nil { call.reject("share-failed") } else { call.resolve() }
        }
        controller.present(share, animated: true)
    } }
}
final class FoliaViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(FoliaNativePlugin()) }
}
