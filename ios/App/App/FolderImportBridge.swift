import Capacitor
import UIKit
import WebKit

// FolderImportBridge.swift — main-thread ownership, lifecycle cancellation and a finite idle lease for a WebView-driven batch.
final class FolderImportBridge {
    private weak var plugin: FoliaNativePlugin?
    private(set) var token: String?
    private var task: Task<Void, Never>?
    private var expiry: DispatchWorkItem?
    private var background: NSObjectProtocol?
    private var navigation: NSKeyValueObservation?
    private var picking = false
    init(plugin: FoliaNativePlugin) {
        self.plugin = plugin
        background = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.abort()
        }
        navigation = plugin.bridge?.webView?.observe(\.isLoading, options: [.new]) { [weak self] web, _ in
            if web.isLoading { DispatchQueue.main.async { self?.abort() } }
        }
    }
    deinit {
        if let background { NotificationCenter.default.removeObserver(background) }
        expiry?.cancel(); task?.cancel()
        if let token, let local = plugin?.engine?.local { Task { await local.cancelFolderImport(token) } }
    }
    func abort() {
        guard let token else { return }
        self.token = nil; task?.cancel(); task = nil; expiry?.cancel(); expiry = nil
        if picking { picking = false; plugin?.picker.cancel() }
        if let local = plugin?.engine?.local { Task { await local.cancelFolderImport(token) } }
    }
    private func renewLease() {
        expiry?.cancel()
        let item = DispatchWorkItem { [weak self] in self?.abort() }
        expiry = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 120, execute: item)
    }
    func begin(_ call: CAPPluginCall) throws {
        guard let plugin, !plugin.importing, token == nil, let token = call.getString("token"), UUID(uuidString: token) != nil,
              let controller = plugin.bridge?.viewController else { throw MobileFailure("folder-busy") }
        self.token = token
        let rootID = call.getString("rootID"), pick = call.getBool("pick") ?? (rootID == nil)
        let start: (URL?) -> Void = { [weak self, weak plugin] source in
            guard let self, let plugin, self.token == token else { call.resolve(["cancelled": true]); return }
            self.picking = false
            if pick, source == nil { self.abort(); call.resolve(["cancelled": true]); return }
            self.perform(call, token: token) {
                try await plugin.engine.local.beginFolderImport(token: token, source: source, rootID: rootID,
                    ignoredPaths: call.getArray("ignoredPaths", String.self), order: call.getArray("order", String.self) ?? [])
            }
        }
        do {
            if pick { picking = true; try plugin.picker.presentFolder(on: controller) { start($0.first) } }
            else { start(nil) }
        } catch { abort(); throw error }
    }
    func perform(_ call: CAPPluginCall, token: String, finished: Bool = false,
                 work: @escaping () async throws -> [String: Any]) {
        guard self.token == token, task == nil, !picking else { call.reject("folder-progress-changed"); return }
        renewLease()
        task = Task { @MainActor [weak self] in
            do {
                let result = try await work()
                // Once committed, success is authoritative even if background/cancel raced the view refresh.
                if finished, self?.token != token { call.resolve(result); return }
                guard let self, self.token == token else { call.reject("folder-cancelled"); return }
                self.task = nil
                if finished { self.token = nil; self.expiry?.cancel(); self.expiry = nil }
                else { self.renewLease() }
                call.resolve(result)
            } catch {
                if self?.token == token { self?.abort() }
                call.reject((error as? MobileFailure)?.code ?? (error is CancellationError ? "folder-cancelled" : "folder-import-failed"))
            }
        }
    }
}
