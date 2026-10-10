import AVFoundation

// NativeProfilePCM.swift — system decoding/resampling; the original analyser receives (L+R)/2 and (L-R)/2.
struct NativeProfilePCM {
    static let sampleRate = 22050.0
    static let maxFrames = 22050 * 20 * 60
    let mid: NSData
    let side: NSData?
    var frames: Int { mid.length / MemoryLayout<Float>.stride }

    // Runs only on the serial analysis actor. Never on the main thread or an audio render callback.
    static func decode(_ url: URL) throws -> NativeProfilePCM {
        guard url.isFileURL else { throw MobileFailure("profile-source-unavailable") }
        try Task.checkCancellation()
        let file = try AVAudioFile(forReading: url, commonFormat: .pcmFormatFloat32, interleaved: false)
        let source = file.processingFormat
        guard (1...2).contains(source.channelCount), source.sampleRate.isFinite, source.sampleRate > 0,
              Double(file.length) / source.sampleRate <= Double(maxFrames) / sampleRate,
              let target = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: source.channelCount),
              let converter = AVAudioConverter(from: source, to: target),
              let input = AVAudioPCMBuffer(pcmFormat: source, frameCapacity: 4096),
              let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: 4096) else {
            throw MobileFailure("profile-format-unavailable")
        }
        converter.sampleRateConverterQuality = AVAudioQuality.max.rawValue
        let mid = NSMutableData(), side: NSMutableData? = source.channelCount == 2 ? NSMutableData() : nil
        var midChunk = [Float](repeating: 0, count: 4096), sideChunk = midChunk
        var inputFailure: Error?
        var eof = false
        while !eof {
            try Task.checkCancellation()
            var failure: NSError?
            let status = converter.convert(to: output, error: &failure) { count, state in
                do {
                    try Task.checkCancellation()
                    // AVAudioFile can return false without NSError when asked to read past its known EOF.
                    guard file.framePosition < file.length else { state.pointee = .endOfStream; return nil }
                    try file.read(into: input, frameCount: min(count, input.frameCapacity))
                    state.pointee = input.frameLength == 0 ? .endOfStream : .haveData
                    return input.frameLength == 0 ? nil : input
                } catch { inputFailure = error; state.pointee = .endOfStream; return nil }
            }
            if let inputFailure { throw inputFailure }
            guard failure == nil, status != .error, let channels = output.floatChannelData else {
                throw MobileFailure("profile-decode-failed")
            }
            let count = Int(output.frameLength)
            guard mid.length / 4 + count <= maxFrames else { throw MobileFailure("profile-too-large") }
            for index in 0..<count {
                let left = Double(channels[0][index]), right = side == nil ? left : Double(channels[1][index])
                guard left.isFinite, right.isFinite, abs(left) <= 16, abs(right) <= 16 else {
                    throw MobileFailure("invalid-profile-input")
                }
                // Match the original Float32Array assignment after double-precision mid/side arithmetic.
                midChunk[index] = Float((left + right) / 2)
                sideChunk[index] = Float((left - right) / 2)
            }
            midChunk.withUnsafeBytes { mid.append($0.baseAddress!, length: count * 4) }
            if let side { sideChunk.withUnsafeBytes { side.append($0.baseAddress!, length: count * 4) } }
            eof = status == .endOfStream
            guard eof || count > 0 else { throw MobileFailure("profile-decode-stalled") }
        }
        return NativeProfilePCM(mid: mid, side: side)
    }
}
