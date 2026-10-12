import Foundation

// PlaybackMediaCache.swift — cache lifetimes belong to decoders; completed playback keeps the original opt-in policy.
extension PlaybackEngine {
    @MainActor func prepareMedia(_ song: [String: Any], refresh: Bool = false, position: Double = 0,
                                 output: StreamMixOutput) async throws -> StreamOccurrence {
        let quality = audioSettings.audioQuality
        let identity = NativeProfileIdentity(song)
        if let provider = identity?.provider { try await mediaCachePurges[provider]?.value }
        try Task.checkCancellation()
        if let identity, identity.provider != nil {
            if refresh { try? await mediaCache.remove(identity) }
            else if let hit = try? await mediaCache.cached(identity, touch: true) {
                do {
                    let entry = try await prepareSource(NativeAudioSource(url: hit.url, replayGain: hit.replayGain ?? NativeReplayGainInfo(song["replayGain"])),
                                                        position: position, output: output)
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
        let source: NativeAudioSource
        if let ref = song["sourceRef"] as? [String: Any], ref["kind"] as? String == "local", let id = ref["mediaId"] as? String {
            source = try await local.audioSource(id)
        } else { source = try await gateway.resolve(song, quality: quality) }
        try Task.checkCancellation()
        return try await prepareSource(source, position: position, output: output)
    }
    @MainActor private func prepareSource(_ source: NativeAudioSource, position: Double, output: StreamMixOutput) async throws -> StreamOccurrence {
        let levels: NativeReplayGainLevels
        if let info = source.replayGain { levels = try await audioRules.replayGain(info) }
        else { levels = .neutral }
        return try await StreamOccurrence.prepare(url: source.url, position: position, output: output,
            networkConfiguration: mediaNetworkConfiguration, allowsTempo: true, replayGain: source.replayGain, replayGainLevels: levels)
    }
    // Call only after checking the playback generation. Persist numeric metadata, never the signed URL.
    func retainReplayGain(_ entry: StreamOccurrence, for song: [String: Any], at target: Int) {
        guard let info = entry.replayGain, let identity = NativeProfileIdentity(song) else { return }
        if queue.indices.contains(target) {
            guard NativeProfileIdentity(queue[target])?.key == identity.key else { return }
            let previous = NativeReplayGainInfo(queue[target]["replayGain"])?.dictionary
            if previous != info.dictionary { queue[target]["replayGain"] = info.dictionary }
        } else if target == -1, detachedSong != nil {
            guard detachedSong.flatMap(NativeProfileIdentity.init)?.key == identity.key else { return }
            detachedSong?["replayGain"] = info.dictionary; queueDirty = true
        }
    }
    func cachePlayedSong(_ song: [String: Any], entry: StreamOccurrence) {
        var enriched = song
        if let info = entry.replayGain { enriched["replayGain"] = info.dictionary }
        cachePlayedSong(enriched, source: entry.sourceURL)
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
        crossfade?.clearingMediaCache(true)
        defer { crossfade?.clearingMediaCache(false) }
        try await mediaCache.clear()
    }
}
