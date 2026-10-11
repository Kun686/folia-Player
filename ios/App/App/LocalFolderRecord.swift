import Foundation

// LocalFolderRecord.swift — bookmarks stay native; stable song ids point to app-owned generations.
struct LocalFolderTrackPlan: Codable {
    var path: String
    var audioSignature: String
    var sidecarSignature: String
    var coverSignature: String
    var lyric: String?
    var translation: String?
    var cover: String?
}
struct LocalFolderTrack: Codable {
    var id: String
    var generation: String
    var source: LocalFolderTrackPlan
}
struct LocalFolderNode: Codable {
    var path: String
    var ignored: Bool
}
struct LocalFolderRecord: Codable {
    var id: String
    var name: String
    var bookmark: Data
    var ignoredPaths: [String]
    var directories: [LocalFolderNode]
    var tracks: [LocalFolderTrack]
}
struct LocalFoldersDocument: Codable {
    var version = 1
    var roots: [LocalFolderRecord] = []
    func validated() throws -> LocalFoldersDocument {
        guard version == 1, roots.count <= 256 else { throw MobileFailure("invalid-folder-catalog") }
        var rootIDs = Set<String>(), songIDs = Set<String>(), generations = Set<String>(), count = 0
        for root in roots {
            guard UUID(uuidString: root.id) != nil, rootIDs.insert(root.id).inserted,
                  !root.name.isEmpty, root.name.utf8.count <= 1024, !root.bookmark.isEmpty, root.bookmark.count <= 1_048_576,
                  root.ignoredPaths.count <= 50_000, root.directories.count <= 50_000 else { throw MobileFailure("invalid-folder-catalog") }
            var paths = Set<String>()
            for path in root.ignoredPaths { try Self.validatePath(path) }
            for directory in root.directories {
                try Self.validatePath(directory.path)
                guard paths.insert(directory.path).inserted else { throw MobileFailure("invalid-folder-catalog") }
            }
            paths.removeAll()
            for track in root.tracks {
                count += 1
                guard count <= 50_000, UUID(uuidString: track.id) != nil, UUID(uuidString: track.generation) != nil,
                      songIDs.insert(track.id).inserted, generations.insert(track.generation).inserted,
                      paths.insert(track.source.path).inserted else { throw MobileFailure("invalid-folder-catalog") }
                try Self.validatePath(track.source.path)
                for path in [track.source.lyric, track.source.translation, track.source.cover].compactMap({ $0 }) { try Self.validatePath(path) }
                for signature in [track.source.audioSignature, track.source.sidecarSignature, track.source.coverSignature] {
                    guard signature.utf8.count <= 1_000_000 else { throw MobileFailure("invalid-folder-catalog") }
                }
            }
        }
        return self
    }
    static func validatePath(_ path: String) throws {
        guard !path.isEmpty, path.utf8.count <= 4096, !path.contains("\\"),
              !path.unicodeScalars.contains(where: { $0.value < 32 }),
              !path.components(separatedBy: "/").contains(where: { $0.isEmpty || $0 == "." || $0 == ".." })
        else { throw MobileFailure("invalid-folder-path") }
    }
}
