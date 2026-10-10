import Foundation
import JavaScriptCore

// NativeDeckMeasurements.swift — same measurement state as Web Audio; confined to the analysis queue.
struct NativeDeckState: Decodable {
    struct Tempo: Decodable { let bpm: Double; let periodSec: Double; let confidence: Double; let beatOffsetHops: Double }
    struct History: Decodable { let db: [Double]; let hopSec: Double }
    let time: Double?, loudnessDb: Double?, tempo: Tempo?, nextBeatIn: Double?, history: History?
}

final class NativeDeckMeasurements {
    private let context: JSContext
    private let state: JSValue
    private let fft = AudioSpectrum(size: NativeDeckCapture.size, smoothing: 0)
    private var completeHistory = true
    private var epoch: UInt64?
    private(set) var revision: UInt64?
    init(rate: Double, bundle: Bundle = .main) throws {
        guard let url = bundle.url(forResource: "deck", withExtension: "js", subdirectory: "public/native"),
              let script = try? String(contentsOf: url, encoding: .utf8), script.utf8.count <= 1048576,
              let context = JSContext(), fft.available else { throw MobileFailure("deck-runtime-unavailable") }
        context.evaluateScript(script, withSourceURL: url)
        guard context.exception == nil, let runtime = context.objectForKeyedSubscript("FoliaDeck"),
              runtime.forProperty("protocolVersion")?.toInt32() == 1,
              runtime.forProperty("fftSize")?.toInt32() == Int32(NativeDeckCapture.size),
              let state = runtime.invokeMethod("create", withArguments: [rate]), context.exception == nil, state.isObject else {
            throw MobileFailure("deck-runtime-unavailable")
        }
        self.context = context; self.state = state
    }
    func tick(_ frame: NativeDeckCapture.Frame) throws {
        if epoch != frame.epoch { try reset(); epoch = frame.epoch }
        completeHistory = completeHistory && frame.completeHistory
        fft.analyse(frame.samples)
        try feed(samples: frame.samples, spectrum: fft.decibels, time: frame.time)
        revision = frame.revision
    }
    // Reuse JS-owned typed arrays. Never interpolate PCM into source text or box it through JSON.
    func feed(samples: [Float], spectrum: [Float], time: Double) throws {
        context.exception = nil
        try copy(samples, property: "samples", count: NativeDeckCapture.size)
        try copy(spectrum, property: "spectrum", count: NativeDeckCapture.size / 2)
        state.invokeMethod("tick", withArguments: [time])
        try check()
    }
    func snapshot(at time: Double, history: Bool = false) throws -> NativeDeckState {
        context.exception = nil
        let result = state.invokeMethod("snapshot", withArguments: [time, history && completeHistory])
        try check()
        guard let text = result?.toString(), let data = text.data(using: .utf8),
              let snapshot = try? JSONDecoder().decode(NativeDeckState.self, from: data) else {
            throw MobileFailure("invalid-deck-result")
        }
        return snapshot
    }
    func matches(_ capture: NativeDeckCapture) -> Bool { epoch == capture.currentEpoch() }
    func reset() throws {
        context.exception = nil; state.invokeMethod("reset", withArguments: []); try check()
        fft.reset(); epoch = nil; revision = nil; completeHistory = true
    }
    private func check() throws {
        guard context.exception == nil else { context.exception = nil; throw MobileFailure("invalid-deck-frame") }
    }
    private func copy(_ values: [Float], property: String, count: Int) throws {
        guard values.count == count, let array = state.forProperty(property),
              let object = JSValueToObject(context.jsGlobalContextRef, array.jsValueRef, nil),
              JSObjectGetTypedArrayLength(context.jsGlobalContextRef, object, nil) == count,
              let pointer = JSObjectGetTypedArrayBytesPtr(context.jsGlobalContextRef, object, nil) else {
            throw MobileFailure("invalid-deck-frame")
        }
        values.withUnsafeBytes { pointer.copyMemory(from: $0.baseAddress!, byteCount: $0.count) }
    }
}
