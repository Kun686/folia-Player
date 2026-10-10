import AVFoundation
import AudioStreaming

// StreamRenderSource.swift — use the system source-node converter between decoder PCM and a shared mixer.
final class StreamRenderSource {
    let node: AVAudioSourceNode
    let format: AVAudioFormat

    init(player: AudioPlayer) throws {
        guard player.externalOutputFormat.commonFormat == .pcmFormatFloat32,
              player.externalOutputFormat.isInterleaved, player.externalOutputFormat.channelCount == 2,
              let format = AVAudioFormat(standardFormatWithSampleRate: player.externalOutputFormat.sampleRate, channels: 2) else {
            throw MobileFailure("unsupported-audio-format")
        }
        self.format = format
        // Block input is interleaved; the host must connect node OUTPUT with the standard format above.
        // AVAudioSourceNode performs PCM layout conversion. Its block retains the decoder until detached.
        node = AVAudioSourceNode(format: player.externalOutputFormat) { silence, _, frames, output in
            let status = player.renderExternalAudio(frames: frames, output: output)
            silence.pointee = ObjCBool(status != noErr)
            return status
        }
    }
}
