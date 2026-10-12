import AVFoundation
import AudioStreaming
import Accelerate

// StreamRenderSource.swift — adapt decoder PCM to the shared mixer's format on its unchanged host clock.
final class StreamRenderSource {
    let node: AVAudioSourceNode
    let format: AVAudioFormat
    let identity: UUID
    let capture: NativeDeckCapture
    let tempo: NativeTempoHandover?
    let replayGain: StreamReplayGain

    init(player: AudioPlayer, allowsTempo: Bool = false, replayGain levels: NativeReplayGainLevels = .neutral, mode: String = "off") throws {
        guard player.externalOutputFormat.commonFormat == .pcmFormatFloat32,
              player.externalOutputFormat.isInterleaved, player.externalOutputFormat.channelCount == 2,
              let format = AVAudioFormat(standardFormatWithSampleRate: player.externalOutputFormat.sampleRate, channels: 2) else {
            throw MobileFailure("unsupported-audio-format")
        }
        self.format = format
        let identity = UUID(), rate = format.sampleRate
        let replayGain = StreamReplayGain(levels: levels, mode: mode, rate: rate)
        self.replayGain = replayGain
        self.identity = identity
        let capture = NativeDeckCapture(rate: rate)
        self.capture = capture
        let tempo = allowsTempo ? try NativeTempoHandover(player: player, usesHostClock: true) : nil
        self.tempo = tempo
        if let tempo {
            node = try NativeStereoSource.make(rate: rate) { silence, time, frames, output in
                let status = tempo.render(output, frames: frames,
                    sampleTime: time.pointee.mFlags.contains(.sampleTimeValid) ? time.pointee.mSampleTime : nil)
                if status == noErr { replayGain.process(output, frames: Int(frames)) }
                if status == noErr, time.pointee.mFlags.contains(.sampleTimeValid) {
                    capture.consume(output, frames: Int(frames), sampleTime: time.pointee.mSampleTime)
                }
                silence.pointee = ObjCBool(status != noErr)
                return status
            }
            return
        }
        // Decoder input is interleaved; the node OUTPUT uses the standard format above.
        // The explicit layout adapter retains the decoder until detached, without a source-node converter.
        node = try NativeStereoSource.make(rate: rate) { silence, time, frames, output in
            let status = player.renderExternalAudio(frames: frames, output: output)
            if status == noErr { replayGain.process(output, frames: Int(frames)) }
            if status == noErr, time.pointee.mFlags.contains(.sampleTimeValid) {
                capture.consume(output, frames: Int(frames), sampleTime: time.pointee.mSampleTime)
            }
            silence.pointee = ObjCBool(status != noErr)
            return status
        }
    }
    // Call after detaching the node and stopping its pulls; the retained wrapper then owns no decoder.
    func close() { tempo?.close() }
}

// Source callbacks and downstream inserts must share the same format and timestamp domain.
// Reuse the deck processor's lossless Accelerate layout conversion, with storage allocated on control.
enum NativeStereoSource {
    static func make(rate: Double, render: @escaping AVAudioSourceNodeRenderBlock) throws -> AVAudioSourceNode {
        guard AudioEffectSources.validRate(rate),
              let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2),
              let interleaved = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 2, interleaved: true),
              let scratch = AVAudioPCMBuffer(pcmFormat: interleaved, frameCapacity: 8192) else {
            throw MobileFailure("unsupported-audio-format")
        }
        return AVAudioSourceNode(format: format) { silence, timestamp, frames, output in
            let buffers = UnsafeMutableAudioBufferListPointer(output)
            func clear() {
                for buffer in buffers {
                    if let data = buffer.mData { memset(data, 0, Int(buffer.mDataByteSize)) }
                }
                silence.pointee = true
            }
            guard frames > 0, frames <= scratch.frameCapacity, buffers.count == 2,
                  buffers.allSatisfy({ $0.mNumberChannels == 1 && $0.mData != nil && $0.mDataByteSize >= frames * 4 }) else {
                clear(); return kAudioUnitErr_InvalidParameter
            }
            scratch.frameLength = frames
            let status = render(silence, timestamp, frames, scratch.mutableAudioBufferList)
            guard status == noErr, !silence.pointee.boolValue else { clear(); return status }
            var channels = DSPSplitComplex(realp: buffers[0].mData!.assumingMemoryBound(to: Float.self),
                                          imagp: buffers[1].mData!.assumingMemoryBound(to: Float.self))
            scratch.floatChannelData![0].withMemoryRebound(to: DSPComplex.self, capacity: Int(frames)) {
                vDSP_ctoz($0, 2, &channels, 1, vDSP_Length(frames))
            }
            return noErr
        }
    }
}
