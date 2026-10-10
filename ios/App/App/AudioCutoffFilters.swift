import AVFoundation

// AudioCutoffFilters.swift — original serial HP/LP filters; Q is in dB for Web Audio cutoff filters.
struct AudioEffectRamp {
    private static let convergenceTolerance = Double(Float(0.00004539992976248485))
    private(set) var value: Double
    private var target: Double
    private var decay: Double
    private var quantumFrame = 0
    private var elapsed = 0
    private let convergenceFrames: Double

    init(_ value: Double, rate: Double, seconds: Double = 0.03) {
        self.value = Double(Float(value)); target = Double(Float(value))
        let timeConstant = Double(Float(seconds))
        decay = exp(-1 / (rate * timeConstant)); convergenceFrames = rate * timeConstant * 10
    }
    mutating func set(_ value: Double) {
        settle()
        target = Double(Float(value)); elapsed = 0
    }
    // Web Audio's measured convergence is checked at 128-frame boundaries, including before retargeting.
    // Without the e^-10 cutoff, a tiny residual LFO depth still changes the delay by audible sample fractions.
    private mutating func settle() {
        guard quantumFrame == 0 else { return }
        let scale = target == 0 ? 1 : abs(value)
        if Double(elapsed) > convergenceFrames || abs(value - target) < Self.convergenceTolerance * scale {
            value = target
        }
    }
    mutating func next() -> Double {
        settle()
        let result = value
        value = target + (value - target) * decay
        quantumFrame = (quantumFrame + 1) % 128
        if Double(elapsed) <= convergenceFrames { elapsed += 1 }
        return result
    }
}

private struct CutoffState {
    var x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0
    mutating func process(_ input: Float, _ c: CutoffCoefficients) -> Float {
        let x = input.isFinite ? Double(input) : 0
        let y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
        guard y.isFinite, abs(y) <= Double(Float.greatestFiniteMagnitude) else { self = CutoffState(); return 0 }
        x2 = x1; x1 = x; y2 = y1; y1 = y
        return Float(y)
    }
}

private struct CutoffCoefficients {
    var b0 = 1.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0
    init(frequency: Double, rate: Double, highpass: Bool) {
        // W3C Web Audio biquad formulas. HP/LP Q is dB; peaking/bandpass Q uses a linear value.
        let angle = 2 * Double.pi * frequency / rate, cosine = cos(angle)
        let alpha = sin(angle) / (2 * pow(10, 0.7 / 20)), denominator = 1 + alpha
        b0 = (highpass ? 1 + cosine : 1 - cosine) / (2 * denominator)
        b1 = (highpass ? -(1 + cosine) : 1 - cosine) / denominator
        b2 = b0; a1 = -2 * cosine / denominator; a2 = (1 - alpha) / denominator
    }
}

final class AudioCutoffFilters {
    private var rate = 44100.0
    private var highpass = AudioEffectRamp(20, rate: 44100)
    private var lowpass = AudioEffectRamp(20000, rate: 44100)
    private var highStates: [CutoffState] = []
    private var lowStates: [CutoffState] = []
    private(set) var available = false

    // Render-owner API: caller transfers requested settings before processing; no shared mutable control state.
    func prepare(rate: Double, channels: Int) {
        unprepare()
        guard AudioEffectSources.validRate(rate), (1...8).contains(channels) else { return }
        self.rate = rate
        highpass = AudioEffectRamp(20, rate: rate)
        lowpass = AudioEffectRamp(min(20000, rate * 0.475), rate: rate)
        highStates = Array(repeating: CutoffState(), count: channels)
        lowStates = Array(repeating: CutoffState(), count: channels)
        available = true
    }
    func unprepare() { available = false; highStates.removeAll(); lowStates.removeAll() }
    func set(highpass: Double, lowpass: Double) {
        guard highpass.isFinite, (20...2000).contains(highpass), lowpass.isFinite, (500...20000).contains(lowpass) else { return }
        self.highpass.set(highpass); self.lowpass.set(min(lowpass, rate * 0.475))
    }
    func reset() {
        for index in highStates.indices { highStates[index] = CutoffState(); lowStates[index] = CutoffState() }
    }
    // Sample-accurate coefficient ramps match setTargetAtTime rather than stepping once per audio callback.
    func process(_ buffers: UnsafeMutablePointer<AudioBufferList>, frames: Int, discontinuity: Bool = false) {
        guard available, frames > 0 else { return }
        let list = UnsafeMutableAudioBufferListPointer(buffers)
        guard Self.valid(list, frames: frames, channels: highStates.count) else { return }
        if discontinuity { reset() }
        for frame in 0..<frames {
            let high = CutoffCoefficients(frequency: Double(Float(highpass.next())), rate: rate, highpass: true)
            let low = CutoffCoefficients(frequency: Double(Float(lowpass.next())), rate: rate, highpass: false)
            var channel = 0
            for buffer in list {
                let stride = Int(buffer.mNumberChannels), data = buffer.mData!.assumingMemoryBound(to: Float.self)
                for local in 0..<stride {
                    let index = frame * stride + local
                    data[index] = lowStates[channel].process(highStates[channel].process(data[index], high), low)
                    channel += 1
                }
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
