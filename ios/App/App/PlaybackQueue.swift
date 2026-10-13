import AVFoundation

// PlaybackQueue.swift — native identity queue and cancellable preloads advance without JavaScript.
extension PlaybackEngine {
    static func sanitizedSong(_ song: [String: Any]) throws -> [String: Any] {
        guard let raw = song["sourceRef"] as? [String: Any], let id = raw["mediaId"] as? String else {
            throw MobileFailure("invalid-identity")
        }
        let isNavidrome = raw["kind"] as? String == "navidrome"
        guard isNavidrome ? NativeNavidromeRequest.validMediaID(id)
            : (!id.isEmpty && id.count <= 128 && id.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil) else {
            throw MobileFailure("invalid-identity")
        }
        var ref: [String: Any]
        if isNavidrome, let scope = raw["scope"] as? String, UUID(uuidString: scope) != nil {
            ref = ["kind": "navidrome", "mediaId": id, "scope": scope]
        } else if raw["kind"] as? String == "local", LocalMediaLibrary.validID(id) {
            ref = ["kind": "local", "mediaId": id]
        } else if raw["kind"] as? String == "online", let provider = raw["providerId"] as? String,
                  ["netease", "qq", "kugou"].contains(provider) {
            ref = ["kind": "online", "providerId": provider, "mediaId": id]
            if let variant = raw["variant"] as? String { ref["variant"] = String(variant.prefix(32)) }
            if let metadata = raw["providerData"] as? [String: Any] {
                var retained = metadata.filter { ["hash", "albumId", "albumAudioId", "songMid", "mediaMid", "fileId"].contains($0.key) }
                if let value = metadata["songId"], let number = Double(String(describing: value)), number.isFinite,
                   number > 0, number <= 9_007_199_254_740_991, number.rounded(.towardZero) == number {
                    retained["songId"] = Int(number)
                }
                ref["providerData"] = retained
            }
        } else { throw MobileFailure("invalid-identity") }
        var album = song["album"] as? [String: Any] ?? [:]
        if !isNavidrome, let pic = album["coverUrl"] as? String, pic.count < 4096, URL(string: pic)?.scheme == "https" {
            album = ["id": String(describing: album["id"] ?? ""), "name": String((album["name"] as? String ?? "").prefix(512)), "coverUrl": pic]
        } else {
            album = ["id": String(describing: album["id"] ?? ""), "name": String((album["name"] as? String ?? "").prefix(512))]
        }
        let artists = (song["artists"] as? [[String: Any]] ?? []).prefix(30).map {
            ["id": String(describing: $0["id"] ?? ""), "name": String(($0["name"] as? String ?? "").prefix(256))]
        }
        var result: [String: Any] = ["id": id, "name": String((song["name"] as? String ?? "").prefix(512)), "artists": artists,
                "album": album,
                "durationMs": (song["durationMs"] as? Double ?? 0), "sourceRef": ref]
        if let gain = NativeReplayGainInfo(song["replayGain"]) { result["replayGain"] = gain.dictionary }
        return result
    }

    func resolve(_ song: [String: Any]) async throws -> URL {
        // Signed Subsonic streams require the redirect-controlled stereo decoder used by the app.
        if (song["sourceRef"] as? [String: Any])?["kind"] as? String == "navidrome" { throw MobileFailure("navidrome-stereo-required") }
        if let ref = song["sourceRef"] as? [String: Any], ref["kind"] as? String == "local", let id = ref["mediaId"] as? String {
            do { return try await local.resolve(id) } catch { throw MobileFailure("local-file-missing") }
        }
        return try await gateway.resolve(song, quality: audioSettings.audioQuality).url
    }
    var currentIsLocal: Bool {
        (currentSong?["sourceRef"] as? [String: Any])?["kind"] as? String == "local"
    }
    var currentUsesGateway: Bool {
        (currentSong?["sourceRef"] as? [String: Any])?["kind"] as? String == "online"
    }
    // Removing another provider must not interrupt a local track or an unrelated account.
    func removeSongs(where matches: ([String: Any]) -> Bool) {
        crossfade?.removeTail(where: matches)
        promotePreparedItem()
        let song = currentSong
        let removesCurrent = song.map(matches) ?? false
        let removedBefore = queue.prefix(max(0, index)).filter(matches).count
        if removesCurrent { stop(); clearOutput() } else { discardPrepared() }
        queue.removeAll(where: matches)
        detachedSong = removesCurrent ? nil : song
        index = removesCurrent ? -1 : index - removedBefore
        if removesCurrent { restoredPosition = 0 }
        if !removesCurrent { prefetch() }
        persist(); publish()
    }

    // The foreground reuses the desktop queue helpers. Commit only against the native queue
    // version it read, preserving the playing occurrence and AVPlayerItem even after removal.
    func editQueue(_ songs: [[String: Any]], currentIndex: Int, expectedRevision: Int) throws {
        promotePreparedItem()
        guard expectedRevision == queueRevision else { throw MobileFailure("queue-changed") }
        guard songs.count <= 1000, currentIndex == -1 || songs.indices.contains(currentIndex) else { throw MobileFailure("invalid-queue") }
        let validated = try songs.map(Self.sanitizedSong).map(canonicalLocalSong)
        let song = currentSong
        if currentIndex >= 0 {
            guard let currentRef = song?["sourceRef"] as? NSDictionary,
                  let nextRef = validated[currentIndex]["sourceRef"] as? NSDictionary,
                  currentRef.isEqual(nextRef) else { throw MobileFailure("invalid-current-song") }
        }
        discardPrepared()
        personalFM.cancelSelection()
        if validated.isEmpty { personalFM.leave() }
        detachedSong = song; queue = validated; index = currentIndex
        prefetch(); persist(); publish()
    }
    func selectQueue(_ target: Int, expectedRevision: Int) throws {
        promotePreparedItem()
        guard expectedRevision == queueRevision else { throw MobileFailure("queue-changed") }
        guard queue.indices.contains(target) else { throw MobileFailure("invalid-queue") }
        personalFM.cancelSelection()
        failures = 0; intentToPlay = true; select(target)
    }

    func discardPrepared() {
        crossfade?.invalidatePlan()
        crossfade?.cancelAnalysis()
        preload?.cancel()
        preparedStream?.entry.dispose(); preparedStream = nil
        if let pending = prepared?.item, pending !== player.currentItem { player.remove(pending) }
        prepared = nil
    }
    func observeStatus(_ item: AVPlayerItem, epoch: Int) {
        observedItem = item
        statusObservation = item.observe(\.status, options: [.initial, .new]) { [weak self, weak item] _, _ in
            DispatchQueue.main.async {
                guard let self, let item, epoch == self.generation else { return }
                if item.status == .failed { self.failed(MobileFailure("audio-failed"), epoch: epoch) }
            }
        }
    }
    func promotePreparedItem() {
        guard !usesStereoOutput else { return }
        guard let next = prepared, player.currentItem === next.item else { return }
        listening.finishOccurrence()
        generation += 1; task?.cancel(); preload?.cancel(); stalledRecovery?.cancel()
        index = next.index; prepared = nil; retried = false; failures = 0; error = nil
        meter = next.meter
        observeStatus(next.item, epoch: generation)
        if !intentToPlay { player.pause() }
        prefetch(); persist(); publish()
    }
}
