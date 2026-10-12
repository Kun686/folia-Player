import Foundation
import JavaScriptCore

// NativeTransitionPlanner.swift — serialized execution of bundled original rules, independent of WKWebView.
struct NativeTransitionPlan: Codable {
    let kind: String, style: String, relation: String, tempo: String
    let stretch: Double, tiltDb: [Double], echoThrow: Bool
    let outStart: Double, inStart: Double, overlap: Double, minOverlap: Double
    let reason: String
    let expansion: Double?
}

struct NativeTransitionEnvelope: Codable {
    struct Gain: Codable { let out: [Double]; let `in`: [Double] }
    struct Bands: Codable { let out: [[Double]]; let `in`: [[Double]] }
    let style: String
    let hold: Double, overlap: Double, crossover: Double, together: Double
    let shapeBands: Bool, sweepOut: Bool, snappedToBeat: Bool
    let gain: Gain
    let bands: Bands?
    var echo: NativeEchoSchedule? = nil
}

struct NativeBalanceStep: Decodable {
    struct Adjustment: Decodable { let trimDb: Double, gain: Double, seconds: Double }
    let intervalMs: Int, minOverlap: Double
    let adjustment: Adjustment?
}

struct NativeTransitionCue: Codable {
    let seconds: Double, crossover: Double
    let periodSec: Double?
    let plain: Bool?
}
struct NativeMasterHandover: Codable {
    let requestedRate: Double, mediaOverlap: Double
    let envelope: NativeTransitionEnvelope?
    let cue: NativeTransitionCue?
}

actor NativeTransitionPlanner {
    private let scriptURL: URL?
    private var context: JSContext?
    init(bundle: Bundle = .main) {
        scriptURL = bundle.url(forResource: "transitions", withExtension: "js", subdirectory: "public/native")
    }

    func plan(_ input: Data) throws -> NativeTransitionPlan {
        try decode(NativeTransitionPlan.self, method: "planJSON", input: input)
    }
    func envelope(_ input: Data) throws -> NativeTransitionEnvelope {
        try decode(NativeTransitionEnvelope.self, method: "envelopeJSON", input: input)
    }
    func master(_ input: Data) throws -> NativeMasterHandover {
        try decode(NativeMasterHandover.self, method: "masterJSON", input: input)
    }
    func balance(_ input: Data) throws -> NativeBalanceStep {
        try decode(NativeBalanceStep.self, method: "balanceJSON", input: input)
    }
    func echo(_ input: Data) throws -> NativeEchoSchedule {
        let result = try decode(NativeEchoSchedule.self, method: "echoJSON", input: input)
        try result.validate()
        return result
    }
    func replayGain(_ info: NativeReplayGainInfo?) throws -> NativeReplayGainLevels {
        try decode(NativeReplayGainLevels.self, method: "replayGainJSON", input:
            JSONSerialization.data(withJSONObject: ["version": 1, "info": info?.dictionary as Any? ?? NSNull()]))
    }

    // Stateless requests prevent interleaved work from sharing a stale plan. Each bounded decode
    // checks cancellation; no partially prepared gesture can reach the caller or audio thread.
    func stems(_ input: Data) throws -> NativeStemGesture {
        let schedule = try decode(NativeStemSchedule.self, method: "stemPlanJSON", input: input)
        guard var request = try JSONSerialization.jsonObject(with: input) as? [String: Any] else {
            throw MobileFailure("invalid-transition-input")
        }
        var out: [NativeStemName: [Float]] = [:], incoming: [NativeStemName: [Float]] = [:]
        for direction in ["out", "in"] {
            request["direction"] = direction
            for name in NativeStemName.allCases {
                request["stem"] = name.rawValue
                let curve = try decode([Float].self, method: "stemCurveJSON",
                    input: JSONSerialization.data(withJSONObject: request))
                guard curve.count == max(2, Int(ceil(schedule.windowSec * 200))),
                      curve.allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 1 }) else {
                    throw MobileFailure("invalid-transition-result")
                }
                if direction == "out" { out[name] = curve } else { incoming[name] = curve }
            }
        }
        try Task.checkCancellation()
        return NativeStemGesture(schedule: schedule, outgoing: out, incoming: incoming)
    }

    func stemBus() throws -> NativeStemBusParameters {
        try decode(NativeStemBusParameters.self, method: "stemBusJSON", input: Data("{\"version\":1}".utf8))
    }

    func stemWindow(_ input: Data) throws -> NativeStemWindowAlignment {
        try decode(NativeStemWindowAlignment.self, method: "stemWindowJSON", input: input)
    }

    // Only this actor touches JS values. Request data is passed as an argument, never evaluated as source.
    private func decode<T: Decodable>(_ type: T.Type, method: String, input: Data) throws -> T {
        try Task.checkCancellation()
        guard input.count <= 262144, let text = String(data: input, encoding: .utf8) else {
            throw MobileFailure("invalid-transition-input")
        }
        let runtime = try load()
        runtime.exception = nil
        let value = runtime.objectForKeyedSubscript("FoliaTransitions")?.invokeMethod(method, withArguments: [text])
        guard runtime.exception == nil, let result = value?.toString(), let data = result.data(using: .utf8),
              data.count <= 262144 else {
            runtime.exception = nil
            throw MobileFailure("invalid-transition-input")
        }
        try Task.checkCancellation()
        do { return try JSONDecoder().decode(type, from: data) }
        catch { throw MobileFailure("invalid-transition-result") }
    }

    private func load() throws -> JSContext {
        if let context { return context }
        guard let scriptURL, scriptURL.isFileURL,
              let source = try? String(contentsOf: scriptURL, encoding: .utf8), source.utf8.count <= 1048576,
              let created = JSContext() else { throw MobileFailure("transition-runtime-unavailable") }
        created.evaluateScript(source, withSourceURL: scriptURL)
        guard created.exception == nil,
              created.objectForKeyedSubscript("FoliaTransitions")?.forProperty("protocolVersion")?.toInt32() == 1 else {
            throw MobileFailure("transition-runtime-unavailable")
        }
        context = created
        return created
    }
}
