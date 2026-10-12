import Foundation

// NativeStemInference.swift — decoded complete-media window → shared ORT work → original packing and vocal exit.
protocol NativeStemSeparating: Sendable {
    func separate(_ material: NativeStemMaterial, model: URL) async throws -> NativeStemWindow
}

actor NativeStemInference: NativeStemSeparating {
    private let inference = NativeORTInference()
    private let analysis = NativeStemAnalysis()

    func separate(_ material: NativeStemMaterial, model: URL) async throws -> NativeStemWindow {
        try Task.checkCancellation()
        let frames = material.channels.first?.count ?? 0
        guard (1...1_323_000).contains(frames), material.channels.count == 2,
              material.channels.allSatisfy({ $0.count == frames && $0.allSatisfy(\.isFinite) }),
              material.totalFrames >= frames, material.fromFrame >= 0,
              material.fromFrame == (material.role == .head ? 0 : material.totalFrames - frames) else {
            throw MobileFailure("invalid-stem-window")
        }
        var input = Data(capacity: frames * 2 * MemoryLayout<Float>.size)
        for channel in material.channels { channel.withUnsafeBytes { input.append(contentsOf: $0) } }
        let output = try await inference.separateWindow(model: model, input: input, frames: frames)
        try Task.checkCancellation()
        let names: [NativeStemName] = [.drums, .bass, .vocals]
        guard output.count == names.count else { throw MobileFailure("ort-invalid-output") }
        var separated: [NativeStemName: [[Float]]] = [:]
        for (name, data) in zip(names, output) {
            guard data.count == input.count else { throw MobileFailure("ort-invalid-output") }
            // Copy into aligned Float storage; Foundation's Data does not promise Float alignment.
            var values = [Float](repeating: 0, count: frames * 2)
            _ = values.withUnsafeMutableBytes { data.copyBytes(to: $0) }
            separated[name] = [Array(values[..<frames]), Array(values[frames...])]
        }
        try Task.checkCancellation()
        let window = try await analysis.window(fromFrame: material.fromFrame, role: material.role,
            mix: material.channels, separated: separated)
        try Task.checkCancellation()
        return window
    }
}
