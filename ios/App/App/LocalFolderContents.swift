import Foundation

// LocalFolderContents.swift — decoded sidecars retain the original upload-versus-disk rule and independent translation.
struct LocalFolderLyricContents: Codable {
    var lyric: String?
    var translation: String?
}
struct LocalFolderSidecars {
    let files: LocalFolderFiles
    let contents: LocalFolderLyricContents
    func cover(_ path: String) throws -> Data? {
        do { return try NativeCoverCache.thumbnail(files.read(path, limit: 8_000_000)) }
        catch let error as MobileFailure where ["invalid-cover", "folder-file-too-large"].contains(error.code) {
            // Like desktop, an unusable optional image falls back to the audio's embedded cover.
            // Changed/missing source files and write failures still abort the batch.
            return nil
        }
    }
}
struct LocalFolderLyricPolicy {
    let keepLyric: Bool
    let keepTranslation: Bool
    init(record: LocalMediaLibrary.LyricSource?, old: LocalFolderTrackPlan?, new: LocalFolderTrackPlan) {
        let changed = old?.sidecarSignature != new.sidecarSignature
        // Legacy non-embedded records were manually imported before provenance fields existed.
        let lyricOrigin = record?.contentOrigin ?? (record?.contentIsEmbedded != true && record?.content.isEmpty == false ? "upload" : nil)
        let translationOrigin = record?.translationOrigin ?? (record?.translationContent?.isEmpty == false ? "upload" : nil)
        keepLyric = lyricOrigin == "upload" && !changed
        keepTranslation = translationOrigin == "upload" && !changed
    }
    func read(_ files: LocalFolderFiles, plan: LocalFolderTrackPlan) throws -> [String: Any] {
        var result: [String: Any] = [:]
        if !keepLyric, let path = plan.lyric { result["lyric"] = try files.lyric(path) }
        if !keepTranslation, let path = plan.translation { result["translation"] = try files.lyric(path) }
        return result
    }
    func apply(_ content: LocalFolderLyricContents, to record: LocalMediaLibrary.LyricSource,
               plan: LocalFolderTrackPlan) throws -> LocalMediaLibrary.LyricSource {
        var result = record
        if !keepLyric {
            guard (plan.lyric != nil) == (content.lyric != nil) else { throw MobileFailure("invalid-folder-lyrics") }
            result.content = content.lyric ?? ""; result.contentIsEmbedded = false
            result.fileName = plan.lyric.map { ($0 as NSString).lastPathComponent }
            result.contentOrigin = result.content.isEmpty ? nil : "sidecar"
        }
        if !keepTranslation {
            guard (plan.translation != nil) == (content.translation != nil) else { throw MobileFailure("invalid-folder-lyrics") }
            result.translationContent = content.translation
            result.translationOrigin = content.translation?.isEmpty == false ? "sidecar" : nil
        }
        return try result.validated()
    }
}

extension LocalMediaLibrary {
    func folderLyricPolicy(transactionID: String, rootID: String, plan: LocalFolderTrackPlan,
                           replacing songID: String?) throws -> LocalFolderLyricPolicy {
        _ = try currentFolderUpdate(transactionID)
        let old = try songID.flatMap { id in
            try folderStore.snapshot().document.roots.first(where: { $0.id == rootID })?.tracks.first(where: { $0.id == id })
        }
        if songID != nil, old == nil { throw MobileFailure("invalid-local-identity") }
        return LocalFolderLyricPolicy(record: try songID.flatMap { try lyricSource($0) }, old: old?.source, new: plan)
    }
}
