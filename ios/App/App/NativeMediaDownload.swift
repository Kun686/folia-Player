import Foundation

// NativeMediaDownload.swift — URLSession streams complete cache downloads to disk, with cancellation and bounded redirects.
struct DownloadedMedia: Sendable { let url: URL; let fileExtension: String; let bytes: Int64 }
final class NativeMediaDownload: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let configuration: URLSessionConfiguration
    private let maximumBytes: Double
    private let lock = NSLock()
    private var continuation: CheckedContinuation<DownloadedMedia, Error>?
    private var session: URLSession?
    private var file: DownloadedMedia?
    private var started = false, cancelled = false
    private var redirects = 0
    init(configuration: URLSessionConfiguration = .ephemeral, maximumBytes: Double = .greatestFiniteMagnitude) {
        self.configuration = configuration; self.maximumBytes = maximumBytes; super.init()
    }
    func read(_ url: URL) async throws -> DownloadedMedia {
        let request = try NativeMediaTransport.request(url)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                lock.lock()
                guard !started, !cancelled else {
                    lock.unlock(); continuation.resume(throwing: CancellationError()); return
                }
                started = true; self.continuation = continuation
                let queue = OperationQueue(); queue.maxConcurrentOperationCount = 1; queue.qualityOfService = .utility
                let session = URLSession(configuration: NativeMediaTransport.configuration(configuration, resourceTimeout: 600),
                                         delegate: self, delegateQueue: queue)
                self.session = session
                let task = session.downloadTask(with: request)
                lock.unlock(); task.resume()
            }
        } onCancel: {
            self.lock.lock(); self.cancelled = true; self.lock.unlock()
            self.finish(.failure(CancellationError()))
        }
    }
    private func finish(_ result: Result<DownloadedMedia, Error>) {
        lock.lock()
        let continuation = self.continuation, session = self.session, file = self.file
        self.continuation = nil; self.session = nil; self.file = nil
        lock.unlock()
        session?.invalidateAndCancel()
        if case .failure = result, let file { try? FileManager.default.removeItem(at: file.url) }
        continuation?.resume(with: result)
    }
    static func validate(_ response: URLResponse?, maximumBytes: Double) throws -> HTTPURLResponse {
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 || http.statusCode == 206,
              !(http.mimeType?.hasPrefix("text/") ?? false), http.mimeType != "application/json",
              http.value(forHTTPHeaderField: "Content-Encoding").map({ $0.lowercased() == "identity" }) ?? true else {
            throw MobileFailure("cache-response-unavailable")
        }
        if http.statusCode == 206 {
            guard let range = http.value(forHTTPHeaderField: "Content-Range"), range.hasPrefix("bytes 0-"),
                  range.range(of: "^bytes 0-[0-9]+/[0-9]+$", options: .regularExpression) != nil else {
                throw MobileFailure("cache-incomplete-response")
            }
            let parts = range.dropFirst(8).split(separator: "/")
            guard parts.count == 2, let end = Int64(parts[0]), let total = Int64(parts[1]), total > 0,
                  end == total - 1, http.expectedContentLength == total else { throw MobileFailure("cache-incomplete-response") }
        }
        guard Double(http.expectedContentLength) <= maximumBytes else { throw MobileFailure("cache-limit") }
        return http
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        do {
            _ = try Self.validate(downloadTask.response, maximumBytes: maximumBytes)
            guard Double(totalBytesWritten) <= maximumBytes else { throw MobileFailure("cache-limit") }
        } catch { finish(.failure(error)) }
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        var owned: URL?
        do {
            let response = try Self.validate(downloadTask.response, maximumBytes: maximumBytes)
            let bytes = try FileManager.default.attributesOfItem(atPath: location.path)[.size] as? NSNumber
            guard let bytes, bytes.int64Value > 0, Double(bytes.int64Value) <= maximumBytes,
                  response.expectedContentLength < 0 || response.expectedContentLength == bytes.int64Value else {
                throw MobileFailure("cache-incomplete-response")
            }
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("FoliaDownload-" + UUID().uuidString)
            owned = url
            try FileManager.default.moveItem(at: location, to: url)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
            lock.lock()
            if continuation != nil, !cancelled {
                file = DownloadedMedia(url: url, fileExtension: NativeMediaTransport.fileExtension(response), bytes: bytes.int64Value)
                owned = nil
            }
            lock.unlock()
        } catch { finish(.failure(error)) }
        if let owned { try? FileManager.default.removeItem(at: owned) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let result: Result<DownloadedMedia, Error> = cancelled ? .failure(CancellationError())
            : error != nil ? .failure(MobileFailure("cache-network"))
            : file.map(Result.success) ?? .failure(MobileFailure("cache-incomplete-response"))
        lock.unlock(); finish(result)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        lock.lock(); redirects += 1; let active = redirects <= 5 && continuation != nil; lock.unlock()
        if active, let url = request.url, let clean = try? NativeMediaTransport.request(url) { completionHandler(clean) }
        else { completionHandler(nil); finish(.failure(MobileFailure("cache-redirect-unavailable"))) }
    }
}
