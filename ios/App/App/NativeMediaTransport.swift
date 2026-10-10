import Foundation

// NativeMediaTransport.swift — audio requests never inherit gateway/platform credentials or cookies.
enum NativeMediaTransport {
    static let extensions = ["mp3", "m4a", "mp4", "aac", "flac", "wav", "aiff", "caf", "ogg", "audio"]
    static func request(_ url: URL, range: String? = nil) throws -> URLRequest {
        guard url.scheme == "https", url.host != nil, url.user == nil, url.password == nil else { throw MobileFailure("invalid-audio-url") }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.httpShouldHandleCookies = false
        request.setValue(range, forHTTPHeaderField: "Range")
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        return request
    }
    static func configuration(_ source: URLSessionConfiguration, resourceTimeout: TimeInterval) -> URLSessionConfiguration {
        let config = source.copy() as! URLSessionConfiguration
        config.httpCookieStorage = nil; config.httpShouldSetCookies = false; config.urlCredentialStorage = nil
        config.urlCache = nil; config.httpAdditionalHeaders = [:]
        config.timeoutIntervalForRequest = 20; config.timeoutIntervalForResource = resourceTimeout
        return config
    }
    static func fileExtension(_ response: URLResponse) -> String {
        let ext = response.url?.pathExtension.lowercased() ?? ""
        if extensions.contains(ext) { return ext }
        return ["audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/flac": "flac",
                "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "application/ogg": "ogg"][response.mimeType ?? ""] ?? "audio"
    }
}
