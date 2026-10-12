import Foundation

// NativeModelStore.swift — optional weights, explicit cancellation, and generation-guarded publication.
actor NativeModelStore {
    typealias Name = NativeModelManifest.Name
    struct Status: Sendable {
        let entry: NativeModelManifest.Entry
        var installed = false, phase = "absent", received: Int64 = 0, host = ""
        var failures: [String] = []
    }
    struct Snapshot: Sendable { let revision: Int, models: [Status], paths: [Name: URL] }
    private enum Operation: Sendable, Equatable { case restore, download, install(URL) }
    private struct Job { let stamp: UUID, operation: Operation, task: Task<Void, Error> }
    private let manifest: NativeModelManifest, files: NativeModelFiles, configuration: URLSessionConfiguration
    private var states: [Name: Status]
    private var jobs: [Name: Job] = [:]
    private var downloads: [Name: UUID] = [:]
    private(set) var revision = 0
    private var changed: (@MainActor @Sendable () -> Void)?

    init(directory: URL? = nil, manifest: NativeModelManifest? = nil, configuration: URLSessionConfiguration = .ephemeral) throws {
        let manifest = try manifest ?? NativeModelManifest()
        self.manifest = manifest; files = NativeModelFiles(directory: directory); self.configuration = configuration
        states = Dictionary(uniqueKeysWithValues: manifest.entries.map { ($0.name, Status(entry: $0)) })
    }
    deinit { jobs.values.forEach { $0.task.cancel() } }
    func onChange(_ callback: @escaping @MainActor @Sendable () -> Void) { changed = callback }
    func status() -> [Status] { Name.allCases.compactMap { states[$0] } }
    func snapshot() -> Snapshot {
        Snapshot(revision: revision, models: status(), paths: Dictionary(uniqueKeysWithValues:
            Name.allCases.compactMap { name in model(name).map { (name, $0) } }))
    }
    // Installed means verified bytes on disk, not that full Automix is enabled or device-qualified.
    func model(_ name: Name) -> URL? { states[name]?.installed == true ? files.url(manifest.entry(name)) : nil }
    func restore() async {
        for name in Name.allCases { try? await perform(name, .restore) }
    }
    func download(_ name: Name) async throws { try await perform(name, .download) }
    func install(_ name: Name, from source: URL) async throws { try await perform(name, .install(source)) }
    func cancel(_ name: Name) async {
        let old = invalidate(name)
        let phase = states[name]?.installed == true ? "installed" : "absent"
        states[name]?.phase = phase
        notify(); _ = try? await old?.value
    }
    func remove(_ name: Name) async throws {
        let old = invalidate(name)
        // No await before deletion: an already verified late job cannot publish across this boundary.
        do {
            try files.remove(manifest.entry(name)); states[name] = Status(entry: manifest.entry(name)); notify()
        } catch {
            states[name]?.phase = "error"; states[name]?.failures = ["model-remove-failed"]; notify()
            _ = try? await old?.value; throw MobileFailure("model-remove-failed")
        }
        _ = try? await old?.value
    }
    private func invalidate(_ name: Name) -> Task<Void, Error>? {
        let task = jobs.removeValue(forKey: name)?.task; task?.cancel()
        downloads.removeValue(forKey: name)
        return task
    }
    private func notify() {
        revision += 1
        if let changed { Task { @MainActor in changed() } }
    }
    private func report(_ name: Name, stamp: UUID, phase: String, received: Int64 = 0, host: String = "", failure: String? = nil) {
        guard jobs[name]?.stamp == stamp else { return }
        downloads.removeValue(forKey: name)
        states[name]?.phase = phase; states[name]?.received = received; states[name]?.host = host
        if let failure { states[name]?.failures.append(failure) }
        notify()
    }
    private func beginDownload(_ name: Name, stamp: UUID, attempt: UUID, host: String) {
        report(name, stamp: stamp, phase: "downloading", host: host)
        if jobs[name]?.stamp == stamp { downloads[name] = attempt }
    }
    private func progress(_ name: Name, stamp: UUID, attempt: UUID, bytes: Int64) {
        guard jobs[name]?.stamp == stamp, downloads[name] == attempt, states[name]?.phase == "downloading" else { return }
        states[name]?.received = bytes; notify()
    }
    private func complete(_ name: Name, stamp: UUID, snapshot: NativeStemSnapshot?, restore: Bool) throws {
        try Task.checkCancellation()
        guard jobs[name]?.stamp == stamp else { throw CancellationError() }
        if let snapshot, !restore { try files.commit(snapshot, entry: manifest.entry(name)) }
        states[name]?.installed = snapshot != nil; states[name]?.phase = snapshot == nil ? "absent" : "installed"
        states[name]?.received = snapshot?.bytes ?? 0; states[name]?.host = ""; states[name]?.failures = []
        downloads.removeValue(forKey: name)
        jobs.removeValue(forKey: name); notify()
    }
    private func failed(_ name: Name, stamp: UUID, error: Error) {
        guard jobs[name]?.stamp == stamp else { return }
        downloads.removeValue(forKey: name)
        jobs.removeValue(forKey: name)
        let phase = error is CancellationError ? (states[name]?.installed == true ? "installed" : "absent") : "error"
        states[name]?.phase = phase
        if states[name]?.failures.isEmpty == true { states[name]?.failures = [Self.code(error)] }
        notify()
    }
    // Repeated callers share one job; only the explicit cancel/remove actions own cancellation.
    private func perform(_ name: Name, _ operation: Operation) async throws {
        if let job = jobs[name] {
            if job.operation == operation { try await job.task.value; return }
            // Never leave an unregistered pending install that could restart after remove/cancel.
            throw MobileFailure("model-busy")
        }
        let entry = manifest.entry(name), stamp = UUID(), files = files, configuration = configuration
        states[name]?.phase = "queued"; states[name]?.received = 0; states[name]?.failures = []; notify()
        if operation == .restore { states[name]?.installed = false }
        let task = Task.detached(priority: .utility) { [weak self] in
            do {
                try Task.checkCancellation()
                var snapshot: NativeStemSnapshot?, restoring = false
                switch operation {
                case .restore:
                    restoring = true
                    await self?.report(name, stamp: stamp, phase: "verifying")
                    if files.exists(entry) { snapshot = try NativeModelFiles.verify(files.url(entry), entry: entry) }
                case .install(let source):
                    await self?.report(name, stamp: stamp, phase: "verifying")
                    let scoped = source.startAccessingSecurityScopedResource()
                    defer { if scoped { source.stopAccessingSecurityScopedResource() } }
                    snapshot = try NativeModelFiles.verify(source, entry: entry)
                case .download:
                    for url in entry.mirrors {
                        try Task.checkCancellation()
                        let host = url.host ?? "", attempt = UUID()
                        await self?.beginDownload(name, stamp: stamp, attempt: attempt, host: host)
                        do {
                            let transfer = NativeMediaDownload(configuration: configuration, maximumBytes: Double(entry.bytes)) { [weak self] bytes in
                                Task { await self?.progress(name, stamp: stamp, attempt: attempt, bytes: bytes) }
                            }
                            let download = try await transfer.read(url)
                            defer { try? FileManager.default.removeItem(at: download.url) }
                            try Task.checkCancellation()
                            await self?.report(name, stamp: stamp, phase: "verifying", received: download.bytes, host: host)
                            snapshot = try NativeModelFiles.verify(download.url, entry: entry)
                            break
                        } catch {
                            try Task.checkCancellation()
                            await self?.report(name, stamp: stamp, phase: "error", host: host, failure: host + ": " + Self.code(error))
                        }
                    }
                    guard snapshot != nil else { throw MobileFailure("model-download-failed") }
                }
                guard let self else { throw CancellationError() }
                try await self.complete(name, stamp: stamp, snapshot: snapshot, restore: restoring)
            } catch {
                await self?.failed(name, stamp: stamp, error: error)
                throw error
            }
        }
        jobs[name] = Job(stamp: stamp, operation: operation, task: task)
        try await task.value
    }
    private static func code(_ error: Error) -> String {
        if error is CancellationError { return "model-cancelled" }
        return (error as? MobileFailure)?.code ?? "model-file-unavailable"
    }
}
