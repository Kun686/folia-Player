import Foundation

// NativeProfileIdentity.swift — standard-quality representation identity, independent of expiring CDN addresses.
// "standard" is a legacy namespace: retain existing song-based audio/lyric/profile caches across quality edits.
struct NativeProfileIdentity {
    let key: String
    let localID: String?
    let provider: String?
    init?(_ song: [String: Any]) {
        guard let clean = try? PlaybackEngine.sanitizedSong(song), let ref = clean["sourceRef"] as? [String: Any],
              let id = ref["mediaId"] as? String else { return nil }
        if ref["kind"] as? String == "local" { key = "local:" + id; localID = id; provider = nil }
        else {
            // Retain the existing remote-cache namespace and invalidation machinery, while the
            // hashed reference keeps Navidrome distinct from Omni and includes its Keychain scope.
            guard let provider = ref["kind"] as? String == "navidrome" ? "navidrome" : ref["providerId"] as? String,
                  let bytes = try? JSONSerialization.data(withJSONObject: ref, options: .sortedKeys) else { return nil }
            key = "online:" + provider + ":standard:" + NativeProfileCache.digest(bytes)
            localID = nil; self.provider = provider
        }
    }
    var cacheKey: String { NativeProfileCache.digest(Data(("v9-gridless-vdsp|" + key).utf8)) }
}
