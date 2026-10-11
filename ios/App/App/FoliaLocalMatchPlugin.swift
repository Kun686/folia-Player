import Capacitor

// FoliaLocalMatchPlugin.swift — publish metadata after atomic storage without replacing playback occurrences.
extension PlaybackEngine {
    func localMatchChanged(_ id: String, song: [String: Any]) {
        let matches: ([String: Any]) -> Bool = { NativeProfileIdentity($0)?.localID == id }
        if queue.contains(where: matches) { queue = queue.map { matches($0) ? song : $0 } }
        if let detachedSong, matches(detachedSong) { self.detachedSong = song; queueDirty = true }
        crossfade?.localLyricsChanged(id)
        if let currentSong, matches(currentSong) { artwork.update(nil) }
        localMetadata[id] = song
        localMetadataRequest += 1
        persist(); publish()
    }
}
extension PlaybackEngine {
    // Replace only metadata; AVPlayerItem/stream, occurrence, generation, position and playback intent stay untouched.
    func canonicalLocalSong(_ song: [String: Any]) -> [String: Any] {
        guard let id = NativeProfileIdentity(song)?.localID else { return song }
        return localMetadata[id] ?? song
    }
    func localLibraryChanged(_ songs: [[String: Any]]) {
        localMetadataRequest += 1
        localMetadata = Dictionary(songs.compactMap { song in NativeProfileIdentity(song)?.localID.map { ($0, song) } },
                                   uniquingKeysWith: { _, last in last })
        let next = queue.map(canonicalLocalSong)
        if !(queue as NSArray).isEqual(to: next) { queue = next }
        if let detachedSong {
            let next = canonicalLocalSong(detachedSong)
            if !(detachedSong as NSDictionary).isEqual(to: next) { self.detachedSong = next; queueDirty = true }
        }
        persist(); publish()
    }
    func refreshLocalLibrary() async throws -> [String: Any] {
        localMetadataRequest += 1; let request = localMetadataRequest
        let snapshot = try await local.librarySnapshot()
        if request == localMetadataRequest { localLibraryChanged(snapshot["songs"] as? [[String: Any]] ?? []) }
        return snapshot
    }
}
extension FoliaNativePlugin {
    @objc func readLocalLibrary(_ call: CAPPluginCall) { run(call) {
        Task { @MainActor in
            do { call.resolve(try await self.engine.refreshLocalLibrary()) }
            catch { call.reject((error as? MobileFailure)?.code ?? "local-library-unavailable") }
        }
    } }
    @objc func editLocalLibrary(_ call: CAPPluginCall) { run(call) {
        guard let revision = call.getString("revision"), let operation = call.getObject("operation")
        else { throw MobileFailure("invalid-local-library") }
        Task { @MainActor in
            do {
                let snapshot = try await self.engine.local.editLibrary(revision: revision, operation: operation)
                self.engine.localLibraryChanged(snapshot["songs"] as? [[String: Any]] ?? [])
                self.notifyListeners("localCatalog", data: [:])
                call.resolve(snapshot)
            } catch { call.reject((error as? MobileFailure)?.code ?? "local-library-unavailable") }
        }
    } }
    @objc func readLocalMatch(_ call: CAPPluginCall) { run(call) {
        guard let id = call.getString("id") else { throw MobileFailure("invalid-local-identity") }
        Task { @MainActor in
            do { call.resolve(try await self.engine.local.readLocalMatch(id)) }
            catch { call.reject((error as? MobileFailure)?.code ?? "local-library-unavailable") }
        }
    } }
    @objc func writeLocalMatch(_ call: CAPPluginCall) { run(call) {
        guard let id = call.getString("id"), let token = call.getString("token"), let document = call.getObject("document"),
              let revision = call.getString("libraryRevision"), let metadata = call.getString("metadata")
        else { throw MobileFailure("invalid-local-match") }
        Task { @MainActor in
            do {
                let song = try await self.engine.local.writeLocalMatch(id, token: token, document: document, source: call.getString("source"),
                    libraryRevision: revision, metadata: metadata, updateArtists: call.getBool("updateArtists") ?? false,
                    updateAlbum: call.getBool("updateAlbum") ?? false, protectOrigins: call.getArray("protectOrigins", String.self) ?? [])
                self.engine.localMatchChanged(id, song: song)
                self.notifyListeners("localCatalog", data: [:])
                var cached = false
                if call.getBool("cacheCover") == true, let coverSong = try? await self.engine.local.onlineCoverSong(id) {
                    cached = (try? await self.engine.coverCache.cover(coverSong, local: self.engine.local)) != nil
                }
                call.resolve(["coverCached": cached])
            } catch { call.reject((error as? MobileFailure)?.code ?? "local-library-unavailable") }
        }
    } }
}
