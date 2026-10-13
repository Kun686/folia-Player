import Foundation
import JavaScriptCore

// NativeLyricMatchJob.swift — event-driven original matcher on a private VM, without WKWebView or the main actor.
actor NativeLyricMatchJob {
    private let scriptURL: URL?
    init(scriptURL: URL? = Bundle.main.url(forResource: "lyric-match", withExtension: "js", subdirectory: "public/native")) {
        self.scriptURL = scriptURL
    }
    func run(_ input: [String: Any],
             baseline: (([String: Any]) async throws -> Void)? = nil,
             request: @escaping ([String: Any]) async throws -> [String: Any]) async throws -> [String: Any]? {
        try Task.checkCancellation()
        let inputData = try JSONSerialization.data(withJSONObject: input)
        guard inputData.count <= 3_000_000, let scriptURL,
              let source = try? String(contentsOf: scriptURL, encoding: .utf8), source.utf8.count <= 2_000_000,
              let context = JSContext() else { throw MobileFailure("lyric-runtime-unavailable") }
        context.evaluateScript(source, withSourceURL: scriptURL)
        guard context.exception == nil, let runtime = context.objectForKeyedSubscript("FoliaLyricMatch"),
              runtime.forProperty("protocolVersion")?.toInt32() == 1 else { throw MobileFailure("lyric-runtime-unavailable") }
        let inflate: @convention(block) (String) -> String? = { NativeLyricInflate.text($0) }
        guard let job = runtime.invokeMethod("createJobJSON", withArguments: [String(decoding: inputData, as: UTF8.self), inflate]),
              context.exception == nil, !job.isUndefined else { throw MobileFailure("invalid-lyric-job") }
        let (stream, continuation) = AsyncStream<(Int, Data)>.makeStream(bufferingPolicy: .bufferingOldest(32))
        var tasks: [Int: Task<Void, Never>] = [:]
        var iterator = stream.makeAsyncIterator()
        let watchdog = Task {
            do {
                try await Task.sleep(nanoseconds: 60_000_000_000)
                continuation.yield((0, Data()))
            } catch { /* The job completed or was cancelled. */ }
        }
        defer {
            watchdog.cancel(); tasks.values.forEach { $0.cancel() }; continuation.finish()
            job.invokeMethod("cancel", withArguments: [])
        }
        for _ in 0..<256 {
            try Task.checkCancellation()
            guard let text = job.invokeMethod("stateJSON", withArguments: [])?.toString(), context.exception == nil,
                  text.utf8.count <= 8_000_000,
                  let state = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
                  let events = state["events"] as? [[String: Any]], events.count <= 128 else { throw MobileFailure("invalid-lyric-job") }
            if let updates = state["updates"] as? [[String: Any]] {
                guard updates.count <= 1 else { throw MobileFailure("invalid-lyric-job") }
                for document in updates { try await baseline?(document) }
            }
            if state["done"] as? Bool == true {
                if state["error"] != nil { throw MobileFailure("lyric-match-failed") }
                try Task.checkCancellation()
                return state["result"] as? [String: Any]
            }
            for event in events {
                guard let id = event["id"] as? Int, (1...128).contains(id), let kind = event["kind"] as? String else {
                    throw MobileFailure("invalid-lyric-job")
                }
                if kind == "cancel" { tasks.removeValue(forKey: id)?.cancel(); continue }
                guard tasks[id] == nil, tasks.count < 16 else { throw MobileFailure("lyric-job-limit") }
                let body = event["request"] as? [String: Any], delay = event["milliseconds"] as? Int
                guard (kind == "request" && body != nil) || (kind == "timer" && (1...10000).contains(delay ?? 0)) else {
                    throw MobileFailure("invalid-lyric-job")
                }
                tasks[id] = Task {
                    var message: [String: Any] = ["id": id]
                    do {
                        if let body { message["reply"] = try await request(body) }
                        else {
                            try await Task.sleep(nanoseconds: UInt64(delay!) * 1_000_000)
                            message["reply"] = ["status": 200, "body": ""]
                        }
                        try Task.checkCancellation()
                        let data = try JSONSerialization.data(withJSONObject: message)
                        guard data.count <= 12_100_000 else { throw MobileFailure("lyrics-too-large") }
                        continuation.yield((id, data))
                    } catch {
                        // No provider response text, credentials or request URLs enter diagnostics.
                        if !Task.isCancelled { continuation.yield((id, Data("{\"id\":\(id),\"error\":true}".utf8))) }
                    }
                }
            }
            guard let (id, data) = await iterator.next() else { throw CancellationError() }
            try Task.checkCancellation()
            guard id != 0 else { throw MobileFailure("lyric-job-timeout") }
            tasks.removeValue(forKey: id)
            job.invokeMethod("replyJSON", withArguments: [String(decoding: data, as: UTF8.self)])
            guard context.exception == nil else { throw MobileFailure("invalid-lyric-response") }
        }
        throw MobileFailure("lyric-job-limit")
    }
}
