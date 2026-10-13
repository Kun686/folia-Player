import AVFoundation
import CoreVideo
import Foundation

// video-layer-fixture.swift — a silent generated H.264 loop for offline browser/device QA; no external media.
guard CommandLine.arguments.count == 2 else { throw NSError(domain: "VideoFixtureUsage", code: 1) }
let output = URL(fileURLWithPath: CommandLine.arguments[1])
guard !FileManager.default.fileExists(atPath: output.path) else { throw NSError(domain: "VideoFixtureExists", code: 1) }
var complete = false
defer { if !complete { try? FileManager.default.removeItem(at: output) } }
let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
let width = 96, height = 64
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width, AVVideoHeightKey: height, AVVideoCompressionPropertiesKey: [AVVideoMaxKeyFrameIntervalKey: 12]])
let pixels = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
    kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height])
guard writer.canAdd(input) else { throw NSError(domain: "VideoFixtureWriter", code: 1) }
writer.add(input); writer.shouldOptimizeForNetworkUse = true
guard writer.startWriting() else { throw writer.error ?? NSError(domain: "VideoFixtureStart", code: 1) }
writer.startSession(atSourceTime: .zero)
let deadline = Date().addingTimeInterval(20)
for frame in 0..<96 {
    while !input.isReadyForMoreMediaData {
        guard writer.status == .writing, Date() < deadline else { writer.cancelWriting(); throw NSError(domain: "VideoFixtureDeadline", code: 1) }
        try await Task.sleep(nanoseconds: 1_000_000)
    }
    var optional: CVPixelBuffer?
    guard let pool = pixels.pixelBufferPool, CVPixelBufferPoolCreatePixelBuffer(nil, pool, &optional) == kCVReturnSuccess,
          let buffer = optional else { throw NSError(domain: "VideoFixtureBuffer", code: 1) }
    CVPixelBufferLockBaseAddress(buffer, [])
    guard let address = CVPixelBufferGetBaseAddress(buffer) else { throw NSError(domain: "VideoFixtureAddress", code: 1) }
    let bytes = address.assumingMemoryBound(to: UInt8.self), row = CVPixelBufferGetBytesPerRow(buffer)
    for y in 0..<height { for x in 0..<width {
        let offset = y * row + x * 4
        bytes[offset] = 255; bytes[offset + 1] = UInt8(frame * 2)
        bytes[offset + 2] = UInt8(x * 2); bytes[offset + 3] = UInt8(y * 3)
    } }
    CVPixelBufferUnlockBaseAddress(buffer, [])
    guard pixels.append(buffer, withPresentationTime: CMTime(value: Int64(frame), timescale: 24)) else {
        throw writer.error ?? NSError(domain: "VideoFixtureAppend", code: 1)
    }
}
input.markAsFinished()
await writer.finishWriting()
guard writer.status == .completed else { throw writer.error ?? NSError(domain: "VideoFixtureFinish", code: 1) }
complete = true
print("Generated four-second silent video fixture")
