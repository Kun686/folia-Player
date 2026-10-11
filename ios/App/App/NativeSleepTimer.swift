import Foundation

// NativeSleepTimer.swift — original one-shot deadline semantics, owned outside the WebView.
final class NativeSleepTimer {
    struct Duration: Codable {
        var hours = 0
        var minutes = 0
        var seconds: Double { Double(hours * 3600 + minutes * 60) }
        var valid: Bool { (0...999).contains(hours) && (0...59).contains(minutes) }
    }
    private struct Edit: Decodable { let hours: Int?; let minutes: Int?; let enabled: Bool? }
    private let storage: UserDefaults
    private let now: () -> Date
    private var timer: DispatchSourceTimer?
    private(set) var duration = Duration()
    private(set) var deadline: Date?
    private(set) var revision = 0
    var expired: (() -> Void)?
    var changed: (() -> Void)?

    init(storage: UserDefaults, now: @escaping () -> Date = Date.init) {
        self.storage = storage; self.now = now
        if let data = storage.data(forKey: "folia.sleep-duration"),
           let saved = try? JSONDecoder().decode(Duration.self, from: data), saved.valid { duration = saved }
        // The desktop persists only the preferred duration, never an armed timer across a process restart.
    }
    var snapshot: [String: Any] {
        ["hours": duration.hours, "minutes": duration.minutes, "enabled": deadline != nil,
         "deadlineMs": deadline.map { $0.timeIntervalSince1970 * 1000 } as Any? ?? NSNull(), "revision": revision]
    }
    // A duration edit must not resurrect a timer that expired while its bridge request was in flight.
    func apply(_ values: [String: Any]) throws -> [String: Any] {
        let edit: Edit
        do {
            guard !values.isEmpty, Set(values.keys).isSubset(of: ["hours", "minutes", "enabled"]) else {
                throw MobileFailure("invalid-sleep-timer")
            }
            edit = try JSONDecoder().decode(Edit.self, from: JSONSerialization.data(withJSONObject: values))
        } catch { throw MobileFailure("invalid-sleep-timer") }
        let next = Duration(hours: edit.hours ?? duration.hours, minutes: edit.minutes ?? duration.minutes)
        guard next.valid, edit.hours != nil || edit.minutes != nil || edit.enabled != nil,
              edit.enabled != true || next.seconds > 0 else { throw MobileFailure("invalid-sleep-timer") }
        let data = try JSONEncoder().encode(next)
        reconcile()
        let durationChanged = next.hours != duration.hours || next.minutes != duration.minutes
        duration = next
        if next.seconds == 0 || edit.enabled == false { deadline = nil }
        else if edit.enabled == true || (deadline != nil && durationChanged) {
            deadline = now().addingTimeInterval(next.seconds)
        }
        storage.set(data, forKey: "folia.sleep-duration")
        revision += 1; schedule(); changed?()
        return snapshot
    }
    // Also called on foreground/commands: a suspended paused app reconciles before any automatic resume.
    func reconcile() {
        guard let deadline, now() >= deadline else { return }
        self.deadline = nil; timer?.cancel(); timer = nil; revision += 1
        expired?(); changed?()
    }
    private func schedule() {
        timer?.cancel(); timer = nil
        guard let deadline else { return }
        let source = DispatchSource.makeTimerSource(queue: .main)
        source.schedule(deadline: .now() + max(0, min(1, deadline.timeIntervalSince(now()))),
                        repeating: 1, leeway: .milliseconds(25))
        source.setEventHandler { [weak self] in self?.reconcile() }
        timer = source; source.resume()
    }
    deinit { timer?.cancel() }
}
