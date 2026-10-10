import Foundation

// NativeProfilePrefix.swift — the original 1.5MiB analysis budget; reject full responses before accepting their body.
final class NativeProfilePrefix: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    static let limit = 1_572_864
    private let configuration: URLSessionConfiguration
    private let lock = NSLock()
    private var session: URLSession?
    private var continuation: CheckedContinuation<Data, Error>?
    private var cancelled = false
    private var started = false
    private var expected = 0
    private var redirects = 0
    private var data = Data()

    init(configuration: URLSessionConfiguration = .ephemeral) { self.configuration = configuration; super.init() }
    static func request(_ url: URL) throws -> URLRequest {
        try NativeMediaTransport.request(url, range: "bytes=0-\(limit - 1)")
    }
    func read(_ url: URL) async throws -> Data {
        let request = try Self.request(url)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                lock.lock()
                guard !started, !cancelled else {
                    let error: Error = cancelled ? CancellationError() : MobileFailure("profile-request-reused")
                    lock.unlock(); continuation.resume(throwing: error); return
                }
                started = true; self.continuation = continuation
                let config = NativeMediaTransport.configuration(configuration, resourceTimeout: 30)
                let queue = OperationQueue(); queue.maxConcurrentOperationCount = 1; queue.qualityOfService = .utility
                let session = URLSession(configuration: config, delegate: self, delegateQueue: queue)
                self.session = session
                let task = session.dataTask(with: request)
                lock.unlock(); task.resume()
            }
        } onCancel: { self.cancel() }
    }
    private func cancel() {
        lock.lock(); cancelled = true; lock.unlock()
        finish(.failure(CancellationError()))
    }
    private func finish(_ result: Result<Data, Error>) {
        lock.lock()
        let continuation = self.continuation, session = self.session
        self.continuation = nil; self.session = nil; data = Data()
        lock.unlock()
        session?.invalidateAndCancel()
        continuation?.resume(with: result)
    }
    static func responseLength(_ response: HTTPURLResponse) throws -> Int {
        guard response.statusCode == 206,
              let range = response.value(forHTTPHeaderField: "Content-Range"),
              let match = range.range(of: "^bytes 0-[0-9]+/([0-9]+|\\*)$", options: .regularExpression), match == range.startIndex..<range.endIndex else {
            throw MobileFailure("profile-range-unavailable")
        }
        let parts = range.dropFirst(8).split(separator: "/")
        guard parts.count == 2, let last = Int(parts[0]), last >= 0, last < limit,
              parts[1] == "*" || (UInt64(parts[1]).map { $0 > UInt64(last) } ?? false),
              response.expectedContentLength < 0 || response.expectedContentLength == last + 1,
              response.value(forHTTPHeaderField: "Content-Encoding").map({ $0.lowercased() == "identity" }) ?? true else {
            throw MobileFailure("profile-range-unavailable")
        }
        return last + 1
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        do {
            guard let http = response as? HTTPURLResponse else { throw MobileFailure("profile-range-unavailable") }
            let count = try Self.responseLength(http)
            lock.lock(); expected = count; let active = continuation != nil; lock.unlock()
            completionHandler(active ? .allow : .cancel)
        } catch { completionHandler(.cancel); finish(.failure(error)) }
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive chunk: Data) {
        lock.lock()
        guard continuation != nil else { lock.unlock(); return }
        guard expected > 0, chunk.count <= expected - data.count else {
            lock.unlock(); finish(.failure(MobileFailure("profile-range-overflow"))); return
        }
        data.append(chunk); lock.unlock()
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let result: Result<Data, Error> = cancelled ? .failure(CancellationError())
            : error != nil ? .failure(MobileFailure("profile-network"))
            : expected > 0 && data.count == expected ? .success(data) : .failure(MobileFailure("profile-incomplete-range"))
        lock.unlock(); finish(result)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        lock.lock(); redirects += 1; let allowed = redirects <= 5 && continuation != nil; lock.unlock()
        // Rebuild instead of forwarding headers: neither credentials nor cookies may follow a CDN redirect.
        if allowed, let url = request.url, let clean = try? Self.request(url) { completionHandler(clean) }
        else { completionHandler(nil); finish(.failure(MobileFailure("profile-redirect-unavailable"))) }
    }
}
