import AVFoundation
import MediaToolbox
import Accelerate
import QuartzCore

// AudioMeter.swift — native EQ precedes capture; Web Audio-compatible analysis runs only when visible UI reads it.
final class AudioMeter {
    let equalizer = AudioEqualizer()
    private let lock = NSLock()
    private var requestedAt = -Double.infinity
    private var sampledAt = -Double.infinity
    private let spectrum = AudioSpectrum()
    private var ring = [Float](repeating: 0, count: AudioSpectrum.size)
    private var samples = [Float](repeating: 0, count: AudioSpectrum.size)
    private var sampleRate: Double = 44100
    private var channels = 0
    private var processingReady = false
    private var outputGain: Float = 1
    private var cursor = 0
    private var captureRevision: UInt64 = 0
    private var analysedRevision: UInt64 = 0
    private var resetAnalysis = true
    // Only the serial tap process callback accesses this flag, including when the mailbox is busy.
    private var captureInterrupted = false

    func setOutputGain(volume: Double, muted: Bool) {
        guard volume.isFinite, (0...1).contains(volume) else { return }
        lock.lock(); defer { lock.unlock() }
        outputGain = muted ? 0 : Float(volume)
    }
    func snapshot() -> [String: Any] {
        // The audio callback only tries this lock: bridge/FFT work can never block audible PCM.
        lock.lock(); defer { lock.unlock() }
        let now = CACurrentMediaTime()
        // Capture may outlive the last UI read by 400 ms. Its timestamp alone cannot detect a
        // suspended consumer: discard the old FFT history/window before restarting demand.
        if now - requestedAt >= 0.4 { clearCapture() }
        requestedAt = now
        let available = requestedAt - sampledAt < 0.4 && spectrum.available
        if available && analysedRevision != captureRevision {
            for i in samples.indices { samples[i] = ring[(cursor + i) % AudioSpectrum.size] }
            if resetAnalysis { spectrum.reset(); resetAnalysis = false }
            spectrum.analyse(samples)
            analysedRevision = captureRevision
        }
        return ["available": available, "spectrum": spectrum.bytes, "sampleRate": sampleRate, "channels": channels]
    }
    func processingAvailable() -> Bool {
        lock.lock(); defer { lock.unlock() }; return processingReady
    }
    func prepare(_ format: AudioStreamBasicDescription) {
        lock.lock(); defer { lock.unlock() }
        equalizer.prepare(format)
        sampleRate = format.mSampleRate
        processingReady = equalizer.available
        channels = processingReady ? Int(format.mChannelsPerFrame) : 0
        clearCapture()
    }
    private func unprepare() {
        lock.lock(); defer { lock.unlock() }
        equalizer.unprepare(); processingReady = false; channels = 0; clearCapture()
    }
    private func clearCapture() {
        for i in ring.indices { ring[i] = 0 }
        cursor = 0; sampledAt = -Double.infinity; resetAnalysis = true
    }
    // Capture the most recent complete window, downmixed to mono as specified by Web Audio.
    // AVPlayer applies volume after its tap, so apply the same gain only to this analysis copy.
    func consume(_ buffers: UnsafeMutablePointer<AudioBufferList>, frames: Int, discontinuity: Bool = false) {
        let now = CACurrentMediaTime()
        guard lock.try() else { captureInterrupted = true; return }
        defer { lock.unlock() }
        if discontinuity || captureInterrupted { clearCapture(); captureInterrupted = false }
        guard channels > 0, frames > 0, now - requestedAt < 0.4 else { return }
        let list = UnsafeMutableAudioBufferListPointer(buffers)
        var count = 0
        for buffer in list {
            let stride = Int(buffer.mNumberChannels)
            guard buffer.mData != nil, stride > 0,
                  Int(buffer.mDataByteSize) / (MemoryLayout<Float>.size * stride) >= frames else { return }
            count += stride
        }
        guard count == channels else { return }
        if now - sampledAt >= 0.4 { clearCapture() }
        for frame in max(0, frames - AudioSpectrum.size)..<frames {
            var mono: Float = 0, channel = 0
            for buffer in list {
                let stride = Int(buffer.mNumberChannels), data = buffer.mData!.assumingMemoryBound(to: Float.self)
                for local in 0..<stride {
                    // Web Audio speaker mixing: mono/stereo/quad/5.1; other counts fall back to discrete.
                    let weight: Float = channels == 6
                        ? (channel < 2 ? sqrt(0.5) : channel == 2 ? 1 : channel == 3 ? 0 : 0.5)
                        : channels == 1 || channels == 2 || channels == 4 ? 1 / Float(channels)
                        : channel == 0 ? 1 : 0
                    let value = data[frame * stride + local]
                    mono += (value.isFinite ? value : 0) * weight
                    channel += 1
                }
            }
            ring[cursor] = mono * outputGain
            cursor = (cursor + 1) % AudioSpectrum.size
        }
        captureRevision &+= 1; sampledAt = now
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
                    meter.consume(buffers, frames: Int(outputCount.pointee),
                        discontinuity: outputFlags.pointee & kMTAudioProcessingTapFlag_StartOfStream != 0)
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
