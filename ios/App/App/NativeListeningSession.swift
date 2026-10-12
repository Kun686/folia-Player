import Foundation
import JavaScriptCore
import QuartzCore

// NativeListeningSession.swift — original tracker in a private JSContext, independent of WKWebView.
struct NativeListeningReport: Decodable {
    let songKey: String
    let mediaId: String
    let playedSeconds: Int
    let totalSeconds: Int
}
final class NativeListeningSession {
    private let context: JSContext
    private let session: JSValue
    init() throws {
        guard Thread.isMainThread, let context = JSContext(),
              let url = Bundle.main.url(forResource: "listening", withExtension: "js", subdirectory: "public/native") else {
            throw MobileFailure("listening-runtime-unavailable")
        }
        let script = try String(contentsOf: url, encoding: .utf8)
        guard script.utf8.count <= 1048576 else { throw MobileFailure("listening-runtime-unavailable") }
        context.evaluateScript(script, withSourceURL: url)
        guard context.exception == nil, let runtime = context.objectForKeyedSubscript("FoliaListening"),
              runtime.forProperty("protocolVersion")?.toInt32() == 1,
              let session = runtime.invokeMethod("create", withArguments: []), context.exception == nil, session.isObject else {
            throw MobileFailure("listening-runtime-unavailable")
        }
        self.context = context; self.session = session
    }
    func observe(song: [String: Any]?, occurrence: String, position: Double, duration: Double,
                 playing: Bool, nowMs: Double = CACurrentMediaTime() * 1000) throws -> NativeListeningReport? {
        guard position.isFinite, duration.isFinite, nowMs.isFinite else {
            try discard(); throw MobileFailure("invalid-listening-sample")
        }
        let data = try JSONSerialization.data(withJSONObject: ["song": song as Any? ?? NSNull(),
            "occurrence": occurrence, "position": position, "duration": duration, "playing": playing, "nowMs": nowMs])
        guard data.count <= 256 * 1024, let json = String(data: data, encoding: .utf8) else {
            try discard(); throw MobileFailure("invalid-listening-sample")
        }
        return try report("observe", [json])
    }
    func settle(nowMs: Double = CACurrentMediaTime() * 1000) throws -> NativeListeningReport? {
        try report("settle", [nowMs])
    }
    func discard() throws { _ = try invoke("discard", []) }
    func discontinuity() throws { _ = try invoke("discontinuity", []) }
    func listenedSeconds() throws -> Double { try invoke("listenedSeconds", []).toDouble() }
    private func report(_ method: String, _ arguments: [Any]) throws -> NativeListeningReport? {
        guard let json = try invoke(method, arguments).toString(), let data = json.data(using: .utf8) else {
            throw MobileFailure("invalid-listening-result")
        }
        return try JSONDecoder().decode(NativeListeningReport?.self, from: data)
    }
    private func invoke(_ method: String, _ arguments: [Any]) throws -> JSValue {
        guard Thread.isMainThread else { throw MobileFailure("listening-thread-required") }
        context.exception = nil
        guard let result = session.invokeMethod(method, withArguments: arguments), context.exception == nil else {
            context.exception = nil; throw MobileFailure("invalid-listening-sample")
        }
        return result
    }
}
