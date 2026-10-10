import AVFoundation
import Accelerate

// AudioReverb.swift — original stereo impulse, WebKit gain calibration and parallel wet/dry ramps.
final class AudioReverbKernel {
    let rate: Double, normalizationGain: Float
    private let left: AudioConvolution, right: AudioConvolution

    // Control-owner construction only. Each active branch owns a distinct pair of convolution histories.
    init?(rate: Double, impulse: [[Float]]) {
        guard AudioEffectSources.validRate(rate), impulse.count == 2,
              impulse.allSatisfy({ $0.count == Int(floor(rate * 2.2)) && $0.allSatisfy(\.isFinite) }) else { return nil }
        var energy: Float = 0
        for channel in impulse {
            var sum: Float = 0
            vDSP_svesq(channel, 1, &sum, vDSP_Length(channel.count)); energy += sum
        }
        let rms = sqrtf(energy / Float(2 * impulse[0].count))
        // WebKit's original ConvolverNode uses -58 dB, slightly different from the specification's 0.00125.
        // Preserve the measured original sound; see EFFECT_PARITY.md for the reference and comparison.
        var scale: Float = 1 / max(0.000125, rms.isFinite ? rms : 0.000125)
        scale *= powf(10, -58 * 0.05); scale *= Float(44100 / rate)
        guard let left = AudioConvolution(impulse: impulse[0].map { $0 * scale }),
              let right = AudioConvolution(impulse: impulse[1].map { $0 * scale }) else { return nil }
        self.left = left; self.right = right; self.rate = rate; normalizationGain = scale
    }
    func reset() { left.reset(); right.reset() }
    func process(left: Float, right: Float) -> (Float, Float) { (self.left.process(left), self.right.process(right)) }
}

final class AudioReverb {
    private var rate = 44100.0, releaseFrames = 0
    private var kernel: AudioReverbKernel?
    private var wet = AudioEffectRamp(0, rate: 44100, seconds: 0.08)
    private var dry = AudioEffectRamp(1, rate: 44100, seconds: 0.08)
    private(set) var available = false
    var active: Bool { kernel != nil }

    func prepare(rate: Double) {
        unprepare()
        guard AudioEffectSources.validRate(rate) else { return }
        self.rate = rate; wet = AudioEffectRamp(0, rate: rate, seconds: 0.08)
        dry = AudioEffectRamp(1, rate: rate, seconds: 0.08); available = true
    }
    func unprepare() { kernel = nil; releaseFrames = 0; available = false }
    // A prebuilt kernel starts a new branch; quick re-enabling preserves the existing reverb tail.
    // The control owner retains retired kernels for destruction outside the audio callback.
    @discardableResult func set(_ amount: Double, kernel next: AudioReverbKernel? = nil) -> Bool {
        guard available, amount.isFinite, (0...1).contains(amount) else { return false }
        if amount > 0 {
            if kernel == nil {
                guard let next, next.rate == rate else { return false }
                kernel = next
            }
            releaseFrames = 0
        } else if active && releaseFrames == 0 { releaseFrames = Int(ceil(rate * 0.8)) }
        wet.set(amount * 0.75); dry.set(1 - amount * 0.2)
        return true
    }
    func process(_ buffers: UnsafeMutablePointer<AudioBufferList>, frames: Int, discontinuity: Bool = false) {
        guard available else { return }
        let list = UnsafeMutableAudioBufferListPointer(buffers)
        guard AudioCutoffFilters.valid(list, frames: frames, channels: 2) else { return }
        if discontinuity { kernel?.reset() }
        let interleaved = list.count == 1, stride = interleaved ? 2 : 1
        let a = list[0].mData!.assumingMemoryBound(to: Float.self)
        let b = list[interleaved ? 0 : 1].mData!.assumingMemoryBound(to: Float.self)
        for frame in 0..<frames {
            let wetGain = Float(wet.next()), dryGain = Float(dry.next())
            let i = frame * stride, j = i + (interleaved ? 1 : 0)
            let left = a[i].isFinite ? a[i] : 0, right = b[j].isFinite ? b[j] : 0
            let result = kernel?.process(left: left, right: right) ?? (0, 0)
            let mixedLeft = left * dryGain + result.0 * wetGain, mixedRight = right * dryGain + result.1 * wetGain
            a[i] = mixedLeft.isFinite ? mixedLeft : 0; b[j] = mixedRight.isFinite ? mixedRight : 0
            if releaseFrames > 0 {
                releaseFrames -= 1
                if releaseFrames == 0 { kernel = nil }
            }
        }
    }
}
