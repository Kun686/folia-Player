import Foundation

// PlaybackLyricSettings.swift — native preference keeps foreground and suspended-WebView lyric selection aligned.
struct NativeLyricSettings: Codable {
    var localLyricsPriority = "local"
    // Absence is a migration marker. Do not enable background searches before restoring the user's Web choices.
    var autoUseBestLyric: Bool?
    var preferredAlternativeLyricSource: String?
    func validate() throws {
        guard ["local", "online"].contains(localLyricsPriority),
              preferredAlternativeLyricSource == nil || ["qq", "netease", "kugou", "amll"].contains(preferredAlternativeLyricSource!) else { throw MobileFailure("invalid-lyric-settings") }
    }
    var dictionary: [String: Any] {
        var result: [String: Any] = ["localLyricsPriority": localLyricsPriority]
        if let autoUseBestLyric { result["autoUseBestLyric"] = autoUseBestLyric }
        if let preferredAlternativeLyricSource { result["preferredAlternativeLyricSource"] = preferredAlternativeLyricSource }
        return result
    }
}

extension PlaybackEngine {
    func setLyricSettings(_ values: [String: Any]) throws -> [String: Any] {
        let settings: NativeLyricSettings
        do { settings = try JSONDecoder().decode(NativeLyricSettings.self, from: JSONSerialization.data(withJSONObject: values)) }
        catch { throw MobileFailure("invalid-lyric-settings") }
        try settings.validate()
        let data = try JSONEncoder().encode(settings)
        lyricSettings = settings
        storage.set(data, forKey: "folia.lyrics")
        crossfade?.lyricSettingsChanged(settings)
        return settings.dictionary
    }
    func restoreLyricSettings() {
        if let data = storage.data(forKey: "folia.lyrics"),
           let saved = try? JSONDecoder().decode(NativeLyricSettings.self, from: data),
           (try? saved.validate()) != nil { lyricSettings = saved }
        crossfade?.lyricSettingsChanged(lyricSettings)
    }
}
