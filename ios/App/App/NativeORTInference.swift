import Foundation

// NativeORTInference.swift — one serial worker for both models, immutable verified bytes, cancellation and a deadline.
// The Objective-C++ job owns its cancellation flags atomically and protects RunOptions with a mutex.
extension FoliaORTJob: @unchecked Sendable {}

final class NativeORTInference: @unchecked Sendable {
    typealias Kind = NativeModelManifest.Name
    // Global across service instances: a second caller cannot load a second model alongside the first.
    // Current/next-track analysis is deadline-bound user work. Utility doubled the measured
    // first-chunk compute time on XS Max; this remains serial and below the audio render priority.
    private static let worker = DispatchQueue(label: "app.folia.models", qos: .userInitiated)
    static var runtimeVersion: String { FoliaORTJob.runtimeVersion() }

    static func modelDigest(_ kind: Kind) throws -> String { try descriptor(kind).digest }
    private static func descriptor(_ kind: Kind) throws -> (bytes: Int64, digest: String) {
        let entry = try NativeModelManifest().entry(kind)
        return (entry.bytes, entry.sha256)
    }

    func infer(_ kind: Kind, model: URL, input: Data, frames: Int) async throws -> [Data] {
        try await execute(kind, model: model, input: input, frames: frames, window: false)
    }

    // Planar drums, bass and vocals for an entire original head/tail window; one session for all chunks.
    func separateWindow(model: URL, input: Data, frames: Int) async throws -> [Data] {
        try await execute(.htdemucs, model: model, input: input, frames: frames, window: true)
    }

    func inferBeatChunks(model: URL, inputs: [Data], frames: [Int]) async throws -> [Data] {
        guard (1...41).contains(inputs.count), inputs.count == frames.count,
              zip(inputs, frames).allSatisfy({ (1...1500).contains($0.1) && $0.0.count == $0.1 * 128 * 4 }) else {
            throw MobileFailure("ort-invalid-input")
        }
        return try await verified(.beatThis, model: model) { job, snapshot in
            try job.runBeatChunks(model: snapshot, inputs: inputs, frames: frames.map { NSNumber(value: $0) })
        }
    }

    private func execute(_ kind: Kind, model: URL, input: Data, frames: Int, window: Bool) async throws -> [Data] {
        guard (kind == .beatThis ? (1...1500).contains(frames) : window ? (1...1_323_000).contains(frames) : frames == 172032),
              input.count == frames * (kind == .beatThis ? 128 : 2) * MemoryLayout<Float>.size else {
            throw MobileFailure("ort-invalid-input")
        }
        return try await verified(kind, model: model) { job, snapshot in
            if window { return try job.separateWindow(model: snapshot, input: input, frames: frames) }
            return try job.run(model: snapshot, kind: kind.rawValue, input: input, frames: frames)
        }
    }

    private func verified(_ kind: Kind, model: URL,
                          run: @escaping @Sendable (FoliaORTJob, URL) throws -> [Data]) async throws -> [Data] {
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
                            let (bytes, digest) = try Self.descriptor(kind)
                            // Reuse the complete-file snapshot: its private immutable copy lives through Session destruction.
                            let snapshot = try NativeStemSnapshot.capture(model, deadline: deadline) { copied in
                                guard !job.cancelled else { throw CancellationError() }
                                guard copied <= bytes else { throw MobileFailure("ort-model-hash-mismatch") }
                            }
                            guard snapshot.bytes == bytes, snapshot.digest == digest else { throw MobileFailure("ort-model-hash-mismatch") }
                            return try withExtendedLifetime(snapshot) {
                                guard !job.cancelled else { throw CancellationError() }
                                return try run(job, snapshot.url)
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
