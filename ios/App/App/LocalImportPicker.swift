import UIKit
import UniformTypeIdentifiers

// LocalImportPicker.swift — a retained delegate owns one import and settles cancellation exactly once.
final class LocalImportPicker: NSObject, UIDocumentPickerDelegate {
    private var completion: (([URL]) -> Void)?
    func present(on controller: UIViewController, lyrics: Bool, completion: @escaping ([URL]) -> Void) throws {
        guard self.completion == nil, controller.presentedViewController == nil else { throw MobileFailure("import-busy") }
        self.completion = completion
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: lyrics ? [.data] : [.audio], asCopy: false)
        picker.allowsMultipleSelection = !lyrics
        picker.delegate = self
        controller.present(picker, animated: true)
    }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { finish(urls) }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finish([]) }
    private func finish(_ urls: [URL]) { let done = completion; completion = nil; done?(urls) }
}
