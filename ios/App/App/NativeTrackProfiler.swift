import Foundation
import JavaScriptCore

// NativeTrackProfiler.swift — serial original analysis; one short-lived JS VM releases each track's large arrays.
actor NativeTrackProfiler {
    private let scriptURL: URL?
    private let cache: NativeProfileCache
    private let trace: NativeAnalysisTrace?
    private var analysing = false
    private var waiting: [(UUID, CheckedContinuation<Void, Error>)] = []
    init(bundle: Bundle = .main, cacheDirectory: URL? = nil, trace: NativeAnalysisTrace? = nil) {
        self.trace = trace
        scriptURL = bundle.url(forResource: "profiles", withExtension: "js", subdirectory: "public/native")
        cache = NativeProfileCache(directory: cacheDirectory ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("FoliaProfiles", isDirectory: true))
    }
    func profile(file: URL, partial: Bool = false, beatModel: URL? = nil) async throws -> Data? {
        try Task.checkCancellation()
        let key = try cache.key(for: file, analysis: analysisID(beatModel))
        // Partial downloads are not stable local representations and never replace a complete record.
        if !partial, let hit = cache.read(key, gridless: beatModel == nil) { return hit.profile }
        let result = try await analyseFile(file, partial: partial, beatModel: beatModel)
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
        let result = try await analyseFile(file, partial: true, beatModel: beatModel)
        try Task.checkCancellation()
        // A failed/empty decode is not evidence about the next URL or account. Only measured profiles persist.
        if let result { cache.save(result, key: key, provider: provider) }
        return result
    }
    func profile(cached media: NativeCachedMedia, identity: NativeProfileIdentity, beatModel: URL? = nil) async throws -> Data? {
        try Task.checkCancellation()
        let key = NativeProfileCache.digest(Data((try analysisID(beatModel) + "|complete|" + identity.key + "|" + media.generation).utf8))
        if let hit = cache.read(key, gridless: beatModel == nil) { return hit.profile }
        let result = try await analyseFile(media.url, partial: false, beatModel: beatModel)
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
    private func decode(_ file: URL, operation: UUID) throws -> NativeProfilePCM {
        let end = trace?.begin("decode", operation: operation); defer { end?() }
        return try NativeProfilePCM.decode(file)
    }
    private func analyseFile(_ file: URL, partial: Bool, beatModel: URL?) async throws -> Data? {
        let operation = UUID()
        return try await withAnalysisPermit(operation) {
            try await analysePCM(decode(file, operation: operation), partial: partial, beatModel: beatModel, operation: operation)
        }
    }
    func analyse(_ pcm: NativeProfilePCM, partial: Bool = false, beatModel: URL? = nil, operation: UUID = UUID()) async throws -> Data? {
        try await withAnalysisPermit(operation) {
            try await analysePCM(pcm, partial: partial, beatModel: beatModel, operation: operation)
        }
    }
    // Both input paths retain the same permit until the awaited pipeline actually exits.
    func withAnalysisPermit<Result>(_ operation: UUID, _ work: () async throws -> Result) async throws -> Result {
        try await acquire(operation); defer { release() }
        try Task.checkCancellation()
        return try await work()
    }
    // An actor is reentrant at await: hold one logical permit through decode, model and features.
    // Waiting cancellation removes only that caller; an active cancellation releases after real work exits.
    private func acquire(_ operation: UUID) async throws {
        let end = trace?.begin("profile.wait", operation: operation); defer { end?() }
        try Task.checkCancellation()
        if !analysing { analysing = true; return }
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                waiting.append((id, continuation))
            }
        } onCancel: { Task { await self.cancelWaiting(id) } }
    }
    private func cancelWaiting(_ id: UUID) {
        guard let index = waiting.firstIndex(where: { $0.0 == id }) else { return }
        waiting.remove(at: index).1.resume(throwing: CancellationError())
    }
    private func release() {
        if waiting.isEmpty { analysing = false }
        else { waiting.removeFirst().1.resume() }
    }
    private func analysePCM(_ pcm: NativeProfilePCM, partial: Bool, beatModel: URL?, operation: UUID) async throws -> Data? {
        let end = trace?.begin("profile", operation: operation); defer { end?() }
        try Task.checkCancellation()
        guard pcm.mid.length % 4 == 0, pcm.frames <= NativeProfilePCM.maxFrames,
              pcm.side == nil || pcm.side!.length == pcm.mid.length else { throw MobileFailure("invalid-profile-input") }
        var gridJSON: Data?
        if let beatModel { gridJSON = try await NativeBeatAnalysis(scriptURL: scriptURL, trace: trace, operation: operation).grid(pcm.mid, model: beatModel) ?? Data("null".utf8) }
        let endAnalysis = trace?.begin("profile.features", operation: operation); defer { endAnalysis?() }
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
