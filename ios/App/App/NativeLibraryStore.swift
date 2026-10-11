import Foundation
import JavaScriptCore
import CryptoKit

// NativeLibraryStore.swift — synchronous storage owned by LocalMediaLibrary's actor, with atomic revision-checked edits.
// One owner must serialize calls; no JSValue or JSContext crosses the owning actor's boundary.
final class NativeLibraryStore {
    struct Snapshot {
        let revision: String
        let record: [String: Any]
    }
    private let file: URL
    private let script: URL?
    private var context: JSContext?
    private let limit = 32_000_000

    init(root: URL, bundle: Bundle = .main) {
        file = root.appendingPathComponent("library-entities.json")
        script = bundle.url(forResource: "library", withExtension: "js", subdirectory: "public/native")
    }

    func snapshot(inputs: [[String: Any]]) throws -> Snapshot {
        let request = try readRequest(inputs: inputs)
        return Snapshot(revision: try revision(request), record: try evaluate("snapshotJSON", request))
    }

    // Reads and compares immediately before committing, without suspension between validation and the atomic write.
    func apply(inputs: [[String: Any]], expectedRevision: String, operation: [String: Any], beforeCommit: (Snapshot) throws -> Void = { _ in }) throws -> Snapshot {
        let baseline = try readRequest(inputs: inputs)
        guard try revision(baseline) == expectedRevision else { throw MobileFailure("local-library-changed") }
        var request = baseline
        request["operation"] = operation
        request["idSeed"] = UUID().uuidString
        request["now"] = Date().timeIntervalSince1970 * 1000
        let record = try evaluate("mutateJSON", request), data = try encode(record)
        var updated = baseline
        updated["record"] = record
        // Validate the complete response before the commit; no throwing work may report failure after a successful write.
        let result = Snapshot(revision: try revision(updated), record: record)
        try beforeCommit(result)
        try Task.checkCancellation()
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return result
    }

    func project(_ snapshot: Snapshot, songs: [[String: Any]], bases: [[String: Any]], documents: [String: Any]) throws -> [String: Any] {
        var result = try evaluate("projectJSON", ["record": snapshot.record, "songs": songs, "bases": bases, "documents": documents])
        result["revision"] = snapshot.revision
        result["entities"] = snapshot.record["entities"]
        result["assignments"] = snapshot.record["assignments"]
        return result
    }

    private func readRequest(inputs: [[String: Any]]) throws -> [String: Any] {
        var record: Any = NSNull()
        do {
            let values = try file.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
            guard values.isRegularFile == true, values.isSymbolicLink != true,
                  let size = values.fileSize, size <= limit else { throw MobileFailure("invalid-local-library") }
            let data = try Data(contentsOf: file)
            guard data.count <= limit else { throw MobileFailure("invalid-local-library") }
            guard let document = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { throw MobileFailure("invalid-local-library") }
            record = document
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile || error.code == .fileNoSuchFile {
            // Only absence is an empty library. Corrupt, unreadable, or unsupported documents must remain intact.
        }
        let ordered = inputs.sorted { ($0["songId"] as? String ?? "") < ($1["songId"] as? String ?? "") }
        return ["version": 1, "record": record, "inputs": ordered]
    }

    private func encode(_ object: [String: Any]) throws -> Data {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        guard data.count <= limit else { throw MobileFailure("local-library-too-large") }
        return data
    }
    private func revision(_ request: [String: Any]) throws -> String {
        SHA256.hash(data: try encode(request)).map { String(format: "%02x", $0) }.joined()
    }
    private func evaluate(_ method: String, _ input: [String: Any]) throws -> [String: Any] {
        try Task.checkCancellation()
        let data = try encode(input)
        guard let text = String(data: data, encoding: .utf8) else { throw MobileFailure("invalid-local-library") }
        let runtime = try load()
        runtime.exception = nil
        defer { runtime.exception = nil }
        let value = runtime.objectForKeyedSubscript("FoliaLibrary")?.invokeMethod(method, withArguments: [text])
        guard runtime.exception == nil, let output = value?.toString(), let bytes = output.data(using: .utf8),
              bytes.count <= limit, let record = try JSONSerialization.jsonObject(with: bytes) as? [String: Any]
        else { throw MobileFailure("invalid-local-library") }
        try Task.checkCancellation()
        return record
    }
    private func load() throws -> JSContext {
        if let context { return context }
        guard let script, let source = try? String(contentsOf: script, encoding: .utf8), let runtime = JSContext()
        else { throw MobileFailure("local-library-runtime-unavailable") }
        runtime.evaluateScript(source)
        guard runtime.exception == nil,
              runtime.objectForKeyedSubscript("FoliaLibrary")?.objectForKeyedSubscript("protocolVersion")?.toInt32() == 1
        else { throw MobileFailure("local-library-runtime-unavailable") }
        context = runtime
        return runtime
    }
}
