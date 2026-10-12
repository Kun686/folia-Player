import Foundation

// NativeAnalysisTrace.swift — opt-in, bounded QA timing; no media identities, URLs, PCM or credentials.
final class NativeAnalysisTrace: @unchecked Sendable {
    private let lock = NSLock()
    private var events: [[String: Any]] = []
    private var dropped = 0
    private let origin = ProcessInfo.processInfo.systemUptime

    func mark(_ stage: String, operation: UUID, edge: String = "point", metrics: [String: NSNumber] = [:]) {
        lock.lock(); defer { lock.unlock() }
        guard events.count < 1024 else { dropped += 1; return }
        events.append(["stage": stage, "operation": operation.uuidString, "edge": edge,
            "elapsed": ProcessInfo.processInfo.systemUptime - origin,
            "thermal": ProcessInfo.processInfo.thermalState.rawValue, "metrics": metrics])
    }

    // Call the returned closure in defer, including errors and cancellation, to measure actual work exit.
    func begin(_ stage: String, operation: UUID) -> @Sendable () -> Void {
        mark(stage, operation: operation, edge: "begin")
        return { self.mark(stage, operation: operation, edge: "end") }
    }

    func snapshot() -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        return ["events": events, "dropped": dropped]
    }
}
