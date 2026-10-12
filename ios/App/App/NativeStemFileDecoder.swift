import AVFoundation
import AudioToolbox

// NativeStemFileDecoder.swift — one system decode/resample operation preserves compressed priming and tail samples.
enum NativeStemFileDecoder {
    // AVAudioFile PCM followed by a second converter loses the encoded tail before the resampler sees it.
    // Feed original packets to AudioConverter, using the file's priming metadata and its default SRC quality.
    static func read(_ url: URL, deadline: Double, consume: (AVAudioPCMBuffer) throws -> Void) throws -> Int {
        guard url.isFileURL else { throw MobileFailure("stem-source-unavailable") }
        try check(deadline)
        let metadata = try AVAudioFile(forReading: url, commonFormat: .pcmFormatFloat32, interleaved: false)
        // At the model rate there is no SRC boundary to preserve. Keep the existing exact decode path.
        if metadata.processingFormat.sampleRate == NativeStemPCM.rate {
            return try NativeAudioFileDecoder.read(url, rate: NativeStemPCM.rate, maxFrames: 4_503_599_627_370_495,
                maxChannels: 32, domain: "stem", deadline: deadline, consume: consume)
        }
        var file: AudioFileID?
        guard AudioFileOpenURL(url as CFURL, .readPermission, 0, &file) == noErr, let file else {
            throw MobileFailure("stem-decode-failed")
        }
        defer { AudioFileClose(file) }
        var source = AudioStreamBasicDescription(), size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        guard AudioFileGetProperty(file, kAudioFilePropertyDataFormat, &size, &source) == noErr,
              source.mSampleRate.isFinite, source.mSampleRate > 0, (1...32).contains(source.mChannelsPerFrame),
              metadata.length > 0 else { throw MobileFailure("stem-format-unavailable") }
        let target: AVAudioFormat?
        if source.mChannelsPerFrame > 2, let layout = metadata.processingFormat.channelLayout {
            target = AVAudioFormat(standardFormatWithSampleRate: NativeStemPCM.rate, channelLayout: layout)
        } else { target = AVAudioFormat(standardFormatWithSampleRate: NativeStemPCM.rate, channels: source.mChannelsPerFrame) }
        guard let target, let buffer = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: 4096) else {
            throw MobileFailure("stem-format-unavailable")
        }
        let length = (Double(metadata.length) * NativeStemPCM.rate / source.mSampleRate).rounded()
        guard length > 0, length <= 4_503_599_627_370_495 else { throw MobileFailure("stem-too-large") }
        let expected = Int(length)
        var output = target.streamDescription.pointee, converter: AudioConverterRef?
        guard AudioConverterNew(&source, &output, &converter) == noErr, let converter else {
            throw MobileFailure("stem-format-unavailable")
        }
        defer { AudioConverterDispose(converter) }
        try copyProperty(file, from: kAudioFilePropertyMagicCookieData, to: kAudioConverterDecompressionMagicCookie, converter: converter)
        try copyProperty(file, from: kAudioFilePropertyChannelLayout, to: kAudioConverterInputChannelLayout, converter: converter)
        try copyProperty(file, from: kAudioFilePropertyChannelLayout, to: kAudioConverterOutputChannelLayout, converter: converter)
        var table = AudioFilePacketTableInfo(), tableSize = UInt32(MemoryLayout<AudioFilePacketTableInfo>.size)
        if AudioFileGetProperty(file, kAudioFilePropertyPacketTableInfo, &tableSize, &table) == noErr {
            guard table.mPrimingFrames >= 0, table.mRemainderFrames >= 0 else { throw MobileFailure("stem-format-unavailable") }
            var prime = AudioConverterPrimeInfo(leadingFrames: UInt32(table.mPrimingFrames), trailingFrames: UInt32(table.mRemainderFrames))
            guard AudioConverterSetProperty(converter, kAudioConverterPrimeInfo, UInt32(MemoryLayout<AudioConverterPrimeInfo>.size), &prime) == noErr else {
                throw MobileFailure("stem-format-unavailable")
            }
        }
        let packets = try Packets(file: file, source: source, deadline: deadline)
        var frames = 0
        while true {
            try check(deadline)
            buffer.frameLength = buffer.frameCapacity
            var count = buffer.frameCapacity
            let status = AudioConverterFillComplexBuffer(converter, input, Unmanaged.passUnretained(packets).toOpaque(),
                &count, buffer.mutableAudioBufferList, nil)
            if let error = packets.error { throw error }
            guard status == noErr, count <= buffer.frameCapacity else { throw MobileFailure("stem-decode-failed") }
            if count == 0 { break }
            let valid = min(Int(count), expected - frames)
            if valid > 0 {
                buffer.frameLength = AVAudioFrameCount(valid)
                try consume(buffer); frames += valid
            }
        }
        try check(deadline)
        guard frames == expected else { throw MobileFailure("stem-decode-truncated") }
        return frames
    }

    private static func check(_ deadline: Double) throws {
        try Task.checkCancellation()
        guard ProcessInfo.processInfo.systemUptime <= deadline else { throw MobileFailure("stem-timeout") }
    }

    private static func copyProperty(_ file: AudioFileID, from: AudioFilePropertyID, to: AudioConverterPropertyID,
                                     converter: AudioConverterRef) throws {
        var size: UInt32 = 0
        guard AudioFileGetPropertyInfo(file, from, &size, nil) == noErr, size > 0 else { return }
        guard size <= 1_048_576 else { throw MobileFailure("stem-format-unavailable") }
        let bytes = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: 16)
        defer { bytes.deallocate() }
        guard AudioFileGetProperty(file, from, &size, bytes) == noErr,
              AudioConverterSetProperty(converter, to, size, bytes) == noErr else { throw MobileFailure("stem-format-unavailable") }
    }

    private final class Packets {
        let file: AudioFileID, channels: UInt32, capacity: UInt32, bytes: UnsafeMutableRawPointer
        let descriptions: UnsafeMutablePointer<AudioStreamPacketDescription>, deadline: Double
        let variablePackets: Bool
        var position: Int64 = 0, error: Error?
        init(file: AudioFileID, source: AudioStreamBasicDescription, deadline: Double) throws {
            self.file = file; self.channels = source.mChannelsPerFrame; self.deadline = deadline
            variablePackets = source.mBytesPerPacket == 0 || source.mFramesPerPacket == 0
            var largest: UInt32 = 0, size = UInt32(MemoryLayout<UInt32>.size)
            guard AudioFileGetProperty(file, kAudioFilePropertyMaximumPacketSize, &size, &largest) == noErr,
                  largest > 0, largest <= 1_048_576 else { throw MobileFailure("stem-format-unavailable") }
            capacity = min(4096, 1_048_576 / largest)
            bytes = .allocate(byteCount: 1_048_576, alignment: 16)
            descriptions = .allocate(capacity: Int(capacity))
        }
        deinit { descriptions.deallocate(); bytes.deallocate() }
    }

    private static let input: AudioConverterComplexInputDataProc = { _, count, buffers, descriptions, opaque in
        guard let opaque else { return kAudioConverterErr_UnspecifiedError }
        let packets = Unmanaged<Packets>.fromOpaque(opaque).takeUnretainedValue()
        do {
            try check(packets.deadline)
            var bytes: UInt32 = 1_048_576
            count.pointee = min(count.pointee, packets.capacity)
            let packetDescriptions = packets.variablePackets ? packets.descriptions : nil
            let status = AudioFileReadPacketData(packets.file, false, &bytes, packetDescriptions, packets.position, &count.pointee, packets.bytes)
            guard status == noErr || status == kAudioFileEndOfFileError else { throw MobileFailure("stem-decode-failed") }
            packets.position += Int64(count.pointee)
            buffers.pointee.mNumberBuffers = 1
            buffers.pointee.mBuffers = AudioBuffer(mNumberChannels: packets.channels, mDataByteSize: bytes, mData: packets.bytes)
            descriptions?.pointee = packetDescriptions
            return noErr
        } catch {
            packets.error = error; count.pointee = 0
            return kAudioConverterErr_UnspecifiedError
        }
    }
}
