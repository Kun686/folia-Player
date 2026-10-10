import AVFoundation
import QuartzCore

// NativeDeckCapture.swift — independent K-weighted per-deck tap, before trim/tone/fade and master effects.
final class NativeDeckCapture {
    static let size = 1024
    struct Frame { let samples: [Float]; let time: Double; let revision: UInt64; let epoch: UInt64; let completeHistory: Bool }
    let identity = UUID()
    let rate: Double
    private let lock = NSLock()
    private let shelf: AudioEffectBiquadCoefficients, rumble: AudioEffectBiquadCoefficients
    private var shelfL = AudioEffectBiquadState(), shelfR = AudioEffectBiquadState()
    private var rumbleL = AudioEffectBiquadState(), rumbleR = AudioEffectBiquadState()
    private var ring = [Float](repeating: 0, count: size)
    private var cursor = 0, quantum = 0
    private var enabled = false, resetPending = true
    private var revision: UInt64 = 0, epoch: UInt64 = 0
    private var completeHistory = true
    private var sampledAt: Double?, expectedFrame: Double?
    // Only the render callback accesses this; a busy reader never stalls audio.
    private var missed = false

    init(rate: Double) {
        self.rate = rate
        var coefficients = [Double](repeating: 0, count: 50)
        AudioEqualizer.writeCoefficients(band: 9, gain: 4, rate: rate,
            frequency: Double(Float(1681.974)), into: &coefficients)
        shelf = AudioEffectBiquadCoefficients(values: coefficients[45..<50])
        rumble = AudioEffectBiquadCoefficients(frequency: Double(Float(38.135)), rate: rate, highpass: true, q: 0.5003)
    }
    func enable(_ value: Bool) {
        lock.lock(); defer { lock.unlock() }
        if enabled != value { enabled = value; invalidate(partial: revision > 0) }
    }
    func reset() { lock.lock(); defer { lock.unlock() }; invalidate() }
    private func invalidate(partial: Bool = true) {
        epoch &+= 1; resetPending = true; sampledAt = nil
        if partial { completeHistory = false }
    }
    private func clear() {
        shelfL = AudioEffectBiquadState(); shelfR = AudioEffectBiquadState()
        rumbleL = AudioEffectBiquadState(); rumbleR = AudioEffectBiquadState()
        for i in ring.indices { ring[i] = 0 }
        cursor = 0; quantum = 0; expectedFrame = nil; resetPending = false
    }
    // Copies only the window. FFT and JS run after releasing the lock, on the analysis queue.
    func snapshot(after previous: UInt64?) -> Frame? {
        lock.lock(); defer { lock.unlock() }
        guard enabled, !resetPending, let sampledAt, revision != previous else { return nil }
        var samples = [Float](repeating: 0, count: Self.size)
        for i in samples.indices { samples[i] = ring[(cursor + i) % Self.size] }
        return Frame(samples: samples, time: sampledAt, revision: revision, epoch: epoch, completeHistory: completeHistory)
    }
    func currentEpoch() -> UInt64 { lock.lock(); defer { lock.unlock() }; return epoch }

    // No allocation, waits, FFT, JavaScript, gain writes or edits to decoder PCM on the audio thread.
    func consume(_ buffers: UnsafeMutablePointer<AudioBufferList>, frames: Int, sampleTime: Double,
                 time: Double = CACurrentMediaTime()) {
        guard lock.try() else { missed = true; return }
        defer { lock.unlock() }
        guard enabled, frames > 0, frames <= 65536, sampleTime.isFinite, time.isFinite else { return }
        let list = UnsafeMutableAudioBufferListPointer(buffers)
        guard list.count == 1, list[0].mNumberChannels == 2,
              Int(list[0].mDataByteSize) >= frames * 2 * MemoryLayout<Float>.size,
              let pcm = list[0].mData?.assumingMemoryBound(to: Float.self) else { return }
        if missed || (expectedFrame != nil && abs(sampleTime - expectedFrame!) > 0.5) { invalidate() }
        if resetPending { clear() }
        missed = false
        for frame in 0..<frames {
            let left = rumbleL.process(shelfL.process(pcm[frame * 2], shelf), rumble)
            let right = rumbleR.process(shelfR.process(pcm[frame * 2 + 1], shelf), rumble)
            ring[cursor] = (left + right) * 0.5
            cursor = (cursor + 1) % Self.size
            quantum += 1
            if quantum == 128 {
                shelfL.finishQuantum(); shelfR.finishQuantum(); rumbleL.finishQuantum(); rumbleR.finishQuantum(); quantum = 0
            }
        }
        expectedFrame = sampleTime + Double(frames)
        sampledAt = time; revision &+= 1
    }
}
