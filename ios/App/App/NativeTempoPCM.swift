import AVFoundation
import AudioStreaming

// NativeTempoPCM.swift — bounded stereo PCM history shared by raw playback and the warming converter.
// Only the enclosing render owner accesses cursors and sample storage; reset/close require stopped pulls.
final class NativeTempoPCM {
    static let capacity = 32768
    let source: NativeTempoFeed
    let format: AVAudioFormat
    private let storage: AVAudioPCMBuffer, scratch: AVAudioPCMBuffer
    private(set) var origin: Double
    private(set) var end = 0
    private(set) var eof = false
    var start: Int { max(0, end - Self.capacity) }
    init(source: NativeTempoFeed) throws {
        format = source.format; self.source = source; origin = source.position
        guard format.commonFormat == .pcmFormatFloat32, format.isInterleaved, format.channelCount == 2,
              origin.isFinite, origin >= 0,
              let storage = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(Self.capacity)),
              let scratch = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 8192) else {
            throw MobileFailure("unsupported-audio-format")
        }
        self.storage = storage; self.scratch = scratch
    }
    func reset() { end = 0; eof = false; origin = source.position }
    func close() { source.close() }
    func position(_ cursor: Int) -> Double { origin + Double(cursor) / format.sampleRate }

    func read(cursor: inout Int, frames: AVAudioFrameCount, output: UnsafeMutablePointer<AudioBufferList>,
              observation: UnsafeMutablePointer<AudioPlayer.ExternalAudioRead>) -> OSStatus {
        observation.pointee = AudioPlayer.ExternalAudioRead()
        let list = UnsafeMutableAudioBufferListPointer(output), count = Int(frames)
        guard count > 0, count <= 8192, cursor >= start, cursor <= end,
              list.count == 1, list[0].mNumberChannels == 2, list[0].mDataByteSize >= frames * 8,
              let destination = list[0].mData else { return kAudioUnitErr_InvalidParameter }
        guard !source.isSeeking else { return kAudioUnitErr_CannotDoInCurrentContext }
        if end - cursor < count && !eof {
            let status = fetch(count - (end - cursor))
            guard status == noErr else { return status }
        }
        let copied = min(count, end - cursor), offset = cursor % Self.capacity
        let first = min(copied, Self.capacity - offset), pcm = storage.floatChannelData![0]
        memcpy(destination, pcm + offset * 2, first * 8)
        if copied > first { memcpy(destination + first * 8, pcm, (copied - first) * 8) }
        if copied < count { memset(destination + copied * 8, 0, (count - copied) * 8) }
        cursor += copied
        observation.pointee.frames = AVAudioFrameCount(copied)
        observation.pointee.position = position(cursor)
        observation.pointee.endOfStream = eof && cursor == end
        return noErr
    }
    private func fetch(_ count: Int) -> OSStatus {
        scratch.frameLength = AVAudioFrameCount(count)
        var read = AudioPlayer.ExternalAudioRead()
        let status = source.read(frames: AVAudioFrameCount(count), output: scratch.mutableAudioBufferList, observation: &read)
        guard status == noErr else { return status }
        let copied = Int(read.frames)
        guard !read.discontinuity, copied <= count, read.position.isFinite, read.position >= 0 else {
            return kAudioUnitErr_CannotDoInCurrentContext
        }
        if copied > 0 {
            let began = read.position - Double(copied) / format.sampleRate
            if end == 0 { origin = began }
            guard abs(began - position(end)) * format.sampleRate < 0.5 else { return kAudioUnitErr_CannotDoInCurrentContext }
            let offset = end % Self.capacity, first = min(copied, Self.capacity - offset)
            let target = storage.floatChannelData![0], data = scratch.floatChannelData![0]
            memcpy(target + offset * 2, data, first * 8)
            if copied > first { memcpy(target, data + first * 2, (copied - first) * 8) }
            end += copied
        }
        eof = read.endOfStream
        return noErr
    }
}

final class CachedTempoFeed: NativeTempoFeed {
    private var window: NativeTempoPCM?
    let format: AVAudioFormat
    var cursor = 0
    var underflow = false
    var position: Double { window?.position(cursor) ?? 0 }
    var isSeeking: Bool { window?.source.isSeeking ?? false }
    var isPaused: Bool { window?.source.isPaused ?? false }
    init(window: NativeTempoPCM) { self.window = window; format = window.format }
    func read(frames: AVAudioFrameCount, output: UnsafeMutablePointer<AudioBufferList>,
              observation: UnsafeMutablePointer<AudioPlayer.ExternalAudioRead>) -> OSStatus {
        guard let window else { return kAudioUnitErr_Uninitialized }
        let status = window.read(cursor: &cursor, frames: frames, output: output, observation: observation)
        if status == noErr, observation.pointee.frames < frames, !observation.pointee.endOfStream { underflow = true }
        return status
    }
    func close() { window = nil }
}
