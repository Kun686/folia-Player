import Foundation
import JavaScriptCore

// NativeLocalLyrics.swift — original file parser runs off the main actor, with bounded input and results.
actor NativeLocalLyricParser {
    private let scriptURL: URL?
    private var context: JSContext?
    init(bundle: Bundle = .main) {
        scriptURL = bundle.url(forResource: "lyrics", withExtension: "js", subdirectory: "public/native")
    }
    func parse(_ content: String, fileName: String? = nil) throws -> Data? {
        try Task.checkCancellation()
        guard content.utf8.count <= 2_000_000, (fileName?.utf8.count ?? 0) <= 1024 else { throw MobileFailure("lyrics-too-large") }
        if context == nil {
            guard let scriptURL, let source = try? String(contentsOf: scriptURL, encoding: .utf8),
                  source.utf8.count <= 2_000_000, let created = JSContext() else { throw MobileFailure("lyric-runtime-unavailable") }
            created.evaluateScript(source, withSourceURL: scriptURL)
            guard created.exception == nil,
                  created.objectForKeyedSubscript("FoliaLocalLyrics")?.forProperty("protocolVersion")?.toInt32() == 1 else {
                throw MobileFailure("lyric-runtime-unavailable")
            }
            context = created
        }
        guard let context else { throw MobileFailure("lyric-runtime-unavailable") }
        var request: [String: Any] = ["version": 1, "content": content]
        if let fileName { request["fileName"] = fileName }
        let input = try JSONSerialization.data(withJSONObject: request)
        context.exception = nil
        let result = context.objectForKeyedSubscript("FoliaLocalLyrics")?.invokeMethod("parseJSON", withArguments: [String(decoding: input, as: UTF8.self)])
        guard context.exception == nil, let text = result?.toString(), let data = text.data(using: .utf8), data.count <= 262144 else {
            context.exception = nil
            throw MobileFailure("invalid-local-lyrics")
        }
        try Task.checkCancellation()
        return data == Data("null".utf8) ? nil : data
    }
}

// Current and next local lyric files only. A changed import invalidates the cached result before re-planning.
final class NativeLocalLyrics {
    private struct Value { let lines: [[String: Any]]? }
    private let local: LocalMediaLibrary
    private let parser: NativeLocalLyricParser
    private var wanted: Set<String> = []
    private var tasks: [String: (UUID, Task<Void, Never>)] = [:]
    private var values: [String: Value] = [:]
    private(set) var revision = 0
    var changed: (() -> Void)?
    init(local: LocalMediaLibrary, parser: NativeLocalLyricParser = NativeLocalLyricParser()) {
        self.local = local; self.parser = parser
    }
    deinit { tasks.values.forEach { $0.1.cancel() } }
    func value(_ song: [String: Any]) -> [[String: Any]]? {
        NativeProfileIdentity(song)?.localID.flatMap { values[$0]?.lines }
    }
    func cancel() { tasks.values.forEach { $0.1.cancel() }; tasks.removeAll(); wanted.removeAll() }
    func invalidate(_ id: String) {
        tasks.removeValue(forKey: id)?.1.cancel(); values.removeValue(forKey: id); wanted.remove(id)
        revision += 1
    }
    func update(_ songs: [[String: Any]]) {
        let ids = Set(songs.prefix(2).compactMap { NativeProfileIdentity($0)?.localID })
        guard ids != wanted else { return }
        for id in Array(tasks.keys) where !ids.contains(id) { tasks.removeValue(forKey: id)?.1.cancel() }
        values = values.filter { ids.contains($0.key) }; wanted = ids
        for id in ids where values[id] == nil && tasks[id] == nil {
            let stamp = UUID()
            let task = Task(priority: .utility) { @MainActor [weak self, local, parser] in
                let lines: [[String: Any]]?
                do {
                    let source = try await local.lyricSource(id)
                    try Task.checkCancellation()
                    if let source, let data = try await parser.parse(source.content, fileName: source.fileName) {
                        lines = try JSONSerialization.jsonObject(with: data) as? [[String: Any]]
                    } else { lines = nil }
                } catch { lines = nil }
                guard let self, !Task.isCancelled, self.wanted.contains(id), self.tasks[id]?.0 == stamp else { return }
                self.tasks.removeValue(forKey: id); self.values[id] = Value(lines: lines)
                self.revision += 1; self.changed?()
            }
            tasks[id] = (stamp, task)
        }
    }
}
