import Foundation

// NativeORTInference.swift — one serial worker for both models, immutable verified bytes, cancellation and a deadline.
// The Objective-C++ job owns its cancellation flags atomically and protects RunOptions with a mutex.
extension FoliaORTJob: @unchecked Sendable {}

final class NativeORTInference: @unchecked Sendable {
    enum Kind: String { case beatThis = "beat_this", htdemucs }
    private struct Manifest: Decodable {
        struct Entry: Decodable { let name: String, bytes: Int64?, sha256: String? }
        let models: [Entry]
    }
    // Global across service instances: a second caller cannot load a second model alongside the first.
    private static let worker = DispatchQueue(label: "app.folia.models", qos: .utility)
    static var runtimeVersion: String { FoliaORTJob.runtimeVersion() }

    func infer(_ kind: Kind, model: URL, input: Data, frames: Int) async throws -> [Data] {
        try await execute(kind, model: model, input: input, frames: frames, window: false)
    }

    // Planar drums, bass and vocals for an entire original head/tail window; one session for all chunks.
    func separateWindow(model: URL, input: Data, frames: Int) async throws -> [Data] {
        try await execute(.htdemucs, model: model, input: input, frames: frames, window: true)
    }

    private func execute(_ kind: Kind, model: URL, input: Data, frames: Int, window: Bool) async throws -> [Data] {
        guard (kind == .beatThis ? (1...1500).contains(frames) : window ? (1...1_323_000).contains(frames) : frames == 172032),
              input.count == frames * (kind == .beatThis ? 128 : 2) * MemoryLayout<Float>.size else {
            throw MobileFailure("ort-invalid-input")
        }
        try Task.checkCancellation()
        let job = FoliaORTJob()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                Self.worker.async {
                    let deadline = ProcessInfo.processInfo.systemUptime + 60
                    let timeout = DispatchWorkItem { job.cancel() }
                    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 60, execute: timeout)
                    defer { timeout.cancel() }
                    do {
                        let result: [Data] = try autoreleasepool {
                            guard !job.cancelled else { throw CancellationError() }
                            guard let manifestURL = Bundle.main.url(forResource: "modelManifest", withExtension: "json"),
                                  let entry = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: manifestURL))
                                    .models.first(where: { $0.name == kind.rawValue }),
                                  let bytes = entry.bytes, let digest = entry.sha256 else {
                                throw MobileFailure("ort-manifest-unavailable")
                            }
                            // Reuse the complete-file snapshot: its private immutable copy lives through Session destruction.
                            let snapshot = try NativeStemSnapshot.capture(model, deadline: deadline) { copied in
                                guard !job.cancelled else { throw CancellationError() }
                                guard copied <= bytes else { throw MobileFailure("ort-model-hash-mismatch") }
                            }
                            guard snapshot.bytes == bytes, snapshot.digest == digest else { throw MobileFailure("ort-model-hash-mismatch") }
                            return try withExtendedLifetime(snapshot) {
                                guard !job.cancelled else { throw CancellationError() }
                                if window { return try job.separateWindow(model: snapshot.url, input: input, frames: frames) }
                                return try job.run(model: snapshot.url, kind: kind.rawValue, input: input, frames: frames)
                            }
                        }
                        guard ProcessInfo.processInfo.systemUptime <= deadline else { throw MobileFailure("ort-timeout") }
                        guard !job.cancelled else { throw CancellationError() }
                        continuation.resume(returning: result)
                    } catch {
                        if ProcessInfo.processInfo.systemUptime > deadline { continuation.resume(throwing: MobileFailure("ort-timeout")) }
                        else if job.cancelled { continuation.resume(throwing: CancellationError()) }
                        else { continuation.resume(throwing: error) }
                    }
                }
            }
        } onCancel: { job.cancel() }
    }
}
