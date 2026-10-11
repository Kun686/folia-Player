import Foundation

// NativeAIClient.swift — bounded HTTPS transport for the configured AI service, independent of the music gateway.
@MainActor final class NativeAIClient {
    private let read: () throws -> [String: Any]
    private let write: ([String: Any]) throws -> Void
    private let configuration: () -> URLSessionConfiguration
    private var requests: [String: Task<[String: Any], Error>] = [:]
    private var earlyCancellations: [String] = []
    private(set) var revision = 0
    nonisolated static let maxResponseBytes = 1024 * 1024
    init(read: @escaping () throws -> [String: Any] = { try SecureStore.read("ai.settings") },
         write: @escaping ([String: Any]) throws -> Void = { try SecureStore.write("ai.settings", $0) },
         configuration: @escaping () -> URLSessionConfiguration = { .ephemeral }) {
        self.read = read; self.write = write; self.configuration = configuration
    }
    deinit { requests.values.forEach { $0.cancel() } }
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
        requests.values.forEach { $0.cancel() }
        return try snapshot()
    }
    func cancel(_ id: String) {
        guard !id.isEmpty, id.utf8.count <= 128 else { return }
        if let task = requests[id] { task.cancel() }
        else if !earlyCancellations.contains(id) {
            // A bridge cancellation can reach the main actor before its request Task starts.
            earlyCancellations.append(id)
            if earlyCancellations.count > 128 { earlyCancellations.removeFirst() }
        }
    }

    func send(id: String, expected: Int, provider: String, body: String) async throws -> [String: Any] {
        if let index = earlyCancellations.firstIndex(of: id) {
            earlyCancellations.remove(at: index); throw MobileFailure("ai-cancelled")
        }
        guard !Task.isCancelled else { throw MobileFailure("ai-cancelled") }
        guard expected == revision else { throw MobileFailure("ai-settings-changed") }
        guard !id.isEmpty, id.utf8.count <= 128, requests[id] == nil, requests.count < 2,
              let bytes = body.data(using: .utf8), bytes.count <= 256 * 1024,
              let payload = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any], !payload.isEmpty else {
            throw MobileFailure("invalid-ai-request")
        }
        let settings = try NativeAISettings.read(read())
        guard provider == settings.provider else { throw MobileFailure("ai-settings-changed") }
        guard !settings.key.isEmpty else { throw MobileFailure("ai-key-missing") }
        let request = try Self.request(settings: settings, body: bytes)
        let config = configuration()
        config.timeoutIntervalForRequest = 120; config.timeoutIntervalForResource = 120
        config.httpCookieStorage = nil; config.httpShouldSetCookies = false
        config.urlCache = nil; config.urlCredentialStorage = nil
        config.httpAdditionalHeaders = nil
        let task = Task { @MainActor in try await Self.perform(request, settings: settings, configuration: config) }
        requests[id] = task
        defer { requests[id] = nil }
        do {
            let result = try await withTaskCancellationHandler { try await task.value } onCancel: { task.cancel() }
            try Task.checkCancellation()
            guard expected == revision else { throw MobileFailure("ai-settings-changed") }
            return result
        } catch {
            if task.isCancelled || Task.isCancelled { throw MobileFailure("ai-cancelled") }
            if let failure = error as? MobileFailure { throw failure }
            if (error as? URLError)?.code == .timedOut { throw MobileFailure("ai-timeout") }
            throw MobileFailure("ai-network")
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
    nonisolated private static func perform(_ request: URLRequest, settings: NativeAISettings,
                                configuration: URLSessionConfiguration) async throws -> [String: Any] {
        let session = URLSession(configuration: configuration, delegate: AIRedirectBlocker(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let (stream, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse else { throw MobileFailure("ai-invalid-response") }
        guard response.expectedContentLength <= maxResponseBytes else { throw MobileFailure("ai-response-too-large") }
        var data = Data()
        // Bound chunked and SSE responses during receipt, not after an unbounded data(for:) allocation.
        for try await byte in stream {
            try Task.checkCancellation()
            guard data.count < maxResponseBytes else { throw MobileFailure("ai-response-too-large") }
            data.append(byte)
        }
        guard var text = String(data: data, encoding: .utf8) else { throw MobileFailure("ai-invalid-response") }
        // Providers can echo request headers in errors. No credential or raw response is logged here.
        if !(200..<300).contains(http.statusCode) {
            for key in settings.keys { text = text.replacingOccurrences(of: key, with: "[redacted]") }
        }
        return ["status": http.statusCode, "body": text, "contentType": http.value(forHTTPHeaderField: "Content-Type") ?? ""]
    }
}

final class AIRedirectBlocker: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
