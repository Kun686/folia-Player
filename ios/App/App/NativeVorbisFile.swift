import AVFoundation
import vorbis

// NativeVorbisFile.swift — approved libvorbisfile decoding into a seekable float CAF; original Ogg bytes are retained.
actor NativeVorbisFile {
    struct Decoded: Sendable {
        let duration: Double
        let frames: Int64
        let rate: Double
        let channels: Int
        let comments: [String]
    }

    func comments(_ input: URL) throws -> [String] {
        try Task.checkCancellation()
        guard input.isFileURL else { throw MobileFailure("unsupported-audio") }
        let values = try input.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true else { throw MobileFailure("unsupported-audio") }
        var file = OggVorbis_File()
        guard input.withUnsafeFileSystemRepresentation({ ov_fopen($0, &file) }) == 0 else { throw MobileFailure("unsupported-audio") }
        defer { ov_clear(&file) }
        guard ov_streams(&file) == 1 else { throw MobileFailure("unsupported-audio") }
        return try Self.comments(&file)
    }

    // Serial non-render work. No whole-song PCM allocation, lossy encoding, provider call or WebView.
    func decode(_ input: URL, output: URL, maximumBytes: Int64 = 1_073_741_824,
                timeout: Double = 120) throws -> Decoded {
        let deadline = ProcessInfo.processInfo.systemUptime + timeout
        func check() throws {
            try Task.checkCancellation()
            guard ProcessInfo.processInfo.systemUptime < deadline else { throw MobileFailure("local-decode-timeout") }
        }
        try check()
        guard input.isFileURL, output.isFileURL, input != output, !FileManager.default.fileExists(atPath: output.path),
              maximumBytes > 0 else { throw MobileFailure("unsupported-audio") }
        let attributes = try input.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard attributes.isRegularFile == true, attributes.isSymbolicLink != true else { throw MobileFailure("unsupported-audio") }
        var file = OggVorbis_File()
        guard input.withUnsafeFileSystemRepresentation({ ov_fopen($0, &file) }) == 0 else { throw MobileFailure("unsupported-audio") }
        defer { ov_clear(&file) }
        guard ov_streams(&file) == 1, let info = ov_info(&file, -1) else { throw MobileFailure("unsupported-audio") }
        let channels = Int(info.pointee.channels), rate = Double(info.pointee.rate), frames = ov_pcm_total(&file, -1)
        guard (1...2).contains(channels), rate >= 8000, rate <= 192000, frames > 0 else { throw MobileFailure("unsupported-audio") }
        guard frames <= (maximumBytes - min(maximumBytes, 4096)) / Int64(channels * 4),
              let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: AVAudioChannelCount(channels)),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096) else { throw MobileFailure("local-decoded-audio-too-large") }
        let comments = try Self.comments(&file)
        try check()
        var complete = false
        defer { if !complete { try? FileManager.default.removeItem(at: output) } }
        do {
            let writer = try AVAudioFile(forWriting: output, settings: format.settings)
            var written: Int64 = 0
            while true {
                try check()
                var pcm: UnsafeMutablePointer<UnsafeMutablePointer<Float>?>?, section: Int32 = 0
                let count = ov_read_float(&file, &pcm, 4096, &section)
                guard count >= 0, section == 0 else { throw MobileFailure("local-decode-failed") }
                if count == 0 { break }
                guard count <= 4096, Int64(count) <= frames - written, let pcm, let target = buffer.floatChannelData
                else { throw MobileFailure("local-decode-failed") }
                buffer.frameLength = AVAudioFrameCount(count)
                for channel in 0..<channels {
                    guard let source = pcm[channel] else { throw MobileFailure("local-decode-failed") }
                    guard UnsafeBufferPointer(start: source, count: count).allSatisfy({ $0.isFinite }) else { throw MobileFailure("local-decode-failed") }
                    target[channel].update(from: source, count: count)
                }
                try writer.write(from: buffer); written += Int64(count)
            }
            guard written == frames else { throw MobileFailure("local-decode-failed") }
        }
        try check()
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: output.path)
        complete = true
        return Decoded(duration: Double(frames) / rate, frames: frames, rate: rate, channels: channels, comments: comments)
    }

    private static func comments(_ file: inout OggVorbis_File) throws -> [String] {
        guard let tags = ov_comment(&file, -1), tags.pointee.comments >= 0, tags.pointee.comments <= 4096 else { throw MobileFailure("invalid-local-metadata") }
        var values: [String] = [], size = 0
        for index in 0..<Int(tags.pointee.comments) {
            try Task.checkCancellation()
            guard let lengths = tags.pointee.comment_lengths, let pointers = tags.pointee.user_comments,
                  let pointer = pointers[index] else { throw MobileFailure("invalid-local-metadata") }
            let length = Int(lengths[index])
            guard length >= 0, length <= 8_000_000 - size else { throw MobileFailure("invalid-local-metadata") }
            size += length
            let data = Data(bytes: pointer, count: length)
            guard let value = String(data: data, encoding: .utf8) else { throw MobileFailure("invalid-local-metadata") }
            values.append(value)
        }
        return values
    }
}
