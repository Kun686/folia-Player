import Foundation

// NativeStemPreparation.swift — complete local bytes only, original model and four-window cache, off the main thread.
actor NativeStemPreparation {
    private let local: LocalMediaLibrary, mediaCache: NativeMediaCache, cache: NativeStemCache
    private let media = NativeStemMedia()
    private let separator: any NativeStemSeparating
    init(local: LocalMediaLibrary, mediaCache: NativeMediaCache, cache: NativeStemCache,
         separator: any NativeStemSeparating = NativeStemInference()) {
        self.local = local; self.mediaCache = mediaCache; self.cache = cache; self.separator = separator
    }
    func prepare(_ identity: NativeProfileIdentity, role: NativeStemRole, model: URL) async throws -> NativeStemWindow? {
        try Task.checkCancellation()
        let digest = try NativeORTInference.modelDigest(.htdemucs)
        if let hit = await cache.read(.init(identity: identity, role: role), modelDigest: digest) { return hit }
        let material: NativeStemMaterial
        if let id = identity.localID { material = try await media.read(file: local.resolve(id), role: role) }
        else if let complete = try await mediaCache.cached(identity) { material = try await media.read(cached: complete, role: role) }
        else { return nil }
        try Task.checkCancellation()
        let key = try material.key(identity: identity, modelDigest: digest)
        if let hit = await cache.read(key) { return hit }
        guard let ticket = await cache.begin(key) else { throw CancellationError() }
        do {
            let window = try await separator.separate(material, model: model)
            try Task.checkCancellation()
            guard await cache.finish(ticket, window: window) else { throw CancellationError() }
            return window
        } catch {
            await cache.abandon(ticket)
            throw error
        }
    }
}
