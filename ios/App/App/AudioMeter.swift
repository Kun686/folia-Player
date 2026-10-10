import AVFoundation
import MediaToolbox
import Accelerate
import QuartzCore

// AudioMeter.swift — native EQ precedes spectrum analysis; only FFT depends on UI polling.
final class AudioMeter {
    let equalizer = AudioEqualizer()
    private let lock = NSLock()
    private var requestedAt = -Double.infinity
    private var sampledAt = -Double.infinity
    private var values = [Float](repeating: 0, count: 512)
    private var sampleRate: Double = 44100
    private var floatPCM = false
    private var processingReady = false
    private var samples = [Float](repeating: 0, count: 1024)
    private var imaginary = [Float](repeating: 0, count: 1024)
    private var realOutput = [Float](repeating: 0, count: 1024)
    private var imagOutput = [Float](repeating: 0, count: 1024)
    private var window = [Float](repeating: 0, count: 1024)
    private var cursor = 0
    private let fft = vDSP_DFT_zop_CreateSetup(nil, 1024, .FORWARD)
    init() { vDSP_hann_window(&window, 1024, Int32(vDSP_HANN_NORM)) }
    deinit { if let fft { vDSP_DFT_DestroySetup(fft) } }
    func snapshot() -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        requestedAt = CACurrentMediaTime()
        return ["available": requestedAt - sampledAt < 0.4, "spectrum": values.map { Int($0) }, "sampleRate": sampleRate]
    }
    func processingAvailable() -> Bool {
        lock.lock(); defer { lock.unlock() }; return processingReady
    }
    private func prepare(_ format: AudioStreamBasicDescription) {
        lock.lock(); defer { lock.unlock() }
        sampleRate = format.mSampleRate
        floatPCM = format.mFormatID == kAudioFormatLinearPCM && format.mFormatFlags & kAudioFormatFlagIsFloat != 0 && format.mBitsPerChannel == 32
        cursor = 0
        equalizer.prepare(format)
        processingReady = equalizer.available
    }
    private func unprepare() {
        lock.lock(); defer { lock.unlock() }
        equalizer.unprepare(); processingReady = false
    }
    private func consume(_ buffers: UnsafeMutablePointer<AudioBufferList>, frames: Int) {
        let now = CACurrentMediaTime()
        guard floatPCM, let fft, lock.try() else { return }
        let wanted = now - requestedAt < 0.4 && now - sampledAt >= 0.04
        lock.unlock()
        guard wanted else { return }
        let list = UnsafeMutableAudioBufferListPointer(buffers)
        guard let buffer = list.first, let data = buffer.mData else { return }
        let channels = max(1, Int(buffer.mNumberChannels)), pcm = data.assumingMemoryBound(to: Float.self)
        let count = min(frames, Int(buffer.mDataByteSize) / (4 * channels))
        for frame in 0..<count {
            samples[cursor] = pcm[frame * channels]; cursor += 1
            if cursor == 1024 {
                vDSP_vmul(samples, 1, window, 1, &samples, 1, 1024)
                vDSP_DFT_Execute(fft, samples, imaginary, &realOutput, &imagOutput)
                if lock.try() {
                    for bin in 0..<512 {
                        let amplitude = hypotf(realOutput[bin], imagOutput[bin]) / 512
                        let db = 20 * log10f(max(0.00001, amplitude))
                        values[bin] = min(255, max(0, (db + 100) / 70 * 255))
                    }
                    sampledAt = now; lock.unlock()
                }
                cursor = 0
                break
            }
        }
    }
    @MainActor static func attach(to item: AVPlayerItem) async -> AudioMeter? {
        guard let track = try? await item.asset.loadTracks(withMediaType: .audio).first else { return nil }
        let meter = AudioMeter()
        let pointer = Unmanaged.passRetained(meter).toOpaque()
        var callbacks = MTAudioProcessingTapCallbacks(version: kMTAudioProcessingTapCallbacksVersion_0, clientInfo: pointer,
            init: { _, info, storage in storage.pointee = info },
            finalize: { tap in Unmanaged<AudioMeter>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).release() },
            prepare: { tap, _, format in Unmanaged<AudioMeter>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue().prepare(format.pointee) },
            unprepare: { tap in Unmanaged<AudioMeter>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue().unprepare() },
            process: { tap, count, _, buffers, outputCount, outputFlags in
                let status = MTAudioProcessingTapGetSourceAudio(tap, count, buffers, outputFlags, nil, outputCount)
                if status == noErr {
                    let meter = Unmanaged<AudioMeter>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue()
                    meter.equalizer.process(buffers, frames: Int(outputCount.pointee),
                        discontinuity: outputFlags.pointee & kMTAudioProcessingTapFlag_StartOfStream != 0)
                    meter.consume(buffers, frames: Int(outputCount.pointee))
                } else { outputCount.pointee = 0 }
            })
        var tap: MTAudioProcessingTap?
        guard MTAudioProcessingTapCreate(kCFAllocatorDefault, &callbacks, kMTAudioProcessingTapCreationFlag_PostEffects, &tap) == noErr, let tap else {
            Unmanaged<AudioMeter>.fromOpaque(pointer).release(); return nil
        }
        let input = AVMutableAudioMixInputParameters(track: track)
        input.audioTapProcessor = tap
        let mix = AVMutableAudioMix(); mix.inputParameters = [input]; item.audioMix = mix
        return meter
    }
}
