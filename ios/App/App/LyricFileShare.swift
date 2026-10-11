import UIKit

// LyricFileShare.swift — a private temporary file survives until the system share sheet completes.
final class LyricFileShare {
    private var busy = false
    private let root = FileManager.default.temporaryDirectory.appendingPathComponent("folia-lyric-exports", isDirectory: true)

    init() {
        // A previous process may have exited while its share sheet was open; these are only exports.
        try? FileManager.default.removeItem(at: root)
    }

    private static func validateName(_ fileName: String, extensions: [String]) throws {
        guard !fileName.isEmpty, !fileName.hasPrefix("."), fileName.utf8.count <= 255,
              fileName.rangeOfCharacter(from: .controlCharacters) == nil,
              !fileName.contains("/"), !fileName.contains("\\"), !fileName.contains(":"),
              extensions.contains((fileName as NSString).pathExtension.lowercased()) else { throw MobileFailure("invalid-lyric-file") }
    }
    static func validate(fileName: String, content: String) throws -> Data {
        try validateName(fileName, extensions: ["fia", "lrc"])
        guard !content.isEmpty, content.utf8.count <= 16_000_000 else { throw MobileFailure("invalid-lyric-file") }
        return Data(content.utf8)
    }
    static func validateArchive(fileName: String, encoded: String) throws -> Data {
        try validateName(fileName, extensions: ["zip"])
        guard encoded.utf8.count <= 21_333_336, let data = Data(base64Encoded: encoded), data.count <= 16_000_000,
              data.starts(with: [0x50, 0x4b, 0x03, 0x04]) else { throw MobileFailure("invalid-lyric-file") }
        return data
    }

    func present(fileName: String, content: String, on controller: UIViewController,
                 completion: @escaping (Result<Bool, Error>) -> Void) throws {
        try present(fileName: fileName, data: Self.validate(fileName: fileName, content: content), on: controller, completion: completion)
    }
    func presentArchive(fileName: String, encoded: String, on controller: UIViewController,
                        completion: @escaping (Result<Bool, Error>) -> Void) throws {
        try present(fileName: fileName, data: Self.validateArchive(fileName: fileName, encoded: encoded), on: controller, completion: completion)
    }
    private func present(fileName: String, data: Data, on controller: UIViewController,
                         completion: @escaping (Result<Bool, Error>) -> Void) throws {
        guard !busy, controller.presentedViewController == nil, controller.viewIfLoaded?.window != nil else {
            throw MobileFailure("share-busy")
        }
        let directory = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let file = directory.appendingPathComponent(fileName, isDirectory: false)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw MobileFailure("share-write-failed")
        }
        busy = true
        let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        share.popoverPresentationController?.sourceView = controller.view
        share.popoverPresentationController?.sourceRect = CGRect(x: controller.view.bounds.midX, y: controller.view.bounds.midY, width: 1, height: 1)
        share.completionWithItemsHandler = { [weak self] _, completed, _, error in
            self?.busy = false
            // The receiving activity has finished consuming the file before this callback.
            try? FileManager.default.removeItem(at: directory)
            completion(error.map { .failure($0) } ?? .success(completed))
        }
        controller.present(share, animated: true)
    }
}
