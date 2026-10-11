import Foundation

// LocalFolderFiles.swift — selected scan entries are rechecked inside coordinated reads; paths never escape the root.
struct LocalFolderFile: Codable {
    let path: String
    let size: Int
    let modified: Double
}
struct LocalFolderFiles {
    let root: URL
    private let entries: [String: LocalFolderFile]
    init(root: URL, files: [LocalFolderFile]) throws {
        guard root.isFileURL, files.count <= 50_000 else { throw MobileFailure("invalid-folder") }
        var indexed: [String: LocalFolderFile] = [:]
        for file in files {
            try LocalFoldersDocument.validatePath(file.path)
            guard file.size >= 0, file.modified.isFinite, file.modified >= 0,
                  indexed.updateValue(file, forKey: file.path) == nil else { throw MobileFailure("invalid-folder-scan") }
        }
        self.root = root; entries = indexed
    }
    // Validate every directory component, so a directory changed into a symlink after scanning cannot be followed.
    func checkedURL(_ path: String) throws -> URL {
        guard let expected = entries[path] else { throw MobileFailure("folder-file-changed") }
        var current = root
        let parts = path.components(separatedBy: "/")
        for part in parts {
            current.removeAllCachedResourceValues()
            let parent = try current.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            guard parent.isDirectory == true, parent.isSymbolicLink != true else { throw MobileFailure("folder-file-changed") }
            current.appendPathComponent(part)
        }
        try check(current, expected: expected)
        return current
    }
    private func check(_ url: URL, expected: LocalFolderFile) throws {
        var fresh = url; fresh.removeAllCachedResourceValues()
        let values = try fresh.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey, .contentModificationDateKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true, values.fileSize == expected.size,
              let modified = values.contentModificationDate,
              max(0, modified.timeIntervalSince1970 * 1000) == expected.modified
        else { throw MobileFailure("folder-file-changed") }
    }
    func read(_ path: String, limit: Int) throws -> Data {
        try Task.checkCancellation()
        guard (0...8_000_000).contains(limit), let expected = entries[path], expected.size <= limit
        else { throw MobileFailure("folder-file-too-large") }
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let url = try checkedURL(path)
        var coordinationError: NSError?, result: Result<Data, Error>?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { readable in
            result = Result {
                _ = try checkedURL(path)
                try check(readable, expected: expected)
                // A source can grow after the metadata check. Never allocate/read beyond the promised size plus one byte.
                let handle = try FileHandle(forReadingFrom: readable)
                defer { try? handle.close() }
                var data = Data()
                while data.count <= expected.size {
                    try Task.checkCancellation()
                    let chunk = try handle.read(upToCount: min(65_536, expected.size + 1 - data.count)) ?? Data()
                    if chunk.isEmpty { break }
                    data.append(chunk)
                }
                guard data.count == expected.size, data.count <= limit else { throw MobileFailure("folder-file-changed") }
                try check(readable, expected: expected)
                _ = try checkedURL(path)
                return data
            }
        }
        if let coordinationError { throw coordinationError }
        guard let result else { throw MobileFailure("folder-unavailable") }
        try Task.checkCancellation()
        return try result.get()
    }
    func lyric(_ path: String) throws -> [String: String] {
        let name = (path as NSString).lastPathComponent
        guard name.utf8.count <= 1024 else { throw MobileFailure("invalid-lyrics") }
        return ["fileName": name, "data": try read(path, limit: 2_000_000).base64EncodedString()]
    }
}
