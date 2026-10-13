import UIKit
import Capacitor

// NativeDisplaySleep.swift — original playback preference; UIKit owns the foreground idle timer.
@MainActor final class NativeDisplaySleep {
    static let storageKey = "prevent_display_sleep_during_playback"
    private static var timerOwner: UUID?
    private let id = UUID()
    private let storage: UserDefaults
    private let center: NotificationCenter
    private let isApplicationActive: @MainActor () -> Bool
    private let isPlaying: @MainActor () -> Bool
    private var observers: [NSObjectProtocol] = []
    private var foreground: Bool
    private var stopped = false
    private(set) var enabled: Bool
    var snapshot: [String: Any] { ["enabled": enabled] }

    init(storage: UserDefaults = .standard, center: NotificationCenter = .default,
         isApplicationActive: @escaping @MainActor () -> Bool = { UIApplication.shared.applicationState == .active },
         isPlaying: @escaping @MainActor () -> Bool) {
        self.storage = storage; self.center = center
        self.isApplicationActive = isApplicationActive; self.isPlaying = isPlaying
        enabled = storage.object(forKey: Self.storageKey) as? Bool ?? false
        foreground = isApplicationActive()
        for name in [UIApplication.willResignActiveNotification, UIApplication.didEnterBackgroundNotification,
                     UIApplication.willTerminateNotification] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.foreground = false; self?.refresh() }
            })
        }
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.foreground = self.isApplicationActive(); self.refresh()
            }
        })
        refresh()
    }
    func setEnabled(_ value: Bool) {
        storage.set(value, forKey: Self.storageKey)
        enabled = value; refresh()
    }
    func refresh() {
        if !stopped && enabled && foreground && isApplicationActive() && isPlaying() {
            Self.timerOwner = id
            if !UIApplication.shared.isIdleTimerDisabled { UIApplication.shared.isIdleTimerDisabled = true }
        } else { Self.release(id) }
    }
    func stop() {
        stopped = true
        observers.forEach(center.removeObserver); observers.removeAll()
        Self.release(id)
    }
    private static func release(_ id: UUID) {
        guard timerOwner == id else { return }
        timerOwner = nil
        UIApplication.shared.isIdleTimerDisabled = false
    }
    deinit {
        observers.forEach(center.removeObserver)
        let owner = id
        // A retiring bridge cannot release a replacement bridge's newly acquired timer.
        DispatchQueue.main.async { Self.release(owner) }
    }
}

extension FoliaNativePlugin {
    @objc func getDisplaySleepSettings(_ call: CAPPluginCall) { run(call) {
        guard let displaySleep = self.displaySleep else { throw MobileFailure("display-sleep-unavailable") }
        call.resolve(displaySleep.snapshot)
    } }
    @objc func setDisplaySleepSettings(_ call: CAPPluginCall) { run(call) {
        guard let enabled = call.getBool("enabled") else { throw MobileFailure("invalid-display-sleep-settings") }
        guard let displaySleep = self.displaySleep else { throw MobileFailure("display-sleep-unavailable") }
        displaySleep.setEnabled(enabled); call.resolve(displaySleep.snapshot)
    } }
}
