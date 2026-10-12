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
    @MainActor func clocks(current: () -> Bool, trace: NativeAnalysisTrace? = nil) async throws -> NativeStemClocks? {
        let operation = trace == nil ? nil : UUID()
        var polls = 0, missingOutgoing = 0, missingIncoming = 0, mismatched = 0
        // Opt-in control-side evidence only; never log media identity or add work to the render callback.
        defer {
            if let trace, let operation {
                let out = output.tempoState(outgoing.audio), input = output.tempoState(incoming.audio)
                trace.mark("preplay.clocks", operation: operation, metrics: [
                    "polls": NSNumber(value: polls), "missingOutgoing": NSNumber(value: missingOutgoing),
                    "missingIncoming": NSNumber(value: missingIncoming), "mismatched": NSNumber(value: mismatched),
                    "outRaw": NSNumber(value: out?.phase == .raw), "inRaw": NSNumber(value: input?.phase == .raw),
                    "outRate": NSNumber(value: out?.rate ?? -1), "inRate": NSNumber(value: input?.rate ?? -1),
                    "outFrame": NSNumber(value: out?.mediaClock?.sampleEnd ?? -1),
                    "inFrame": NSNumber(value: input?.mediaClock?.sampleEnd ?? -1),
                    "outQuantum": NSNumber(value: out?.mediaClock?.quantumFrames ?? -1),
                    "inQuantum": NSNumber(value: input?.mediaClock?.quantumFrames ?? -1),
                    "renderedEnd": NSNumber(value: output.transitionGain.clock.renderedEnd ?? -1),
                    "inBufferedSeconds": NSNumber(value: incoming.audio.bufferedDuration),
                    "inPlaying": NSNumber(value: incoming.playing), "inSeeking": NSNumber(value: incoming.seeking),
                    "inEnded": NSNumber(value: incoming.hasEnded)])
            }
        }
        let deadline = CACurrentMediaTime() + 0.25
        while CACurrentMediaTime() < deadline {
            try check(current)
            guard state == .playing else { throw MobileFailure("transition-cancelled") }
            let out = output.mediaClock(outgoing.audio), input = output.mediaClock(incoming.audio)
            polls += 1
            if out == nil { missingOutgoing += 1 }
            if input == nil { missingIncoming += 1 }
            if let clocks = NativeStemClocks(outgoing: out, incoming: input) { return clocks }
            if out != nil && input != nil { mismatched += 1 }
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        return nil
    }
    func commit(_ prepared: NativeLiveStemHandover, fallback: NativeTransitionEnvelope, current: () -> Bool) throws -> UInt64 {
        try check(current)
        guard state == .playing, let generation,
              let next = try output.replacePreplay(outgoing: outgoing.audio, incoming: incoming.audio,
                  prepared: prepared, fallback: fallback, generation: generation) else { throw MobileFailure("transition-cancelled") }
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
