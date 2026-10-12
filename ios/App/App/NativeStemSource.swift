import AVFoundation

// NativeStemSource.swift — permanently silent until an atomic stem command reaches the shared audio clock.
final class NativeStemSource {
    let node: AVAudioSourceNode
    let format = AVAudioFormat(standardFormatWithSampleRate: NativeStemPCM.rate, channels: 2)!

    init(gain: TransitionGain) {
        let input = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: NativeStemPCM.rate,
                                  channels: 2, interleaved: true)!
        node = AVAudioSourceNode(format: input) { silence, timestamp, frames, output in
            guard timestamp.pointee.mFlags.contains(.sampleTimeValid),
                  gain.processStems(output, frames: Int(frames), sampleTime: timestamp.pointee.mSampleTime) else {
                for buffer in UnsafeMutableAudioBufferListPointer(output) {
                    if let data = buffer.mData { memset(data, 0, Int(buffer.mDataByteSize)) }
                }
                silence.pointee = true
                return kAudioUnitErr_InvalidParameter
            }
            silence.pointee = false
            return noErr
        }
    }
}
