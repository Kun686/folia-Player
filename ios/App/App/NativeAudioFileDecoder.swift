import AVFoundation

// NativeAudioFileDecoder.swift — existing system converter loop, shared by profiles and full stem material reads.
enum NativeAudioFileDecoder {
    // The consumer borrows a reused buffer synchronously. It must copy only the samples it needs.
    @discardableResult static func read(_ url: URL, rate: Double, maxFrames: Int, maxChannels: UInt32 = 2,
        domain: String, deadline: Double? = nil, consume: (AVAudioPCMBuffer) throws -> Void) throws -> Int {
        guard url.isFileURL else { throw MobileFailure(domain + "-source-unavailable") }
        try Task.checkCancellation()
        let file = try AVAudioFile(forReading: url, commonFormat: .pcmFormatFloat32, interleaved: false)
        let source = file.processingFormat
        guard source.channelCount > 0, source.channelCount <= maxChannels, source.sampleRate.isFinite, source.sampleRate > 0,
              rate.isFinite, rate > 0, maxFrames > 0,
              Double(file.length) / source.sampleRate <= Double(maxFrames) / rate else {
            throw MobileFailure(domain + "-format-unavailable")
        }
        let format: AVAudioFormat?
        // Apple's channel-count initializer only supports mono/stereo. Preserve the source layout for
        // multichannel files so stems take the original first two lanes instead of a stereo downmix.
        if source.channelCount > 2, let layout = source.channelLayout {
            format = AVAudioFormat(standardFormatWithSampleRate: rate, channelLayout: layout)
        } else { format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: source.channelCount) }
        guard let target = format,
              let converter = AVAudioConverter(from: source, to: target),
              let input = AVAudioPCMBuffer(pcmFormat: source, frameCapacity: 4096),
              let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: 4096) else {
            throw MobileFailure(domain + "-format-unavailable")
        }
        converter.sampleRateConverterQuality = AVAudioQuality.max.rawValue
        var inputFailure: Error?, eof = false, frames = 0
        func check() throws {
            try Task.checkCancellation()
            if let deadline, ProcessInfo.processInfo.systemUptime > deadline { throw MobileFailure(domain + "-timeout") }
        }
        while !eof {
            try check()
            var failure: NSError?
            let status = converter.convert(to: output, error: &failure) { count, state in
                do {
                    try check()
                    // AVAudioFile can return false without NSError when asked to read past its known EOF.
                    guard file.framePosition < file.length else { state.pointee = .endOfStream; return nil }
                    try file.read(into: input, frameCount: min(count, input.frameCapacity))
                    state.pointee = input.frameLength == 0 ? .endOfStream : .haveData
                    return input.frameLength == 0 ? nil : input
                } catch { inputFailure = error; state.pointee = .endOfStream; return nil }
            }
            if let inputFailure { throw inputFailure }
            guard failure == nil, status != .error, output.floatChannelData != nil else {
                throw MobileFailure(domain + "-decode-failed")
            }
            let count = Int(output.frameLength)
            guard count <= maxFrames - frames else { throw MobileFailure(domain + "-too-large") }
            try consume(output)
            frames += count
            eof = status == .endOfStream
            guard eof || count > 0 else { throw MobileFailure(domain + "-decode-stalled") }
        }
        try check()
        return frames
    }
}
