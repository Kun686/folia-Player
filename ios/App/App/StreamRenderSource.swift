import AVFoundation
import AudioStreaming

// StreamRenderSource.swift — use the system source-node converter between decoder PCM and a shared mixer.
final class StreamRenderSource {
    let node: AVAudioSourceNode
    let format: AVAudioFormat
    let identity: UUID
    let capture: NativeDeckCapture

    init(player: AudioPlayer, gain: TransitionGain? = nil) throws {
        guard player.externalOutputFormat.commonFormat == .pcmFormatFloat32,
              player.externalOutputFormat.isInterleaved, player.externalOutputFormat.channelCount == 2,
              let format = AVAudioFormat(standardFormatWithSampleRate: player.externalOutputFormat.sampleRate, channels: 2) else {
            throw MobileFailure("unsupported-audio-format")
        }
        self.format = format
        let identity = UUID(), rate = format.sampleRate
        self.identity = identity
        let capture = NativeDeckCapture(rate: rate)
        self.capture = capture
        let tone = TransitionTone()
        // Block input is interleaved; the host must connect node OUTPUT with the standard format above.
        // AVAudioSourceNode performs PCM layout conversion. Its block retains the decoder until detached.
        node = AVAudioSourceNode(format: player.externalOutputFormat) { silence, time, frames, output in
            let status = player.renderExternalAudio(frames: frames, output: output)
            if status == noErr, time.pointee.mFlags.contains(.sampleTimeValid) {
                capture.consume(output, frames: Int(frames), sampleTime: time.pointee.mSampleTime)
            }
            if status == noErr, let gain,
               (!time.pointee.mFlags.contains(.sampleTimeValid)
                || !gain.process(output, frames: Int(frames), sampleTime: time.pointee.mSampleTime, rate: rate, source: identity, tone: tone)) {
                for buffer in UnsafeMutableAudioBufferListPointer(output) {
                    if let data = buffer.mData { memset(data, 0, Int(buffer.mDataByteSize)) }
                }
                silence.pointee = true
                return kAudioUnitErr_InvalidParameter
            }
            silence.pointee = ObjCBool(status != noErr)
            return status
        }
    }
}
