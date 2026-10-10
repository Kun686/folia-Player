import AVFoundation

// AudioCutoffFilters.swift — original serial HP/LP filters; Q is in dB for Web Audio cutoff filters.
struct AudioEffectRamp {
    private static let convergenceTolerance: Float = 0.00004539992976248485
    private var value: Float, last: Float, target: Float, requested: Float
    private let step: Float, second: Float, third: Float, fourth: Float
    private var base: Float = 0, delta: Float = 0
    private var quantumFrame = 0, groupFrame = 0, groupLength = 4
    private var elapsed = 0
    private let convergenceFrames: Double
    private var pending = false, started = false

    init(_ value: Double, rate: Double, seconds: Double = 0.03) {
        self.value = Float(value); last = Float(value); target = Float(value); requested = Float(value)
        let timeConstant = Double(Float(seconds))
        step = Float(1 - exp(-1 / (rate * timeConstant))); convergenceFrames = rate * timeConstant * 10
        second = step * (2 - step)
        third = step * Float(3).addingProduct(step - 3, step)
        fourth = step * Float(4).addingProduct(step, Float(-6).addingProduct(4 - step, step))
    }
    mutating func set(_ value: Double) { requested = Float(value); pending = true }
    var changesWithinQuantum: Bool {
        var preview = self
        let first = preview.next(), count = 128 - quantumFrame
        if count > 1 {
            for _ in 1..<count { if preview.next() != first { return true } }
        }
        return false
    }
    // Web Audio checks convergence at quantum/event boundaries and evaluates a four-sample Float32 recurrence.
    // Double per-sample smoothing sounds similar alone, but its residual error is amplified by bit crushing.
    private mutating func settle() {
        let scale: Float = target == 0 ? 1 : abs(value)
        if Double(elapsed) > convergenceFrames || abs(value - target) < Self.convergenceTolerance * scale {
            value = target
        }
    }
    mutating func next() -> Double {
        if quantumFrame == 0 || pending {
            if started { value = last.addingProduct(target - last, step) }
            settle()
            if pending {
                target = requested; elapsed = 0; pending = false
                value = target + (value - target); settle()
            }
            groupFrame = 0; started = true
        }
        if groupFrame == 0 {
            base = value; delta = target - base
            groupLength = 128 - quantumFrame >= 4 ? 4 : 1
        }
        let result: Float
        switch groupFrame {
        case 1: result = base + delta * step
        case 2: result = base + delta * second
        case 3: result = base + delta * third
        default: result = base
        }
        groupFrame += 1
        if groupFrame == groupLength {
            value = base.addingProduct(delta, groupLength == 4 ? fourth : step)
            groupFrame = 0
        }
        last = result
        quantumFrame = (quantumFrame + 1) % 128
        if Double(elapsed) <= convergenceFrames { elapsed += 1 }
        return Double(result)
    }
}

struct AudioEffectBiquadState {
    var x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0
    mutating func process(_ input: Float, _ c: AudioEffectBiquadCoefficients, roundFeedback: Bool = false) -> Float {
        let x = input.isFinite ? Double(input) : 0
        let y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
        guard y.isFinite, abs(y) <= Double(Float.greatestFiniteMagnitude) else { self = AudioEffectBiquadState(); return 0 }
        x2 = x1; x1 = x; y2 = y1; y1 = roundFeedback ? Double(Float(y)) : y
        return Float(y)
    }
    mutating func finishQuantum() {
        // WebKit's automated loop feeds back Float32 outputs; its constant-coefficient path
        // keeps double history within the quantum and copies Float32 outputs at its end.
        y1 = abs(y1) < Double(Float.leastNormalMagnitude) ? 0 : Double(Float(y1))
        y2 = abs(y2) < Double(Float.leastNormalMagnitude) ? 0 : Double(Float(y2))
    }
}

struct AudioEffectBiquadCoefficients {
    var b0 = 1.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0
    init(frequency: Double, rate: Double, highpass: Bool) {
        // W3C Web Audio biquad formulas. HP/LP Q is dB; peaking/bandpass Q uses a linear value.
        let angle = Double.pi * (frequency / (rate * 0.5)), cosine = cos(angle)
        let alpha = sin(angle) / (2 * pow(10, Double(Float(0.7)) * 0.05)), denominator = 1 + alpha
        let beta = (highpass ? 1 + cosine : 1 - cosine) / 2
        b0 = beta / denominator; b1 = (highpass ? -2 * beta : 2 * beta) / denominator
        b2 = b0; a1 = -2 * cosine / denominator; a2 = (1 - alpha) / denominator
    }
    init(bandpassFrequency: Double, rate: Double, q: Double) {
        // W3C bandpass uses linear Q and a constant 0 dB peak gain.
        let angle = 2 * Double.pi * bandpassFrequency / rate
        let alpha = sin(angle) / (2 * q), denominator = 1 + alpha
        b0 = alpha / denominator; b1 = 0; b2 = -b0
        a1 = -2 * cos(angle) / denominator; a2 = (1 - alpha) / denominator
    }
}

final class AudioCutoffFilters {
    private var rate = 44100.0
    private var highpass = AudioEffectRamp(20, rate: 44100)
    private var lowpass = AudioEffectRamp(20000, rate: 44100)
    private var highStates: [AudioEffectBiquadState] = []
    private var lowStates: [AudioEffectBiquadState] = []
    private var quantumFrame = 0, dirty = true, highVariable = false, lowVariable = false
    private(set) var available = false

    // Render-owner API: caller transfers requested settings before processing; no shared mutable control state.
    func prepare(rate: Double, channels: Int) {
        unprepare()
        guard AudioEffectSources.validRate(rate), (1...8).contains(channels) else { return }
        self.rate = rate
        quantumFrame = 0; dirty = true
        highpass = AudioEffectRamp(20, rate: rate)
        lowpass = AudioEffectRamp(min(20000, rate * 0.475), rate: rate)
        highStates = Array(repeating: AudioEffectBiquadState(), count: channels)
        lowStates = Array(repeating: AudioEffectBiquadState(), count: channels)
        available = true
    }
    func unprepare() { available = false; highStates.removeAll(); lowStates.removeAll() }
    func set(highpass: Double, lowpass: Double) {
        guard highpass.isFinite, (20...2000).contains(highpass), lowpass.isFinite, (500...20000).contains(lowpass) else { return }
        self.highpass.set(highpass); self.lowpass.set(min(lowpass, rate * 0.475))
        dirty = true
    }
    func reset() {
        for index in highStates.indices { highStates[index] = AudioEffectBiquadState(); lowStates[index] = AudioEffectBiquadState() }
    }
    // Sample-accurate coefficient ramps match setTargetAtTime rather than stepping once per audio callback.
    func process(_ buffers: UnsafeMutablePointer<AudioBufferList>, frames: Int, discontinuity: Bool = false) {
        guard available, frames > 0 else { return }
        let list = UnsafeMutableAudioBufferListPointer(buffers)
        guard Self.valid(list, frames: frames, channels: highStates.count) else { return }
        if discontinuity { reset() }
        for frame in 0..<frames {
            if quantumFrame == 0 || dirty {
                highVariable = highpass.changesWithinQuantum; lowVariable = lowpass.changesWithinQuantum; dirty = false
            }
            let high = AudioEffectBiquadCoefficients(frequency: Double(Float(highpass.next())), rate: rate, highpass: true)
            let low = AudioEffectBiquadCoefficients(frequency: Double(Float(lowpass.next())), rate: rate, highpass: false)
            var channel = 0
            for buffer in list {
                let stride = Int(buffer.mNumberChannels), data = buffer.mData!.assumingMemoryBound(to: Float.self)
                for local in 0..<stride {
                    let index = frame * stride + local
                    data[index] = lowStates[channel].process(highStates[channel].process(data[index], high, roundFeedback: highVariable), low, roundFeedback: lowVariable)
                    channel += 1
                }
            }
            quantumFrame = (quantumFrame + 1) % 128
            if quantumFrame == 0 {
                for i in highStates.indices { highStates[i].finishQuantum(); lowStates[i].finishQuantum() }
            }
        }
    }
    static func valid(_ list: UnsafeMutableAudioBufferListPointer, frames: Int, channels: Int) -> Bool {
        guard frames > 0 else { return false }
        var total = 0
        for buffer in list {
            let count = Int(buffer.mNumberChannels)
            guard buffer.mData != nil, (1...8).contains(count),
                  Int(buffer.mDataByteSize) / (MemoryLayout<Float>.size * count) >= frames else { return false }
            total += count
        }
        return total == channels
    }
}
