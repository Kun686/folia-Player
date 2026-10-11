import Foundation
import JavaScriptCore

// LocalFolderScanner.swift — actor-owned read-only complete scan; failed/cancelled scans never produce a removal plan.
actor LocalFolderScanner {
    struct Snapshot {
        let plan: [String: Any]
        let directories: [[String: Any]]
        let files: [[String: Any]]
    }
    private let script: URL?
    private var context: JSContext?
    private let maximumEntries: Int
    private let maximumDepth: Int
    init(bundle: Bundle = .main, maximumEntries: Int = 50_000, maximumDepth: Int = 64) {
        script = bundle.url(forResource: "folders", withExtension: "js", subdirectory: "public/native")
        self.maximumEntries = maximumEntries; self.maximumDepth = maximumDepth
    }
    // Returned paths are relative metadata only. A later import must reacquire access and validate file signatures.
    func scan(_ source: URL, ignoredPaths: [String] = [], lyricFormatOrder: [String] = [],
              previous: [[String: Any]] = []) throws -> Snapshot {
        guard source.isFileURL else { throw MobileFailure("invalid-folder") }
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        var files: [[String: Any]] = [], directories: [[String: Any]] = [], remaining = maximumEntries, ruleBytes = 0
        func visit(_ path: String, rules: [[String: String]], depth: Int) throws {
            try Task.checkCancellation()
            guard depth <= maximumDepth, path.utf8.count <= 4096 else { throw MobileFailure("folder-too-deep") }
            let url = path.isEmpty ? source : source.appendingPathComponent(path, isDirectory: true)
            let listing = try LocalFolderAccess.read(url, maximumEntries: remaining)
            remaining -= listing.visited
            var active = rules
            if let content = listing.ignore {
                ruleBytes += content.utf8.count
                guard ruleBytes <= 8_000_000 else { throw MobileFailure("folder-ignore-too-large") }
                active.append(["path": path, "content": content])
            }
            let output = try evaluate("directoryJSON", ["path": path, "rules": active, "ignoredPaths": ignoredPaths,
                "entries": listing.entries.map { ["name": $0.name, "directory": $0.directory] as [String: Any] }])
            guard let accepted = output["entries"] as? [[String: Any]] else { throw MobileFailure("invalid-folder-scan") }
            let indexed = Dictionary(uniqueKeysWithValues: listing.entries.map { ($0.name, $0) })
            for entry in accepted {
                guard let name = entry["name"] as? String, let original = indexed[name], let relative = entry["path"] as? String,
                      relative == (path.isEmpty ? name : path + "/" + name) else { throw MobileFailure("invalid-folder-scan") }
                if original.directory {
                    directories.append(entry)
                    if entry["ignored"] as? Bool != true { try visit(relative, rules: active, depth: depth + 1) }
                } else { files.append(["path": relative, "size": original.size, "modified": original.modified]) }
            }
        }
        try visit("", rules: [], depth: 0)
        let plan = try evaluate("planJSON", ["files": files, "lyricFormatOrder": lyricFormatOrder, "previous": previous])
        return Snapshot(plan: plan, directories: directories, files: files)
    }
    private func evaluate(_ method: String, _ request: [String: Any]) throws -> [String: Any] {
        try Task.checkCancellation()
        let data = try JSONSerialization.data(withJSONObject: request)
        guard data.count <= 32_000_000, let input = String(data: data, encoding: .utf8)
        else { throw MobileFailure("folder-too-large") }
        let runtime = try load()
        runtime.exception = nil
        defer { runtime.exception = nil }
        let result = runtime.objectForKeyedSubscript("FoliaFolders")?.invokeMethod(method, withArguments: [input])
        guard runtime.exception == nil, let text = result?.toString(), let bytes = text.data(using: .utf8), bytes.count <= 32_000_000,
              let output = try JSONSerialization.jsonObject(with: bytes) as? [String: Any]
        else { throw MobileFailure("invalid-folder-scan") }
        try Task.checkCancellation()
        return output
    }
    private func load() throws -> JSContext {
        if let context { return context }
        guard let script, let source = try? String(contentsOf: script, encoding: .utf8), let runtime = JSContext()
        else { throw MobileFailure("folder-runtime-unavailable") }
        runtime.evaluateScript(source)
        guard runtime.exception == nil,
              runtime.objectForKeyedSubscript("FoliaFolders")?.objectForKeyedSubscript("protocolVersion")?.toInt32() == 1
        else { throw MobileFailure("folder-runtime-unavailable") }
        context = runtime; return runtime
    }
}

extension LocalMediaLibrary {
    func scanFolder(_ source: URL, ignoredPaths: [String] = [], lyricFormatOrder: [String] = [],
                    previous: [[String: Any]] = []) async throws -> LocalFolderScanner.Snapshot {
        try await folderScanner.scan(source, ignoredPaths: ignoredPaths, lyricFormatOrder: lyricFormatOrder, previous: previous)
    }
}
