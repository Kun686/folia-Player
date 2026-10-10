import Foundation
import CryptoKit

// NativeProfileCache.swift — bounded, versioned analysis records; no audio, paths, credentials or signed URLs in records.
struct NativeProfileCache {
    struct Hit { let profile: Data? }
    private struct Record: Codable { let schema: Int; let payload: Data; let digest: String; let provider: String? }
    let directory: URL
    static func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    func key(for file: URL) throws -> String {
        guard file.isFileURL else { throw MobileFailure("profile-source-unavailable") }
        let values = try FileManager.default.attributesOfItem(atPath: file.path)
        guard let size = values[.size] as? NSNumber, let date = values[.modificationDate] as? Date else { throw MobileFailure("profile-source-unavailable") }
        return Self.digest(Data("v9-gridless-vdsp|\(file.standardizedFileURL.path)|\(size)|\(date.timeIntervalSince1970)".utf8))
    }
    func read(_ key: String) -> Hit? {
        let url = directory.appendingPathComponent(key + ".json")
        guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 393216,
              let data = try? Data(contentsOf: url), let record = try? JSONDecoder().decode(Record.self, from: data),
              record.schema == 1, record.payload.count <= 262144, Self.digest(record.payload) == record.digest else { return nil }
        if record.payload == Data("null".utf8) { return Hit(profile: nil) }
        guard let fields = (try? JSONSerialization.jsonObject(with: record.payload)) as? [String: Any],
              fields["version"] as? Int == 9, fields["gridless"] as? Bool == true else { return nil }
        return Hit(profile: record.payload)
    }
    func save(_ profile: Data?, key: String, provider: String? = nil) {
        let manager = FileManager.default, payload = profile ?? Data("null".utf8)
        guard let data = try? JSONEncoder().encode(Record(schema: 1, payload: payload, digest: Self.digest(payload), provider: provider)) else { return }
        do {
            try manager.createDirectory(at: directory, withIntermediateDirectories: true)
            try data.write(to: directory.appendingPathComponent(key + ".json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            // Only this module's fixed-format records are eligible for eviction.
            let files = try manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey], options: [.skipsHiddenFiles])
                .filter { $0.pathExtension == "json" && $0.deletingPathExtension().lastPathComponent.count == 64
                    && $0.deletingPathExtension().lastPathComponent.allSatisfy { "0123456789abcdef".contains($0) } }
            let dates = files.map { ($0, (try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) }
            for (url, _) in dates.sorted(by: { $0.1 < $1.1 }).prefix(max(0, files.count - 200)) { try? manager.removeItem(at: url) }
        } catch { /* Cache I/O never makes playable audio fail. A later request can measure it again. */ }
    }
    func remove(provider: String) {
        guard let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey]) else { return }
        for url in files where url.pathExtension == "json" && url.deletingPathExtension().lastPathComponent.count == 64
            && url.deletingPathExtension().lastPathComponent.allSatisfy({ "0123456789abcdef".contains($0) }) {
            guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 393216,
                  let data = try? Data(contentsOf: url), let record = try? JSONDecoder().decode(Record.self, from: data),
                  record.provider == provider else { continue }
            try? FileManager.default.removeItem(at: url)
        }
    }
}
