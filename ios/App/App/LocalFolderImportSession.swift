import Foundation

// LocalFolderImportSession.swift — native-only directory access and ordered, bounded preparation for one import.
final class LocalFolderImportSession {
    let token: String
    let transaction: String
    let access: LocalFolderAuthorization.Access
    let roots: [LocalFolderRecord]
    var root: LocalFolderRecord
    let order: [String]
    var scan: LocalFolderScanner.Snapshot?
    var files: LocalFolderFiles?
    var plans: [LocalFolderTrackPlan] = []
    var work: [LocalFolderTrackPlan] = []
    var prepared: [String: LocalFolderTrack] = [:]
    var warnings: [[String: String]] = []
    var index = 0
    var busy = false
    var readIndex: Int?
    var omitted = Set<String>()
    init(token: String, transaction: String, access: LocalFolderAuthorization.Access,
         roots: [LocalFolderRecord], root: LocalFolderRecord, order: [String]) {
        self.token = token; self.transaction = transaction; self.access = access
        self.roots = roots; self.root = root; self.order = order
    }
    var previous: [[String: Any]] {
        get throws {
            guard let value = try JSONSerialization.jsonObject(with: JSONEncoder().encode(root.tracks.map(\.source))) as? [[String: Any]]
            else { throw MobileFailure("invalid-folder-scan") }
            return value
        }
    }
    func progress() -> [String: Any] {
        var value: [String: Any] = ["token": token, "rootID": root.id, "name": root.name,
            "total": work.count, "completed": index, "reused": prepared.count - index + skippedCount]
        if index < work.count { value["path"] = work[index].path }
        return value
    }
    var skippedCount = 0
    func warn(_ path: String, _ code: String) { warnings.append(["path": path, "code": code]) }
}

extension LocalFolderScanner.Snapshot {
    // Metadata equality is intentionally not a content hash; re-scan detects added/removed dependencies before commit.
    func fingerprint() throws -> Data {
        try JSONSerialization.data(withJSONObject: ["plan": plan, "directories": directories, "files": files], options: .sortedKeys)
    }
}
