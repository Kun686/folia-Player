import Foundation
import JavaScriptCore

// NativeTrackProfiler.swift — serial original analysis; one short-lived JS VM releases each track's large arrays.
actor NativeTrackProfiler {
    private let scriptURL: URL?
    private let cache: NativeProfileCache
    init(bundle: Bundle = .main, cacheDirectory: URL? = nil) {
        scriptURL = bundle.url(forResource: "profiles", withExtension: "js", subdirectory: "public/native")
        cache = NativeProfileCache(directory: cacheDirectory ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("FoliaProfiles", isDirectory: true))
    }
    func profile(file: URL, partial: Bool = false) throws -> Data? {
        try Task.checkCancellation()
        let key = try cache.key(for: file)
        // Partial downloads are not stable local representations and never replace a complete record.
        if !partial, let hit = cache.read(key) { return hit.profile }
        let result = try analyse(NativeProfilePCM.decode(file), partial: partial)
        try Task.checkCancellation()
        guard try cache.key(for: file) == key else { throw MobileFailure("profile-source-changed") }
        if !partial { cache.save(result, key: key) }
        return result
    }
    // Uncached, default-off media keeps the original head-only bandwidth policy.
    func profile(remote url: URL, identity: NativeProfileIdentity,
                 configuration: URLSessionConfiguration = .ephemeral) async throws -> Data? {
        try Task.checkCancellation()
        guard let provider = identity.provider else { throw MobileFailure("invalid-identity") }
        if let hit = cache.read(identity.cacheKey) { return hit.profile }
        let bytes = try await NativeProfilePrefix(configuration: configuration).read(url)
        try Task.checkCancellation()
        let ext = ["mp3", "m4a", "mp4", "aac", "flac", "wav", "aiff", "caf", "ogg"].contains(url.pathExtension.lowercased())
            ? url.pathExtension.lowercased() : "audio"
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(ext)
        defer { try? FileManager.default.removeItem(at: file) }
        try bytes.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        let result = try analyse(NativeProfilePCM.decode(file), partial: true)
        try Task.checkCancellation()
        // A failed/empty decode is not evidence about the next URL or account. Only measured profiles persist.
        if let result { cache.save(result, key: identity.cacheKey, provider: provider) }
        return result
    }
    func profile(cached media: NativeCachedMedia, identity: NativeProfileIdentity) throws -> Data? {
        try Task.checkCancellation()
        let key = NativeProfileCache.digest(Data(("v9-gridless-vdsp|complete|" + identity.key + "|" + media.generation).utf8))
        if let hit = cache.read(key) { return hit.profile }
        let result = try analyse(NativeProfilePCM.decode(media.url), partial: false)
        try Task.checkCancellation()
        if let result { cache.save(result, key: key, provider: identity.provider) }
        return result
    }
    func invalidateProvider(_ provider: String) { cache.remove(provider: provider) }
    func analyse(_ pcm: NativeProfilePCM, partial: Bool = false) throws -> Data? {
        try Task.checkCancellation()
        guard pcm.mid.length % 4 == 0, pcm.frames <= NativeProfilePCM.maxFrames,
              pcm.side == nil || pcm.side!.length == pcm.mid.length else { throw MobileFailure("invalid-profile-input") }
        return try autoreleasepool {
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
            let mid = try NativeFloat32Bridge.make(pcm.mid, in: context, errorCode: "profile-memory-unavailable")
            let side = try pcm.side.map { try NativeFloat32Bridge.make($0, in: context, errorCode: "profile-memory-unavailable") } ?? JSValue(nullIn: context)!
            var response: String?, code = ""
            let done: @convention(block) (String, String) -> Void = { json, error in response = json; code = error }
            let fft = NativeProfileFFT()
            let transform: @convention(block) (JSValue, JSValue) -> Void = { [weak context] real, imag in
                do { try fft.transform(real: real, imag: imag) }
                catch { context?.exception = JSValue(newErrorFromMessage: "profile-fft-failed", in: context) }
            }
            runtime.invokeMethod("analysePCM", withArguments: [mid, side, partial, done, transform])
            try Task.checkCancellation()
            guard ProcessInfo.processInfo.systemUptime <= deadline else { throw MobileFailure("profile-timeout") }
            guard context.exception == nil, code.isEmpty, let response, response.utf8.count <= 262144,
                  let data = response.data(using: .utf8) else { throw MobileFailure("profile-analysis-failed") }
            if response == "null" { return nil }
            guard let fields = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  fields["version"] as? Int == 9 else { throw MobileFailure("invalid-profile-result") }
            return data
        }
    }

}
