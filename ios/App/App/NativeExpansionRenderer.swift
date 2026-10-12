import Foundation
import JavaScriptCore

// NativeExpansionRenderer.swift — exact original sample renderer in a short-lived VM, never the audio callback.
actor NativeExpansionRenderer {
    private let scriptURL: URL?
    init(bundle: Bundle = .main) {
        scriptURL = bundle.url(forResource: "transitions", withExtension: "js", subdirectory: "public/native")
    }
    func render(_ windows: NativeStemWindowPair, plan: NativeExpansionPlan) throws -> NativeExpansionPCM {
        guard windows.seconds == plan.windowSec else { throw MobileFailure("invalid-expansion-plan") }
        return try render(plan: plan) { try windows.expansionChannels($0) }
    }
    func render(_ pcm: NativeStemPCM, plan: NativeExpansionPlan) throws -> NativeExpansionPCM {
        try render(plan: plan) { pcm.stems[$0]! }
    }

    func program(_ window: NativeStemWindow, plannedOffset: Double, plan: NativeExpansionPlan) throws -> NativeExpansionProgram {
        try Task.checkCancellation(); try plan.validate()
        return try withRuntime { context, runtime in
            let value = runtime.invokeMethod("expansionSampleMapPCM", withArguments: [try planText(plan)])
            try Task.checkCancellation()
            guard context.exception == nil, let value else { throw MobileFailure("invalid-expansion-pcm") }
            let map = try NativeFloat32Bridge.copyDoubles(value, count: plan.frames * 2)
            return try NativeExpansionProgram(plan: plan, map: map, window: window, plannedOffset: plannedOffset)
        }
    }

    private func planText(_ plan: NativeExpansionPlan) throws -> String {
        struct Request: Encodable { let version = 1; let plan: NativeExpansionPlan }
        let text = String(decoding: try JSONEncoder().encode(Request(plan: plan)), as: UTF8.self)
        guard text.utf8.count <= 262144 else { throw MobileFailure("invalid-expansion-plan") }
        return text
    }
    private func withRuntime<T>(_ body: (JSContext, JSValue) throws -> T) throws -> T {
        try autoreleasepool {
            guard let scriptURL, let script = try? String(contentsOf: scriptURL, encoding: .utf8),
                  script.utf8.count <= 1048576, let context = JSContext() else { throw MobileFailure("transition-runtime-unavailable") }
            context.evaluateScript(script, withSourceURL: scriptURL)
            guard context.exception == nil, let runtime = context.objectForKeyedSubscript("FoliaTransitions"),
                  runtime.forProperty("protocolVersion")?.toInt32() == 1 else { throw MobileFailure("transition-runtime-unavailable") }
            return try body(context, runtime)
        }
    }

    // One channel per call bounds cancellation latency; each call retains the original complete render.
    // No JS values, callbacks or PCM owners escape the autorelease pool/VM. Only copied Float32 returns.
    private func render(plan: NativeExpansionPlan, channels: (NativeStemName) throws -> [[Float]]) throws -> NativeExpansionPCM {
        try Task.checkCancellation(); try plan.validate()
        return try withRuntime { context, runtime in
            let text = try planText(plan)
            let deadline = ProcessInfo.processInfo.systemUptime + 10
            var output = Array(repeating: Array(repeating: Float(0), count: plan.frames), count: 2)
            for name in plan.stems {
                let rows = try channels(NativeStemName(rawValue: name)!)
                guard rows.count == 2, rows[0].count == rows[1].count,
                      rows.allSatisfy({ (1...1_323_000).contains($0.count) && $0.allSatisfy(\.isFinite) }) else {
                    throw MobileFailure("invalid-expansion-pcm")
                }
                for channel in 0..<2 {
                    try Task.checkCancellation()
                    let rendered: [Float] = try autoreleasepool {
                        let owner = rows[channel].withUnsafeBytes { NSData(bytes: $0.baseAddress!, length: $0.count) }
                        let input = try NativeFloat32Bridge.make(owner, in: context, errorCode: "expansion-memory-unavailable")
                        context.exception = nil
                        let value = runtime.invokeMethod("renderExpansionPCM", withArguments: [input, text])
                        try Task.checkCancellation()
                        guard ProcessInfo.processInfo.systemUptime <= deadline else { throw MobileFailure("expansion-timeout") }
                        guard context.exception == nil, let value else { throw MobileFailure("invalid-expansion-pcm") }
                        return try NativeFloat32Bridge.copy(value, count: plan.frames)
                    }
                    // The session sums drums, then other, rounding to Float32 after each stem.
                    for i in 0..<plan.frames { output[channel][i] += rendered[i] }
                }
            }
            try Task.checkCancellation()
            return try NativeExpansionPCM(plan: plan, channels: output)
        }
    }
}
