import AVFoundation
import AudioStreaming

// NativeTempoFeed.swift — the same observed PCM contract for a decoder and a retained read-ahead window.
protocol NativeTempoFeed: AnyObject {
    var format: AVAudioFormat { get }
    var position: Double { get }
    var isSeeking: Bool { get }
    var isPaused: Bool { get }
    func read(frames: AVAudioFrameCount, output: UnsafeMutablePointer<AudioBufferList>,
              observation: UnsafeMutablePointer<AudioPlayer.ExternalAudioRead>) -> OSStatus
    func close()
}

final class DecoderTempoFeed: NativeTempoFeed {
    private var player: AudioPlayer?
    let format: AVAudioFormat
    var position: Double { player?.progress ?? 0 }
    var isSeeking: Bool { player?.isSeeking ?? false }
    var isPaused: Bool { player?.state == .paused }
    init(player: AudioPlayer) { self.player = player; format = player.externalOutputFormat }
    func read(frames: AVAudioFrameCount, output: UnsafeMutablePointer<AudioBufferList>,
              observation: UnsafeMutablePointer<AudioPlayer.ExternalAudioRead>) -> OSStatus {
        player?.renderExternalAudio(frames: frames, output: output, observation: observation) ?? kAudioUnitErr_Uninitialized
    }
    func close() { player = nil }
}
