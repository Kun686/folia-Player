import AVFoundation

// PlaybackQueue.swift — preloaded AVQueuePlayer items advance even without JavaScript.
extension PlaybackEngine {
    static func sanitizedSong(_ song: [String: Any]) throws -> [String: Any] {
        guard let raw = song["sourceRef"] as? [String: Any],
              let provider = raw["providerId"] as? String, ["netease", "qq", "kugou"].contains(provider),
              raw["kind"] as? String == "online", let id = raw["mediaId"] as? String,
              !id.isEmpty, id.count <= 128, id.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else {
            throw MobileFailure("invalid-identity")
        }
        var ref: [String: Any] = ["kind": "online", "providerId": provider, "mediaId": id]
        if let variant = raw["variant"] as? String { ref["variant"] = String(variant.prefix(32)) }
        if let metadata = raw["providerData"] as? [String: Any] {
            ref["providerData"] = metadata.filter { ["hash", "albumId", "albumAudioId", "songMid", "mediaMid", "fileId"].contains($0.key) }
        }
        let artists = (song["artists"] as? [[String: Any]] ?? []).prefix(30).map {
            ["id": String(describing: $0["id"] ?? ""), "name": String(($0["name"] as? String ?? "").prefix(256))]
        }
        let album = song["album"] as? [String: Any] ?? [:]
        return ["id": id, "name": String((song["name"] as? String ?? "").prefix(512)), "artists": artists,
                "album": ["id": String(describing: album["id"] ?? ""), "name": String((album["name"] as? String ?? "").prefix(512))],
                "durationMs": (song["durationMs"] as? Double ?? 0), "sourceRef": ref]
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
        observeStatus(next.item, epoch: generation)
        if !intentToPlay { player.pause() }
        prefetch(); persist(); publish()
    }
}
