import Foundation
import QuartzCore

// NativeBalanceCorrection.swift — original transition-only policy, scheduled independently of WKWebView.
final class NativeBalanceCorrection {
    private var task: Task<Void, Never>?
    func cancel() { task?.cancel(); task = nil }
    deinit { task?.cancel() }

    @MainActor func start(planner: NativeTransitionPlanner, output: StreamMixOutput,
                         outgoing: StreamOccurrence, incoming: StreamOccurrence,
                         outgoingReference: Double?, incomingReference: Double?,
                         overlap: Double, generation: UInt64, current: @escaping () -> Bool) {
        cancel()
        task = Task { @MainActor [weak outgoing, weak incoming, weak output] in
            var applied = 0.0
            func request(_ a: Double?, _ b: Double?) throws -> Data {
                try JSONSerialization.data(withJSONObject: ["version": 1, "overlap": overlap, "appliedDb": applied,
                    "outgoingDb": a as Any? ?? NSNull(), "incomingDb": b as Any? ?? NSNull()])
            }
            func recent(_ state: NativeDeckState?) -> Double? {
                guard let state, let time = state.time, CACurrentMediaTime() - time < 0.25 else { return nil }
                return state.loudnessDb
            }
            do {
                let policy = try await planner.balance(request(nil, nil))
                guard overlap >= policy.minOverlap, (25...1000).contains(policy.intervalMs) else { return }
                while !Task.isCancelled {
                    try await Task.sleep(nanoseconds: UInt64(policy.intervalMs) * 1_000_000)
                    guard current(), let outgoing, let incoming, let output,
                          !outgoing.hasEnded, !outgoing.hasFailed, !incoming.hasEnded, !incoming.hasFailed else { return }
                    // A temporary decoder stall must not permanently disable correction for this blend.
                    guard output.running, outgoing.playing, incoming.playing else { continue }
                    let outLevel: Double?
                    if let outgoingReference { outLevel = outgoingReference + output.replayGainDb(outgoing.audio) }
                    else { outLevel = recent(await output.deckState(outgoing.audio)) }
                    let inLevel: Double?
                    if let incomingReference { inLevel = incomingReference + output.replayGainDb(incoming.audio) }
                    else { inLevel = recent(await output.deckState(incoming.audio)) }
                    try Task.checkCancellation()
                    guard current() else { return }
                    let step = try await planner.balance(request(outLevel, inLevel))
                    try Task.checkCancellation()
                    guard current() else { return }
                    if let adjustment = step.adjustment,
                       output.transitionGain.trim(gain: adjustment.gain, seconds: adjustment.seconds, generation: generation) {
                        applied = adjustment.trimDb
                    }
                }
            } catch {
                // No measurement/runtime is a reason to leave trim alone, never to interrupt playback.
            }
        }
    }
}
