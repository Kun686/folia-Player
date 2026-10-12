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
        let mid = NSMutableData()
        var side: NSMutableData?
        var midChunk = [Float](repeating: 0, count: 4096), sideChunk = midChunk
        try NativeAudioFileDecoder.read(url, rate: sampleRate, maxFrames: maxFrames, domain: "profile") { output in
            guard let channels = output.floatChannelData else {
                throw MobileFailure("profile-decode-failed")
            }
            if output.format.channelCount == 2 && side == nil { side = NSMutableData() }
            let count = Int(output.frameLength)
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
        }
        return NativeProfilePCM(mid: mid, side: side)
    }
}
