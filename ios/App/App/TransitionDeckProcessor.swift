import AVFoundation
import Accelerate

// TransitionDeckProcessor.swift — one persistent original deck chain, independent of decoder lifetime.
final class TransitionDeckProcessor {
    private let gain: TransitionGain
    private let lock = NSLock()
    private var requestedIdentity: UUID?
    private var mediaClockOwner: NativeTempoHandover?
    private var identity = UUID()
    private var scratch: AVAudioPCMBuffer?
    private var rate = 0.0
    private var tone = TransitionTone()
    private var echo: TransitionEcho?

    init(gain: TransitionGain) { self.gain = gain }
    func source(_ identity: UUID, mediaClockOwner: NativeTempoHandover? = nil) {
        lock.lock(); defer { lock.unlock() }
        requestedIdentity = identity; self.mediaClockOwner = mediaClockOwner
    }
    // Control retains/releases this reference under the lock; render never takes ownership of it.
    func clearMediaClockOwner() { lock.lock(); defer { lock.unlock() }; mediaClockOwner = nil }

    // Graph edits can reallocate AU buffers. Preserve the original deck's histories at the same rate.
    func prepare(rate: Double, capacity: AVAudioFrameCount) throws {
        guard AudioEffectSources.validRate(rate), capacity > 0, capacity <= 65536,
              let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 2, interleaved: true) else {
            throw MobileFailure("unsupported-audio-format")
        }
        if self.rate != rate { self.rate = rate; tone = TransitionTone(); echo = TransitionEcho(rate: rate) }
        if scratch?.format != format || (scratch?.frameCapacity ?? 0) < capacity {
            guard let created = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { throw MobileFailure("audio-failed") }
            scratch = created
        }
    }

    // AU input/output is planar Float32. Accelerate only interleaves/deinterleaves here; it neither
    // resamples nor changes any samples. The existing transition processors keep their exact contract.
    func process(_ buffers: UnsafeMutablePointer<AudioBufferList>, frames: Int, sampleTime: Double) -> Bool {
        guard let scratch, frames > 0, frames <= Int(scratch.frameCapacity), sampleTime.isFinite,
              abs(sampleTime) < 4_503_599_627_370_496 else { return false }
        let list = UnsafeMutableAudioBufferListPointer(buffers)
        guard list.count == 2, list.allSatisfy({ $0.mNumberChannels == 1 && $0.mData != nil
            && Int($0.mDataByteSize) >= frames * MemoryLayout<Float>.size }),
              let pcm = scratch.floatChannelData?[0] else { return false }
        if lock.try() {
            mediaClockOwner?.bindMediaClock(sampleTime: sampleTime, frames: frames)
            if let requestedIdentity {
                identity = requestedIdentity; self.requestedIdentity = nil
                // A replacement song cannot feed a previous song's scheduled throw. Its return survives.
                echo?.stopSending(at: sampleTime, immediate: true)
            }
            lock.unlock()
        }
        var channels = DSPSplitComplex(realp: list[0].mData!.assumingMemoryBound(to: Float.self),
                                       imagp: list[1].mData!.assumingMemoryBound(to: Float.self))
        pcm.withMemoryRebound(to: DSPComplex.self, capacity: frames) { vDSP_ztoc(&channels, 1, $0, 2, vDSP_Length(frames)) }
        scratch.frameLength = AVAudioFrameCount(frames)
        guard gain.process(scratch.mutableAudioBufferList, frames: frames, sampleTime: sampleTime,
                           rate: rate, source: identity, tone: tone, echo: echo) else { return false }
        pcm.withMemoryRebound(to: DSPComplex.self, capacity: frames) { vDSP_ctoz($0, 2, &channels, 1, vDSP_Length(frames)) }
        return true
    }
}
