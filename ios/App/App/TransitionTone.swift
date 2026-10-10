import AVFoundation

// TransitionTone.swift — execution of original three-band curves before the fade; no style decisions here.
struct TransitionBandCurve {
    let out: [[Float]], input: [[Float]]
    init(_ bands: NativeTransitionEnvelope.Bands) throws {
        let rows = bands.out + bands.in
        guard bands.out.count == 3, bands.in.count == 3,
              let count = rows.first?.count, (2...256).contains(count),
              rows.allSatisfy({ $0.count == count && $0.allSatisfy { $0.isFinite && (-24...3).contains($0) } }) else {
            throw MobileFailure("invalid-transition-bands")
        }
        out = bands.out.map { $0.map(Float.init) }; input = bands.in.map { $0.map(Float.init) }
    }
    func value(incoming: Bool, band: Int, elapsed: Double, duration: Double, rate: Double) -> Float {
        guard elapsed >= 0 else { return 0 }
        let points = incoming ? input[band] : out[band]
        if elapsed <= duration { return TransitionGainCurve.interpolate(points, elapsed: elapsed, duration: duration) }
        // scheduleBandBlend holds the last knot for 6ms, then ramps all bands flat over 120ms.
        let reset = max(0, elapsed - duration - 0.006 * rate) / (0.12 * rate)
        return Float(Double(points[points.count - 1]) * max(0, 1 - reset))
    }
}

final class TransitionTone {
    private let frequencies = [250.0, 1000.0, 4000.0]
    private let filterBands = [0, 1, 9]
    private var coefficients = [Double](repeating: 0, count: 50)
    private var left = [AudioEffectBiquadState](repeating: AudioEffectBiquadState(), count: 3)
    private var right = [AudioEffectBiquadState](repeating: AudioEffectBiquadState(), count: 3)
    private var values = [Float](repeating: 0, count: 3), from = [Float](repeating: 0, count: 3)
    private var generation: UInt64?
    private var resetAt = 0.0
    private var immediate = false
    private var quantum = 0
    private var variable = [Bool](repeating: false, count: 3)
    private var dirty = true

    private var settled: Bool {
        for band in 0..<3 {
            if values[band] != 0 || left[band].x1 != left[band].y1 || left[band].x2 != left[band].y2
                || right[band].x1 != right[band].y1 || right[band].x2 != right[band].y2 { return false }
        }
        return true
    }

    func consumeNeutral(_ pcm: UnsafeMutablePointer<Float>, frames: Int) {
        guard frames > 0 else { return }
        // Unity biquads still hear the stream in Web Audio. Keep their last two input/output
        // samples while bypassing arithmetic, so a later filter change starts with the right history.
        for band in 0..<3 {
            left[band].x2 = frames > 1 ? Double(pcm[(frames - 2) * 2]) : left[band].x1
            right[band].x2 = frames > 1 ? Double(pcm[(frames - 2) * 2 + 1]) : right[band].x1
            left[band].x1 = Double(pcm[(frames - 1) * 2]); right[band].x1 = Double(pcm[(frames - 1) * 2 + 1])
            left[band].y1 = left[band].x1; left[band].y2 = left[band].x2
            right[band].y1 = right[band].x1; right[band].y2 = right[band].x2
        }
        quantum = (quantum + frames) % 128
    }

    // Deck-local histories survive role changes and decoder replacement, like the original persistent graph.
    // All storage is allocated before rendering. The common neutral path leaves PCM byte-for-byte intact.
    func process(_ pcm: UnsafeMutablePointer<Float>, frames: Int, sampleTime: Double, rate: Double,
                 curve: TransitionBandCurve?, incoming: Bool, start: Double, duration: Double,
                 generation: UInt64?, immediate: Bool) {
        if self.generation != generation {
            self.generation = generation; resetAt = sampleTime; self.immediate = immediate
            for band in 0..<3 { from[band] = values[band] }
            dirty = true
        }
        guard curve != nil || !settled else { consumeNeutral(pcm, frames: frames); return }
        for frame in 0..<frames {
            let time = sampleTime + Double(frame)
            if quantum == 0 || dirty {
                for band in 0..<3 {
                    variable[band] = value(band, time: time, rate: rate, curve: curve, incoming: incoming, start: start, duration: duration)
                        != value(band, time: time + Double(127 - quantum), rate: rate, curve: curve, incoming: incoming, start: start, duration: duration)
                }
                dirty = false
            }
            var l = pcm[frame * 2], r = pcm[frame * 2 + 1]
            for band in 0..<3 {
                let db = value(band, time: time, rate: rate, curve: curve, incoming: incoming, start: start, duration: duration)
                values[band] = db
                AudioEqualizer.writeCoefficients(band: filterBands[band], gain: Double(db), rate: rate,
                    frequency: frequencies[band], q: Double(Float(0.8)), preservePolesAtUnity: true, into: &coefficients)
                let offset = filterBands[band] * 5
                let c = AudioEffectBiquadCoefficients(values: coefficients[offset..<offset + 5])
                l = left[band].process(l, c, roundFeedback: variable[band])
                r = right[band].process(r, c, roundFeedback: variable[band])
            }
            pcm[frame * 2] = l; pcm[frame * 2 + 1] = r
            quantum = (quantum + 1) % 128
            if quantum == 0 {
                for band in 0..<3 { left[band].finishQuantum(); right[band].finishQuantum() }
            }
        }
    }
    private func value(_ band: Int, time: Double, rate: Double, curve: TransitionBandCurve?,
                       incoming: Bool, start: Double, duration: Double) -> Float {
        if let curve { return curve.value(incoming: incoming, band: band, elapsed: time - start, duration: duration, rate: rate) }
        // Original resetTone uses a 50ms linear dB ramp, separate from the 30ms gain ramp.
        return immediate ? 0 : Float(Double(from[band]) * max(0, 1 - (time - resetAt) / (0.05 * rate)))
    }
}
