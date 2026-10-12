import Foundation
import QuartzCore
import UIKit

// NativeListeningReporter.swift — main-thread accounting and cancellable account writes, independent of WebView.
final class NativeListeningReporter {
    private let gateway: GatewayClient
    private let clock: () -> Double
    private let timeoutOverride: Double?
    private var runtime: NativeListeningSession?
    private var song: [String: Any]?
    private var quality = "standard"
    private var occurrence = UUID().uuidString
    private var epoch = 0
    private var request: Task<Void, Never>?
    private var probe: Task<Void, Never>?
    private var deadline: DispatchWorkItem?
    private var probeDeadline: DispatchWorkItem?
    private var ticket: Int?
    private var background = UIBackgroundTaskIdentifier.invalid
    private(set) var enabled = false
    private(set) var ready = false
    private(set) var error: String? = "checking"
    var changed: (() -> Void)?
    var snapshot: [String: Any] { ["ready": ready, "error": error as Any? ?? NSNull()] }
    var listenedSeconds: Double { (try? runtime?.listenedSeconds()) ?? 0 }

    init(gateway: GatewayClient, clock: @escaping () -> Double = { CACurrentMediaTime() * 1000 }, timeout: Double? = nil) {
        self.gateway = gateway; self.clock = clock; self.timeoutOverride = timeout
    }
    func setEnabled(_ value: Bool) {
        guard enabled != value else { return }
        enabled = value
        // Disable never settles a final record, and cancellation retains the hourly rate history.
        cancelRequest(); discard()
        if value && !ready && probe == nil && error != "checking" { refresh() }
    }
    func invalidate() {
        epoch += 1; cancelRequest(); discard()
        probe?.cancel(); probe = nil; probeDeadline?.cancel(); probeDeadline = nil
        ready = false; error = "checking"
    }
    func authenticationFailed(_ code: String) {
        invalidate(); error = code; changed?()
    }
    func refresh() {
        invalidate()
        guard gateway.listeningAccountAvailable() else { error = "auth-required"; changed?(); return }
        let expected = epoch
        let expiry = DispatchWorkItem { [weak self] in
            guard let self, self.epoch == expected else { return }
            self.probe?.cancel(); self.probe = nil; self.epoch += 1
            self.error = "network"; self.changed?()
        }
        probeDeadline = expiry
        DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: expiry)
        probe = Task { @MainActor [weak self, gateway] in
            do {
                try Task.checkCancellation()
                let health = try await gateway.send("/mobile/health")
                guard let self, !Task.isCancelled, self.epoch == expected else { return }
                self.probeDeadline?.cancel(); self.probeDeadline = nil; self.probe = nil
                self.ready = health["protocol"] as? Int == 1 &&
                    (health["providers"] as? [String])?.contains("netease") == true &&
                    (health["playbackReportProviders"] as? [String])?.contains("netease") == true
                self.error = self.ready ? nil : "unsupported"
                self.changed?()
            } catch {
                guard let self, !Task.isCancelled, self.epoch == expected else { return }
                self.probeDeadline?.cancel(); self.probeDeadline = nil; self.probe = nil
                self.error = Self.safeError(error); self.changed?()
            }
        }
        changed?()
    }
    func observe(song: [String: Any]?, position: Double, duration: Double, playing: Bool, quality: String) {
        guard enabled, ready else { return }
        do {
            if runtime == nil { runtime = try NativeListeningSession() }
            let report = try runtime?.observe(song: song, occurrence: occurrence, position: position,
                duration: duration, playing: playing, nowMs: clock())
            if let report { submit(report) }
            self.song = song; self.quality = quality
        } catch { failRuntime() }
    }
    // Called at EOF, manual song selection and Automix handover, before replacing the audible deck.
    func finishOccurrence() {
        if enabled && ready {
            do { if let report = try runtime?.settle(nowMs: clock()) { submit(report) } }
            catch { failRuntime() }
        }
        song = nil; occurrence = UUID().uuidString
    }
    func seek(from: Double, to: Double) {
        guard enabled, ready else { return }
        do { if let report = try runtime?.seek(from: from, to: to, nowMs: clock()) { submit(report) } }
        catch { failRuntime() }
    }
    func retryUnavailable() { if error == "network" { refresh() } }
    func discontinuity() { try? runtime?.discontinuity() }
    private func discard() { try? runtime?.discard(); song = nil; occurrence = UUID().uuidString }
    private func failRuntime() { discard(); ready = false; error = "listening-runtime-unavailable"; changed?() }

    private func submit(_ report: NativeListeningReport) {
        guard enabled, ready, let runtime, let song, let reserved = try? runtime.reserve(nowMs: clock()) else { return }
        ticket = reserved
        let expected = epoch, quality = self.quality
        background = UIApplication.shared.beginBackgroundTask(withName: "Folia listening report") { [weak self] in
            self?.expire(expected, reserved)
        }
        let expiry = DispatchWorkItem { [weak self] in self?.expire(expected, reserved) }
        deadline = expiry
        DispatchQueue.main.asyncAfter(deadline: .now() + (timeoutOverride ?? runtime.timeoutSeconds), execute: expiry)
        request = Task { @MainActor [weak self, gateway] in
            do {
                try Task.checkCancellation()
                try await gateway.reportListening(song: song, report: report, quality: quality)
                guard let self, !Task.isCancelled, self.epoch == expected, self.ticket == reserved else { return }
                self.completeRequest(); self.error = nil; self.changed?()
            } catch {
                guard let self, !Task.isCancelled, self.epoch == expected, self.ticket == reserved else { return }
                self.completeRequest(); self.error = Self.safeError(error)
                if ["auth-required", "gateway-auth-required"].contains(self.error ?? "") { self.ready = false; self.discard() }
                self.changed?()
            }
        }
    }
    private func expire(_ expected: Int, _ reserved: Int) {
        guard epoch == expected, ticket == reserved else { return }
        cancelRequest(); error = "network"; changed?()
    }
    private func completeRequest() {
        if let ticket { runtime?.finish(ticket) }
        ticket = nil; request = nil; deadline?.cancel(); deadline = nil
        if background != .invalid { UIApplication.shared.endBackgroundTask(background); background = .invalid }
    }
    private func cancelRequest() { request?.cancel(); completeRequest() }
    private static func safeError(_ cause: Error) -> String {
        let code = (cause as? MobileFailure)?.code ?? "network"
        return ["auth-required", "gateway-auth-required", "rate-limited", "unsupported"].contains(code) ? code : "network"
    }
    deinit {
        request?.cancel(); probe?.cancel(); deadline?.cancel(); probeDeadline?.cancel()
        if background != .invalid { UIApplication.shared.endBackgroundTask(background) }
    }
}
