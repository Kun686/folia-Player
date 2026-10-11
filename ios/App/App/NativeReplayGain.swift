import AVFoundation

// NativeReplayGain.swift — bounded metadata conversion; playback rules remain in the original TS utility.
struct NativeReplayGainInfo: Sendable {
    let dictionary: [String: Double]
    init?(_ value: Any?) {
        guard let raw = value as? [String: Any] else { return nil }
        var fields: [String: Double] = [:]
        for key in ["trackGain", "trackPeak", "albumGain", "albumPeak"] {
            let number: Double?
            if let value = raw[key] as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID() { number = value.doubleValue }
            else if let value = raw[key] as? String { number = Double(value.trimmingCharacters(in: .whitespacesAndNewlines)) }
            else { number = nil }
            if let number, number.isFinite { fields[key] = number }
        }
        guard !fields.isEmpty else { return nil }
        dictionary = fields
    }

    // AVFoundation exposes ID3 TXXX descriptions in `info`. Other key spaces keep the tag in the key.
    // Match music-metadata's dB/power-ratio conversion used by the original metadata worker.
    static func read(_ metadata: [AVMetadataItem]) async -> NativeReplayGainInfo? {
        var values: [String: Double] = [:]
        let keys = ["replaygain_track_gain": "trackGain", "replaygain_track_peak": "trackPeak",
                    "replaygain_album_gain": "albumGain", "replaygain_album_peak": "albumPeak"]
        for item in metadata.prefix(4096) {
            if Task.isCancelled { return nil }
            let extra = try? await item.load(.extraAttributes)
            let names = [extra?[AVMetadataExtraAttributeKey(rawValue: "info")] as? String,
                         item.key as? String, item.identifier?.rawValue].compactMap { $0?.lowercased() }
            guard let tag = keys.keys.first(where: { key in names.contains { $0 == key || $0.hasSuffix(":" + key) || $0.hasSuffix("/" + key) } }),
                  let field = keys[tag], let text = try? await item.load(.stringValue), text.count <= 128 else { continue }
            let parts = text.components(separatedBy: " ").map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            guard let first = parts.first, let value = Scanner(string: first).scanDouble(), value.isFinite else { continue }
            let inDB = parts.count == 2 && parts[1] == "db"
            let converted = field.hasSuffix("Gain") ? (inDB ? value : 10 * log10(value)) : (inDB ? pow(10, value / 10) : value)
            if converted.isFinite { values[field] = converted }
        }
        return NativeReplayGainInfo(values)
    }
}

struct NativeReplayGainLevels: Decodable, Sendable {
    let track: Double, album: Double
    static let neutral = NativeReplayGainLevels(track: 1, album: 1)
    func value(_ mode: String) -> Double { mode == "track" ? track : mode == "album" ? album : 1 }
}

struct NativeAudioSource {
    let url: URL
    var replayGain: NativeReplayGainInfo? = nil
}

// One ramp per occurrence, before deck analysis/trim/transition EQ. The render thread never waits.
final class StreamReplayGain {
    private let lock = NSLock()
    private let levels: NativeReplayGainLevels
    private let rampFrames: Int
    private var requested: Double, published: Double, requestedFrom = 1.0
    private var target: Double, current: Double, step = 0.0
    private var remaining = 0
    init(levels: NativeReplayGainLevels, mode: String, rate: Double) {
        self.levels = levels; rampFrames = max(1, Int(rate * 0.1))
        let value = levels.value(mode)
        requested = value; published = 1; target = 1; current = 1
    }
    func configure(_ mode: String) {
        lock.withLock {
            let value = levels.value(mode)
            if requested != value { requested = value; requestedFrom = published }
        }
    }
    var amplitude: Double { lock.withLock { published } }
    func process(_ audio: UnsafeMutablePointer<AudioBufferList>, frames: Int) {
        if lock.try() {
            if requested != target {
                // AudioParam.value is the last rendered sample when the control action runs.
                current = requestedFrom
                target = requested; remaining = rampFrames; step = (target - current) / Double(rampFrames)
            }
            lock.unlock()
        }
        let buffers = UnsafeMutableAudioBufferListPointer(audio)
        guard frames > 0, buffers.count == 1, buffers[0].mNumberChannels == 2,
              Int(buffers[0].mDataByteSize) / MemoryLayout<Float>.size >= frames * 2,
              let data = buffers[0].mData?.assumingMemoryBound(to: Float.self) else { return }
        var last = current
        if current != 1 || remaining > 0 {
            for frame in 0..<frames {
                let gain = Float(current)
                last = Double(gain)
                data[frame * 2] *= gain; data[frame * 2 + 1] *= gain
                if remaining > 0 {
                    remaining -= 1; current = remaining == 0 ? target : current + step
                }
            }
        }
        if lock.try() { published = last; lock.unlock() }
    }
}
