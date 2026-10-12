import Foundation

// NativeAIClient.swift — bounded HTTPS transport for the configured AI service, independent of the music gateway.
@MainActor final class NativeAIClient {
    private let read: () throws -> [String: Any]
    private let write: ([String: Any]) throws -> Void
    private let configuration: () -> URLSessionConfiguration
    private let requests = NativeJSONTasks(prefix: "ai")
    private(set) var revision = 0
    nonisolated static let maxResponseBytes = 1024 * 1024
    init(read: @escaping () throws -> [String: Any] = { try SecureStore.read("ai.settings") },
         write: @escaping ([String: Any]) throws -> Void = { try SecureStore.write("ai.settings", $0) },
         configuration: @escaping () -> URLSessionConfiguration = { .ephemeral }) {
        self.read = read; self.write = write; self.configuration = configuration
    }
    func snapshot() throws -> [String: Any] {
        var result = try NativeAISettings.read(read()).publicValues
        result["revision"] = revision
        return result
    }
    func configure(_ values: [String: Any], expected: Int) throws -> [String: Any] {
        guard expected == revision else { throw MobileFailure("ai-settings-changed") }
        let next = try NativeAISettings.read(read()).editing(values)
        try write(next.record())
        revision += 1
        requests.cancelAll()
        return try snapshot()
    }
    func cancel(_ id: String) { requests.cancel(id) }
    func send(id: String, expected: Int, provider: String, body: String) async throws -> [String: Any] {
        try await requests.run(id: id) { [self] in
            guard expected == revision else { throw MobileFailure("ai-settings-changed") }
            guard let bytes = body.data(using: .utf8), bytes.count <= 256 * 1024,
                  let payload = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any], !payload.isEmpty else {
                throw MobileFailure("invalid-ai-request")
            }
            let settings = try NativeAISettings.read(read())
            guard provider == settings.provider else { throw MobileFailure("ai-settings-changed") }
            guard !settings.key.isEmpty else { throw MobileFailure("ai-key-missing") }
            let request = try Self.request(settings: settings, body: bytes)
            var result = try await NativeJSONTransport.perform(request, configuration: configuration(),
                limit: Self.maxResponseBytes, timeout: 120, prefix: "ai")
            guard expected == revision else { throw MobileFailure("ai-settings-changed") }
            // Providers can echo request headers in errors. No credential or raw response is logged here.
            if let status = result["status"] as? Int, !(200..<300).contains(status), var text = result["body"] as? String {
                for key in settings.keys { text = text.replacingOccurrences(of: key, with: "[redacted]") }
                result["body"] = text
            }
            return result
        }
    }
    static func request(settings: NativeAISettings, body: Data) throws -> URLRequest {
        var request = URLRequest(url: try settings.endpoint)
        request.httpMethod = "POST"; request.httpBody = body
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if settings.provider == "gemini" { request.setValue(settings.key, forHTTPHeaderField: "x-goog-api-key") }
        else { request.setValue("Bearer " + settings.key, forHTTPHeaderField: "Authorization") }
        return request
    }
}

// Preserve the existing delegate test seam while AI and sync share the same redirect policy.
typealias AIRedirectBlocker = NativeJSONRedirectBlocker
