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
    func profile(file: URL, partial: Bool = false, beatModel: URL? = nil) async throws -> Data? {
        try Task.checkCancellation()
        let key = try cache.key(for: file, analysis: analysisID(beatModel))
        // Partial downloads are not stable local representations and never replace a complete record.
        if !partial, let hit = cache.read(key, gridless: beatModel == nil) { return hit.profile }
        let result = try await analyse(NativeProfilePCM.decode(file), partial: partial, beatModel: beatModel)
        try Task.checkCancellation()
        guard try cache.key(for: file, analysis: analysisID(beatModel)) == key else { throw MobileFailure("profile-source-changed") }
        if !partial { cache.save(result, key: key) }
        return result
    }
    // Uncached, default-off media keeps the original head-only bandwidth policy.
    func profile(remote url: URL, identity: NativeProfileIdentity,
                 configuration: URLSessionConfiguration = .ephemeral, beatModel: URL? = nil) async throws -> Data? {
        try Task.checkCancellation()
        guard let provider = identity.provider else { throw MobileFailure("invalid-identity") }
        let key = NativeProfileCache.digest(Data((try analysisID(beatModel) + "|" + identity.key).utf8))
        if let hit = cache.read(key, gridless: beatModel == nil) { return hit.profile }
        let bytes = try await NativeProfilePrefix(configuration: configuration).read(url)
        try Task.checkCancellation()
        let ext = ["mp3", "m4a", "mp4", "aac", "flac", "wav", "aiff", "caf", "ogg"].contains(url.pathExtension.lowercased())
            ? url.pathExtension.lowercased() : "audio"
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(ext)
        defer { try? FileManager.default.removeItem(at: file) }
        try bytes.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        let result = try await analyse(NativeProfilePCM.decode(file), partial: true, beatModel: beatModel)
        try Task.checkCancellation()
        // A failed/empty decode is not evidence about the next URL or account. Only measured profiles persist.
        if let result { cache.save(result, key: key, provider: provider) }
        return result
    }
    func profile(cached media: NativeCachedMedia, identity: NativeProfileIdentity, beatModel: URL? = nil) async throws -> Data? {
        try Task.checkCancellation()
        let key = NativeProfileCache.digest(Data((try analysisID(beatModel) + "|complete|" + identity.key + "|" + media.generation).utf8))
        if let hit = cache.read(key, gridless: beatModel == nil) { return hit.profile }
        let result = try await analyse(NativeProfilePCM.decode(media.url), partial: false, beatModel: beatModel)
        try Task.checkCancellation()
        if let result { cache.save(result, key: key, provider: identity.provider) }
        return result
    }
    func invalidateProvider(_ provider: String) { cache.remove(provider: provider) }
    private func analysisID(_ model: URL?) throws -> String {
        guard let model else { return "v9-gridless-vdsp" }
        guard model.isFileURL else { throw MobileFailure("ort-invalid-input") }
        return "v9-beat-this-vdsp-ort1.30.0|" + (try NativeORTInference.modelDigest(.beatThis))
    }
    func analyse(_ pcm: NativeProfilePCM, partial: Bool = false, beatModel: URL? = nil) async throws -> Data? {
        try Task.checkCancellation()
        guard pcm.mid.length % 4 == 0, pcm.frames <= NativeProfilePCM.maxFrames,
              pcm.side == nil || pcm.side!.length == pcm.mid.length else { throw MobileFailure("invalid-profile-input") }
        var gridJSON: Data?
        if let beatModel { gridJSON = try await NativeBeatAnalysis(scriptURL: scriptURL).grid(pcm.mid, model: beatModel) ?? Data("null".utf8) }
        return try autoreleasepool {
            let vm = try NativeProfileRuntime(scriptURL: scriptURL), context = vm.context
            let mid = try NativeFloat32Bridge.make(pcm.mid, in: context, errorCode: "profile-memory-unavailable")
            let side = try pcm.side.map { try NativeFloat32Bridge.make($0, in: context, errorCode: "profile-memory-unavailable") } ?? JSValue(nullIn: context)!
            var response: String?, code = ""
            let done: @convention(block) (String, String) -> Void = { json, error in response = json; code = error }
            var arguments: [Any] = [mid, side, partial, done, vm.transform]
            if let gridJSON { arguments.append(String(decoding: gridJSON, as: UTF8.self)) }
            try vm.call("analysePCM", arguments)
            guard code.isEmpty, let response, response.utf8.count <= 262144,
                  let data = response.data(using: .utf8) else { throw MobileFailure("profile-analysis-failed") }
            if response == "null" { return nil }
            guard let fields = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  fields["version"] as? Int == 9 else { throw MobileFailure("invalid-profile-result") }
            return data
        }
    }

}
