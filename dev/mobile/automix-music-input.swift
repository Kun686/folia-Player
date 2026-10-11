import AVFoundation
import CryptoKit
import Foundation

// dev/mobile/automix-music-input.swift — bounded real-music fixture extraction, independent of the App.
// Decode/resample with the system afconvert first; this preserves the selected 44.1kHz stereo window.
enum FixtureError: Error { case invalidArguments, invalidFormat, invalidWindow, existingOutput, invalidPCM }

func main() throws {
    let args = CommandLine.arguments
    guard args.count == 4 else { throw FixtureError.invalidArguments }
    let sourceURL = URL(fileURLWithPath: args[1])
    let outputURL = URL(fileURLWithPath: args[3])
    let reportURL = outputURL.appendingPathExtension("json")
    guard !FileManager.default.fileExists(atPath: outputURL.path),
          !FileManager.default.fileExists(atPath: reportURL.path) else { throw FixtureError.existingOutput }
    let file = try AVAudioFile(forReading: sourceURL, commonFormat: .pcmFormatFloat32, interleaved: false)
    let format = file.processingFormat
    guard format.sampleRate == 44100, format.channelCount == 2 else { throw FixtureError.invalidFormat }
    let frames = AVAudioFrameCount(30 * 44100)
    let start: AVAudioFramePosition
    if args[2] == "tail" { start = file.length - AVAudioFramePosition(frames) }
    else {
        guard let seconds = Double(args[2]), seconds.isFinite, seconds >= 0,
              seconds <= Double(file.length) / format.sampleRate else { throw FixtureError.invalidWindow }
        start = AVAudioFramePosition((seconds * format.sampleRate).rounded())
    }
    guard start >= 0, start <= file.length - AVAudioFramePosition(frames),
          let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { throw FixtureError.invalidWindow }
    file.framePosition = start
    try file.read(into: pcm, frameCount: frames)
    guard pcm.frameLength == frames, let channels = pcm.floatChannelData else { throw FixtureError.invalidPCM }
    var data = Data(capacity: Int(frames) * 8)
    var peak = 0.0, squared = 0.0
    // Serialize planar little-endian float32, the original htdemucs input contract.
    for channel in 0..<2 {
        for frame in 0..<Int(frames) {
            let value = channels[channel][frame]
            guard value.isFinite, abs(value) <= 16 else { throw FixtureError.invalidPCM }
            peak = max(peak, abs(Double(value))); squared += Double(value) * Double(value)
            var bits = value.bitPattern.littleEndian
            withUnsafeBytes(of: &bits) { data.append(contentsOf: $0) }
        }
    }
    let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    let report: [String: Any] = ["sampleRate": 44100, "shape": [2, Int(frames)], "sourceFrames": file.length,
        "startFrame": start, "startSeconds": Double(start) / 44100, "frames": frames, "bytes": data.count,
        "sha256": hash, "peak": peak, "rms": sqrt(squared / Double(frames * 2)),
        "decoder": "AVFoundation float32; input required to be stereo 44100 Hz"]
    let json = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
    try data.write(to: outputURL, options: [.withoutOverwriting])
    do { try json.write(to: reportURL, options: [.withoutOverwriting]) }
    catch { try? FileManager.default.removeItem(at: outputURL); throw error }
    print(String(decoding: json, as: UTF8.self))
}

do { try main() }
catch {
    fputs("Fixture extraction failed: \(error)\nusage: extract decoded-44100-stereo-file start-seconds|tail NEW-output.f32\n", stderr)
    exit(1)
}
