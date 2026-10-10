import AVFoundation

// AudioEffectGraph.swift — original post-EQ graph order; one render owner, preallocated stereo scratch and no callback-sized allocations.
final class AudioEffectGraph {
    let rate: Double
    private let cutoff = AudioCutoffFilters(), wow = AudioWowDelay(), width = AudioStereoWidth(), punch = AudioPunch()
    private let noise = AudioNoise(), reverb = AudioReverb()
    private let leftDrive = WebAudioOversampling(), rightDrive = WebAudioOversampling()
    private let scratch: AVAudioPCMBuffer
    private var program: AudioEffectProgram
    private var noiseSource: AudioNoiseBuffer?, reverbKernel: AudioReverbKernel?
    var latencyFrames: Int { WebAudioOversampling.latencyFrames + punch.latencyFrames }
    #if DEBUG
    var trace: ((String, UnsafeMutablePointer<AudioBufferList>, Int) -> Void)?
    #endif

    init?(program: AudioEffectProgram) {
        rate = program.rate; self.program = program
        guard let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2),
              let scratch = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 128) else { return nil }
        self.scratch = scratch
        cutoff.prepare(rate: rate, channels: 2); wow.prepare(rate: rate, channels: 2)
        width.prepare(rate: rate); punch.prepare(rate: rate, channels: 2)
        noise.prepare(rate: rate); reverb.prepare(rate: rate)
        guard cutoff.available, wow.available, width.available, punch.available, noise.available, reverb.available,
              apply(program) else { return nil }
    }
    // Caller retains the replaced program for destruction on the control thread.
    @discardableResult func apply(_ next: AudioEffectProgram) -> Bool {
        guard next.rate == rate, next.values["noise"]! == 0 || noise.active || next.noise != nil,
              next.values["space"]! == 0 || reverb.active || next.reverb != nil else { return false }
        let values = next.values
        cutoff.set(highpass: values["highpass"]!, lowpass: values["lowpass"]!)
        wow.set(values["wow"]!); width.set(values["width"]!); punch.set(values["punch"]!)
        if !noise.active { noiseSource = values["noise"]! > 0 ? next.noise : nil }
        if !reverb.active { reverbKernel = values["space"]! > 0 ? next.reverb : nil }
        noise.set(values["noise"]!, source: noiseSource); reverb.set(values["space"]!, kernel: reverbKernel)
        next.retainActiveBranches(noise: noiseSource, reverb: reverbKernel)
        program = next
        return true
    }
    func process(_ buffers: UnsafeMutablePointer<AudioBufferList>, frames: Int, discontinuity: Bool = false) {
        let list = UnsafeMutableAudioBufferListPointer(buffers)
        guard AudioCutoffFilters.valid(list, frames: frames, channels: 2) else { return }
        if discontinuity { leftDrive.reset(); rightDrive.reset() }
        let interleaved = list.count == 1, stride = interleaved ? 2 : 1
        let inputLeft = list[0].mData!.assumingMemoryBound(to: Float.self)
        let inputRight = list[interleaved ? 0 : 1].mData!.assumingMemoryBound(to: Float.self)
        let left = scratch.floatChannelData![0], right = scratch.floatChannelData![1]
        var offset = 0
        while offset < frames {
            let count = min(128, frames - offset)
            scratch.frameLength = AVAudioFrameCount(count)
            for i in 0..<count {
                left[i] = inputLeft[(offset + i) * stride]
                right[i] = inputRight[(offset + i) * stride + (interleaved ? 1 : 0)]
            }
            let start = discontinuity && offset == 0, work = scratch.mutableAudioBufferList
            cutoff.process(work, frames: count, discontinuity: start)
            #if DEBUG
            trace?("cutoff", work, count)
            #endif
            program.drive.withUnsafeBufferPointer { curve in
                leftDrive.process(UnsafeBufferPointer(start: left, count: count), into: UnsafeMutableBufferPointer(start: left, count: count), curve: curve)
                rightDrive.process(UnsafeBufferPointer(start: right, count: count), into: UnsafeMutableBufferPointer(start: right, count: count), curve: curve)
            }
            #if DEBUG
            trace?("drive", work, count)
            #endif
            program.crush.withUnsafeBufferPointer { curve in
                WebAudioWaveShaper.process(left, count: count, curve: curve); WebAudioWaveShaper.process(right, count: count, curve: curve)
            }
            #if DEBUG
            trace?("crush", work, count)
            #endif
            wow.process(work, frames: count, discontinuity: start)
            #if DEBUG
            trace?("wow", work, count)
            #endif
            width.process(work, frames: count)
            #if DEBUG
            trace?("width", work, count)
            #endif
            punch.process(work, frames: count, discontinuity: start)
            #if DEBUG
            trace?("makeup", work, count)
            #endif
            reverb.process(work, frames: count, discontinuity: start); noise.process(work, frames: count)
            #if DEBUG
            trace?("output", work, count)
            #endif
            for i in 0..<count {
                inputLeft[(offset + i) * stride] = left[i]
                inputRight[(offset + i) * stride + (interleaved ? 1 : 0)] = right[i]
            }
            offset += count
        }
        // Program retains these until the next handoff, so no large object is destroyed here.
        if !noise.active { noiseSource = nil }
        if !reverb.active { reverbKernel = nil }
    }
}
