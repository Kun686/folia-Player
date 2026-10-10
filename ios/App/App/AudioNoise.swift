import AVFoundation

// AudioNoise.swift — original looping vinyl source, bandpass and gain; prepare random buffers off the render thread.
final class AudioNoiseBuffer {
    let rate: Double
    let samples: [[Float]]
    init?(rate: Double, samples: [[Float]]) {
        guard AudioEffectSources.validRate(rate), samples.count == 2,
              samples.allSatisfy({ $0.count == Int(floor(rate * 3)) && $0.allSatisfy(\.isFinite) }) else { return nil }
        self.rate = rate; self.samples = samples
    }
}

final class AudioNoise {
    private var rate = 44100.0, cursor = 0, releaseFrames = 0
    private var source: AudioNoiseBuffer?
    private var left = AudioEffectBiquadState(), right = AudioEffectBiquadState()
    private var filter = AudioEffectBiquadCoefficients(bandpassFrequency: 2600, rate: 44100, q: 0.5)
    private var gain = AudioEffectRamp(0, rate: 44100, seconds: 0.12)
    private(set) var available = false
    var active: Bool { source != nil }

    func prepare(rate: Double) {
        unprepare()
        guard AudioEffectSources.validRate(rate) else { return }
        self.rate = rate; filter = AudioEffectBiquadCoefficients(bandpassFrequency: 2600, rate: rate, q: 0.5)
        gain = AudioEffectRamp(0, rate: rate, seconds: 0.12); available = true
    }
    func unprepare() { available = false; source = nil; resetSource() }
    private func resetSource() { cursor = 0; releaseFrames = 0; left = AudioEffectBiquadState(); right = AudioEffectBiquadState() }

    // A new activation needs a prebuilt source. Re-enabling during the fade keeps its phase and filter history.
    // The control owner retains sources until the render owner retires them; ARC reclamation stays off the callback.
    @discardableResult func set(_ amount: Double, source next: AudioNoiseBuffer? = nil) -> Bool {
        guard available, amount.isFinite, (0...1).contains(amount) else { return false }
        if amount > 0 {
            if source == nil {
                guard let next, next.rate == rate else { return false }
                source = next; resetSource()
            }
            releaseFrames = 0
        } else if active && releaseFrames == 0 { releaseFrames = Int(ceil(rate * 0.8)) }
        gain.set(pow(amount, 1.4) * 0.55)
        return true
    }
    func process(_ buffers: UnsafeMutablePointer<AudioBufferList>, frames: Int) {
        guard available else { return }
        let list = UnsafeMutableAudioBufferListPointer(buffers)
        guard AudioCutoffFilters.valid(list, frames: frames, channels: 2) else { return }
        let interleaved = list.count == 1, stride = interleaved ? 2 : 1
        let a = list[0].mData!.assumingMemoryBound(to: Float.self)
        let b = list[interleaved ? 0 : 1].mData!.assumingMemoryBound(to: Float.self)
        for frame in 0..<frames {
            let level = Float(gain.next())
            guard let source else { continue }
            let i = frame * stride, j = i + (interleaved ? 1 : 0)
            let mixedLeft = (a[i].isFinite ? a[i] : 0) + left.process(source.samples[0][cursor], filter) * level
            let mixedRight = (b[j].isFinite ? b[j] : 0) + right.process(source.samples[1][cursor], filter) * level
            a[i] = mixedLeft.isFinite ? mixedLeft : 0; b[j] = mixedRight.isFinite ? mixedRight : 0
            cursor = (cursor + 1) % source.samples[0].count
            if releaseFrames > 0 {
                releaseFrames -= 1
                if releaseFrames == 0 { self.source = nil; resetSource() }
            }
        }
    }
}
