import AVFoundation

// AudioPunch.swift — original punch mapping, k-rate compression parameters and a-rate external makeup gain.
final class AudioPunch {
    private let compressor = WebAudioCompressor()
    private var threshold = AudioEffectControlRamp(0, rate: 44100)
    private var knee = AudioEffectControlRamp(30, rate: 44100)
    private var ratio = AudioEffectControlRamp(1, rate: 44100)
    private var makeup = AudioEffectRamp(1, rate: 44100)
    private var quantumFrame = 0, channels = 0
    var available: Bool { compressor.available }
    var latencyFrames: Int { compressor.latencyFrames }

    func prepare(rate: Double, channels: Int) {
        compressor.prepare(rate: rate, channels: channels)
        guard available else { self.channels = 0; return }
        self.channels = channels; quantumFrame = 0
        threshold = AudioEffectControlRamp(0, rate: rate); knee = AudioEffectControlRamp(30, rate: rate)
        ratio = AudioEffectControlRamp(1, rate: rate); makeup = AudioEffectRamp(1, rate: rate)
    }
    func unprepare() { compressor.unprepare(); channels = 0 }
    func set(_ amount: Double) {
        guard amount.isFinite, (0...1).contains(amount) else { return }
        threshold.set(-6 - amount * 26); knee.set(30 - amount * 18)
        ratio.set(1 + amount * 7); makeup.set(pow(10, amount * 3 / 20))
    }
    func process(_ buffers: UnsafeMutablePointer<AudioBufferList>, frames: Int, discontinuity: Bool = false) {
        guard available else { return }
        let list = UnsafeMutableAudioBufferListPointer(buffers)
        guard AudioCutoffFilters.valid(list, frames: frames, channels: channels) else { return }
        if discontinuity { compressor.reset() }
        let interleaved = list.count == 1, stride = interleaved ? channels : 1
        let left = list[0].mData!.assumingMemoryBound(to: Float.self)
        let right = list[interleaved ? 0 : channels - 1].mData!.assumingMemoryBound(to: Float.self)
        for frame in 0..<frames {
            if quantumFrame == 0 { compressor.set(threshold: threshold.next(), knee: knee.next(), ratio: ratio.next()) }
            var a = left[frame * stride], b = right[frame * stride + (interleaved ? channels - 1 : 0)]
            compressor.processFrame(left: &a, right: &b)
            let gain = Float(makeup.next())
            left[frame * stride] = a * gain
            if channels == 2 { right[frame * stride + (interleaved ? 1 : 0)] = b * gain }
            quantumFrame = (quantumFrame + 1) % 128
        }
    }
}

// K-rate AudioParams advance in Float32 once per quantum. Audio-rate interpolation changes the static knee search.
struct AudioEffectControlRamp {
    private var value: Float, target: Float, requested: Float
    private let step: Float, convergenceFrames: Double
    private var elapsed = 0
    private var pending = false, started = false
    init(_ value: Float, rate: Double) {
        self.value = value; target = value; requested = value
        let seconds = Double(Float(0.03))
        step = Float(1 - exp(-128 / (rate * seconds))); convergenceFrames = rate * seconds * 10
    }
    mutating func set(_ value: Double) { requested = Float(value); pending = true }
    mutating func next() -> Float {
        if started {
            value = value.addingProduct(target - value, step)
            if Double(elapsed) <= convergenceFrames { elapsed += 128 }
        }
        settle()
        if pending {
            target = requested; elapsed = 0; pending = false
            // WebKit evaluates target + Float32(value - target) at the new event's start.
            // Algebraically cancelling these terms changes rounding and the knee search.
            value = target + (value - target)
            settle()
        }
        started = true
        return value
    }
    private mutating func settle() {
        let scale: Float = target == 0 ? 1 : abs(value)
        if Double(elapsed) > convergenceFrames || abs(target - value) < 0.00004539992976248485 * scale { value = target }
    }
}
