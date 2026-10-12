import JavaScriptCore

// NativeProfileRuntime.swift — short-lived original analysis VM, shared by profile and beat preprocessing/postprocessing.
final class NativeProfileRuntime {
    let context: JSContext
    let transform: @convention(block) (JSValue, JSValue) -> Void
    private let runtime: JSValue
    private let deadline: Double

    init(scriptURL: URL?, fftSize: NativeProfileFFT.Size = .profile) throws {
        try Task.checkCancellation()
        guard let scriptURL, scriptURL.isFileURL,
              let source = try? String(contentsOf: scriptURL, encoding: .utf8), source.utf8.count <= 1048576,
              let context = JSContext() else { throw MobileFailure("profile-runtime-unavailable") }
        let deadline = ProcessInfo.processInfo.systemUptime + 45
        let now: @convention(block) () -> Double = { [weak context] in
            let time = ProcessInfo.processInfo.systemUptime
            if Task.isCancelled || time > deadline {
                context?.exception = JSValue(newErrorFromMessage: "profile-interrupted", in: context)
            }
            return time * 1000
        }
        context.setObject(["now": now], forKeyedSubscript: "performance" as NSString)
        context.evaluateScript(source, withSourceURL: scriptURL)
        guard context.exception == nil, let runtime = context.objectForKeyedSubscript("FoliaProfiles"),
              runtime.forProperty("protocolVersion")?.toInt32() == 1,
              runtime.forProperty("profileVersion")?.toInt32() == 9,
              runtime.forProperty("sampleRate")?.toDouble() == NativeProfilePCM.sampleRate,
              runtime.forProperty("maxFrames")?.toInt32() == Int32(NativeProfilePCM.maxFrames) else {
            throw MobileFailure("profile-runtime-unavailable")
        }
        let fft = NativeProfileFFT(size: fftSize)
        transform = { [weak context] real, imag in
            do { try fft.transform(real: real, imag: imag) }
            catch { context?.exception = JSValue(newErrorFromMessage: "profile-fft-failed", in: context) }
        }
        self.context = context; self.runtime = runtime; self.deadline = deadline
    }

    @discardableResult func call(_ method: String, _ arguments: [Any]) throws -> JSValue? {
        try Task.checkCancellation()
        let result = runtime.invokeMethod(method, withArguments: arguments)
        try Task.checkCancellation()
        guard ProcessInfo.processInfo.systemUptime <= deadline else { throw MobileFailure("profile-timeout") }
        guard context.exception == nil else { throw MobileFailure("profile-analysis-failed") }
        return result
    }
}
