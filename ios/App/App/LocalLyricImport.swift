import Foundation

// LocalLyricImport.swift — original Web decoder receives bounded file bytes; native validates before replacing user lyrics.
extension LocalMediaLibrary {
    func readLyricFile(_ source: URL, for id: String) throws -> [String: Any] {
        _ = try resolve(id)
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        var coordinatedError: NSError?, readError: Error?, bytes: Data?
        NSFileCoordinator().coordinate(readingItemAt: source, options: [], error: &coordinatedError) { readable in
            do {
                let values = try readable.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
                guard values.isRegularFile == true, let size = values.fileSize, size <= 2_000_000,
                      source.lastPathComponent.utf8.count <= 1024 else { throw MobileFailure("lyrics-too-large") }
                let data = try Data(contentsOf: readable)
                guard !data.isEmpty, data.count <= 2_000_000 else { throw MobileFailure("invalid-lyrics") }
                bytes = data
            } catch { readError = error }
        }
        if let coordinatedError { throw coordinatedError }
        if let readError { throw readError }
        guard let bytes else { throw MobileFailure("invalid-lyrics") }
        return ["data": bytes.base64EncodedString(), "fileName": source.lastPathComponent, "token": lyricToken(id)]
    }

    func saveDecodedLyrics(_ content: String, fileName: String, for id: String, token: String) async throws -> [String: Any] {
        _ = try resolve(id)
        guard lyricEditTokens[id] == token else { throw MobileFailure("local-lyrics-changed") }
        guard !content.isEmpty, content.utf8.count <= 2_000_000, !fileName.isEmpty,
              fileName.utf8.count <= 1024 else { throw MobileFailure("lyrics-too-large") }
        _ = try await readLyricSources(id)
        // The WebView cannot bypass the original native parser or its line/time/output bounds.
        guard let data = try await lyricImportParser.parse(content, fileName: fileName),
              let lines = try JSONSerialization.jsonObject(with: data) as? [[String: Any]],
              lines.contains(where: { !(($0["fullText"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) })
        else { throw MobileFailure("invalid-lyrics") }
        try Task.checkCancellation()
        _ = try resolve(id)
        guard lyricEditTokens[id] == token else { throw MobileFailure("local-lyrics-changed") }
        var record = try lyricSource(id) ?? LyricSource(content: "", fileName: nil)
        record.content = content; record.fileName = fileName; record.lyricsSource = "local"; record.contentIsEmbedded = false
        record.contentOrigin = "upload"
        try writeLyricSources(record, id: id)
        lyricEditTokens[id] = UUID().uuidString
        return try details(id)
    }
}
