import Foundation

// PlaybackLyricSettings.swift — native preference keeps foreground and suspended-WebView lyric selection aligned.
struct NativeLyricSettings: Codable {
    var localLyricsPriority = "local"
    func validate() throws {
        guard ["local", "online"].contains(localLyricsPriority) else { throw MobileFailure("invalid-lyric-settings") }
    }
    var dictionary: [String: Any] { ["localLyricsPriority": localLyricsPriority] }
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
        crossfade?.localLyricsPriorityChanged(settings.localLyricsPriority)
        return settings.dictionary
    }
    func restoreLyricSettings() {
        if let data = storage.data(forKey: "folia.lyrics"),
           let saved = try? JSONDecoder().decode(NativeLyricSettings.self, from: data),
           (try? saved.validate()) != nil { lyricSettings = saved }
        crossfade?.localLyricsPriorityChanged(lyricSettings.localLyricsPriority)
    }
}
