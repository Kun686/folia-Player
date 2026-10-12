import Foundation
import JavaScriptCore

// NativePlaybackFade.swift — main-thread host for the original scheduler, independent of WKWebView.
final class NativePlaybackFade {
    private let context: JSContext
    private var controller: JSValue!
    private var timers: [Int: DispatchWorkItem] = [:]
    private var timerID = 0
    private var pauseAction: (() -> Void)?
    private let ramp: (Double, Double) -> Void
    private(set) var available = true

    init(enabled: @escaping () -> Bool, running: @escaping () -> Bool,
         ramp: @escaping (Double, Double) -> Void) throws {
        guard Thread.isMainThread, let context = JSContext(),
              let url = Bundle.main.url(forResource: "playback-fade", withExtension: "js", subdirectory: "public/native") else {
            throw MobileFailure("playback-fade-unavailable")
        }
        self.context = context; self.ramp = ramp
        let script = try String(contentsOf: url, encoding: .utf8)
        guard script.utf8.count < 65536 else { throw MobileFailure("playback-fade-unavailable") }
        context.evaluateScript(script, withSourceURL: url)
        guard context.exception == nil, let runtime = context.objectForKeyedSubscript("FoliaPlaybackFade"),
              runtime.forProperty("protocolVersion")?.toInt32() == 1 else { throw MobileFailure("playback-fade-unavailable") }
        let isEnabled: @convention(block) () -> Bool = enabled
        let isRunning: @convention(block) () -> Bool = running
        let gain: @convention(block) (Double, Double) -> Void = ramp
        let pause: @convention(block) () -> Void = { [weak self] in
            let action = self?.pauseAction; self?.pauseAction = nil; action?()
        }
        let timer: @convention(block) (JSValue, Double) -> Int = { [weak self] callback, ms in
            guard let self, ms.isFinite, ms >= 0, ms <= 1000 else { return 0 }
            self.timerID += 1; let id = self.timerID
            let work = DispatchWorkItem { [weak self] in
                guard let self, self.timers.removeValue(forKey: id) != nil, self.available else { return }
                self.context.exception = nil; callback.call(withArguments: [])
                if self.context.exception != nil { self.fail() }
            }
            self.timers[id] = work
            DispatchQueue.main.asyncAfter(deadline: .now() + ms / 1000, execute: work)
            return id
        }
        let clear: @convention(block) (Int) -> Void = { [weak self] id in self?.timers.removeValue(forKey: id)?.cancel() }
        controller = runtime.invokeMethod("create", withArguments: [
            ["enabled": isEnabled, "running": isRunning, "ramp": gain, "pause": pause, "timer": timer, "clearTimer": clear] as [String: Any]
        ])
        guard context.exception == nil, controller?.isObject == true else { throw MobileFailure("playback-fade-unavailable") }
    }
    var isFadingOut: Bool { invoke("isFadingOut")?.toBool() == true }
    func fadeOutThen(_ action: @escaping () -> Void) -> Bool {
        if isFadingOut { return true }
        pauseAction = action
        let accepted = invoke("fadeOutThen")?.toBool() == true
        if !accepted { pauseAction = nil }
        return accepted
    }
    func cancelPendingPause() -> Bool {
        let cancelled = invoke("cancelPendingPause")?.toBool() == true
        if cancelled { pauseAction = nil }
        return cancelled
    }
    func prepareFadeIn() -> Int? {
        pauseAction = nil
        guard let value = invoke("prepareFadeIn"), !value.isNull, !value.isUndefined else { return nil }
        return Int(value.toInt32())
    }
    func runFadeIn(_ token: Int) { _ = invoke("runFadeIn", [token]) }
    func abortFadeIn(_ token: Int) { _ = invoke("abortFadeIn", [token]) }
    func cancel() { pauseAction = nil; _ = invoke("cancel") }
    func flush() { _ = invoke("flush"); pauseAction = nil }
    private func invoke(_ method: String, _ args: [Any] = []) -> JSValue? {
        guard available, Thread.isMainThread else { return nil }
        context.exception = nil
        let result = controller.invokeMethod(method, withArguments: args)
        guard context.exception == nil else { fail(); return nil }
        return result
    }
    // A damaged script must never strand output at zero or leave a requested pause unfulfilled.
    private func fail() {
        available = false; context.exception = nil
        timers.values.forEach { $0.cancel() }; timers.removeAll()
        let action = pauseAction; pauseAction = nil; action?(); ramp(1, 0)
    }
    deinit { timers.values.forEach { $0.cancel() } }
}
