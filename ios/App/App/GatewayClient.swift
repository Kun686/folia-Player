import Foundation

// GatewayClient.swift — access token is only attached to the configured HTTPS origin.
class GatewayClient: NSObject, URLSessionTaskDelegate {
    let credentials: NativeGatewayStore
    private let configuration: () -> URLSessionConfiguration
    @TaskLocal private static var requiredScope: String?
    init(credentials: NativeGatewayStore = .shared, configuration: @escaping () -> URLSessionConfiguration = { .ephemeral }) {
        self.credentials = credentials; self.configuration = configuration
        super.init()
    }
    private lazy var session: URLSession = {
        let config = configuration()
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 25
        config.httpCookieStorage = nil
        config.urlCache = nil
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    static func validatedServer(_ raw: String) throws -> String {
        do {
            let normalized = try NativeSyncSettings.normalizedURL(raw)
            guard let url = URL(string: normalized), url.path.isEmpty else { throw MobileFailure("https-origin-required") }
            return normalized
        } catch { throw MobileFailure("https-origin-required") }
    }
    func send(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        guard ["/mobile/request", "/mobile/resolve", "/mobile/health", "/mobile/fm", "/mobile/report"].contains(path) else { throw MobileFailure("forbidden") }
        try Task.checkCancellation()
        let config = try credentials.snapshot()
        if let scope = Self.requiredScope, scope != config.scope { throw MobileFailure("gateway-settings-changed") }
        let base = try Self.validatedServer(config.server)
        let token = config.token
        guard !token.isEmpty, let url = URL(string: base + path) else { throw MobileFailure("configure-server") }
        var request = URLRequest(url: url)
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        try Task.checkCancellation()
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard try credentials.snapshot().scope == config.scope else { throw MobileFailure("gateway-settings-changed") }
        guard data.count <= 9 * 1024 * 1024, let http = response as? HTTPURLResponse,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw MobileFailure("invalid-response") }
        guard (200..<300).contains(http.statusCode) else { throw MobileFailure(object["code"] as? String ?? "network") }
        return object
    }
    func send(_ path: String, body: [String: Any]? = nil, scope: String) async throws -> [String: Any] {
        try await Self.$requiredScope.withValue(scope) { try await send(path, body: body) }
    }
    // Bind native lyric work to the configuration that supplied its cookie, across parser awaits.
    func withSession<T>(_ provider: String, work: ([String: Any]) async throws -> T) async throws -> T {
        let record = try credentials.snapshot()
        return try await Self.$requiredScope.withValue(record.scope) {
            let result = try await work(record.sessions[provider] ?? [:])
            try Task.checkCancellation()
            guard try credentials.snapshot().scope == record.scope else { throw MobileFailure("gateway-settings-changed") }
            return result
        }
    }
    // Only signed-in cookies are eligible; anonymous credentials can never create an account report.
    func listeningAccountAvailable() -> Bool {
        guard let values = try? credentials.snapshot().sessions["netease"], let cookie = values["cookie"] else { return false }
        return !cookie.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    func reportListening(song: [String: Any], report: NativeListeningReport, quality: String) async throws {
        try Task.checkCancellation()
        let record = try credentials.snapshot()
        let values = record.sessions["netease"] ?? [:]
        guard let cookie = values["cookie"], !cookie.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw MobileFailure("auth-required")
        }
        let response = try await send("/mobile/report", body: ["song": song, "report": [
            "playedSeconds": report.playedSeconds, "totalSeconds": report.totalSeconds, "quality": quality],
            "session": ["cookie": cookie]], scope: record.scope)
        guard response["reported"] as? Bool == true else { throw MobileFailure("invalid-response") }
    }
    func personalFM(_ selection: [String: Any]) async throws -> [String: Any] {
        let record = try credentials.snapshot()
        let session = record.sessions["netease"] ?? [:]
        guard let cookie = session["cookie"], !cookie.isEmpty else { throw MobileFailure("auth-required") }
        return try await send("/mobile/fm", body: ["provider": "netease", "selection": selection, "session": ["cookie": cookie]], scope: record.scope)
    }
    func resolve(_ song: [String: Any], quality: String = "standard") async throws -> NativeAudioSource {
        guard NativeAudioSettings.audioQualities.contains(quality) else { throw MobileFailure("invalid-audio-settings") }
        guard let ref = song["sourceRef"] as? [String: Any], let provider = ref["providerId"] as? String,
              ["netease", "qq", "kugou"].contains(provider) else { throw MobileFailure("invalid-identity") }
        let record = try credentials.snapshot()
        let source = try await send("/mobile/resolve", body: ["song": song, "quality": quality,
            "session": record.sessions[provider] ?? [:]], scope: record.scope)
        try Task.checkCancellation()
        return try Self.audioSource(source, song: song)
    }
    static func audioSource(_ source: [String: Any], song: [String: Any]) throws -> NativeAudioSource {
        guard let raw = source["url"] as? String, let url = URL(string: raw),
              url.scheme == "https", url.host != nil, url.user == nil, url.password == nil else { throw MobileFailure("invalid-audio-url") }
        return NativeAudioSource(url: url, replayGain: NativeReplayGainInfo(source["replayGain"]) ?? NativeReplayGainInfo(song["replayGain"]))
    }
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
