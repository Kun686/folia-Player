import Foundation
import JavaScriptCore

// lyric-match-host-probe.swift — finite offline Mac execution of the production Swift host and raw provider adapters.
private func require(_ value: @autoclosure () -> Bool, _ code: String) throws {
    if !value() { throw MobileFailure(code) }
}
private func reply(_ body: [String: Any]) throws -> [String: Any] {
    ["status": 200, "body": String(decoding: try JSONSerialization.data(withJSONObject: body), as: UTF8.self)]
}
private actor ProbeRequests {
    var active = 0, cancelled = 0, calls = 0
    func wait(_ nanoseconds: UInt64) async throws {
        active += 1; calls += 1
        defer { active -= 1 }
        do { try await Task.sleep(nanoseconds: nanoseconds) }
        catch { cancelled += 1; throw error }
    }
    func snapshot() -> [String: Int] { ["active": active, "cancelled": cancelled, "calls": calls] }
}
@main struct LyricMatchHostProbe {
    static func main() async {
        do { try await run() }
        catch { FileHandle.standardError.write(Data("FAIL: \((error as? MobileFailure)?.code ?? "probe-error")\n".utf8)); exit(1) }
    }
    static func run() async throws {
        guard CommandLine.arguments.count == 4 else { throw MobileFailure("usage-script-fixtures-new-result") }
        let script = URL(fileURLWithPath: CommandLine.arguments[1]), fixtures = URL(fileURLWithPath: CommandLine.arguments[2])
        let output = URL(fileURLWithPath: CommandLine.arguments[3])
        try require(!FileManager.default.fileExists(atPath: output.path), "result-exists")
        guard let context = JSContext() else { throw MobileFailure("missing-jsc") }
        context.evaluateScript(try String(contentsOf: script, encoding: .utf8))
        try require(context.exception == nil, "runtime-load")
        try require(context.evaluateScript("['window','document','fetch','setTimeout','localStorage','Worker','URLSearchParams'].every(k => typeof globalThis[k] === 'undefined')")?.toBool() == true, "browser-global-leak")
        guard let rows = try JSONSerialization.jsonObject(with: Data(contentsOf: fixtures)) as? [[String: Any]] else { throw MobileFailure("fixtures") }
        func fixture(_ name: String) throws -> [String: Any] {
            guard let steps = rows.first(where: { $0["name"] as? String == name })?["steps"] as? [[String: Any]],
                  let input = steps.last?["input"] as? [String: Any], let replies = input["responses"] as? [[String: Any]], let last = replies.last else {
                throw MobileFailure("fixture-missing")
            }
            return last
        }
        let title = "合成测试", artist = "测试", album = "测试专辑"
        @Sendable func input(_ preferred: String) -> [String: Any] {
            ["version": 1, "title": title, "artist": artist, "durationMs": 30000,
             "options": ["album": album, "preferredSource": preferred]]
        }
        let ncmSearch = try reply(["code": 200, "result": ["songCount": 1, "songs": [
            ["id": 42, "name": title, "ar": [["id": 1, "name": artist]], "al": ["id": 2, "name": album], "dt": 30000]]]])
        let qqSearch = try reply(["code": 0, "request": ["code": 0, "data": ["body": ["item_song": [
            ["id": 42, "mid": "mid42", "title": title, "singer": [["id": 1, "name": artist]], "album": ["id": 2, "name": album], "interval": 30]]]]]])
        let kgSearch = try reply(["data": ["total": 1, "lists": [["FileHash": "ABC123", "SongName": title,
            "SingerName": artist, "AlbumName": album, "Duration": 30, "album_audio_id": 76]]]])
        let ttml = "<tt xmlns=\"http://www.w3.org/ns/ttml\" xmlns:itunes=\"http://music.apple.com/lyric-ttml-internal\" itunes:timing=\"Word\"><body><div><p itunes:key=\"L1\" begin=\"1s\" end=\"3s\"><span begin=\"1s\" end=\"3s\">歌词</span></p></div></body></tt>"
        let qqLyrics = try fixture("qq-qrc"), neteaseLyrics = try fixture("netease-yrc")
        let send: ([String: Any]) async throws -> [String: Any] = { request in
            let provider = request["provider"] as? String, path = request["path"] as? String ?? ""
            if provider == "amll" { return try reply(["status": 200, "data": ["lyrics": ttml]]) }
            if path == "/cloudsearch" { return ncmSearch }
            if path == "/lyric/new" { return neteaseLyrics }
            if path == "/song/chorus" { return try reply(["code": 200, "chorus": []]) }
            if path.contains("u.y.qq.com") {
                guard let text = request["body"] as? String,
                      let body = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
                      let operation = body["request"] as? [String: Any] else { throw MobileFailure("qq-request") }
                return operation["method"] as? String == "DoSearchForQQMusicLite" ? qqSearch : qqLyrics
            }
            if path.contains("complexsearch.kugou.com") || path == "/search" { return kgSearch }
            if path == "/search/lyric" { return try reply(["candidates": [["id": 1, "accesskey": "synthetic"]]]) }
            if path == "/lyric" { return try reply(["decodeContent": "[1000,3000]<0,1000,0>合成<1000,2000,0>歌词"]) }
            if path == "/song/climax" { return try reply(["data": []]) }
            throw MobileFailure("unexpected-request")
        }
        var cases: [[String: Any]] = []
        for provider in ["qq", "netease", "kugou", "amll"] {
            let result = try await NativeLyricMatchJob(scriptURL: script).run(input(provider), request: send)
            try require(result?["source"] as? String == provider, "source-" + provider)
            try require((result?["lyrics"] as? [String: Any])?["isWordByWord"] as? Bool == true, "word-" + provider)
            cases.append(["name": provider, "passed": true]); print("PASS original raw \(provider) path")
        }
        // Same actor, separate per-call VMs: current and next may overlap without sharing replies or fallback state.
        let shared = NativeLyricMatchJob(scriptURL: script)
        async let first = shared.run(input("qq"), request: { request in
            try await Task.sleep(nanoseconds: 20_000_000); return try await send(request)
        })
        async let second = shared.run(input("netease"), request: send)
        let pair = try await (first, second)
        try require(pair.0?["source"] as? String == "qq" && pair.1?["source"] as? String == "netease", "concurrent-jobs")
        cases.append(["name": "concurrent", "passed": true]); print("PASS concurrent isolated jobs")

        let delayed = ProbeRequests(), start = ProcessInfo.processInfo.systemUptime
        let timed = try await NativeLyricMatchJob(scriptURL: script).run(input("qq"), request: { request in
            if (request["path"] as? String)?.contains("u.y.qq.com") == true { try await delayed.wait(10_000_000_000) }
            return try await send(request)
        })
        let elapsed = ProcessInfo.processInfo.systemUptime - start
        let timeoutState = await delayed.snapshot()
        try require(timed?["source"] as? String == "netease" && elapsed >= 3.3 && elapsed < 6, "search-deadline")
        try require(timeoutState["cancelled"] == 1 && timeoutState["active"] == 0, "search-task-not-cancelled")
        cases.append(["name": "search-timeout", "seconds": elapsed, "transport": timeoutState, "passed": true]); print("PASS real 3500ms deadline and request cancellation")

        let amllDelayed = ProbeRequests()
        var amllInput = input("amll")
        amllInput["options"] = ["album": album, "preferredSource": "amll", "metadataCandidate": ["source": "qq", "songId": "mid42"]]
        let amllStart = ProcessInfo.processInfo.systemUptime
        let amllResult = try await NativeLyricMatchJob(scriptURL: script).run(amllInput, request: { request in
            if (request["path"] as? String)?.hasSuffix("qqMusicId=mid42") == true { try await amllDelayed.wait(10_000_000_000) }
            return try await send(request)
        })
        let amllTime = ProcessInfo.processInfo.systemUptime - amllStart, amllState = await amllDelayed.snapshot()
        try require(amllResult?["source"] as? String == "amll" && amllTime >= 4.8 && amllTime < 8, "amll-id-deadline")
        try require(amllState["cancelled"] == 1 && amllState["active"] == 0, "amll-mid-task-not-cancelled")
        cases.append(["name": "amll-mid-timeout-numeric-fallback", "seconds": amllTime, "transport": amllState, "passed": true])
        print("PASS real 5000ms AMLL mid timeout and numeric-ID fallback")

        let cancelled = ProbeRequests()
        let work = Task { try await NativeLyricMatchJob(scriptURL: script).run(input("qq"), request: { request in
            try await cancelled.wait(10_000_000_000); return try await send(request)
        }) }
        try await Task.sleep(nanoseconds: 100_000_000)
        work.cancel()
        do { _ = try await work.value; throw MobileFailure("cancelled-job-returned-result") }
        catch is CancellationError { }
        try await Task.sleep(nanoseconds: 30_000_000)
        let cancelState = await cancelled.snapshot()
        try require(cancelState["cancelled"] == 1 && cancelState["active"] == 0, "job-request-not-cancelled")
        cases.append(["name": "parent-task-cancellation", "transport": cancelState, "passed": true]); print("PASS parent task cancellation and cleanup")
        let result: [String: Any] = ["passed": true, "globalsAbsent": true, "realNetwork": false, "physicalDevice": false, "cases": cases]
        try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]).write(to: output, options: .atomic)
    }
}
