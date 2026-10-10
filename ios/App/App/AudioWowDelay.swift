import AVFoundation

// AudioWowDelay.swift — original 0.7/6.8 Hz tape modulation; preallocated delay history stays on the render owner.
final class AudioWowDelay {
    private var rate = 44100.0, channels = 0
    private let line = AudioDelayLine()
    private var base = AudioEffectRamp(0, rate: 44100, seconds: 0.08)
    private var wowDepth = AudioEffectRamp(0, rate: 44100, seconds: 0.08)
    private var flutterDepth = AudioEffectRamp(0, rate: 44100, seconds: 0.08)
    private var oscillatorFrame = 0
    private var releaseFrames = 0
    private(set) var oscillatorsActive = false
    private(set) var available = false

    func prepare(rate: Double, channels: Int) {
        unprepare()
        guard AudioEffectSources.validRate(rate), (1...8).contains(channels) else { return }
        self.rate = rate; self.channels = channels
        guard line.prepare(rate: rate, channels: channels, seconds: 0.2) else { return }
        base = AudioEffectRamp(0, rate: rate, seconds: 0.08)
        wowDepth = AudioEffectRamp(0, rate: rate, seconds: 0.08)
        flutterDepth = AudioEffectRamp(0, rate: rate, seconds: 0.08)
        available = true
    }
    func unprepare() {
        line.unprepare(); channels = 0; available = false
        oscillatorFrame = 0; releaseFrames = 0; oscillatorsActive = false
    }
    func set(_ amount: Double) {
        guard amount.isFinite, (0...1).contains(amount) else { return }
        if amount > 0 {
            if !oscillatorsActive { oscillatorFrame = 0 }
            oscillatorsActive = true; releaseFrames = 0
        } else if oscillatorsActive && releaseFrames == 0 { releaseFrames = Int(ceil(rate * 0.8)) }
        base.set(amount > 0 ? 0.012 : 0)
        wowDepth.set(amount * 0.0045); flutterDepth.set(amount * 0.0006)
    }
    func reset() {
        line.reset()
    }
    // DelayNode uses linear interpolation between adjacent stored samples; both LFOs start with phase zero.
    func process(_ buffers: UnsafeMutablePointer<AudioBufferList>, frames: Int, discontinuity: Bool = false) {
        guard available else { return }
        let list = UnsafeMutableAudioBufferListPointer(buffers)
        guard AudioCutoffFilters.valid(list, frames: frames, channels: channels) else { return }
        if discontinuity { reset() }
        for frame in 0..<frames {
            let time = Double(oscillatorFrame) / rate
            let wow = Float(wowDepth.next()), flutter = Float(flutterDepth.next())
            let modulation: Float = oscillatorsActive
                ? Float(sin(2 * .pi * 0.7 * time)) * wow + Float(sin(2 * .pi * 6.8 * time)) * flutter : 0
            let delay = max(0, min(0.2, Double(Float(base.next()) + modulation))) * rate
            let tap = line.tap(delay)
            var channel = 0
            for buffer in list {
                let stride = Int(buffer.mNumberChannels), data = buffer.mData!.assumingMemoryBound(to: Float.self)
                for local in 0..<stride {
                    let index = frame * stride + local
                    line.write(data[index], channel: channel)
                    data[index] = line.read(tap, channel: channel)
                    channel += 1
                }
            }
            line.advance()
            if oscillatorsActive {
                // Both frequencies complete an integral number of cycles in ten seconds.
                oscillatorFrame = (oscillatorFrame + 1) % Int(rate * 10)
                if releaseFrames > 0 {
                    releaseFrames -= 1
                    if releaseFrames == 0 { oscillatorsActive = false }
                }
            }
        }
    }
}
