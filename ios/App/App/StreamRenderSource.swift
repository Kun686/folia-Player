import AVFoundation
import AudioStreaming

// StreamRenderSource.swift — use the system source-node converter between decoder PCM and a shared mixer.
final class StreamRenderSource {
    let node: AVAudioSourceNode
    let format: AVAudioFormat
    let identity: UUID
    let capture: NativeDeckCapture
    let tempo: NativeTempoHandover?

    init(player: AudioPlayer, allowsTempo: Bool = false) throws {
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
        let tempo = allowsTempo ? try NativeTempoHandover(player: player) : nil
        self.tempo = tempo
        if let tempo {
            node = AVAudioSourceNode(format: player.externalOutputFormat) { silence, time, frames, output in
                let status = tempo.render(output, frames: frames)
                if status == noErr, time.pointee.mFlags.contains(.sampleTimeValid) {
                    capture.consume(output, frames: Int(frames), sampleTime: time.pointee.mSampleTime)
                }
                silence.pointee = ObjCBool(status != noErr)
                return status
            }
            return
        }
        // Block input is interleaved; the host must connect node OUTPUT with the standard format above.
        // AVAudioSourceNode performs PCM layout conversion. Its block retains the decoder until detached.
        node = AVAudioSourceNode(format: player.externalOutputFormat) { silence, time, frames, output in
            let status = player.renderExternalAudio(frames: frames, output: output)
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
