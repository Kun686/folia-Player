import Foundation
import UIKit

// NativePersonalFM.swift — main-thread queue owner; replenishment survives a suspended WebView.
final class NativePersonalFM {
    weak var engine: PlaybackEngine?
    private(set) var selection: [String: Any]?
    private(set) var error: String?
    private(set) var fallback = false
    private var epoch = 0
    private var request: Task<[String: Any], Error>?
    private var completion: Task<Void, Never>?
    private var waitingForNext = false
    private var starting = false
    var active: Bool { selection != nil }
    var snapshot: [String: Any] {
        ["active": active, "selection": selection as Any? ?? NSNull(), "loading": request != nil,
         "fallback": fallback, "error": error as Any? ?? NSNull()]
    }
    func restore(_ value: Any?) {
        guard let value = value as? [String: Any], value["mode"] is String else { return }
        selection = value
    }
    func cancelPending() {
        epoch += 1; request?.cancel(); completion?.cancel(); request = nil; completion = nil; waitingForNext = false; starting = false
    }
    func cancelSelection() { if starting { cancelPending() } }
    func leave() {
        if waitingForNext { engine?.intentToPlay = false }
        cancelPending(); selection = nil; error = nil; fallback = false
    }
    // A response cannot replace a queue after ordinary playback, pause, logout or a newer FM selection.
    @MainActor func start(_ next: [String: Any]) async throws {
        guard let engine else { throw MobileFailure("player-unavailable") }
        cancelPending(); let ticket = epoch
        error = nil; starting = true
        let work = load(next, ticket: ticket)
        request = work; engine.publish()
        do {
            let result = try await work.value
            guard ticket == epoch, !Task.isCancelled else { throw CancellationError() }
            let songs = try Self.songs(result)
            guard !songs.isEmpty else { throw MobileFailure("fm-empty") }
            let applied = try Self.appliedSelection(result)
            request = nil; starting = false; selection = applied; fallback = result["fallback"] as? Bool ?? false
            try engine.setQueue(songs, at: 0, preservingFM: true)
        } catch {
            if ticket == epoch {
                request = nil; starting = false; self.error = Self.code(error)
                if ["auth-required", "gateway-auth-required", "rate-limited"].contains(self.error ?? ""),
                   (engine.currentSong?["sourceRef"] as? [String: Any])?["providerId"] as? String == "netease" {
                    engine.stop(self.error)
                } else { engine.publish() }
            }
            throw error
        }
    }
    // Refill near the end, as in the original queue controller. Errors latch until an explicit retry.
    func refill(force: Bool = false) {
        guard let engine, let selection, engine.intentToPlay, engine.index >= engine.queue.count - 2,
              request == nil, force || error == nil else { return }
        error = nil; let ticket = epoch
        let work = load(selection, ticket: ticket)
        request = work; engine.publish()
        completion = Task { @MainActor [weak self, weak engine] in
            guard let self, let engine else { work.cancel(); return }
            do {
                let result = try await work.value
                guard ticket == self.epoch, !Task.isCancelled else { return }
                let songs = try Self.songs(result)
                guard !songs.isEmpty else { throw MobileFailure("fm-empty") }
                _ = try Self.appliedSelection(result)
                self.request = nil; self.completion = nil; self.fallback = result["fallback"] as? Bool ?? false
                // Bound radio history while retaining the current occurrence and recent previous tracks.
                if engine.queue.count + songs.count > 1000 {
                    let remove = max(0, engine.index - 20)
                    engine.discardPrepared(); engine.queue.removeFirst(remove); engine.index -= remove
                }
                guard engine.queue.count + songs.count <= 1000 else { throw MobileFailure("queue-full") }
                engine.queue.append(contentsOf: songs)
                let advance = self.waitingForNext; self.waitingForNext = false
                if advance && engine.intentToPlay { engine.move(1) }
                else if engine.prepared == nil && engine.preparedStream == nil { engine.prefetch() }
                engine.persist(); engine.publish()
            } catch {
                guard ticket == self.epoch, !Task.isCancelled else { return }
                self.request = nil; self.completion = nil; self.error = Self.code(error)
                let waiting = self.waitingForNext; self.waitingForNext = false
                if waiting || ["auth-required", "gateway-auth-required", "rate-limited"].contains(self.error ?? "") {
                    engine.stop(self.error)
                } else { engine.publish() }
            }
        }
    }
    func waitForNext(automatic: Bool) {
        guard let engine, active else { return }
        engine.intentToPlay = true; waitingForNext = true
        engine.pauseOutput()
        if automatic && error != nil { engine.stop(error); return }
        refill(force: !automatic)
        engine.publish()
    }
    private func load(_ selection: [String: Any], ticket: Int) -> Task<[String: Any], Error> {
        Task { @MainActor [weak self] in
            guard let self, let engine = self.engine else { throw CancellationError() }
            let lease = UIApplication.shared.beginBackgroundTask(withName: "Folia FM refill") { [weak self] in
                guard let self, self.epoch == ticket else { return }
                let waiting = self.waitingForNext
                self.cancelPending(); self.error = "network-timeout"
                if waiting { self.engine?.stop("network-timeout") } else { self.engine?.publish() }
            }
            defer { if lease != .invalid { UIApplication.shared.endBackgroundTask(lease) } }
            try Task.checkCancellation()
            let result = try await engine.gateway.personalFM(selection)
            try Task.checkCancellation()
            return result
        }
    }
    private static func appliedSelection(_ response: [String: Any]) throws -> [String: Any] {
        guard let selection = response["selection"] as? [String: Any], selection["mode"] is String else {
            throw MobileFailure("invalid-fm-response")
        }
        return selection
    }
    private static func songs(_ response: [String: Any]) throws -> [[String: Any]] {
        guard let songs = response["songs"] as? [[String: Any]], songs.count <= 100,
              songs.allSatisfy({ ($0["sourceRef"] as? [String: Any])?["providerId"] as? String == "netease" }) else {
            throw MobileFailure("invalid-fm-response")
        }
        return try songs.map(PlaybackEngine.sanitizedSong)
    }
    private static func code(_ error: Error) -> String { (error as? MobileFailure)?.code ?? "network" }
    deinit { request?.cancel(); completion?.cancel() }
}
