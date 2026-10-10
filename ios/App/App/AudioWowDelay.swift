import AVFoundation

// AudioWowDelay.swift — original 0.7/6.8 Hz tape modulation; preallocated delay history stays on the render owner.
final class AudioWowDelay {
    private var rate = 44100.0, channels = 0, capacity = 0, cursor = 0
    private var history: [Float] = []
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
        self.rate = rate; self.channels = channels; capacity = Int(ceil(rate * 0.2)) + 2
        history = [Float](repeating: 0, count: capacity * channels)
        base = AudioEffectRamp(0, rate: rate, seconds: 0.08)
        wowDepth = AudioEffectRamp(0, rate: rate, seconds: 0.08)
        flutterDepth = AudioEffectRamp(0, rate: rate, seconds: 0.08)
        available = true
    }
    func unprepare() {
        history.removeAll(); channels = 0; capacity = 0; cursor = 0; available = false
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
        for i in history.indices { history[i] = 0 }
        cursor = 0
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
            let whole = Int(floor(delay)), fraction = Float(delay - Double(whole))
            let newer = (cursor - whole + capacity) % capacity, older = (newer - 1 + capacity) % capacity
            var channel = 0
            for buffer in list {
                let stride = Int(buffer.mNumberChannels), data = buffer.mData!.assumingMemoryBound(to: Float.self)
                for local in 0..<stride {
                    let index = frame * stride + local, start = channel * capacity
                    history[start + cursor] = data[index].isFinite ? data[index] : 0
                    let a = history[start + newer], b = history[start + older]
                    data[index] = a + fraction * (b - a)
                    channel += 1
                }
            }
            cursor = (cursor + 1) % capacity
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
