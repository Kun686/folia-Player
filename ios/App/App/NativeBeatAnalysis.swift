import Foundation
import JavaScriptCore

// NativeBeatAnalysis.swift — original JS mel/chunk/peak rules with one cancellable native model session per track.
actor NativeBeatAnalysis {
    struct Prepared {
        let frames: Int, starts: [Int], lengths: [Int], inputs: [Data]
    }
    private let scriptURL: URL?
    private let inference = NativeORTInference()
    init(bundle: Bundle = .main) {
        scriptURL = bundle.url(forResource: "profiles", withExtension: "js", subdirectory: "public/native")
    }
    init(scriptURL: URL?) { self.scriptURL = scriptURL }

    func grid(_ mid: NSData, model: URL) async throws -> Data? {
        let prepared = try prepare(mid)
        guard !prepared.inputs.isEmpty else { return nil }
        let outputs = try await inference.inferBeatChunks(model: model, inputs: prepared.inputs, frames: prepared.lengths)
        try Task.checkCancellation()
        return try finish(prepared, outputs: outputs)
    }

    func prepare(_ mid: NSData) throws -> Prepared {
        guard mid.length % 4 == 0, mid.length / 4 <= NativeProfilePCM.maxFrames else {
            throw MobileFailure("invalid-profile-input")
        }
        return try autoreleasepool {
            let vm = try NativeProfileRuntime(scriptURL: scriptURL, fftSize: .beat)
            let pcm = try NativeFloat32Bridge.make(mid, in: vm.context, errorCode: "profile-memory-unavailable")
            var chunks: JSValue?, frames = 0, code = ""
            // A JS callback can outlive this call. Break its captured JSValue → context reference explicitly.
            defer { chunks = nil }
            let done: @convention(block) (JSValue, Int32, String) -> Void = { value, count, error in
                chunks = value; frames = Int(count); code = error
            }
            try vm.call("prepareBeatPCM", [pcm, done, vm.transform])
            guard code.isEmpty, let chunks, let count = chunks.forProperty("length")?.toInt32(),
                  (0...41).contains(count), (0...60001).contains(frames) else { throw MobileFailure("beat-preparation-failed") }
            var starts: [Int] = [], lengths: [Int] = [], inputs: [Data] = []
            for index in 0..<Int(count) {
                try Task.checkCancellation()
                guard let chunk = chunks.atIndex(index), let length = chunk.forProperty("frames")?.toInt32(),
                      (1...1500).contains(length), let start = chunk.forProperty("start")?.toInt32(),
                      let data = chunk.forProperty("data") else { throw MobileFailure("beat-preparation-failed") }
                let floats = try NativeFloat32Bridge.copy(data, count: Int(length) * 128)
                guard floats.allSatisfy(\.isFinite) else { throw MobileFailure("beat-preparation-failed") }
                inputs.append(floats.withUnsafeBytes { Data($0) }); starts.append(Int(start)); lengths.append(Int(length))
            }
            return Prepared(frames: frames, starts: starts, lengths: lengths, inputs: inputs)
        }
    }

    func finish(_ prepared: Prepared, outputs: [Data]) throws -> Data {
        guard (1...41).contains(prepared.inputs.count), prepared.starts.count == prepared.inputs.count,
              prepared.lengths.count == prepared.inputs.count, outputs.count == prepared.inputs.count * 2 else {
            throw MobileFailure("invalid-beat-prediction")
        }
        return try autoreleasepool {
            let vm = try NativeProfileRuntime(scriptURL: scriptURL, fftSize: .beat)
            var predictions: [[String: Any]] = []
            for index in prepared.inputs.indices {
                try Task.checkCancellation()
                let count = prepared.lengths[index]
                guard (1...1500).contains(count), outputs[index * 2].count == count * 4,
                      outputs[index * 2 + 1].count == count * 4 else { throw MobileFailure("invalid-beat-prediction") }
                let beat = try NativeFloat32Bridge.make(outputs[index * 2] as NSData, in: vm.context, errorCode: "profile-memory-unavailable")
                let downbeat = try NativeFloat32Bridge.make(outputs[index * 2 + 1] as NSData, in: vm.context, errorCode: "profile-memory-unavailable")
                predictions.append(["start": prepared.starts[index], "frames": count, "beat": beat, "downbeat": downbeat])
            }
            let result = try vm.call("beatGridJSON", [predictions, prepared.frames])
            guard let result, result.isString, let json = result.toString(), json.utf8.count <= 262144 else {
                throw MobileFailure("invalid-beat-prediction")
            }
            return Data(json.utf8)
        }
    }
}
