import Foundation

// NativeNavidromeClient.swift — independent Keychain connection and bounded read transport, usable without a running WebView.
@MainActor final class NativeNavidromeClient {
    private let read: () throws -> [String: Any]
    private let write: ([String: Any]) throws -> Void
    private let configuration: () -> URLSessionConfiguration
    private let requests = NativeJSONTasks(prefix: "navidrome")
    // Browsing cannot occupy the two slots reserved for current/next native playback.
    private let playbackRequests = NativeJSONTasks(prefix: "navidrome")
    private(set) var revision = 0
    var connectionChanged: (() -> Void)?
    nonisolated static let maxResponseBytes = 8 * 1024 * 1024
    init(read: @escaping () throws -> [String: Any] = { try SecureStore.read("navidrome.settings") },
         write: @escaping ([String: Any]) throws -> Void = { try SecureStore.write("navidrome.settings", $0) },
         configuration: @escaping () -> URLSessionConfiguration = { .ephemeral }) {
        self.read = read; self.write = write; self.configuration = configuration
    }
    func snapshot() throws -> [String: Any] {
        publicValues(try NativeNavidromeSettings.read(read()))
    }
    private func publicValues(_ settings: NativeNavidromeSettings) -> [String: Any] {
        var value = settings.publicValues; value["revision"] = revision; return value
    }
    func configure(_ values: [String: Any], expected: Int, scope: String) throws -> [String: Any] {
        let previous = try NativeNavidromeSettings.read(read())
        guard revision == expected, previous.scope == scope else { throw MobileFailure("navidrome-settings-changed") }
        let next = try previous.editing(values)
        try write(next.record())
        // A failed Keychain write must preserve current requests and the last committed settings.
        revision += 1; requests.cancelAll(); playbackRequests.cancelAll()
        if previous.scope != next.scope || previous.enabled != next.enabled { connectionChanged?() }
        return publicValues(next)
    }
    // Validate even cache hits. A restored queue must never adopt the current account implicitly.
    func validatePlayback(_ song: [String: Any], expected: Int? = nil) throws -> Int {
        let settings = try NativeNavidromeSettings.read(read())
        guard let ref = song["sourceRef"] as? [String: Any], ref["kind"] as? String == "navidrome",
              let scope = ref["scope"] as? String, !scope.isEmpty, scope == settings.scope,
              expected == nil || expected == revision else { throw MobileFailure("navidrome-settings-changed") }
        guard settings.enabled else { throw MobileFailure("navidrome-disabled") }
        return revision
    }
    func audioSource(_ song: [String: Any]) async throws -> NativeAudioSource {
        let epoch = try validatePlayback(song), settings = try NativeNavidromeSettings.read(read())
        guard let ref = song["sourceRef"] as? [String: Any], let id = ref["mediaId"] as? String,
              NativeNavidromeRequest.validMediaID(id) else { throw MobileFailure("invalid-identity") }
        // Read the original song endpoint first: Subsonic reports expired auth as JSON, often with HTTP 200.
        let result = try await playbackRequests.run(id: "playback-" + UUID().uuidString) { [self] in
            try await perform(expected: epoch, scope: settings.scope, operation: "getSong", parameters: ["id": id])
        }
        try Task.checkCancellation()
        _ = try validatePlayback(song, expected: epoch)
        guard let response = result["response"] as? [String: Any], let envelope = response["subsonic-response"] as? [String: Any],
              let remote = envelope["song"] as? [String: Any], remote["id"] as? String == id else {
            throw MobileFailure("navidrome-invalid-response")
        }
        return NativeAudioSource(url: try NativeNavidromeRequest.streamURL(settings, id: id),
            replayGain: NativeReplayGainInfo(remote["replayGain"]) ?? NativeReplayGainInfo(song["replayGain"]))
    }
    func cancel(_ id: String) { requests.cancel(id) }
    func send(id: String, expected: Int, scope: String, operation: String, parameters: [String: String]) async throws -> [String: Any] {
        try await requests.run(id: id) { [self] in
            try await perform(expected: expected, scope: scope, operation: operation, parameters: parameters)
        }
    }
    private func perform(expected: Int, scope: String, operation: String, parameters: [String: String]) async throws -> [String: Any] {
        let settings = try NativeNavidromeSettings.read(read())
        guard expected == revision, scope == settings.scope else { throw MobileFailure("navidrome-settings-changed") }
        let request = try NativeNavidromeRequest.make(settings: settings, operation: operation, parameters: parameters)
        let result = try await NativeJSONTransport.perform(request, configuration: configuration(),
            limit: Self.maxResponseBytes, timeout: 30, prefix: "navidrome")
        guard expected == revision, scope == (try NativeNavidromeSettings.read(read())).scope else {
            throw MobileFailure("navidrome-settings-changed")
        }
        return ["scope": scope, "revision": revision, "response": try NativeNavidromeRequest.response(result)]
    }
}
