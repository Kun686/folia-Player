import Foundation
import QuartzCore

// NativeMutedPreplay.swift — owns a silent incoming occurrence until a schedule takes over or intent is revoked.
final class NativeMutedPreplay {
    let incoming: StreamOccurrence
    private let outgoing: StreamOccurrence, output: StreamMixOutput
    private enum State { case prepared, waiting, playing, transferred, cancelled }
    private var state = State.prepared
    private var generation: UInt64?

    init(output: StreamMixOutput, outgoing: StreamOccurrence, incoming: StreamOccurrence) throws {
        guard outgoing !== incoming, incoming.canPreplay, output.running else { throw MobileFailure("transition-cancelled") }
        self.output = output; self.outgoing = outgoing; self.incoming = incoming
    }

    // The owner must retain this object before awaiting, so pause/seek can dispose its source immediately.
    @MainActor func start(current: () -> Bool) async throws {
        guard state == .prepared else { throw MobileFailure("transition-cancelled") }
        state = .waiting
        do {
            try check(current)
            guard incoming.canPreplay else { throw MobileFailure("transition-cancelled") }
            try incoming.attachOutput()
            let stamp = output.transitionGain.cancel(); generation = stamp
            guard try output.schedulePreplay(outgoing: outgoing.audio, incoming: incoming.audio, generation: stamp) else {
                throw MobileFailure("transition-cancelled")
            }
            let deadline = CACurrentMediaTime() + 1
            while CACurrentMediaTime() < deadline {
                try check(current)
                let clock = output.transitionGain.clock
                // A cancel can share this generation before the gate is adopted; it has no curveStart.
                if clock.generation == stamp, clock.curveStart != nil {
                    try incoming.play(); state = .playing; return
                }
                try await Task.sleep(nanoseconds: 5_000_000)
            }
            throw MobileFailure("transition-cancelled")
        } catch { cancel(); throw error }
    }

    // No suspension between final intent validation, command replacement and ownership transfer.
    func commit(_ envelope: NativeTransitionEnvelope, current: () -> Bool) throws -> UInt64 {
        try check(current)
        guard state == .playing, let generation,
              let next = try output.replacePreplay(outgoing: outgoing.audio, incoming: incoming.audio,
                                                   envelope: envelope, generation: generation) else {
            throw MobileFailure("transition-cancelled")
        }
        state = .transferred
        return next
    }
    private func check(_ current: () -> Bool) throws {
        try Task.checkCancellation()
        guard state != .cancelled, state != .transferred, current(), output.running,
              !outgoing.seeking, !outgoing.hasEnded, !outgoing.hasFailed,
              !incoming.seeking, !incoming.hasEnded, !incoming.hasFailed,
              generation.map({ output.transitionGain.isCurrent($0) }) ?? true else {
            throw MobileFailure("transition-cancelled")
        }
    }
    func cancel() {
        guard state != .cancelled, state != .transferred else { return }
        state = .cancelled
        // Disconnect first: cancelling gain restores both masters and would otherwise unmute this deck.
        incoming.dispose()
        if let generation { output.transitionGain.cancel(ifCurrent: generation) }
    }
    deinit { cancel() }
}
