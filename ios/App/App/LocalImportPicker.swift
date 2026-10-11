import UIKit
import UniformTypeIdentifiers

// LocalImportPicker.swift — a retained delegate owns one import and settles cancellation exactly once.
final class LocalImportPicker: NSObject, UIDocumentPickerDelegate {
    private var completion: (([URL]) -> Void)?
    private weak var activePicker: UIDocumentPickerViewController?
    func present(on controller: UIViewController, lyrics: Bool, completion: @escaping ([URL]) -> Void) throws {
        try present(on: controller, types: lyrics ? [.data] : [.audio], multiple: !lyrics, completion: completion)
    }
    func presentFolder(on controller: UIViewController, completion: @escaping ([URL]) -> Void) throws {
        try present(on: controller, types: [.folder], multiple: false, completion: completion)
    }
    private func present(on controller: UIViewController, types: [UTType], multiple: Bool, completion: @escaping ([URL]) -> Void) throws {
        guard self.completion == nil, controller.presentedViewController == nil else { throw MobileFailure("import-busy") }
        self.completion = completion
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: false)
        picker.allowsMultipleSelection = multiple
        picker.delegate = self
        activePicker = picker
        controller.present(picker, animated: true)
    }
    func cancel() { activePicker?.dismiss(animated: true); finish([]) }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        if controller === activePicker { finish(urls) }
    }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { if controller === activePicker { finish([]) } }
    private func finish(_ urls: [URL]) { let done = completion; completion = nil; activePicker = nil; done?(urls) }
}
