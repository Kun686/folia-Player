import Foundation

// PlaybackTransitionSettings.swift — original mode selection persists independently of WebView lifetime.
struct NativeTransitionSettings: Codable {
    var enabled = false
    var mode = "automix"
    var crossfadeMaxSec = 5.0
    func validate() throws {
        guard ["crossfade", "automix"].contains(mode), crossfadeMaxSec.isFinite,
              (1...25).contains(crossfadeMaxSec) else { throw MobileFailure("invalid-transition-settings") }
    }
    var dictionary: [String: Any] {
        ["enabled": enabled, "mode": mode, "crossfadeMaxSec": crossfadeMaxSec]
    }
}

extension PlaybackEngine {
    // Validate before changing either persistence or playback. Original unavailable-analysis fallback is crossfade.
    func setTransitionSettings(_ values: [String: Any]) throws -> [String: Any] {
        let settings: NativeTransitionSettings
        do { settings = try JSONDecoder().decode(NativeTransitionSettings.self, from: JSONSerialization.data(withJSONObject: values)) }
        catch { throw MobileFailure("invalid-transition-settings") }
        try settings.validate()
        let data = try JSONEncoder().encode(settings)
        try crossfade?.configure(enabled: settings.enabled, maximumSeconds: settings.crossfadeMaxSec)
        transitionSettings = settings
        storage.set(data, forKey: "folia.transition")
        return settings.dictionary
    }
    func restoreTransitionSettings() {
        if let data = storage.data(forKey: "folia.transition"),
           let saved = try? JSONDecoder().decode(NativeTransitionSettings.self, from: data),
           (try? saved.validate()) != nil { transitionSettings = saved }
        try? crossfade?.configure(enabled: transitionSettings.enabled, maximumSeconds: transitionSettings.crossfadeMaxSec)
    }
}
