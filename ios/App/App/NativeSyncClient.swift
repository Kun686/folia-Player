import Foundation

// NativeSyncClient.swift — preserve the original sync-server routes; only the configured server receives the independent sync token.
@MainActor final class NativeSyncClient {
    private let read: () throws -> [String: Any]
    private let write: ([String: Any]) throws -> Void
    private let configuration: () -> URLSessionConfiguration
    private let requests = NativeJSONTasks(prefix: "sync")
    private(set) var revision = 0
    nonisolated static let maxRequestBytes = 2 * 1024 * 1024
    nonisolated static let maxResponseBytes = 8 * 1024 * 1024
    init(read: @escaping () throws -> [String: Any] = { try SecureStore.read("sync.settings") },
         write: @escaping ([String: Any]) throws -> Void = { try SecureStore.write("sync.settings", $0) },
         configuration: @escaping () -> URLSessionConfiguration = { .ephemeral }) {
        self.read = read; self.write = write; self.configuration = configuration
    }
    func snapshot() throws -> [String: Any] {
        var value = try NativeSyncSettings.read(read()).publicValues
        value["revision"] = revision; return value
    }
    func configure(_ values: [String: Any], expected: Int) throws -> [String: Any] {
        guard revision == expected else { throw MobileFailure("sync-settings-changed") }
        let next = try NativeSyncSettings.read(read()).editing(values)
        try write(next.record())
        revision += 1; requests.cancelAll()
        return try snapshot()
    }
    func cancel(_ id: String) { requests.cancel(id) }
    func send(id: String, expected: Int, operation: String, body: String?) async throws -> [String: Any] {
        try await requests.run(id: id) { [self] in
            guard expected == revision else { throw MobileFailure("sync-settings-changed") }
            let settings = try NativeSyncSettings.read(read())
            let request = try Self.request(settings: settings, operation: operation, body: body)
            var result = try await NativeJSONTransport.perform(request, configuration: configuration(),
                limit: Self.maxResponseBytes, timeout: 120, prefix: "sync")
            guard expected == revision else { throw MobileFailure("sync-settings-changed") }
            // The shared sync protocol only uses the HTTP status for errors; never return an echoed credential/error body.
            if let status = result["status"] as? Int, !(200..<300).contains(status) { result["body"] = "" }
            return result
        }
    }
    nonisolated static func request(settings: NativeSyncSettings, operation: String, body: String?) throws -> URLRequest {
        let routes: [String: (String, String)] = [
            "health": ("GET", "/health"), "state": ("GET", "/state"), "settingsRead": ("GET", "/settings"),
            "settingsWrite": ("PUT", "/settings"), "themeManifest": ("GET", "/themes/manifest"),
            "themeGet": ("POST", "/themes/get"), "themePut": ("POST", "/themes/put"),
            "themeBuckets": ("POST", "/themes/bucket"), "themeList": ("POST", "/themes/list"),
        ]
        guard let (method, path) = routes[operation] else { throw MobileFailure("invalid-sync-request") }
        try settings.validate()
        guard !settings.baseURL.isEmpty, !settings.token.isEmpty else { throw MobileFailure("sync-not-configured") }
        guard settings.enabled || ["health", "state"].contains(operation) else { throw MobileFailure("sync-disabled") }
        let baseURL = try NativeSyncSettings.normalizedURL(settings.baseURL)
        guard let url = URL(string: baseURL + path) else { throw MobileFailure("invalid-sync-request") }
        var request = URLRequest(url: url)
        request.httpMethod = method; request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer " + settings.token, forHTTPHeaderField: "Authorization")
        if method == "GET" {
            guard body == nil else { throw MobileFailure("invalid-sync-request") }
        } else {
            guard let body, let bytes = body.data(using: .utf8), bytes.count <= maxRequestBytes,
                  (try? JSONSerialization.jsonObject(with: bytes)) is [String: Any] else {
                throw MobileFailure("invalid-sync-request")
            }
            request.httpBody = bytes; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }
}
