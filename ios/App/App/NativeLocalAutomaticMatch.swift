import Foundation

// NativeLocalAutomaticMatch.swift — original local metadata/lyric matching, independently owned by the native queue.
enum NativeLocalAutomaticMatch {
    static func load(_ id: String, local: LocalMediaLibrary, parser: NativeLyricParser, gateway: GatewayClient,
                     settings: NativeLyricSettings, baseline: [[String: Any]]?, coverCache: NativeCoverCache? = nil,
                     saved: @escaping ([String: Any], [[String: Any]]?) async -> Void) async -> [[String: Any]]? {
        do {
            let snapshot = try await local.readLocalMatch(id, includeCover: false)
            guard let input = try await parser.localAutomatic(snapshot, settings: settings),
                  let context = input["context"] as? [String: Any], let lyrics = snapshot["lyrics"] as? [String: Any],
                  let token = lyrics["token"] as? String, let revision = snapshot["libraryRevision"] as? String else { return baseline }
            let transport = try NativeLyricMatchTransport(gateway: gateway)
            let request: [String: Any] = ["version": 1, "title": context["title"] ?? "", "artist": context["artist"] ?? "",
                "durationMs": context["durationMs"] ?? 0, "sessions": transport.record.sessions, "localMatch": input]
            guard let decision = try await NativeLyricMatchJob().run(request, request: transport.send) else { return baseline }
            try transport.validate()
            guard let edit = try await parser.localAutomatic(snapshot, settings: settings, decision: decision),
                  let document = edit["document"] as? [String: Any], let metadata = edit["metadata"] as? String else { return baseline }
            try Task.checkCancellation(); try transport.validate()
            func commit(_ revision: String) async throws -> [String: Any] {
                try await local.writeLocalMatch(id, token: token, document: document, source: edit["source"] as? String,
                    libraryRevision: revision, metadata: metadata, updateArtists: edit["updateArtists"] as? Bool == true,
                    updateAlbum: edit["updateAlbum"] as? Bool == true, protectOrigins: edit["protectOrigins"] as? [String] ?? [],
                    validate: transport.validate)
            }
            let updated: [String: Any]
            do { updated = try await commit(revision) }
            catch let failure as MobileFailure where failure.code == "local-library-changed" {
                // Current and next may finish together. Rebase once only if this song's complete snapshot is unchanged.
                var latest = try await local.readLocalMatch(id, includeCover: false), before = snapshot
                guard let freshRevision = latest.removeValue(forKey: "libraryRevision") as? String else { throw failure }
                before.removeValue(forKey: "libraryRevision")
                guard NSDictionary(dictionary: latest).isEqual(to: before) else { throw failure }
                updated = try await commit(freshRevision)
            }
            let source = try await local.readLyricSources(id)
            let data = try await parser.localSources(source, priority: settings.localLyricsPriority)
            let lines = try data.flatMap { try JSONSerialization.jsonObject(with: $0) as? [[String: Any]] }
            try Task.checkCancellation()
            await saved(updated, lines)
            if edit["cacheCover"] as? Bool == true, let coverCache, let coverSong = try? await local.onlineCoverSong(id) {
                _ = try? await coverCache.cover(coverSong, local: local)
            }
            return lines
        } catch {
            // An optional search, revoked session or stale edit never withholds the already available file lyrics.
            return baseline
        }
    }
}
