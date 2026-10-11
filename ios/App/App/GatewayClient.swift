import Foundation

// GatewayClient.swift — access token is only attached to the configured HTTPS origin.
class GatewayClient: NSObject, URLSessionTaskDelegate {
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 25
        config.httpCookieStorage = nil
        config.urlCache = nil
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    static func validatedServer(_ raw: String) throws -> String {
        guard let url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              url.scheme == "https", url.host != nil, url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil, url.path.isEmpty || url.path == "/" else { throw MobileFailure("https-origin-required") }
        return url.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }
    func send(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        guard ["/mobile/request", "/mobile/resolve", "/mobile/health"].contains(path) else { throw MobileFailure("forbidden") }
        let config = try SecureStore.read("gateway")
        let base = try Self.validatedServer(config["server"] as? String ?? "")
        guard let token = config["token"] as? String, !token.isEmpty, let url = URL(string: base + path) else { throw MobileFailure("configure-server") }
        var request = URLRequest(url: url)
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard data.count <= 9 * 1024 * 1024, let http = response as? HTTPURLResponse,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw MobileFailure("invalid-response") }
        guard (200..<300).contains(http.statusCode) else { throw MobileFailure(object["code"] as? String ?? "network") }
        return object
    }
    func resolve(_ song: [String: Any], quality: String = "standard") async throws -> NativeAudioSource {
        guard NativeAudioSettings.audioQualities.contains(quality) else { throw MobileFailure("invalid-audio-settings") }
        guard let ref = song["sourceRef"] as? [String: Any], let provider = ref["providerId"] as? String,
              ["netease", "qq", "kugou"].contains(provider) else { throw MobileFailure("invalid-identity") }
        let source = try await send("/mobile/resolve", body: ["song": song, "quality": quality,
            "session": try SecureStore.read("session." + provider)])
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
