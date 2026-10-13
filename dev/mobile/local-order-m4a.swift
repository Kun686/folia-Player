import AVFoundation
import Foundation

// local-order-m4a.swift — offline test fixture only; export real AAC metadata with the system encoder.
let output = URL(fileURLWithPath: CommandLine.arguments[1])
let input = output.deletingPathExtension().appendingPathExtension("wav")
do {
    let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4410)!
    buffer.frameLength = 4410
    for channel in 0..<2 { buffer.floatChannelData![channel].initialize(repeating: 0, count: 4410) }
    let file = try AVAudioFile(forWriting: input, settings: format.settings)
    try file.write(from: buffer)
}
defer { try? FileManager.default.removeItem(at: input) }
let export = AVAssetExportSession(asset: AVURLAsset(url: input), presetName: AVAssetExportPresetAppleM4A)!
export.metadata = [(AVMetadataIdentifier.iTunesMetadataTrackNumber, Data([0, 0, 0, 2, 0, 12, 0, 0])),
                   (.iTunesMetadataDiscNumber, Data([0, 0, 0, 3, 0, 4]))].map { identifier, bytes in
    let item = AVMutableMetadataItem(); item.identifier = identifier; item.value = bytes as NSData; return item
}
export.outputURL = output; export.outputFileType = .m4a
await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in export.exportAsynchronously { continuation.resume() } }
guard export.status == .completed else { throw export.error ?? NSError(domain: "FoliaFixture", code: 1) }
print("Exported offline track/disc M4A fixture")
