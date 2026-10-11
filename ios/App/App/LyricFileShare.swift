import UIKit

// LyricFileShare.swift — a private temporary file survives until the system share sheet completes.
final class LyricFileShare {
    private var busy = false
    private let root = FileManager.default.temporaryDirectory.appendingPathComponent("folia-lyric-exports", isDirectory: true)

    init() {
        // A previous process may have exited while its share sheet was open; these are only exports.
        try? FileManager.default.removeItem(at: root)
    }

    static func validate(fileName: String, content: String) throws -> Data {
        guard !fileName.isEmpty, !fileName.hasPrefix("."), fileName.utf8.count <= 255,
              fileName.rangeOfCharacter(from: .controlCharacters) == nil,
              !fileName.contains("/"), !fileName.contains("\\"), !fileName.contains(":"),
              ["fia", "lrc"].contains((fileName as NSString).pathExtension.lowercased()),
              !content.isEmpty, content.utf8.count <= 16_000_000 else { throw MobileFailure("invalid-lyric-file") }
        return Data(content.utf8)
    }

    func present(fileName: String, content: String, on controller: UIViewController,
                 completion: @escaping (Result<Bool, Error>) -> Void) throws {
        guard !busy, controller.presentedViewController == nil, controller.viewIfLoaded?.window != nil else {
            throw MobileFailure("share-busy")
        }
        let data = try Self.validate(fileName: fileName, content: content)
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
