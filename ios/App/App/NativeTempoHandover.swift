import AVFoundation
import AudioStreaming
import Accelerate

// NativeTempoHandover.swift — warm from already-heard history, retaining read-ahead for the raw path.
// Construction/close happen on control; only render owns the PCM window and active stream.
final class NativeTempoHandover {
    enum Phase { case raw, armed, active, failed }
    struct State {
        let phase: Phase, position: Double, rate: Double
        let decoderEnded: Bool, drained: Bool
        // TimePitch position is an estimate. Only complete, unbent PCM can anchor a stem splice.
        var mediaClock: NativeMediaClock? = nil
    }
    private let window: NativeTempoPCM, feed: CachedTempoFeed, stream: NativeTempoStream
    private let scratch: AVAudioPCMBuffer
    private let latencyFrames: Int, historyFrames: Int
    private var cursor = 0, desiredRate = 1.0
    private var phase = Phase.raw, rawEnded = false
    private let lock = NSLock()
    private var pendingRate: Double?, closed = false
    private var pendingClockReset = false
    private var published: State
    private var mediaClock = NativeMediaClockTracker()
    // Main-control callbacks use pre-created coalescing sources, as AudioEffectController does.
    // A reset invalidates queued notices; render never allocates a dispatch closure or waits for main.
    var changed: ((Bool) -> Void)?
    private var wake: DispatchSourceUserDataAdd?, fault: DispatchSourceUserDataAdd?
    private var noticeGeneration: UInt64 = 0

    convenience init(player: AudioPlayer) throws { try self.init(source: DecoderTempoFeed(player: player)) }
    init(source: NativeTempoFeed) throws {
        let window = try NativeTempoPCM(source: source), feed = CachedTempoFeed(window: window)
        self.window = window; self.feed = feed
        stream = try NativeTempoStream(feed: feed)
        let latency = stream.startupFrames
        guard latency > 0, latency <= 8192, abs(latency - latency.rounded()) < 0.001,
              let format = AVAudioFormat(standardFormatWithSampleRate: source.format.sampleRate, channels: 2),
              let scratch = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: NativeTempoProcessor.maximumFrames) else {
            throw MobileFailure("unsupported-audio-format")
        }
        latencyFrames = Int(latency.rounded()); historyFrames = latencyFrames * 2
        self.scratch = scratch
        published = State(phase: .raw, position: source.position, rate: 1, decoderEnded: false, drained: false)
        prepareNotices()
    }
    func request(rate: Double) throws {
        guard rate.isFinite, (0.88...1.12).contains(rate) else { throw MobileFailure("invalid-tempo-rate") }
        lock.lock(); defer { lock.unlock() }
        guard !closed else { throw MobileFailure("tempo-unavailable") }
        pendingRate = rate
        if rate != 1 { published.mediaClock = nil }
    }
    func snapshot() -> State { lock.lock(); defer { lock.unlock() }; return published }
    // Control may revoke a clock even while the engine is stopping. Render owns the epoch reset.
    func invalidateMediaClock() {
        lock.lock(); defer { lock.unlock() }
        pendingClockReset = true; published.mediaClock = nil
    }

    // All extra pulls stay in the same bounded source callback. No graph edits, allocation, seek,
    // network request creation, or control-side blocking lock happens at the point of handover.
    func render(_ output: UnsafeMutablePointer<AudioBufferList>, frames: AVAudioFrameCount,
                sampleTime: Double? = nil) -> OSStatus {
        let list = UnsafeMutableAudioBufferListPointer(output)
        guard !closed, frames > 0, frames <= 8192, list.count == 1, list[0].mNumberChannels == 2,
              list[0].mDataByteSize >= frames * 8, let destination = list[0].mData else {
            invalidateRenderedMediaClock(); return kAudioUnitErr_InvalidParameter
        }
        if window.source.isPaused {
            memset(destination, 0, Int(frames) * 8); invalidateRenderedMediaClock(); return noErr
        }
        if lock.try() {
            if pendingClockReset { mediaClock.invalidate(); pendingClockReset = false }
            if let pendingRate { desiredRate = pendingRate; self.pendingRate = nil }
            lock.unlock()
        }
        var justWarmed = false
        var completeRawRead = false
        if phase == .raw || phase == .armed {
            phase = desiredRate == 1 ? .raw : .armed
            if phase == .armed, cursor - historyFrames >= window.start {
                feed.cursor = cursor - historyFrames
                var remaining = historyFrames + latencyFrames
                var ready = stream.primeOrigin()
                while ready && remaining > 0 {
                    let count = AVAudioFrameCount(min(remaining, Int(NativeTempoProcessor.maximumFrames)))
                    scratch.frameLength = count
                    ready = stream.render(scratch.mutableAudioBufferList, frames: count) == noErr && !feed.underflow
                    remaining -= Int(count)
                }
                // Only past output is discarded: after warm-up the next output is at the raw cursor.
                ready = ready && abs(stream.renderState.position - window.position(cursor)) * window.format.sampleRate < 0.5
                phase = ready ? .active : .failed
                justWarmed = ready
            }
        }
        if phase == .active {
            var offset = 0
            while offset < Int(frames) {
                let count = AVAudioFrameCount(min(Int(frames) - offset, Int(NativeTempoProcessor.maximumFrames)))
                scratch.frameLength = count
                let status = stream.render(scratch.mutableAudioBufferList, frames: count, rate: justWarmed ? 1 : desiredRate)
                guard status == noErr else {
                    memset(destination, 0, Int(frames) * 8); invalidateRenderedMediaClock(); fault?.add(data: 1); return status
                }
                var channels = DSPSplitComplex(realp: scratch.floatChannelData![0], imagp: scratch.floatChannelData![1])
                (destination + offset * 8).assumingMemoryBound(to: Float.self).withMemoryRebound(to: DSPComplex.self, capacity: Int(count)) {
                    vDSP_ztoc(&channels, 1, $0, 2, vDSP_Length(count))
                }
                offset += Int(count)
            }
        } else {
            var read = AudioPlayer.ExternalAudioRead()
            let status = window.read(cursor: &cursor, frames: frames, output: output, observation: &read)
            guard status == noErr else {
                memset(destination, 0, Int(frames) * 8); invalidateRenderedMediaClock(); fault?.add(data: 1); return status
            }
            rawEnded = read.endOfStream
            completeRawRead = read.frames == frames && !read.endOfStream
        }
        let state = stream.renderState
        let position = phase == .active ? state.position : window.position(cursor)
        let clock = mediaClock.record(sampleTime: sampleTime, frames: Int(frames), sampleRate: window.format.sampleRate,
            mediaEnd: position, complete: phase == .raw && desiredRate == 1 && completeRawRead)
        if lock.try() {
            let next = State(phase: phase, position: position,
                rate: phase == .active ? state.rate : 1, decoderEnded: phase == .active ? state.decoderEnded : rawEnded,
                drained: phase == .active ? state.drained : rawEnded,
                mediaClock: !pendingClockReset && (pendingRate == nil || pendingRate == 1) ? clock : nil)
            let notify = next.phase != published.phase || next.rate != published.rate
                || next.decoderEnded != published.decoderEnded || next.drained != published.drained
            published = next
            lock.unlock()
            if notify { wake?.add(data: 1) }
        }
        return noErr
    }
    private func invalidateRenderedMediaClock() {
        mediaClock.invalidate()
        if lock.try() { published.mediaClock = nil; lock.unlock() }
    }
    // After entering TimePitch, rate 1 stays on the same aligned stream until this occurrence ends.
    // Switching back to a new raw cursor mid-song would need another alignment and is unnecessary.
    func reset() throws {
        lock.lock(); defer { lock.unlock() }
        guard !closed else { throw MobileFailure("tempo-unavailable") }
        guard !window.source.isSeeking else { throw MobileFailure("invalid-position") }
        prepareNotices()
        mediaClock.invalidate()
        window.reset(); cursor = 0; feed.cursor = 0; feed.underflow = false
        pendingRate = nil; pendingClockReset = false; desiredRate = 1; rawEnded = false; phase = .raw
        do { try stream.reset() }
        catch {
            phase = .failed
            published = State(phase: .failed, position: window.position(0), rate: 1, decoderEnded: false, drained: false)
            throw error
        }
        published = State(phase: .raw, position: window.position(0), rate: 1, decoderEnded: false, drained: false)
    }
    func close() {
        lock.lock(); defer { lock.unlock() }
        guard !closed else { return }; closed = true; pendingRate = nil
        mediaClock.invalidate(); published.mediaClock = nil
        noticeGeneration &+= 1; wake?.cancel(); fault?.cancel(); changed = nil
        stream.close(); window.close()
    }
    // Only control calls this while pulls are stopped, including construction and seek/reset.
    private func prepareNotices() {
        noticeGeneration &+= 1
        let stamp = noticeGeneration
        wake?.cancel(); fault?.cancel()
        let wake = DispatchSource.makeUserDataAddSource(queue: .main)
        let fault = DispatchSource.makeUserDataAddSource(queue: .main)
        wake.setEventHandler { [weak self] in
            guard let self, !self.closed, self.noticeGeneration == stamp else { return }
            self.changed?(false)
        }
        fault.setEventHandler { [weak self] in
            guard let self, !self.closed, self.noticeGeneration == stamp else { return }
            self.changed?(true)
        }
        self.wake = wake; self.fault = fault
        wake.resume(); fault.resume()
    }
    deinit { close() }
}
