import Foundation
import JavaScriptCore

// NativeStemAnalysis.swift — original PCM observations and tail evidence, prepared outside the render thread.
struct NativeStemAnalysisContext: Codable {
    let windowSec: Double, outAt: Double, inAt: Double
    var outgoingBarSec: Double?, incomingBarSec: Double?, outgoingBpm: Double?, outgoingDownbeat: Double?
    var outgoingBeatsPerBar: Double?, incomingSectionStart: Double?, expansion: Double?
    var keysClash = false
}

actor NativeStemAnalysis {
    private let scriptURL: URL?
    init(bundle: Bundle = .main) {
        scriptURL = bundle.url(forResource: "transitions", withExtension: "js", subdirectory: "public/native")
    }

    // The original tail end is measured from unquantized vocals and the original mix, before Int16 storage.
    func window(fromFrame: Int, role: NativeStemRole, mix: [[Float]],
                separated: [NativeStemName: [[Float]]]) throws -> NativeStemWindow {
        try Task.checkCancellation()
        var vocalEnd: Double?
        if role == .tail {
            guard let vocals = separated[.vocals], vocals.first?.count == mix.first?.count else {
                throw MobileFailure("invalid-stem-window")
            }
            vocalEnd = try withRuntime { context, runtime in
                let request: [String: Any] = ["version": 1, "vocals": try envelope(vocals, context, runtime),
                    "mix": try envelope(mix, context, runtime)]
                let data = try invoke("stemVocalEndJSON", request, runtime, context)
                return try JSONDecoder().decode(Double?.self, from: data)
            }
        }
        try Task.checkCancellation()
        return try NativeStemWindow(fromFrame: fromFrame, role: role, mix: mix, separated: separated, vocalEnd: vocalEnd)
    }

    // Evidence uses the original rounded slice BEFORE late compensation; playback alignment is a later step.
    // A full incoming head supplies the reference floor even when the requested blend contains only a quiet intro.
    func request(out: NativeStemWindow, incoming: NativeStemWindow, options: NativeStemAnalysisContext,
                 planner: NativeTransitionPlanner) async throws -> Data? {
        try Task.checkCancellation()
        guard out.role == .tail, incoming.role == .head else { throw MobileFailure("invalid-stem-window") }
        let alignment = try await planner.stemWindow(JSONSerialization.data(withJSONObject: ["version": 1,
            "outAt": options.outAt, "outFrom": out.from, "outFrames": out.frames,
            "inAt": options.inAt, "inFrom": incoming.from, "inFrames": incoming.frames,
            "seconds": options.windowSec, "lateBy": 0]))
        guard alignment.covered else { return nil }
        guard let offset = alignment.expansionOffset, let inOffset = alignment.inOffset, let length = alignment.length,
              offset >= 0, inOffset >= 0, length > 0, offset <= out.frames - length,
              inOffset <= incoming.frames - length else { throw MobileFailure("invalid-stem-alignment") }
        return try withRuntime { context, runtime in
            guard var request = try JSONSerialization.jsonObject(with: JSONEncoder().encode(options)) as? [String: Any] else {
                throw MobileFailure("invalid-transition-input")
            }
            request["version"] = 1
            request["vocals"] = try envelope(out.decodedStem(.vocals, offset: Double(offset), count: length), context, runtime)
            request["mix"] = try envelope(out.mixed(offset: offset, count: length), context, runtime)
            request["incomingVocals"] = try envelope(incoming.decodedStem(.vocals, offset: Double(inOffset), count: length), context, runtime)
            request["incomingReference"] = try envelope(incoming.mixed(), context, runtime)
            return try invoke("stemObservationJSON", request, runtime, context)
        }
    }

    private func withRuntime<T>(_ body: (JSContext, JSValue) throws -> T) throws -> T {
        try Task.checkCancellation()
        return try autoreleasepool {
            guard let scriptURL, let script = try? String(contentsOf: scriptURL, encoding: .utf8),
                  script.utf8.count <= 1048576, let context = JSContext() else { throw MobileFailure("transition-runtime-unavailable") }
            context.evaluateScript(script, withSourceURL: scriptURL)
            guard context.exception == nil, let runtime = context.objectForKeyedSubscript("FoliaTransitions"),
                  runtime.forProperty("protocolVersion")?.toInt32() == 1 else { throw MobileFailure("transition-runtime-unavailable") }
            let result = try body(context, runtime)
            try Task.checkCancellation()
            return result
        }
    }

    private func envelope(_ channels: [[Float]], _ context: JSContext, _ runtime: JSValue) throws -> [Double] {
        try Task.checkCancellation()
        guard channels.count == 2, channels[0].count == channels[1].count,
              channels.allSatisfy({ (1...1_323_000).contains($0.count) && $0.allSatisfy(\.isFinite) }) else {
            throw MobileFailure("invalid-stem-pcm")
        }
        return try autoreleasepool {
            let inputs = try channels.map { row -> JSValue in
                let owner = row.withUnsafeBytes { NSData(bytes: $0.baseAddress!, length: $0.count) }
                return try NativeFloat32Bridge.make(owner, in: context, errorCode: "stem-memory-unavailable")
            }
            context.exception = nil
            let value = runtime.invokeMethod("stemEnvelopeJSON", withArguments: inputs)
            try Task.checkCancellation()
            let data = try response(value, context)
            let values = try JSONDecoder().decode([Float].self, from: data)
            guard values.count == channels[0].count / 2205, values.allSatisfy({ $0.isFinite && $0 >= 0 }) else {
                throw MobileFailure("invalid-stem-evidence")
            }
            return values.map(Double.init)
        }
    }

    private func invoke(_ method: String, _ input: [String: Any], _ runtime: JSValue, _ context: JSContext) throws -> Data {
        try Task.checkCancellation()
        let data = try JSONSerialization.data(withJSONObject: input)
        guard data.count <= 262144 else { throw MobileFailure("invalid-transition-input") }
        context.exception = nil
        let result = runtime.invokeMethod(method, withArguments: [String(decoding: data, as: UTF8.self)])
        try Task.checkCancellation()
        return try response(result, context)
    }

    private func response(_ value: JSValue?, _ context: JSContext) throws -> Data {
        guard context.exception == nil, let value, value.isString, let text = value.toString(), text.utf8.count <= 262144 else {
            throw MobileFailure("invalid-stem-evidence")
        }
        return Data(text.utf8)
    }
}
