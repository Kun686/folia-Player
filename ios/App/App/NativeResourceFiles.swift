import Foundation

// NativeResourceFiles.swift — provider-scoped, bounded cache inventory reused by covers and parsed lyrics.
struct NativeResourceFiles {
    let root: URL, fileExtension: String
    func entries(provider: String? = nil) -> [(URL, Int, Date)] {
        (provider.map { [$0] } ?? ["qq", "netease", "kugou"]).flatMap { provider in
            ((try? FileManager.default.contentsOfDirectory(at: root.appendingPathComponent(provider),
                includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey, .isSymbolicLinkKey])) ?? []).compactMap { url in
                guard url.pathExtension == fileExtension, NativeMediaFiles.validKey(url.deletingPathExtension().lastPathComponent),
                      let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey, .isSymbolicLinkKey]),
                      values.isRegularFile == true, values.isSymbolicLink != true else { return nil }
                return (url, values.fileSize ?? 0, values.contentModificationDate ?? .distantPast)
            }
        }
    }
    func prune(limit: Int, preserving: (URL) -> Bool = { _ in false }) throws {
        let values = entries().filter { !preserving($0.0) }.sorted { $0.2 < $1.2 }; var total = values.reduce(0) { $0 + $1.1 }
        for value in values where total > limit { try FileManager.default.removeItem(at: value.0); total -= value.1 }
    }
    func summary() -> [String: Int] { let values = entries(); return ["count": values.count, "bytes": values.reduce(0) { $0 + $1.1 }] }
    func clear(provider: String? = nil) throws { for value in entries(provider: provider) { try FileManager.default.removeItem(at: value.0) } }
}
