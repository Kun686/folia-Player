import Foundation
import JavaScriptCore

// NativeLyrics.swift — original file parser runs off the main actor, with bounded input and results.
actor NativeLyricParser {
    private let scriptURL: URL?
    private var context: JSContext?
    init(bundle: Bundle = .main) {
        scriptURL = bundle.url(forResource: "lyrics", withExtension: "js", subdirectory: "public/native")
    }
    func parse(_ content: String, fileName: String? = nil, translation: String? = nil) throws -> Data? {
        try Task.checkCancellation()
        guard content.utf8.count <= 2_000_000, (translation?.utf8.count ?? 0) <= 2_000_000,
              (fileName?.utf8.count ?? 0) <= 1024 else { throw MobileFailure("lyrics-too-large") }
        var request: [String: Any] = ["version": 1, "content": content]
        if let fileName { request["fileName"] = fileName }
        if let translation { request["translationContent"] = translation }
        let data = try call("parseJSON", input: JSONSerialization.data(withJSONObject: request), inputLimit: 24_300_000)
        guard data.count <= 262144 else { throw MobileFailure("invalid-local-lyrics") }
        return data == Data("null".utf8) ? nil : data
    }
    func embeddedTags(_ tags: [[String: String]]) throws -> EmbeddedLyrics {
        let input = try JSONSerialization.data(withJSONObject: ["version": 1, "tags": tags])
        let data = try call("embeddedTagsJSON", input: input, limit: 24_300_000, inputLimit: 24_300_000)
        let result = try JSONDecoder().decode(EmbeddedLyrics.self, from: data)
        guard (result.lyrics?.utf8.count ?? 0) <= 2_000_000,
              (result.translationLyrics?.utf8.count ?? 0) <= 2_000_000 else { throw MobileFailure("lyrics-too-large") }
        return result
    }
    func flacTags(_ url: URL) throws -> EmbeddedLyrics {
        try Task.checkCancellation()
        do { return try NativeMetadataFile.read(url, context: lyricContext()) }
        catch { context = nil; throw error } // Discard any unfinished JS jobs before reusing this actor.
    }
    func localMatchDocument(_ document: [String: Any]) throws -> String {
        let input = try JSONSerialization.data(withJSONObject: document)
        let result = try call("localMatchJSON", input: input, limit: 3_000_000, inputLimit: 8_000_000)
        guard let text = String(data: result, encoding: .utf8) else { throw MobileFailure("invalid-local-match") }
        return text
    }
    func onlineStep(_ input: Data) throws -> Data { try call("stepJSON", input: input, limit: 3_000_000) }
    func localSources(_ snapshot: [String: Any], priority: String = "local") throws -> Data? {
        let input = try JSONSerialization.data(withJSONObject: ["version": 1, "snapshot": snapshot, "priority": priority])
        let data = try call("sourcesJSON", input: input, inputLimit: 37_000_000)
        guard data.count <= 262144 else { throw MobileFailure("invalid-local-lyrics") }
        return data == Data("null".utf8) ? nil : data
    }
    func cacheDocument(_ payload: [String: Any]) throws -> [String: Any] {
        let input = try JSONSerialization.data(withJSONObject: ["version": 1, "payload": payload])
        guard input.count <= 8_000_000,
              let result = try JSONSerialization.jsonObject(with: call("cacheJSON", input: input, limit: 8_000_000)) as? [String: Any]
        else { throw MobileFailure("invalid-lyric-cache") }
        return result
    }

    private func lyricContext() throws -> JSContext {
        if context == nil {
            guard let scriptURL, let source = try? String(contentsOf: scriptURL, encoding: .utf8),
                  source.utf8.count <= 2_000_000, let created = JSContext() else { throw MobileFailure("lyric-runtime-unavailable") }
            created.evaluateScript(source, withSourceURL: scriptURL)
            guard created.exception == nil,
                  created.objectForKeyedSubscript("FoliaLocalLyrics")?.forProperty("protocolVersion")?.toInt32() == 1 else {
                throw MobileFailure("lyric-runtime-unavailable")
            }
            let inflate: @convention(block) (String) -> String? = { NativeLyricInflate.text($0) }
            created.setObject(inflate, forKeyedSubscript: "foliaInflate" as NSString)
            context = created
        }
        guard let context else { throw MobileFailure("lyric-runtime-unavailable") }
        return context
    }
    private func call(_ method: String, input: Data, limit: Int = 300000, inputLimit: Int = 12_100_000) throws -> Data {
        try Task.checkCancellation()
        guard input.count <= inputLimit else { throw MobileFailure("lyrics-too-large") }
        let context = try lyricContext()
        guard let inflate = context.objectForKeyedSubscript("foliaInflate") else { throw MobileFailure("lyric-runtime-unavailable") }
        context.exception = nil
        let result = context.objectForKeyedSubscript("FoliaLocalLyrics")?.invokeMethod(method,
            withArguments: [String(decoding: input, as: UTF8.self), inflate])
        guard context.exception == nil, let text = result?.toString(), let data = text.data(using: .utf8), data.count <= limit else {
            context.exception = nil
            throw MobileFailure("invalid-local-lyrics")
        }
        try Task.checkCancellation()
        return data
    }
}

// Current/next lyrics only. Import and account changes invalidate pending work before re-planning.
final class NativeLyrics {
    private struct Value { let lines: [[String: Any]]? }
    private let local: LocalMediaLibrary
    private let parser: NativeLyricParser
    private let gateway: GatewayClient
    private let cache: NativeLyricCache?
    private let session: ((String) throws -> [String: Any])?
    private var wanted: Set<String> = []
    private var tasks: [String: (UUID, Task<Void, Never>)] = [:]
    private var values: [String: Value] = [:]
    private var selections: Set<String> = []
    private var localPriority = "local"
    private var settings = NativeLyricSettings()
    private(set) var revision = 0
    var changed: (() -> Void)?
    var cacheChanged: (([String: Any]) -> Void)?
    // Only explicit choices briefly hold new Automix planning; audio and optional matching continue.
    var awaitingSelection: Bool { !selections.isDisjoint(with: wanted) }
    init(local: LocalMediaLibrary, parser: NativeLyricParser = NativeLyricParser(), gateway: GatewayClient = GatewayClient(), cache: NativeLyricCache? = nil,
         session: ((String) throws -> [String: Any])? = nil) {
        self.local = local; self.parser = parser; self.gateway = gateway; self.session = session; self.cache = cache
    }
    deinit { tasks.values.forEach { $0.1.cancel() } }
    func value(_ song: [String: Any]) -> [[String: Any]]? {
        NativeProfileIdentity(song).flatMap { values[$0.key]?.lines }
    }
    func cancel() {
        for (id, task) in tasks { task.1.cancel(); values.removeValue(forKey: id) }
        tasks.removeAll(); wanted.removeAll(); selections.removeAll()
    }
    func invalidate(_ id: String) {
        invalidateKey("local:" + id)
    }
    func invalidateSong(_ song: [String: Any], selection: Bool = false) {
        guard let id = NativeProfileIdentity(song) else { return }
        invalidateKey(id.key)
        if selection { selections.insert(id.key) }
    }
    private func invalidateKey(_ key: String) {
        tasks.removeValue(forKey: key)?.1.cancel(); values.removeValue(forKey: key); wanted.remove(key)
        revision += 1
    }
    func invalidateProvider(_ provider: String) {
        for key in Set(values.keys).union(tasks.keys).union(wanted) where key.hasPrefix(settings.autoUseBestLyric == true ? "online:" : "online:" + provider + ":") {
            invalidateKey(key)
        }
    }
    func setLocalPriority(_ priority: String) -> Bool {
        guard ["local", "online"].contains(priority), priority != localPriority else { return false }
        localPriority = priority
        for key in Set(values.keys).union(tasks.keys).union(wanted) where key.hasPrefix("local:") {
            invalidateKey(key)
        }
        return true
    }
    func setSettings(_ value: NativeLyricSettings) -> Bool {
        let localChanged = setLocalPriority(value.localLyricsPriority)
        let onlineChanged = settings.autoUseBestLyric != value.autoUseBestLyric
            || settings.preferredAlternativeLyricSource != value.preferredAlternativeLyricSource
        settings = value
        if onlineChanged {
            for key in Set(values.keys).union(tasks.keys).union(wanted) where key.hasPrefix("online:") { invalidateKey(key) }
        }
        return localChanged || onlineChanged
    }
    func update(_ songs: [[String: Any]]) {
        let identities = songs.prefix(2).compactMap(NativeProfileIdentity.init).filter { $0.localID != nil || ["netease", "qq"].contains($0.provider ?? "") }
        let ids = Set(identities.map(\.key))
        guard ids != wanted else { return }
        for id in Array(tasks.keys) where !ids.contains(id) { tasks.removeValue(forKey: id)?.1.cancel() }
        values = values.filter { ids.contains($0.key) }; wanted = ids; selections.formIntersection(ids)
        for id in ids where values[id] == nil && tasks[id] == nil {
            guard let identity = identities.first(where: { $0.key == id }),
                  let song = songs.first(where: { NativeProfileIdentity($0)?.key == id }) else { continue }
            let stamp = UUID()
            let priority = localPriority, settings = settings
            let task = Task(priority: .utility) { @MainActor [weak self, local, parser, gateway, session, cache] in
                let lines: [[String: Any]]?
                do {
                    if let localID = identity.localID {
                        let source = try await local.readLyricSources(localID)
                        try Task.checkCancellation()
                        if let data = try await parser.localSources(source, priority: priority) {
                            lines = try JSONSerialization.jsonObject(with: data) as? [[String: Any]]
                        } else { lines = nil }
                    } else if session == nil, let cache {
                        lines = try await NativeBestLyrics.load(song, settings: settings, cache: cache, gateway: gateway,
                            baseline: { [weak self] lines in
                                await MainActor.run {
                                    guard let self, !Task.isCancelled, self.wanted.contains(id), self.tasks[id]?.0 == stamp else { return }
                                    self.values[id] = Value(lines: lines); self.selections.remove(id)
                                    self.revision += 1; self.changed?()
                                }
                            }, saved: { [weak self] in
                                await MainActor.run {
                                    guard let self, !Task.isCancelled, self.tasks[id]?.0 == stamp else { return }
                                    self.cacheChanged?(song)
                                }
                            })
                    } else {
                        let load: ([String: Any]) async throws -> [[String: Any]]? = { values in
                            if let cache { return try await cache.lines(song, session: values, gateway: gateway) }
                            return try await NativeOnlineLyrics.load(song, session: values, gateway: gateway, parser: parser)
                        }
                        if let session { lines = try await load(session(identity.provider!)) }
                        else { lines = try await gateway.withSession(identity.provider!, work: load) }
                    }
                } catch { lines = nil }
                guard let self, !Task.isCancelled, self.wanted.contains(id), self.tasks[id]?.0 == stamp else { return }
                self.tasks.removeValue(forKey: id); self.values[id] = Value(lines: lines); self.selections.remove(id)
                self.revision += 1; self.changed?()
            }
            tasks[id] = (stamp, task)
        }
    }
}
