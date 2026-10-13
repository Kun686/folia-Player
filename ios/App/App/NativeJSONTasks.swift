import Foundation

// NativeJSONTasks.swift — exact-ID cancellation and bounded concurrency shared by independent AI and sync request owners.
@MainActor final class NativeJSONTasks {
    private let prefix: String
    private let maximumActive: Int
    private var requests: [String: Task<[String: Any], Error>] = [:]
    private var earlyCancellations: [String] = []
    init(prefix: String, maximumActive: Int = 2) { self.prefix = prefix; self.maximumActive = max(1, min(16, maximumActive)) }
    deinit { requests.values.forEach { $0.cancel() } }
    func cancelAll() { requests.values.forEach { $0.cancel() } }
    func cancel(_ id: String) {
        guard !id.isEmpty, id.utf8.count <= 128 else { return }
        if let task = requests[id] { task.cancel() }
        else if !earlyCancellations.contains(id) {
            // A bridge cancellation can reach the main actor before its request Task starts.
            earlyCancellations.append(id)
            if earlyCancellations.count > 128 { earlyCancellations.removeFirst() }
        }
    }
    func run(id: String, work: @escaping @MainActor () async throws -> [String: Any]) async throws -> [String: Any] {
        if let index = earlyCancellations.firstIndex(of: id) {
            earlyCancellations.remove(at: index); throw MobileFailure(prefix + "-cancelled")
        }
        guard !Task.isCancelled else { throw MobileFailure(prefix + "-cancelled") }
        guard !id.isEmpty, id.utf8.count <= 128, requests[id] == nil, requests.count < maximumActive else {
            throw MobileFailure("invalid-" + prefix + "-request")
        }
        let task = Task { @MainActor in try Task.checkCancellation(); return try await work() }
        requests[id] = task
        defer { requests[id] = nil }
        do {
            let result = try await withTaskCancellationHandler { try await task.value } onCancel: { task.cancel() }
            try Task.checkCancellation()
            return result
        } catch {
            if task.isCancelled || Task.isCancelled { throw MobileFailure(prefix + "-cancelled") }
            if let failure = error as? MobileFailure { throw failure }
            if (error as? URLError)?.code == .timedOut { throw MobileFailure(prefix + "-timeout") }
            throw MobileFailure(prefix + "-network")
        }
    }
}
