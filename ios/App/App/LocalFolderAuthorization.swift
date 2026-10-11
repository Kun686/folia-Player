import Foundation

// LocalFolderAuthorization.swift — iOS implicit bookmark scopes, balanced explicitly and never exposed to JavaScript.
enum LocalFolderAuthorization {
    final class Access {
        let url: URL
        let bookmark: Data
        private var scoped: Bool
        init(url: URL) throws {
            guard url.isFileURL else { throw MobileFailure("invalid-folder") }
            let scoped = url.startAccessingSecurityScopedResource()
            do {
                let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
                guard values.isDirectory == true, values.isSymbolicLink != true else { throw MobileFailure("invalid-folder") }
                let bookmark = try url.bookmarkData(options: [], includingResourceValuesForKeys: [.fileResourceIdentifierKey, .volumeIdentifierKey], relativeTo: nil)
                guard !bookmark.isEmpty, bookmark.count <= 1_048_576 else { throw MobileFailure("invalid-folder-bookmark") }
                self.url = url; self.bookmark = bookmark; self.scoped = scoped
            } catch { if scoped { url.stopAccessingSecurityScopedResource() }; throw error }
        }
        func close() { if scoped { scoped = false; url.stopAccessingSecurityScopedResource() } }
        deinit { close() }
    }
    static func open(_ bookmark: Data) throws -> Access {
        guard !bookmark.isEmpty, bookmark.count <= 1_048_576 else { throw MobileFailure("folder-access-required") }
        do {
            var stale = false
            let url = try URL(resolvingBookmarkData: bookmark, options: [.withoutUI, .withoutImplicitStartAccessing],
                              relativeTo: nil, bookmarkDataIsStale: &stale)
            // Refreshing data while access is held also repairs a stale but successfully resolved bookmark.
            return try Access(url: url)
        } catch { throw MobileFailure("folder-access-required") }
    }
    static func sameDirectory(_ lhs: URL, _ rhs: URL) throws -> Bool {
        if lhs.standardizedFileURL.resolvingSymlinksInPath() == rhs.standardizedFileURL.resolvingSymlinksInPath() { return true }
        let keys: Set<URLResourceKey> = [.fileResourceIdentifierKey, .volumeIdentifierKey]
        let a = try lhs.resourceValues(forKeys: keys), b = try rhs.resourceValues(forKeys: keys)
        guard let aID = a.fileResourceIdentifier as? NSObject, let bID = b.fileResourceIdentifier as? NSObject,
              let aVolume = a.volumeIdentifier as? NSObject, let bVolume = b.volumeIdentifier as? NSObject else { return false }
        return aID.isEqual(bID) && aVolume.isEqual(bVolume)
    }
}
