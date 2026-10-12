import Foundation

// NativeStemHandover.swift — one cancellable preparation of the original gesture, aligned PCM and optional build.
struct NativePreparedStemHandover {
    let windows: NativeStemWindowPair
    let gesture: NativeStemGesture
    let bus: NativeStemBusParameters
    let expansion: NativeExpansionPCM?
}
struct NativeLiveStemHandover {
    let outgoing: NativeStemWindow, incoming: NativeStemWindow
    let clocks: NativeStemClocks, plannedStart: Double
    let gesture: NativeStemGesture, bus: NativeStemBusParameters
}

actor NativeStemHandover {
    private let analysis = NativeStemAnalysis()
    private let expansion = NativeExpansionRenderer()

    // Keep the original observations/curves, while the render thread binds packed PCM to actual media time.
    // Performance builds require a separately aligned render; the current queue has performance disabled.
    func prepareLive(outgoing: NativeStemWindow, incoming: NativeStemWindow,
                     options: NativeStemAnalysisContext, clocks: NativeStemClocks, plannedStart: Double,
                     planner: NativeTransitionPlanner) async throws -> NativeLiveStemHandover? {
        try Task.checkCancellation()
        guard options.expansion == nil else { throw MobileFailure("invalid-expansion-pcm") }
        guard let request = try await analysis.request(out: outgoing, incoming: incoming, options: options, planner: planner) else { return nil }
        let gesture = try await planner.stems(request), bus = try await planner.stemBus()
        try Task.checkCancellation()
        return NativeLiveStemHandover(outgoing: outgoing, incoming: incoming, clocks: clocks,
                                     plannedStart: plannedStart, gesture: gesture, bus: bus)
    }

    // Observations precede late wiring compensation, exactly as in scheduleStemGesture.
    // Nothing is published until every stage finishes, so a cancellation cannot leave half a program.
    func prepare(outgoing: NativeStemWindow, incoming: NativeStemWindow,
                 options: NativeStemAnalysisContext, lateBy: Double,
                 planner: NativeTransitionPlanner) async throws -> NativePreparedStemHandover? {
        try Task.checkCancellation()
        guard lateBy.isFinite, lateBy >= 0 else { throw MobileFailure("invalid-stem-alignment") }
        guard let request = try await analysis.request(out: outgoing, incoming: incoming, options: options, planner: planner) else { return nil }
        let gesture = try await planner.stems(request), bus = try await planner.stemBus()
        try Task.checkCancellation()
        guard let windows = try await NativeStemWindowPair.prepare(out: outgoing, incoming: incoming,
            outAt: options.outAt, inAt: options.inAt, seconds: options.windowSec, lateBy: lateBy, planner: planner) else { return nil }
        let build: NativeExpansionPCM?
        if let plan = gesture.expansion { build = try await expansion.render(windows, plan: plan) }
        else { build = nil }
        try Task.checkCancellation()
        return NativePreparedStemHandover(windows: windows, gesture: gesture, bus: bus, expansion: build)
    }
}
