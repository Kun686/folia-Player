import AVFoundation

// PlaybackQueue.swift — preloaded AVQueuePlayer items advance even without JavaScript.
extension PlaybackEngine {
    static func sanitizedSong(_ song: [String: Any]) throws -> [String: Any] {
        guard let raw = song["sourceRef"] as? [String: Any], let id = raw["mediaId"] as? String,
              !id.isEmpty, id.count <= 128, id.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else {
            throw MobileFailure("invalid-identity")
        }
        var ref: [String: Any]
        if raw["kind"] as? String == "local", LocalMediaLibrary.validID(id) {
            ref = ["kind": "local", "mediaId": id]
        } else if raw["kind"] as? String == "online", let provider = raw["providerId"] as? String,
                  ["netease", "qq", "kugou"].contains(provider) {
            ref = ["kind": "online", "providerId": provider, "mediaId": id]
            if let variant = raw["variant"] as? String { ref["variant"] = String(variant.prefix(32)) }
            if let metadata = raw["providerData"] as? [String: Any] {
                ref["providerData"] = metadata.filter { ["hash", "albumId", "albumAudioId", "songMid", "mediaMid", "fileId"].contains($0.key) }
            }
        } else { throw MobileFailure("invalid-identity") }
        var album = song["album"] as? [String: Any] ?? [:]
        if let pic = album["coverUrl"] as? String, pic.count < 4096, URL(string: pic)?.scheme == "https" {
            album = ["id": String(describing: album["id"] ?? ""), "name": String((album["name"] as? String ?? "").prefix(512)), "coverUrl": pic]
        } else {
            album = ["id": String(describing: album["id"] ?? ""), "name": String((album["name"] as? String ?? "").prefix(512))]
        }
        let artists = (song["artists"] as? [[String: Any]] ?? []).prefix(30).map {
            ["id": String(describing: $0["id"] ?? ""), "name": String(($0["name"] as? String ?? "").prefix(256))]
        }
        return ["id": id, "name": String((song["name"] as? String ?? "").prefix(512)), "artists": artists,
                "album": album,
                "durationMs": (song["durationMs"] as? Double ?? 0), "sourceRef": ref]
    }

    func resolve(_ song: [String: Any]) async throws -> URL {
        if let ref = song["sourceRef"] as? [String: Any], ref["kind"] as? String == "local", let id = ref["mediaId"] as? String {
            do { return try await local.resolve(id) } catch { throw MobileFailure("local-file-missing") }
        }
        return try await gateway.resolve(song)
    }
    var currentIsLocal: Bool {
        queue.indices.contains(index) && (queue[index]["sourceRef"] as? [String: Any])?["kind"] as? String == "local"
    }
    // Removing another provider must not interrupt a local track or an unrelated account.
    func removeSongs(where matches: ([String: Any]) -> Bool) {
        let removesCurrent = queue.indices.contains(index) && matches(queue[index])
        let removedBefore = queue.prefix(max(0, index)).filter(matches).count
        if removesCurrent { stop(); player.removeAllItems() } else { discardPrepared() }
        queue.removeAll(where: matches)
        index = removesCurrent ? -1 : index - removedBefore
        if !removesCurrent { prefetch() }
        persist(); publish()
    }

    func discardPrepared() {
        preload?.cancel()
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
        guard let next = prepared, player.currentItem === next.item else { return }
        generation += 1; task?.cancel(); preload?.cancel(); stalledRecovery?.cancel()
        index = next.index; prepared = nil; retried = false; failures = 0; error = nil
        meter = next.meter
        observeStatus(next.item, epoch: generation)
        if !intentToPlay { player.pause() }
        prefetch(); persist(); publish()
    }
}
