import Foundation

// NativeLyricMatchTransport.swift — one immutable account/configuration snapshot per match; AMLL has a separate public session.
final class NativeLyricMatchTransport: @unchecked Sendable {
    private let gateway: GatewayClient
    let record: NativeGatewayRecord
    private let configuration: URLSessionConfiguration
    init(gateway: GatewayClient, configuration: URLSessionConfiguration = .ephemeral) throws {
        self.gateway = gateway; record = try gateway.credentials.snapshot()
        self.configuration = configuration.copy() as! URLSessionConfiguration
    }
    // An opaque generation receipt, never a session value, also guards foreground automatic commits.
    var sessionToken: String { record.scope + ":" + (record.sessionGeneration ?? "legacy") }
    func validate() throws {
        try Task.checkCancellation()
        let current = try gateway.credentials.snapshot()
        // A platform session replacement intentionally does not rotate the gateway scope.
        guard current.scope == record.scope, current.sessionGeneration == record.sessionGeneration,
              current.sessions == record.sessions else { throw MobileFailure("lyric-session-changed") }
    }
    func send(_ request: [String: Any]) async throws -> [String: Any] {
        try validate()
        let reply: [String: Any]
        if request["provider"] as? String == "amll" {
            guard Set(request.keys) == Set(["provider", "path"]), let path = request["path"] as? String,
                  path.utf8.count <= 512, let url = URL(string: path),
                  let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
                  parts.scheme == "https", parts.host == "api.amll.dev", parts.path == "/v1/lyrics/get",
                  parts.port == nil, parts.user == nil, parts.password == nil, parts.fragment == nil,
                  let queries = parts.queryItems, queries.count == 1,
                  ["ncmMusicId", "qqMusicId"].contains(queries[0].name), let id = queries[0].value,
                  !id.isEmpty, id.utf8.count <= 128 else { throw MobileFailure("forbidden") }
            var outgoing = URLRequest(url: url)
            outgoing.setValue("Folia/mobile (Kun686/folia-Player)", forHTTPHeaderField: "User-Agent")
            do {
                reply = try await NativeJSONTransport.perform(outgoing,
                    configuration: configuration.copy() as! URLSessionConfiguration,
                    limit: 2_000_000, timeout: 5, prefix: "lyric")
            } catch let failure as MobileFailure where failure.code == "lyric-response-too-large" {
                throw MobileFailure("lyrics-too-large")
            }
        } else {
            reply = try await gateway.send("/mobile/request", body: request, scope: record.scope)
        }
        try validate()
        return reply
    }
}

enum NativeBestLyrics {
    static func match(_ input: [String: Any], gateway: GatewayClient) async throws -> [String: Any]? {
        let transport = try NativeLyricMatchTransport(gateway: gateway)
        var input = input
        input["sessions"] = transport.record.sessions
        let result = try await NativeLyricMatchJob().run(input, request: transport.send)
        try transport.validate()
        return result
    }
}


// Cache selection remains authoritative; optional matching never blocks the audio transport.
extension NativeBestLyrics {
    static func load(_ song: [String: Any], settings: NativeLyricSettings, cache: NativeLyricCache,
                     gateway: GatewayClient, baseline: @escaping ([[String: Any]]?) async -> Void,
                     saved: @escaping () async -> Void) async throws -> [[String: Any]]? {
        let snapshot = try await cache.read(song), payload = snapshot["payload"] as? [String: Any] ?? [:]
        let state = payload["state"] as? [String: Any] ?? [:]
        let cached = snapshot["lines"] as? [[String: Any]]
        await baseline(cached)
        if state["lyricsSource"] as? String == "imported" || state["hasOnlineOverride"] as? Bool == true { return cached }
        guard let token = snapshot["token"] as? String, let selection = snapshot["selectionToken"] as? String else {
            throw MobileFailure("invalid-lyric-cache")
        }
        // With matching disabled, an existing baseline is usable completely offline.
        if settings.autoUseBestLyric != true && payload.keys.contains("lyrics") { return cached }
        let transport: NativeLyricMatchTransport
        do { transport = try NativeLyricMatchTransport(gateway: gateway) }
        catch { if payload.keys.contains("lyrics") { return cached }; throw error }
        let artists = (song["artists"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String }.joined(separator: ", ")
        let input: [String: Any] = ["version": 1, "song": song, "title": song["name"] as? String ?? "",
            "artist": String(artists.prefix(4096)), "durationMs": song["durationMs"] ?? 0,
            "sessions": transport.record.sessions, "autoUseBestLyric": settings.autoUseBestLyric == true,
            "options": ["preferredSource": settings.preferredAlternativeLyricSource ?? "qq",
                        "album": (song["album"] as? [String: Any])?["name"] as? String ?? ""]]
        do {
            let result = try await NativeLyricMatchJob().run(input, baseline: { document in
                try transport.validate()
                if let value = (document["payload"] as? [String: Any])?["lyrics"] {
                    try await cache.write(song, token: token, field: "lyrics", value: value, validate: transport.validate)
                }
                let retained = try await cache.read(song)
                try transport.validate()
                await baseline(retained["lines"] as? [[String: Any]])
            }, request: transport.send)
            try transport.validate()
            if let selectionState = result?["state"] as? [String: Any] {
                do {
                    try await cache.write(song, token: token, field: "state", value: selectionState,
                                          selectionToken: selection, validate: transport.validate)
                    await saved()
                } catch let failure as MobileFailure where failure.code == "lyric-cache-changed" {
                    // A newer manual/imported/automatic answer wins; display the retained document below.
                }
            }
        } catch {
            try Task.checkCancellation(); try transport.validate()
            // Optional search/refresh failure retains the last usable cache, including the baseline just delivered.
            let retained = try await cache.read(song)
            guard !(retained["payload"] as? [String: Any] ?? [:]).isEmpty else { throw error }
        }
        let retained = try await cache.read(song)
        try transport.validate()
        return retained["lines"] as? [[String: Any]]
    }
}
