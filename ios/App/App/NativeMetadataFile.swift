import Foundation
import JavaScriptCore

// NativeMetadataFile.swift — only file ranges requested by the original FLAC parser; no audio copy or WebView.
enum NativeMetadataFile {
    static func read(_ url: URL, context: JSContext) throws -> EmbeddedLyrics {
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true else { throw MobileFailure("invalid-local-lyrics") }
        let file = try FileHandle(forReadingFrom: url)
        defer { try? file.close() }
        let size = try file.seekToEnd()
        guard size <= 9_007_199_254_740_991 else { throw MobileFailure("lyrics-too-large") }
        var total = 0, calls = 0, result: String?
        let started = ProcessInfo.processInfo.systemUptime
        let read: @convention(block) (Double, Double) -> String? = { position, length in
            guard !Task.isCancelled, ProcessInfo.processInfo.systemUptime - started < 5,
                  position.isFinite, length.isFinite, position.rounded(.towardZero) == position, length.rounded(.towardZero) == length,
                  position >= 0, position <= Double(size), length >= 0, length <= 4_000_000,
                  length <= Double(size) - position, calls < 512, total <= 8_000_000 - Int(length) else { return nil }
            total += Int(length); calls += 1
            do {
                try file.seek(toOffset: UInt64(position))
                let data = try file.read(upToCount: Int(length)) ?? Data()
                guard data.count == Int(length) else { return nil }
                return data.base64EncodedString()
            } catch { return nil }
        }
        let done: @convention(block) (String) -> Void = { result = $0 }
        context.exception = nil
        context.objectForKeyedSubscript("FoliaLocalLyrics")?.invokeMethod("flacTags", withArguments: [Double(size), read, done])
        try Task.checkCancellation()
        guard context.exception == nil, let result, result.utf8.count <= 24_300_000,
              let data = result.data(using: .utf8),
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any], object["error"] == nil else {
            throw MobileFailure("invalid-local-lyrics")
        }
        let selected = try JSONDecoder().decode(EmbeddedLyrics.self, from: data)
        guard (selected.lyrics?.utf8.count ?? 0) <= 2_000_000,
              (selected.translationLyrics?.utf8.count ?? 0) <= 2_000_000 else { throw MobileFailure("lyrics-too-large") }
        return selected
    }
}
