import Foundation
import MediaPlayer
import UIKit

// PlaybackArtwork.swift — load once per identity; quarter-second playback snapshots reuse decoded artwork.
final class PlaybackArtwork {
    private let cache: NativeCoverCache
    private let local: LocalMediaLibrary
    private var key: String?
    private var task: Task<Void, Never>?
    private var generation = 0
    private var requestedNetwork = false
    private(set) var image: MPMediaItemArtwork?
    var changed: (() -> Void)?
    init(cache: NativeCoverCache, local: LocalMediaLibrary) { self.cache = cache; self.local = local }
    deinit { task?.cancel() }
    func update(_ song: [String: Any]?, allowNetwork: Bool = true) {
        let identity = song.flatMap(NativeProfileIdentity.init)?.key
        guard key != identity || (identity != nil && allowNetwork && !requestedNetwork && image == nil) else { return }
        generation += 1; let epoch = generation
        requestedNetwork = allowNetwork
        key = identity; image = nil; task?.cancel(); task = nil
        guard identity != nil, let song else { return }
        task = Task { @MainActor [weak self, cache, local] in
            let data = try? await cache.cover(song, local: local, allowNetwork: allowNetwork)
            guard let self, !Task.isCancelled, self.generation == epoch else { return }
            self.task = nil
            if let data, let image = UIImage(data: data) {
                self.image = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                self.changed?()
            }
        }
    }
}
