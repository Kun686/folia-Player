import Foundation

// PlaybackAudioSettings.swift — persist functional audio settings in native storage for background playback.
struct NativeEqualizerSlot: Codable {
    var gains: [Double]
    var effects: [String: Double]
}
struct NativeEqualizerSettings: Codable {
    static let neutral: [String: Double] = ["highpass": 20, "lowpass": 20000, "drive": 0, "crush": 0,
        "wow": 0, "noise": 0, "width": 1, "space": 0, "punch": 0]
    var enabled = false
    var gains = [Double](repeating: 0, count: 10)
    var preset = "flat"
    var effects = neutral
    var customSlots = [NativeEqualizerSlot](repeating: NativeEqualizerSlot(gains: [Double](repeating: 0, count: 10), effects: neutral), count: 2)
    func validate() throws {
        func validGains(_ values: [Double]) -> Bool { values.count == 10 && values.allSatisfy { $0.isFinite && abs($0) <= 12 } }
        func validEffects(_ values: [String: Double]) -> Bool {
            let bounds: [String: ClosedRange<Double>] = ["highpass": 20...2000, "lowpass": 500...20000,
                "drive": 0...1, "crush": 0...1, "wow": 0...1, "noise": 0...1, "width": 0...2, "space": 0...1, "punch": 0...1]
            return values.count == bounds.count && bounds.allSatisfy { key, range in
                guard let value = values[key] else { return false }; return value.isFinite && range.contains(value)
            }
        }
        guard validGains(gains), validEffects(effects), customSlots.count == 2,
              customSlots.allSatisfy({ validGains($0.gains) && validEffects($0.effects) }),
              ["flat", "lofi", "radio", "hall", "vocal", "bass", "custom1", "custom2"].contains(preset) else {
            throw MobileFailure("invalid-audio-settings")
        }
    }
}
struct NativeAudioSettings: Codable {
    static let audioQualities = ["standard", "high", "lossless", "hires"]
    var volume = 1.0
    var isMuted = false
    var equalizer = NativeEqualizerSettings()
    var replayGainMode = "off"
    var audioQuality = "standard"
    var playbackFadeEnabled = true
    var neteaseScrobbleEnabled = false
    private enum CodingKeys: String, CodingKey { case volume, isMuted, equalizer, replayGainMode, audioQuality, neteaseScrobbleEnabled, playbackFadeEnabled }
    init() {}
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        volume = try values.decode(Double.self, forKey: .volume)
        isMuted = try values.decode(Bool.self, forKey: .isMuted)
        equalizer = try values.decode(NativeEqualizerSettings.self, forKey: .equalizer)
        replayGainMode = try values.decodeIfPresent(String.self, forKey: .replayGainMode) ?? "off"
        playbackFadeEnabled = try values.decodeIfPresent(Bool.self, forKey: .playbackFadeEnabled) ?? true
        neteaseScrobbleEnabled = try values.decodeIfPresent(Bool.self, forKey: .neteaseScrobbleEnabled) ?? false
        audioQuality = try values.decodeIfPresent(String.self, forKey: .audioQuality) ?? "standard"
    }
    func validate() throws {
        guard volume.isFinite, (0...1).contains(volume), ["off", "track", "album"].contains(replayGainMode),
              Self.audioQualities.contains(audioQuality) else { throw MobileFailure("invalid-audio-settings") }
        try equalizer.validate()
    }
    var dictionary: [String: Any] {
        guard let data = try? JSONEncoder().encode(self),
              let result = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return [:] }
        return result
    }
}
extension PlaybackEngine {
    // Validate everything before touching the live player or persistence; a rejected edit is atomic.
    func setAudioSettings(_ values: [String: Any]) throws -> [String: Any] {
        let settings: NativeAudioSettings
        do { settings = try JSONDecoder().decode(NativeAudioSettings.self, from: JSONSerialization.data(withJSONObject: values)) }
        catch { throw MobileFailure("invalid-audio-settings") }
        try settings.validate()
        let data = try JSONEncoder().encode(settings)
        let qualityChanged = audioSettings.audioQuality != settings.audioQuality
        listening.setEnabled(settings.neteaseScrobbleEnabled)
        audioSettings = settings
        storage.set(data, forKey: "folia.audio")
        applyAudioSettings()
        if qualityChanged { refreshPreparedQuality() }
        return audioSettings.dictionary
    }
    // Keep audible decks and song-based caches; only unplayed online preparation follows a new preference.
    private func refreshPreparedQuality() {
        guard crossfade?.isFading != true else { return }
        promotePreparedItem()
        guard let next = nextIndex(automatic: true),
              let song = queue.indices.contains(next) ? queue[next] : detachedSong,
              (song["sourceRef"] as? [String: Any])?["kind"] as? String == "online" else { return }
        discardPrepared()
        prefetch()
    }
    func restoreAudioSettings() {
        if let data = storage.data(forKey: "folia.audio"), let saved = try? JSONDecoder().decode(NativeAudioSettings.self, from: data),
           (try? saved.validate()) != nil { audioSettings = saved }
        listening.setEnabled(audioSettings.neteaseScrobbleEnabled)
        applyAudioSettings()
    }
    func applyAudioSettings() {
        if usesStereoOutput { streamOutput?.apply(audioSettings); return }
        player.volume = Float(audioSettings.volume); player.isMuted = audioSettings.isMuted
        configureMeter(meter); configureMeter(prepared?.meter)
    }
    func configureMeter(_ meter: AudioMeter?) {
        meter?.setOutputGain(volume: audioSettings.volume, muted: audioSettings.isMuted)
        meter?.equalizer.configure(enabled: audioSettings.equalizer.enabled, gains: audioSettings.equalizer.gains)
        meter?.effects.configure(audioSettings.equalizer.enabled ? audioSettings.equalizer.effects : NativeEqualizerSettings.neutral)
    }
}
