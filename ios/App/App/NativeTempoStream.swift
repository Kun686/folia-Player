import AVFoundation
import AudioStreaming

// NativeTempoStream.swift — media-time observations and output drain independent of decoder delegates.
// The owner serializes render/reset/close, and stops rendering before seeking the decoder.
final class NativeTempoStream {
    struct Snapshot {
        let position: Double
        let decoderEnded: Bool
        let drained: Bool
        let rate: Double
    }
    private let processor: NativeTempoProcessor
    private let input: TempoStreamInput
    private let sampleRate: Double
    private var initialLatency: Double
    private let lock = NSLock()
    private var published: Snapshot
    private var position: Double
    private var drainingFrames = 0, silentFrames = 0
    private var drained = false, closed = false, failed = false

    init(player: AudioPlayer, rate: Double = 1) throws {
        let state = TempoStreamInput(player: player)
        input = state; sampleRate = player.externalOutputFormat.sampleRate
        position = player.progress
        published = Snapshot(position: position, decoderEnded: false, drained: false, rate: rate)
        processor = try NativeTempoProcessor(format: player.externalOutputFormat, rate: rate) { [state] flags, _, frames, _, output in
            state.render(flags, frames, output)
        }
        initialLatency = processor.latency
    }
    func request(rate: Double) throws { try processor.request(rate: rate) }
    func snapshot() -> Snapshot { lock.lock(); defer { lock.unlock() }; return published }

    // Estimate media time from input history and initial system latency. This is not a speaker
    // timestamp; changes in the system's latency after a rate change still need measured validation.
    func render(_ output: UnsafeMutablePointer<AudioBufferList>, frames: AVAudioFrameCount) -> OSStatus {
        guard !closed, !failed else { return kAudioUnitErr_Uninitialized }
        let status = processor.render(output, frames: frames)
        guard status == noErr else { return status }
        let coordinate = Double(input.timeline.frames) - initialLatency * sampleRate * processor.appliedRate
        if let media = input.timeline.media(at: coordinate) { position = max(position, media / sampleRate) }
        if input.ended {
            drainingFrames += Int(frames)
            let buffers = UnsafeMutableAudioBufferListPointer(output)
            let left = buffers[0].mData!.assumingMemoryBound(to: Float.self)
            let right = buffers[1].mData!.assumingMemoryBound(to: Float.self)
            // Quiet music must survive: only exact zero output counts, with no amplitude threshold.
            for frame in 0..<Int(frames) { silentFrames = left[frame] == 0 && right[frame] == 0 ? silentFrames + 1 : 0 }
            // The system reports tailTime == 0 while retaining audible PCM. One full second of exact
            // silence after known EOF is a conservative resource-release gate, NOT a next-song
            // scheduling deadline. Original overlap scheduling must continue using media time.
            drained = silentFrames >= Int(sampleRate)
            if !drained && drainingFrames > Int(2 * sampleRate) {
                failed = true
                memset(left, 0, Int(frames) * MemoryLayout<Float>.size)
                memset(right, 0, Int(frames) * MemoryLayout<Float>.size)
                return kAudioUnitErr_CannotDoInCurrentContext
            }
        }
        if lock.try() {
            published = Snapshot(position: position, decoderEnded: input.ended, drained: drained, rate: processor.appliedRate)
            lock.unlock()
        }
        return noErr
    }

    // Call only after the decoder completes its seek; old PCM, EOF and timing cannot cross a reset.
    func reset(rate: Double = 1) throws {
        guard !closed, let player = input.player else { throw MobileFailure("tempo-unavailable") }
        guard !player.isSeeking else { throw MobileFailure("invalid-position") }
        try processor.reset(rate: rate)
        position = player.progress; input.reset(position: position)
        initialLatency = processor.latency
        drainingFrames = 0; silentFrames = 0; drained = false; failed = false
        lock.lock(); published = Snapshot(position: position, decoderEnded: false, drained: false, rate: rate); lock.unlock()
    }
    func close() { guard !closed else { return }; closed = true; processor.close(); input.player = nil }
    deinit { close() }
}

private final class TempoStreamInput {
    var player: AudioPlayer?
    let timeline = TempoInputTimeline()
    private let sampleRate: Double
    var ended = false
    init(player: AudioPlayer) {
        self.player = player; sampleRate = player.externalOutputFormat.sampleRate
        reset(position: player.progress)
    }
    func reset(position: Double) { timeline.reset(origin: position * sampleRate); ended = false }
    func render(_ flags: UnsafeMutablePointer<AudioUnitRenderActionFlags>, _ frames: AVAudioFrameCount,
                _ output: UnsafeMutablePointer<AudioBufferList>) -> OSStatus {
        guard let player else { return kAudioUnitErr_Uninitialized }
        if ended {
            flags.pointee.insert(.unitRenderAction_OutputIsSilence)
            timeline.silence(frames: Int(frames))
            return noErr
        }
        var read = AudioPlayer.ExternalAudioRead()
        let status = player.renderExternalAudio(frames: frames, output: output, observation: &read)
        guard status == noErr else { return status }
        guard !read.discontinuity, timeline.append(requested: Int(frames), copied: Int(read.frames),
            end: read.position * sampleRate) else { return kAudioUnitErr_CannotDoInCurrentContext }
        ended = read.endOfStream
        return noErr
    }
}

// Fixed storage for media/silence spans. Normal playback coalesces into one span; underrun padding
// holds media time still. Expired history returns nil instead of inventing a timestamp.
final class TempoInputTimeline {
    private struct Span { var start = 0, end = 0; var media = 0.0; var moving = false }
    private var spans = [Span](repeating: Span(), count: 64)
    private var cursor = 0, count = 0
    private(set) var frames = 0
    private var mediaEnd = 0.0
    func reset(origin: Double = 0) { cursor = 0; count = 0; frames = 0; mediaEnd = origin }
    @discardableResult func append(requested: Int, copied: Int, end: Double) -> Bool {
        guard requested >= 0, requested <= 8192, copied >= 0, copied <= requested,
              end.isFinite, end >= 0 else { return false }
        let start = end - Double(copied)
        guard copied == 0 || abs(start - mediaEnd) < 0.5 else { return false }
        if copied > 0 { add(length: copied, media: start, moving: true); mediaEnd = end }
        silence(frames: requested - copied)
        return true
    }
    func silence(frames: Int) { if frames > 0 { add(length: frames, media: mediaEnd, moving: false) } }
    private func add(length: Int, media: Double, moving: Bool) {
        if count > 0 {
            let last = (cursor + count - 1) % spans.count
            let expected = spans[last].media + (moving ? Double(spans[last].end - spans[last].start) : 0)
            if spans[last].moving == moving && abs(expected - media) < 0.5 {
                spans[last].end += length; frames += length; return
            }
        }
        if count == spans.count { cursor = (cursor + 1) % spans.count; count -= 1 }
        spans[(cursor + count) % spans.count] = Span(start: frames, end: frames + length, media: media, moving: moving)
        count += 1; frames += length
    }
    func media(at frame: Double) -> Double? {
        guard frame.isFinite, count > 0 else { return nil }
        for offset in 0..<count {
            let span = spans[(cursor + offset) % spans.count]
            if frame >= Double(span.start) && frame <= Double(span.end) {
                return span.media + (span.moving ? frame - Double(span.start) : 0)
            }
        }
        return nil
    }
}
