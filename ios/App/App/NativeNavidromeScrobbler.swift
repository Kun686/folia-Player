import Foundation
import JavaScriptCore
import UIKit

// NativeNavidromeScrobbler.swift — bounded native reports using the original JS tracker, independent of WebView and gateway.
@MainActor final class NativeNavidromeScrobbler {
    private struct Report: Decodable { let kind: String; let songId: String }
    private struct Pending { let song: [String: Any]; let revision: Int; let time: Double; let submission: Bool }
    private weak var client: NativeNavidromeClient?
    private let clock: () -> Double
    private var context: JSContext?
    private var runtime: JSValue?
    private var activeKey: String?
    private var rejectedKey: String?
    private var activeSong: [String: Any]?
    private var activeRevision = 0
    private var queue: [Pending] = []
    private var worker: Task<Void, Never>?
    private var cancelledWorker: Task<Void, Never>?
    private var epoch = 0
    private var unavailable = false
    private(set) var error: String?
    var pendingCount: Int { queue.count + (worker == nil ? 0 : 1) }
    init(client: NativeNavidromeClient, clock: @escaping () -> Double = { Date().timeIntervalSince1970 * 1000 }) {
        self.client = client; self.clock = clock
    }
    func observe(song: [String: Any]?, position: Double, duration: Double, playing: Bool) {
        guard !unavailable else { return }
        guard let song, let identity = NativeProfileIdentity(song), identity.provider == "navidrome", let client else {
            clearSession(); return
        }
        guard rejectedKey != identity.key else { return }
        if activeKey != identity.key {
            clearSession()
            do { activeRevision = try client.validatePlayback(song) }
            catch {
                // A restored old-account song cannot disable a later valid song from the new account.
                rejectedKey = identity.key; self.error = (error as? MobileFailure)?.code ?? "navidrome-settings-changed"; return
            }
            activeSong = ["sourceRef": song["sourceRef"]!]; activeKey = identity.key
        }
        do {
            // Restored paused queues and buffered starts do not initialize JS or send network traffic.
            guard playing else { return }
            let id = (song["sourceRef"] as? [String: Any])?["mediaId"] as? String ?? ""
            let metadata = song["durationMs"] as? Double ?? 0
            let seconds = metadata > 0 ? metadata : duration * 1000
            try enqueue(invoke("observe", [id, seconds, position, playing]))
        } catch { fail(error) }
    }
    func finish(endPosition: Double? = nil) {
        guard runtime != nil else { clearSession(); return }
        do { try enqueue(invoke("finish", [endPosition as Any? ?? NSNull()])) } catch { fail(error) }
        clearSession()
    }
    func invalidate() {
        epoch += 1; cancelWorker(); queue = []; clearSession(); rejectedKey = nil; error = nil; unavailable = false
    }
    private func cancelWorker() {
        if let worker { worker.cancel(); cancelledWorker = worker; self.worker = nil }
    }
    private func clearSession() {
        _ = runtime?.invokeMethod("clear", withArguments: []); activeKey = nil; activeSong = nil
        // Discard obsolete queued now-playing updates; already earned submissions keep their song identity.
        queue.removeAll { !$0.submission }
    }
    private func invoke(_ method: String, _ arguments: [Any]) throws -> [Report] {
        if runtime == nil {
            guard let context = JSContext(), let url = Bundle.main.url(forResource: "listening", withExtension: "js", subdirectory: "public/native") else {
                throw MobileFailure("navidrome-scrobble-runtime")
            }
            let script = try String(contentsOf: url, encoding: .utf8)
            guard script.utf8.count <= 1_048_576 else { throw MobileFailure("navidrome-scrobble-runtime") }
            context.evaluateScript(script, withSourceURL: url)
            guard context.exception == nil, let api = context.objectForKeyedSubscript("FoliaListening"),
                  api.forProperty("protocolVersion")?.toInt32() == 1,
                  let runtime = api.invokeMethod("createNavidrome", withArguments: []), runtime.isObject, context.exception == nil else {
                throw MobileFailure("navidrome-scrobble-runtime")
            }
            self.context = context; self.runtime = runtime
        }
        context?.exception = nil
        guard let json = runtime?.invokeMethod(method, withArguments: arguments)?.toString(), context?.exception == nil,
              let data = json.data(using: .utf8), data.count <= 32_768 else { throw MobileFailure("navidrome-scrobble-runtime") }
        return try JSONDecoder().decode([Report].self, from: data)
    }
    private func enqueue(_ reports: [Report]) throws {
        guard let song = activeSong, let id = (song["sourceRef"] as? [String: Any])?["mediaId"] as? String else { return }
        for report in reports {
            guard report.songId == id, ["now-playing", "submission"].contains(report.kind) else { throw MobileFailure("navidrome-scrobble-runtime") }
            guard pendingCount < 8 else { error = "navidrome-request-limit"; continue }
            queue.append(Pending(song: song, revision: activeRevision, time: clock(), submission: report.kind == "submission"))
        }
        drain()
    }
    // Serialize now-playing and submission; do not replay uncertain writes after timeout or network recovery.
    private func drain() {
        guard worker == nil, !queue.isEmpty, let client else { return }
        let pending = queue.removeFirst(), expected = epoch, cancelled = cancelledWorker
        cancelledWorker = nil
        worker = Task { @MainActor [weak self, client] in
            // Cancellation is cooperative: wait for the previous request to release the client's single slot.
            await cancelled?.value
            guard !Task.isCancelled else { return }
            let background = UIApplication.shared.beginBackgroundTask(withName: "Folia Navidrome report") { [weak self] in
                guard let self, self.epoch == expected else { return }
                self.epoch += 1; self.cancelWorker(); self.queue = []; self.error = "navidrome-timeout"
            }
            defer { if background != .invalid { UIApplication.shared.endBackgroundTask(background) } }
            var failure: String?
            do { try await client.scrobble(song: pending.song, expected: pending.revision, time: pending.time, submission: pending.submission) }
            catch { failure = (error as? MobileFailure)?.code ?? "navidrome-network" }
            guard let self, !Task.isCancelled, self.epoch == expected else { return }
            self.worker = nil; self.error = failure
            if ["navidrome-auth-required", "navidrome-forbidden", "navidrome-settings-changed", "navidrome-disabled"].contains(failure ?? "") {
                self.queue = []; self.clearSession(); self.unavailable = true
            } else { self.drain() }
        }
    }
    private func fail(_ cause: Error) {
        error = (cause as? MobileFailure)?.code ?? "navidrome-scrobble-runtime"
        clearSession(); unavailable = true
    }
    deinit { worker?.cancel(); cancelledWorker?.cancel() }
}
