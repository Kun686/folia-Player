import AVFoundation

// AudioStereoWidth.swift — original direct/cross matrix for an already stereo signal.
final class AudioStereoWidth {
    private var direct = AudioEffectRamp(1, rate: 44100)
    private var cross = AudioEffectRamp(0, rate: 44100)
    private(set) var available = false

    func prepare(rate: Double) {
        available = AudioEffectSources.validRate(rate)
        guard available else { return }
        direct = AudioEffectRamp(1, rate: rate); cross = AudioEffectRamp(0, rate: rate)
    }
    func set(_ width: Double) {
        guard width.isFinite, (0...2).contains(width) else { return }
        direct.set((1 + width) / 2); cross.set((1 - width) / 2)
    }
    // The native chain must explicitly supply stereo; a mono tap cannot silently stand in for stereo effects.
    func process(_ buffers: UnsafeMutablePointer<AudioBufferList>, frames: Int) {
        guard available else { return }
        let list = UnsafeMutableAudioBufferListPointer(buffers)
        guard AudioCutoffFilters.valid(list, frames: frames, channels: 2) else { return }
        let interleaved = list.count == 1
        let left = list[0].mData!.assumingMemoryBound(to: Float.self)
        let right = list[interleaved ? 0 : 1].mData!.assumingMemoryBound(to: Float.self)
        let stride = interleaved ? 2 : 1
        for frame in 0..<frames {
            let l = left[frame * stride], r = right[frame * stride + (interleaved ? 1 : 0)]
            let a = l.isFinite ? l : 0, b = r.isFinite ? r : 0
            let d = Float(direct.next()), c = Float(cross.next())
            left[frame * stride] = a * d + b * c
            right[frame * stride + (interleaved ? 1 : 0)] = a * c + b * d
        }
    }
}
