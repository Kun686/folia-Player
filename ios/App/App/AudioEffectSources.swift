import Foundation

// AudioEffectSources.swift — original effectSources.ts curves and buffers, generated off the render thread.
enum AudioEffectSources {
    static func saturation(_ amount: Double) -> [Float]? {
        guard amount.isFinite, (0...1).contains(amount), amount > 0 else { return nil }
        let shape = 1 + amount * 4, scale = tanh(shape)
        var energy = 0.0
        for index in 0..<1024 {
            let input = 0.5 * sin(2 * .pi * Double(index) / 1024)
            let shaped = tanh(shape * input) / scale
            energy += shaped * shaped
        }
        let rms = sqrt(energy / 1024), compensation = rms > 0 ? (0.5 / sqrt(2)) / rms : 1
        return (0..<1024).map { Float(tanh(shape * (Double($0) / 1023 * 2 - 1)) / scale * compensation) }
    }

    static func bitCrush(_ amount: Double) -> [Float]? {
        guard amount.isFinite, (0...1).contains(amount), amount > 0 else { return nil }
        let bits = 16 - sqrt(amount) * 12, steps = max(2, pow(2, bits - 1))
        // JavaScript Math.round rounds negative half ties toward +infinity, unlike Swift .rounded().
        return (0..<8192).map {
            let input = Double($0) / 8191 * 2 - 1
            return Float(max(-1, min(1, floor(input * steps + 0.5) / steps)))
        }
    }

    static func vinylNoise(rate: Double, random: () -> Double = { Double.random(in: 0..<1) }) -> [[Float]] {
        guard validRate(rate) else { return [] }
        let count = Int(floor(rate * 3))
        return (0..<2).map { _ in
            var crackle = 0.0, samples = [Float](repeating: 0, count: count)
            for index in samples.indices {
                if random() < 0.0007 { crackle = random() * 2 - 1 }
                crackle *= 0.88
                samples[index] = Float((random() * 2 - 1) * 0.12 + crackle * 0.9)
            }
            return samples
        }
    }

    static func reverbImpulse(rate: Double, random: () -> Double = { Double.random(in: 0..<1) }) -> [[Float]] {
        guard validRate(rate) else { return [] }
        let count = Int(floor(rate * 2.2))
        return (0..<2).map { _ in
            (0..<count).map { Float((random() * 2 - 1) * pow(1 - Double($0) / Double(count), 2.8)) }
        }
    }

    // Bound allocations to the native PCM formats the effect chain supports.
    static func validRate(_ rate: Double) -> Bool { rate.isFinite && (8000...192000).contains(rate) }
}
