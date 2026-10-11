import Capacitor
import UIKit

// FoliaNativePlugin.swift — methods are usable only from packaged capacitor://localhost content.
@objc(FoliaNativePlugin)
public class FoliaNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FoliaNativePlugin"
    public let jsName = "FoliaNative"
    public let pluginMethods: [CAPPluginMethod] = ["bootstrap", "configure", "health", "saveSession", "clearSession",
        "request", "cancelRequests", "setQueue", "editQueue", "selectQueue", "command", "getState", "shareQR", "copyText", "shareLyricFile",
        "localCatalog", "importAudio", "localDetails", "importLyrics", "pickLyricFile", "saveLocalLyrics", "readLocalLyrics", "selectLocalLyrics", "readLocalMatch", "writeLocalMatch", "removeLocal", "audioLevels",
        "getAudioSettings", "setAudioSettings", "getTransitionSettings", "setTransitionSettings", "getMediaCacheSettings", "setMediaCacheSettings",
        "mediaCacheState", "clearMediaCache", "songCover", "coverCacheState", "clearCoverCache",
        "readLyricCache", "writeLyricCache", "lyricCacheState", "clearLyricCache",
        "listExportLyrics", "readExportLyrics", "shareLyricArchive"].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    private let picker = LocalImportPicker()
    let lyricFileShare = LyricFileShare()
    private var importing = false
    private let gateway = GatewayClient()
    var engine: PlaybackEngine!
    private var requests: [String: Task<Void, Never>] = [:]
    public override func load() {
        DispatchQueue.main.async {
            self.engine = PlaybackEngine(gateway: self.gateway, usesStereoOutput: true)
            self.engine.mediaCacheChanged = { [weak self] in self?.notifyListeners("mediaCache", data: [:]) }
            self.engine.emit = { [weak self] state in self?.notifyListeners("playback", data: state) }
        }
    }
    func run(_ call: CAPPluginCall, _ work: @escaping () throws -> Void) {
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
        if !self.engine.currentIsLocal { self.engine.stop() }
        self.engine.discardPrepared()
        self.requests.values.forEach { $0.cancel() }; self.requests.removeAll()
        try SecureStore.write("gateway", ["server": server, "token": token])
        self.engine.prefetch()
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
        let previous = try SecureStore.read("session." + provider)
        let changed = ["cookie", "token", "userid"].contains { (previous[$0] as? String) != values[$0] }
        try SecureStore.write("session." + provider, values)
        if changed { self.engine.crossfade?.cancelLyricRequests() }
        Task { @MainActor in
            do {
                if changed {
                    try await self.engine.lyricCache.clear(provider: provider)
                    self.engine.crossfade?.providerLyricsChanged(provider)
                }
                call.resolve()
            } catch { call.reject("cache-clear-failed") }
        }
    } }
    @objc func clearSession(_ call: CAPPluginCall) { run(call) {
        let provider = try self.provider(call)
        self.engine.invalidateProvider(provider)
        try SecureStore.remove("session." + provider)
        Task { @MainActor in
            do { try await self.engine.mediaCachePurges[provider]?.value; call.resolve() }
            catch { call.reject("cache-clear-failed") }
        }
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
        try self.engine.setQueue(songs, at: index)
        call.resolve()
    } }
    @objc func editQueue(_ call: CAPPluginCall) { run(call) {
        guard let songs = call.getArray("songs", JSObject.self), let index = call.getInt("currentIndex"),
              let revision = call.getInt("queueRevision") else { throw MobileFailure("invalid-queue") }
        try self.engine.editQueue(songs, currentIndex: index, expectedRevision: revision)
        call.resolve(self.engine.snapshot())
    } }
    @objc func selectQueue(_ call: CAPPluginCall) { run(call) {
        guard let index = call.getInt("index"), let revision = call.getInt("queueRevision") else { throw MobileFailure("invalid-queue") }
        try self.engine.selectQueue(index, expectedRevision: revision)
        call.resolve()
    } }
    @objc func command(_ call: CAPPluginCall) { run(call) {
        try self.engine.command(call.getString("action") ?? "", position: call.getDouble("position"), mode: call.getString("mode"))
        call.resolve()
    } }
    @objc func getState(_ call: CAPPluginCall) { run(call) { call.resolve(self.engine.snapshot()) } }
    @objc func getAudioSettings(_ call: CAPPluginCall) { run(call) { call.resolve(self.engine.audioSettings.dictionary) } }
    @objc func getTransitionSettings(_ call: CAPPluginCall) { run(call) { call.resolve(self.engine.transitionSettings.dictionary) } }
    @objc func setTransitionSettings(_ call: CAPPluginCall) { run(call) {
        guard let settings = call.getObject("settings") else { throw MobileFailure("invalid-transition-settings") }
        call.resolve(try self.engine.setTransitionSettings(settings))
    } }
    @objc func setAudioSettings(_ call: CAPPluginCall) { run(call) {
        guard let settings = call.getObject("settings") else { throw MobileFailure("invalid-audio-settings") }
        call.resolve(try self.engine.setAudioSettings(settings))
    } }
    @objc func getMediaCacheSettings(_ call: CAPPluginCall) { run(call) {
        Task { @MainActor in call.resolve(await self.engine.mediaCache.settings.dictionary) }
    } }
    @objc func setMediaCacheSettings(_ call: CAPPluginCall) { run(call) {
        guard let raw = call.getObject("settings"), let enabled = raw["enabled"] as? Bool, let limit = raw["limitGB"] as? Double else { throw MobileFailure("invalid-cache-settings") }
        Task { @MainActor in
            do { call.resolve(try await self.engine.configureMediaCache(.init(enabled: enabled, limitGB: limit))) }
            catch { call.reject((error as? MobileFailure)?.code ?? "cache-settings-failed") }
        }
    } }
    @objc func mediaCacheState(_ call: CAPPluginCall) { run(call) {
        Task { @MainActor in
            call.resolve(await self.engine.mediaCache.summary())
        }
    } }
    @objc func songCover(_ call: CAPPluginCall) { run(call) {
        guard let raw = call.getObject("song") else { throw MobileFailure("invalid-cover-identity") }
        let song = try PlaybackEngine.sanitizedSong(raw)
        Task { @MainActor in
            do {
                let data = try await self.engine.coverCache.cover(song, local: self.engine.local)
                call.resolve(data.map { ["url": "data:image/jpeg;base64," + $0.base64EncodedString()] } ?? [:])
            } catch { call.reject((error as? MobileFailure)?.code ?? "cover-unavailable") }
        }
    } }
    @objc func coverCacheState(_ call: CAPPluginCall) { run(call) {
        Task { @MainActor in call.resolve(await self.engine.coverCache.summary()) }
    } }
    @objc func clearCoverCache(_ call: CAPPluginCall) { run(call) {
        Task { @MainActor in
            do { try await self.engine.coverCache.clear(); call.resolve() }
            catch { call.reject("cache-clear-failed") }
        }
    } }
    @objc func clearMediaCache(_ call: CAPPluginCall) { run(call) {
        Task { @MainActor in
            do { try await self.engine.clearMediaCache(); call.resolve() }
            catch { call.reject("cache-clear-failed") }
        }
    } }
    @objc func audioLevels(_ call: CAPPluginCall) { run(call) {
        call.resolve(self.engine.meter?.snapshot() ?? ["available": false, "spectrum": [], "sampleRate": 44100])
    } }
    @objc func localCatalog(_ call: CAPPluginCall) { run(call) {
        Task { @MainActor in
            do { call.resolve(["songs": try await self.engine.local.catalog()]) }
            catch { call.reject("local-library-unavailable") }
        }
    } }
    @objc func localDetails(_ call: CAPPluginCall) { run(call) {
        Task { @MainActor in
            do { call.resolve(try await self.engine.local.details(call.getString("id") ?? "")) }
            catch { call.reject("local-file-missing") }
        }
    } }
    @objc func removeLocal(_ call: CAPPluginCall) { run(call) {
        let id = call.getString("id") ?? ""
        guard LocalMediaLibrary.validID(id), !self.importing else { throw MobileFailure("invalid-local-identity") }
        Task { @MainActor in
            do {
                try await self.engine.local.remove(id)
                self.engine.removeSongs { song in
                    let ref = song["sourceRef"] as? [String: Any]
                    return ref?["kind"] as? String == "local" && ref?["mediaId"] as? String == id
                }
                self.engine.crossfade?.localLyricsChanged(id)
                call.resolve()
            } catch { call.reject("local-remove-failed") }
        }
    } }
    @objc func importAudio(_ call: CAPPluginCall) { chooseFiles(call, lyrics: false) }
    @objc func importLyrics(_ call: CAPPluginCall) { chooseFiles(call, lyrics: true) }
    @objc func pickLyricFile(_ call: CAPPluginCall) { chooseFiles(call, lyrics: true, readBytes: true) }
    @objc func saveLocalLyrics(_ call: CAPPluginCall) { run(call) {
        guard let id = call.getString("id"), let content = call.getString("content"),
              let name = call.getString("fileName"), let token = call.getString("token") else { throw MobileFailure("invalid-lyrics") }
        Task { @MainActor in
            do {
                let result = try await self.engine.local.saveDecodedLyrics(content, fileName: name, for: id, token: token)
                self.engine.crossfade?.localLyricsChanged(id)
                call.resolve(result)
            } catch { call.reject((error as? MobileFailure)?.code ?? "import-failed") }
        }
    } }
    private func chooseFiles(_ call: CAPPluginCall, lyrics: Bool, readBytes: Bool = false) { run(call) {
        guard !self.importing, let controller = self.bridge?.viewController else { throw MobileFailure("import-busy") }
        if lyrics && !LocalMediaLibrary.validID(call.getString("id") ?? "") { throw MobileFailure("invalid-local-identity") }
        try self.picker.present(on: controller, lyrics: lyrics) { urls in
            self.importing = true
            Task { @MainActor in
                defer { self.importing = false }
                guard !urls.isEmpty else { call.resolve(["cancelled": true]); return }
                guard urls.count <= 100 else { call.reject("too-many-files"); return }
                do {
                    if lyrics {
                        let id = call.getString("id") ?? ""
                        if readBytes {
                            call.resolve(try await self.engine.local.readLyricFile(urls[0], for: id))
                            return
                        }
                        let result = try await self.engine.local.importLyrics(urls[0], for: id)
                        self.engine.crossfade?.localLyricsChanged(id)
                        call.resolve(result)
                    } else {
                        var songs: [[String: Any]] = [], failures: [[String: String]] = []
                        for url in urls {
                            do { songs.append(try await self.engine.local.importAudio(url)) }
                            catch { failures.append(["name": url.lastPathComponent, "code": (error as? MobileFailure)?.code ?? "import-failed"]) }
                        }
                        call.resolve(["songs": songs, "failures": failures])
                    }
                } catch { call.reject((error as? MobileFailure)?.code ?? "import-failed") }
            }
        }
    } }
    @objc func copyText(_ call: CAPPluginCall) { run(call) {
        guard let text = call.getString("text"), text.utf8.count <= 2_000_000 else { throw MobileFailure("invalid-text") }
        UIPasteboard.general.string = text
        call.resolve()
    } }
    @objc func shareLyricFile(_ call: CAPPluginCall) { run(call) {
        guard let fileName = call.getString("fileName"), let content = call.getString("content"),
              let controller = self.bridge?.viewController else { throw MobileFailure("invalid-lyric-file") }
        try self.lyricFileShare.present(fileName: fileName, content: content, on: controller) { result in
            switch result {
            case .success(let completed): call.resolve(["completed": completed])
            case .failure: call.reject("share-failed")
            }
        }
    } }
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
