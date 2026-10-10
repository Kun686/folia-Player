import Foundation

// PlaybackMediaCache.swift — cache lifetimes belong to decoders; completed playback keeps the original opt-in policy.
extension PlaybackEngine {
    @MainActor func prepareMedia(_ song: [String: Any], refresh: Bool = false, position: Double = 0,
                                 output: StreamMixOutput) async throws -> StreamOccurrence {
        let identity = NativeProfileIdentity(song)
        if let provider = identity?.provider { try await mediaCachePurges[provider]?.value }
        try Task.checkCancellation()
        if let identity, identity.provider != nil {
            if refresh { try? await mediaCache.remove(identity) }
            else if let hit = try? await mediaCache.cached(identity, touch: true) {
                do {
                    let entry = try await StreamOccurrence.prepare(url: hit.url, position: position, output: output)
                    entry.cachedMedia = hit
                    return entry
                } catch {
                    try Task.checkCancellation()
                    // Corruption is evicted before the normal one-time remote recovery path.
                    try? await mediaCache.remove(identity)
                }
            }
        }
        try Task.checkCancellation()
        return try await StreamOccurrence.prepare(url: resolve(song), position: position, output: output,
                                                   networkConfiguration: mediaNetworkConfiguration)
    }
    func cachePlayedSong(_ song: [String: Any], entry: StreamOccurrence) {
        cachePlayedSong(song, source: entry.sourceURL)
    }
    func cachePlayedSong(_ song: [String: Any], source: URL) {
        guard let identity = NativeProfileIdentity(song), identity.provider != nil, !source.isFileURL else { return }
        let epoch = mediaCacheEpoch
        Task { @MainActor [weak self, mediaCache] in
            guard self?.mediaCacheEpoch == epoch else { return }
            // Cache failure is reported separately and must never interrupt the next song.
            _ = try? await mediaCache.store(identity, song: song, source: source)
        }
    }
    @MainActor func configureMediaCache(_ settings: NativeMediaCacheSettings) async throws -> [String: Any] {
        try settings.validate()
        let data = try JSONEncoder().encode(settings)
        mediaCacheEpoch += 1
        try await mediaCache.configure(settings)
        storage.set(data, forKey: "folia.media-cache")
        crossfade?.cacheSettingsChanged()
        return settings.dictionary
    }
    @MainActor func clearMediaCache() async throws {
        mediaCacheEpoch += 1
        // Stop analysis-driven downloads before clearing, without stopping audible decks.
        crossfade?.cancelAnalysis()
        try await mediaCache.clear()
    }
}
