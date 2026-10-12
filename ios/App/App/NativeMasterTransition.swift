import Foundation
import QuartzCore

// NativeMasterTransition.swift — adapt the original schedule to the rate actually adopted by native output.
enum NativeMasterTransition {
    @MainActor static func prepare(planner: NativeTransitionPlanner, plan: NativeTransitionPlan,
                                   output: StreamMixOutput, outgoing: StreamOccurrence, duration: Double,
                                   fromProfile: [String: Any]?, toProfile: [String: Any]?,
                                   stems: (outgoing: NativeStemWindow, incoming: NativeStemWindow)? = nil,
                                   current: @escaping () -> Bool) async throws -> NativeMasterHandover {
        if let stems, stems.outgoing.role != .tail || stems.incoming.role != .head {
            throw MobileFailure("invalid-stem-window")
        }
        let fields = try JSONSerialization.jsonObject(with: JSONEncoder().encode(plan))
        // Capture before bending, as the original deck clock does. Dividing twice would shorten the fade.
        let tailRate = outgoing.rate
        func check() throws {
            try Task.checkCancellation()
            guard current(), !outgoing.seeking, !outgoing.hasEnded, !outgoing.hasFailed else {
                throw MobileFailure("transition-cancelled")
            }
        }
        func calculate(_ applied: Double?) async throws -> NativeMasterHandover {
            try check()
            let measured = await output.deckState(outgoing.audio)
            try check()
            let live = measured.flatMap { state in state.time.flatMap { CACurrentMediaTime() - $0 < 0.25 ? state : nil } }
            var sourceClock = output.mediaClock(outgoing.audio)
            // A control read may land between the two deck pulls. Paired stems need a coherent
            // snapshot, not a one-shot race that silently demotes an otherwise ready transition.
            if stems != nil, sourceClock == nil, outgoing.tempoState?.phase == .raw {
                let deadline = CACurrentMediaTime() + 0.25
                while sourceClock == nil && CACurrentMediaTime() < deadline {
                    try check()
                    try await Task.sleep(nanoseconds: 5_000_000)
                    sourceClock = output.mediaClock(outgoing.audio)
                }
            }
            func extent(_ window: NativeStemWindow?) -> Any {
                window.map { ["from": $0.from, "to": $0.from + $0.duration] } as Any? ?? NSNull()
            }
            let request: [String: Any] = ["version": 1, "plan": fields,
                "from": ["duration": duration, "lines": NSNull(), "profile": fromProfile as Any? ?? NSNull(), "separated": extent(stems?.outgoing)],
                "to": ["duration": 0, "lines": NSNull(), "profile": toProfile as Any? ?? NSNull(), "separated": extent(stems?.incoming)],
                "timing": ["position": sourceClock?.mediaEnd ?? outgoing.position, "tailRate": tailRate, "appliedRate": applied as Any? ?? NSNull(),
                    "outgoingDb": live?.loudnessDb as Any? ?? NSNull(), "periodSec": live?.tempo?.periodSec as Any? ?? NSNull(),
                    "nextBeatIn": live?.nextBeatIn as Any? ?? NSNull()]]
            var result = try await planner.master(JSONSerialization.data(withJSONObject: request))
            result.sourceClock = sourceClock
            try check()
            return result
        }
        func adopt(_ requested: Double) async throws -> Double {
            try check()
            if abs(outgoing.rate - requested) < 0.000001 { return outgoing.rate }
            try outgoing.requestTempo(rate: requested)
            // Only control waits, for at most one second; the render callback never waits for this task.
            let deadline = CACurrentMediaTime() + 1
            while CACurrentMediaTime() < deadline {
                try check()
                if abs(outgoing.rate - requested) < 0.000001 { return outgoing.rate }
                if outgoing.tempoState?.phase == .failed { break }
                try await Task.sleep(nanoseconds: 10_000_000)
            }
            throw MobileFailure("tempo-unavailable")
        }
        let requested = try await calculate(nil)
        guard requested.mediaOverlap > 0 else { throw MobileFailure("transition-cancelled") }
        var applied = try await adopt(requested.requestedRate)
        var result = try await calculate(applied)
        // Loading/adoption may consume the last part of a window. Reapply the original short-window gate.
        if result.requestedRate == 1 && abs(applied - 1) >= 0.000001 {
            applied = try await adopt(1)
            result = try await calculate(applied)
        }
        guard result.envelope != nil, result.cue != nil else { throw MobileFailure("transition-cancelled") }
        return result
    }
}
