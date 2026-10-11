import Foundation

// NativeLyricCache.swift — full parsed lyrics and the original selection state, shared across foreground and native planning.
actor NativeLyricCache {
    private let root: URL
    private let parser: NativeLyricParser
    private var tokens: [String: String] = [:]
    private var exportToken = UUID().uuidString
    private let limit: Int
    init(root: URL? = nil, parser: NativeLyricParser = NativeLyricParser(), limit: Int = 64 * 1024 * 1024) {
        self.root = root ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("FoliaLyrics", isDirectory: true)
        self.parser = parser; self.limit = max(0, limit)
    }
    private func identity(_ song: [String: Any]) throws -> NativeProfileIdentity {
        guard let id = NativeProfileIdentity(song), id.provider != nil else { throw MobileFailure("invalid-lyric-identity") }
        return id
    }
    private func token(_ provider: String) -> String {
        if let token = tokens[provider] { return token }
        let token = UUID().uuidString; tokens[provider] = token; return token
    }
    private func path(_ id: NativeProfileIdentity) -> URL {
        root.appendingPathComponent(id.provider!).appendingPathComponent(NativeProfileCache.digest(Data(("lyrics-v1|" + id.key).utf8)) + ".json")
    }
    private func payload(_ id: NativeProfileIdentity) -> [String: Any] {
        let url = path(id)
        guard let values = try? url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey]),
              values.isRegularFile == true, values.isSymbolicLink != true, let bytes = values.fileSize, bytes <= 8_000_000,
              let data = try? Data(contentsOf: url), let record = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              record["version"] as? Int == 1, record["identity"] as? String == id.key,
              let payload = record["payload"] as? [String: Any] else { return [:] }
        return payload
    }
    func read(_ song: [String: Any]) async throws -> [String: Any] {
        try Task.checkCancellation()
        let id = try identity(song), epoch = token(id.provider!)
        let raw = payload(id)
        var result: [String: Any]
        do { result = try await parser.cacheDocument(raw) }
        catch {
            try Task.checkCancellation()
            // A damaged optional cache is a miss, never a fabricated lyric or a playback error.
            if token(id.provider!) == epoch && NSDictionary(dictionary: payload(id)).isEqual(to: raw) {
                try? FileManager.default.removeItem(at: path(id))
            }
            result = ["payload": [:], "lines": NSNull()]
        }
        guard token(id.provider!) == epoch else { throw CancellationError() }
        try Task.checkCancellation()
        if !raw.isEmpty { try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: path(id).path) }
        result["token"] = epoch
        return result
    }
    func write(_ song: [String: Any], token expected: String, field: String, value: Any, onlyIfMissing: Bool = false) async throws {
        let id = try identity(song)
        guard ["lyrics", "state"].contains(field), token(id.provider!) == expected else { throw MobileFailure("lyric-cache-changed") }
        let validated = try await parser.cacheDocument([field: value])
        try Task.checkCancellation()
        guard token(id.provider!) == expected, let clean = validated["payload"] as? [String: Any], let value = clean[field] else {
            throw MobileFailure("lyric-cache-changed")
        }
        // Merge only after validation returns: a concurrent state edit must not be replaced by a late provider result.
        var current = payload(id)
        if onlyIfMissing && current.keys.contains(field) { return }
        current[field] = value
        let data = try JSONSerialization.data(withJSONObject: ["version": 1, "identity": id.key, "payload": current,
            "song": NativeLyricExport.metadata(song)], options: .sortedKeys)
        guard data.count <= 8_000_000 else { throw MobileFailure("lyrics-too-large") }
        let url = path(id)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        try prune()
    }
    func lines(_ song: [String: Any], session: [String: Any], gateway: GatewayClient) async throws -> [[String: Any]]? {
        let snapshot = try await read(song), payload = snapshot["payload"] as? [String: Any] ?? [:]
        let state = payload["state"] as? [String: Any] ?? [:]
        if payload.keys.contains("lyrics") || state["hasOnlineOverride"] as? Bool == true
            || (state["lyricsSource"] as? String == "imported" && state["importedLyrics"] is [String: Any]) {
            return snapshot["lines"] as? [[String: Any]]
        }
        let fetched = try await NativeOnlineLyrics.document(song, session: session, gateway: gateway, parser: parser)
        try Task.checkCancellation()
        let id = try identity(song), expected = snapshot["token"] as! String
        guard token(id.provider!) == expected else { throw CancellationError() }
        do {
            try await write(song, token: expected, field: "lyrics", value: fetched["lyrics"] ?? NSNull(), onlyIfMissing: true)
            let retained = try await read(song)
            if (retained["payload"] as? [String: Any])?.isEmpty == false { return retained["lines"] as? [[String: Any]] }
            return fetched["lines"] as? [[String: Any]]
        } catch {
            try Task.checkCancellation()
            guard token(id.provider!) == expected else { throw CancellationError() }
            // Disk errors must not withhold valid in-memory timing from the current playback.
            return fetched["lines"] as? [[String: Any]]
        }
    }
    private var files: NativeResourceFiles { NativeResourceFiles(root: root, fileExtension: "json") }
    private func prune() throws {
        // Imported and authoritative selections are user data, not disposable provider refreshes.
        try files.prune(limit: limit) { url in
            guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 8_000_000,
                  let data = try? Data(contentsOf: url), let record = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  let payload = record["payload"] as? [String: Any], let state = payload["state"] as? [String: Any] else { return false }
            return state["hasOnlineOverride"] as? Bool == true || state["lyricsSource"] as? String == "imported"
        }
    }
    func summary() -> [String: Int] { files.summary() }
    func exportInventory(knownSongs: [[String: Any]]) throws -> [String: Any] {
        ["token": exportToken, "entries": try NativeLyricExport.inventory(root: root, knownSongs: knownSongs)]
    }
    func validateExport(_ expected: String) throws {
        guard expected == exportToken else { throw MobileFailure("lyric-cache-changed") }
    }
    func exportRead(key: String, token expected: String) async throws -> [String: Any] {
        try validateExport(expected)
        let record = try NativeLyricExport.record(NativeLyricExport.url(key, root: root))
        let parsed = try await parser.cacheDocument(record["payload"] as! [String: Any])
        try Task.checkCancellation(); try validateExport(expected)
        return ["payload": parsed["payload"] ?? [:]]
    }
    func clear(provider: String? = nil) throws {
        guard provider == nil || ["qq", "netease", "kugou"].contains(provider!) else { throw MobileFailure("invalid-provider") }
        for provider in provider.map({ [$0] }) ?? ["qq", "netease", "kugou"] { tokens[provider] = UUID().uuidString }
        exportToken = UUID().uuidString
        try files.clear(provider: provider)
    }
}
