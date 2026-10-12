import AVFoundation

// NativeStemTransition.swift — one-shot stem bus and complementary media-element splices on one render clock.
final class NativeStemTransition {
    let outgoing: UUID, incoming: UUID
    let hold: Double, seconds: Double, splice: Double
    private let mixer: NativeStemMixer
    private let alignment: NativeStemAlignment?
    private let claimLock = NSLock()
    private var claimed = false
    private var previousEnd: Double?
    private var outgoingLevel: Float = 1
    private(set) var failed = false

    init(outgoing: UUID, incoming: UUID, mixer: NativeStemMixer, seconds: Double, hold: Double, splice: Double,
         alignment: NativeStemAlignment? = nil) throws {
        guard outgoing != incoming, seconds.isFinite, (0.8...30).contains(seconds),
              hold.isFinite, (0...25).contains(hold), splice.isFinite, splice > 0, splice < seconds / 2,
              mixer.frames == Int(ceil(seconds * NativeStemPCM.rate)), mixer.position == 0 else {
            throw MobileFailure("invalid-stem-schedule")
        }
        self.outgoing = outgoing; self.incoming = incoming; self.mixer = mixer
        self.seconds = seconds; self.hold = hold; self.splice = splice
        self.alignment = alignment
    }

    // Control-only ownership transfer. The same rendered window must never be replayed by rescheduling it.
    func claim() -> Bool {
        claimLock.lock(); defer { claimLock.unlock() }
        guard !claimed else { return false }; claimed = true; return true
    }

    // Render-owner methods. A discontinuous clock cannot silently replay or skip separated media.
    func activate(at frame: Double, frames: Int) -> Double {
        guard let alignment else { return ceil(frame + hold * NativeStemPCM.rate) }
        let start = max(frame, alignment.plannedStart)
        if !alignment.valid(at: frame, frames: frames) { failed = true }
        if let offsets = alignment.offsets(at: start) {
            if !mixer.bind(outgoingOffset: offsets.outgoing, incomingOffset: offsets.incoming) { failed = true }
        } else { failed = true }
        return start
    }
    func beginQuantum(at frame: Double, frames: Int) {
        if let previousEnd, previousEnd != frame { failed = true }
        if let alignment, !alignment.valid(at: frame, frames: frames) { failed = true }
        previousEnd = frame + Double(frames)
    }
    func setOutgoingLevel(_ value: Float) { outgoingLevel = value }
    func gain(incoming: Bool, elapsed: Double) -> Float {
        if failed { return incoming ? 1 : 0 }
        let rate = NativeStemPCM.rate
        if incoming {
            return Float(min(1, max(0, (elapsed - (seconds - splice) * rate) / (splice * rate))))
        }
        return outgoingLevel * Float(1 - min(1, max(0, elapsed / (splice * rate))))
    }

    // Caller has already validated and zero-filled the interleaved output. Stack-only buffer slicing
    // handles a window starting inside a host callback, without changing the mixer's PCM alignment.
    func render(_ output: UnsafeMutablePointer<Float>, frames: Int, elapsed: Double) -> Bool {
        guard !failed else { return true }
        let prefix = min(frames, max(0, Int(-elapsed)))
        if prefix == frames || elapsed >= Double(mixer.frames) { return true }
        let expected = max(0, Int(elapsed))
        guard mixer.position == expected else { failed = true; return false }
        var buffers = AudioBufferList(mNumberBuffers: 1, mBuffers: AudioBuffer(mNumberChannels: 2,
            mDataByteSize: UInt32((frames - prefix) * 2 * MemoryLayout<Float>.size), mData: output + prefix * 2))
        let valid = mixer.render(&buffers, frames: frames - prefix)
        if !valid { failed = true }
        return valid
    }
}
