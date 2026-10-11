import Foundation

// LocalFolderAccess.swift — coordinated bounded directory reads; no mutation or escaping symlink traversal.
enum LocalFolderAccess {
    struct Entry {
        let name: String
        let directory: Bool
        let size: Int
        let modified: Double
    }
    struct Listing { let entries: [Entry]; let ignore: String?; let visited: Int }
    static func read(_ directory: URL, maximumEntries: Int) throws -> Listing {
        try Task.checkCancellation()
        guard directory.isFileURL else { throw MobileFailure("invalid-folder") }
        let values = try directory.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard values.isDirectory == true, values.isSymbolicLink != true else { throw MobileFailure("invalid-folder") }
        var coordinationError: NSError?, result: Result<Listing, Error>?
        NSFileCoordinator().coordinate(readingItemAt: directory, options: [], error: &coordinationError) { readable in
            result = Result { try list(readable, maximumEntries: maximumEntries) }
        }
        if let coordinationError { throw coordinationError }
        guard let result else { throw MobileFailure("folder-unavailable") }
        try Task.checkCancellation()
        return try result.get()
    }
    private static func list(_ directory: URL, maximumEntries: Int) throws -> Listing {
        let directoryValues = try directory.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard directoryValues.isDirectory == true, directoryValues.isSymbolicLink != true else { throw MobileFailure("invalid-folder") }
        var error: Error?, count = 0, entries: [Entry] = []
        let keys: Set<URLResourceKey> = [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey, .contentModificationDateKey]
        guard let iterator = FileManager.default.enumerator(at: directory, includingPropertiesForKeys: Array(keys),
            options: [.skipsSubdirectoryDescendants], errorHandler: { _, cause in error = cause; return false })
        else { throw MobileFailure("folder-unavailable") }
        var ignore: String?
        while let url = iterator.nextObject() as? URL {
            try Task.checkCancellation()
            count += 1
            guard count <= maximumEntries else { throw MobileFailure("folder-too-large") }
            let values = try url.resourceValues(forKeys: keys)
            if values.isSymbolicLink == true { continue }
            guard values.isDirectory == true || values.isRegularFile == true else { continue }
            let name = url.lastPathComponent
            guard !name.isEmpty, name != ".", name != "..", !name.contains("/"), !name.contains("\\"),
                  name.utf8.count <= 1024, !name.unicodeScalars.contains(where: { $0.value < 32 })
            else { throw MobileFailure("invalid-folder-path") }
            if name == ".foliaignore", values.isRegularFile == true {
                guard let size = values.fileSize, size <= 262_144 else { throw MobileFailure("folder-ignore-too-large") }
                let data = try Data(contentsOf: url)
                guard data.count <= 262_144, let text = String(data: data, encoding: .utf8)
                else { throw MobileFailure("invalid-folder-ignore") }
                ignore = text
            }
            guard values.isDirectory == true || (values.fileSize != nil && values.contentModificationDate != nil)
            else { throw MobileFailure("folder-incomplete") }
            entries.append(Entry(name: name, directory: values.isDirectory == true, size: values.fileSize ?? 0,
                modified: max(0, (values.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000)))
        }
        if let error { throw error }
        return Listing(entries: entries, ignore: ignore, visited: count)
    }
}
