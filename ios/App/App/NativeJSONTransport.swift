import Foundation

// NativeJSONTransport.swift — shared bounded text transport; callers supply only already-validated HTTPS destinations and headers.
enum NativeJSONTransport {
    static func perform(_ request: URLRequest, configuration: URLSessionConfiguration, limit: Int,
                        timeout: TimeInterval, prefix: String) async throws -> [String: Any] {
        configuration.timeoutIntervalForRequest = timeout; configuration.timeoutIntervalForResource = timeout
        configuration.httpCookieStorage = nil; configuration.httpShouldSetCookies = false
        configuration.urlCache = nil; configuration.urlCredentialStorage = nil; configuration.httpAdditionalHeaders = nil
        let session = URLSession(configuration: configuration, delegate: NativeJSONRedirectBlocker(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let (stream, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse else { throw MobileFailure(prefix + "-invalid-response") }
        guard response.expectedContentLength <= limit else { throw MobileFailure(prefix + "-response-too-large") }
        var data = Data()
        // Bound chunked and SSE responses during receipt, not after an unbounded data(for:) allocation.
        for try await byte in stream {
            try Task.checkCancellation()
            guard data.count < limit else { throw MobileFailure(prefix + "-response-too-large") }
            data.append(byte)
        }
        guard let text = String(data: data, encoding: .utf8) else { throw MobileFailure(prefix + "-invalid-response") }
        return ["status": http.statusCode, "body": text, "contentType": http.value(forHTTPHeaderField: "Content-Type") ?? ""]
    }
}

final class NativeJSONRedirectBlocker: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
