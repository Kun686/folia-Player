import Foundation

// PlaybackTransitionSettings.swift — original mode selection persists independently of WebView lifetime.
struct NativeTransitionSettings: Codable {
    var enabled = false
    var mode = "automix"
    var crossfadeMaxSec = 5.0
    var performance = false
    private enum CodingKeys: String, CodingKey { case enabled, mode, crossfadeMaxSec, performance }
    init() {}
    // Existing installs omit performance. Only absence defaults to off; malformed edits are rejected.
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        enabled = try values.decode(Bool.self, forKey: .enabled)
        mode = try values.decode(String.self, forKey: .mode)
        crossfadeMaxSec = try values.decode(Double.self, forKey: .crossfadeMaxSec)
        performance = values.contains(.performance) ? try values.decode(Bool.self, forKey: .performance) : false
    }
    func validate() throws {
        guard ["crossfade", "automix"].contains(mode), crossfadeMaxSec.isFinite,
              (1...25).contains(crossfadeMaxSec) else { throw MobileFailure("invalid-transition-settings") }
    }
    var dictionary: [String: Any] {
        ["enabled": enabled, "mode": mode, "crossfadeMaxSec": crossfadeMaxSec, "performance": performance]
    }
}

extension PlaybackEngine {
    // Validate before changing either persistence or playback; the selected original planner owns its fallback.
    func setTransitionSettings(_ values: [String: Any]) throws -> [String: Any] {
        let settings: NativeTransitionSettings
        do { settings = try JSONDecoder().decode(NativeTransitionSettings.self, from: JSONSerialization.data(withJSONObject: values)) }
        catch { throw MobileFailure("invalid-transition-settings") }
        try settings.validate()
        let data = try JSONEncoder().encode(settings)
        try crossfade?.configure(enabled: settings.enabled, maximumSeconds: settings.crossfadeMaxSec, mode: settings.mode,
                                performance: settings.performance)
        transitionSettings = settings
        storage.set(data, forKey: "folia.transition")
        return settings.dictionary
    }
    func restoreTransitionSettings() {
        if let data = storage.data(forKey: "folia.transition"),
           let saved = try? JSONDecoder().decode(NativeTransitionSettings.self, from: data),
           (try? saved.validate()) != nil { transitionSettings = saved }
        try? crossfade?.configure(enabled: transitionSettings.enabled, maximumSeconds: transitionSettings.crossfadeMaxSec,
                                 mode: transitionSettings.mode, performance: transitionSettings.performance)
    }
}
