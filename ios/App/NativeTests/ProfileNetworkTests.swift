import XCTest
import AVFoundation
@testable import App

// ProfileNetworkTests.swift — bounded synthetic HTTP responses exercise the real URLSession delegate and original analyser.
final class ProfileHTTPFixture: @unchecked Sendable {
    let bytes: Data
    var status = 206
    var headers: [String: String] = [:]
    var delay = 0.001
    var advertised: Int?
    var redirect: URL?
    var completesDeclinedRedirect = false
    private let lock = NSLock()
    private var requests: [URLRequest] = []
    private var sent = 0, stopped = 0
    init(_ bytes: Data) { self.bytes = bytes }
    func request(_ request: URLRequest) { lock.lock(); requests.append(request); lock.unlock() }
    func delivered(_ count: Int) { lock.lock(); sent += count; lock.unlock() }
    func stop() { lock.lock(); stopped += 1; lock.unlock() }
    var stats: (requests: Int, sent: Int, stopped: Int, first: URLRequest?) {
        lock.lock(); defer { lock.unlock() }; return (requests.count, sent, stopped, requests.first)
    }
    var prefixRequests: Int {
        lock.lock(); defer { lock.unlock() }
        return requests.filter { $0.value(forHTTPHeaderField: "Range") == "bytes=0-1572863" }.count
    }
    var capturedRequests: [URLRequest] {
        lock.lock(); defer { lock.unlock() }; return requests
    }
}
final class ProfileHTTPProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var fixtures: [String: ProfileHTTPFixture] = [:]
    private let gate = NSLock()
    private var closed = false
    private var fixture: ProfileHTTPFixture?
    private static func key(_ url: URL) -> String {
        let id = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "id" }?.value
        return url.host! + url.path + (id.map { "|id=" + $0 } ?? "")
    }
    static func add(_ fixture: ProfileHTTPFixture, at url: URL) {
        lock.lock(); fixtures[key(url)] = fixture; lock.unlock()
    }
    static func add(_ fixture: ProfileHTTPFixture, route: String? = nil, atOrigin: Bool = false) -> URL {
        // Keep each fixture isolated even when clients append a fixed protocol route.
        let key = "/" + UUID().uuidString + (route.map { "/" + $0 } ?? ".wav")
        let url = atOrigin ? URL(string: "https://" + UUID().uuidString.lowercased() + ".profile.invalid/" + (route ?? ""))!
            : URL(string: "https://profile.invalid" + key)!
        lock.lock(); fixtures[url.host! + url.path] = fixture; lock.unlock()
        return url
    }
    static func remove(_ url: URL) { lock.lock(); fixtures.removeValue(forKey: key(url)); lock.unlock() }
    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "profile.invalid" || request.url?.host?.hasSuffix(".profile.invalid") == true
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock()
        let found = Self.fixtures[Self.key(request.url!)] ?? Self.fixtures[request.url!.host! + request.url!.path]
        Self.lock.unlock()
        guard let found else { client?.urlProtocol(self, didFailWithError: URLError(.fileDoesNotExist)); return }
        fixture = found; found.request(request)
        if let target = found.redirect {
            var next = request; next.url = target
            let response = HTTPURLResponse(url: request.url!, statusCode: 302, httpVersion: "HTTP/1.1",
                headerFields: found.headers.merging(["Location": target.absoluteString], uniquingKeysWith: { _, value in value }))!
            client?.urlProtocol(self, wasRedirectedTo: next, redirectResponse: response)
            if found.completesDeclinedRedirect {
                // A real server finishes its 302 response even when the delegate declines the new request.
                // The default fixture models only followed redirects, whose original protocol is cancelled.
                DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 0.02) { [self] in
                    gate.lock(); let active = !closed; gate.unlock()
                    guard active else { return }
                    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                    client?.urlProtocolDidFinishLoading(self)
                }
            }
            return
        }
        let range = (request.value(forHTTPHeaderField: "Range") ?? "bytes=0-").dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
        let start = range.first.flatMap { Int($0) } ?? 0
        let requestedEnd = range.count > 1 ? Int(range[1]) ?? found.bytes.count - 1 : found.bytes.count - 1
        let end = min(found.bytes.count, requestedEnd + 1)
        guard start >= 0, start < end else { client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse)); return }
        let bytes = found.bytes.subdata(in: start..<end), length = found.advertised ?? bytes.count
        var headers = ["Content-Type": "audio/wav", "Content-Length": String(length),
                       "Accept-Ranges": "bytes", "Content-Range": "bytes \(start)-\(start + length - 1)/\(max(found.bytes.count, start + length))"]
        headers.merge(found.headers, uniquingKeysWith: { _, new in new })
        let response = HTTPURLResponse(url: request.url!, statusCode: found.status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 0.02) { [self] in send(bytes, offset: 0, fixture: found) }
    }
    private func send(_ bytes: Data, offset: Int, fixture: ProfileHTTPFixture) {
        gate.lock()
        guard !closed else { gate.unlock(); return }
        let end = min(offset + 16384, bytes.count)
        let chunk = bytes.subdata(in: offset..<end)
        if end == bytes.count { closed = true }
        gate.unlock()
        client?.urlProtocol(self, didLoad: chunk); fixture.delivered(chunk.count)
        if end == bytes.count { client?.urlProtocolDidFinishLoading(self) }
        else {
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + fixture.delay) { [self] in send(bytes, offset: end, fixture: fixture) }
        }
    }
    override func stopLoading() { gate.lock(); closed = true; gate.unlock(); fixture?.stop() }
}

@MainActor extension NativeTests {
    func profileNetworkConfiguration() -> URLSessionConfiguration {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ProfileHTTPProtocol.self]
        // Even an inherited configuration must not send access credentials to the audio CDN.
        config.httpAdditionalHeaders = ["Authorization": "fixture-only", "Cookie": "fixture-only"]
        return config
    }
    func testProfilePrefixRejectsFullResponsesBeforeReadingTheirBody() async throws {
        let fixture = ProfileHTTPFixture(Data(repeating: 0, count: 1024)); fixture.status = 200
        let url = ProfileHTTPProtocol.add(fixture); defer { ProfileHTTPProtocol.remove(url) }
        do { _ = try await NativeProfilePrefix(configuration: profileNetworkConfiguration()).read(url); XCTFail() }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "profile-range-unavailable") }
        try await Task.sleep(nanoseconds: 60_000_000)
        XCTAssertEqual(fixture.stats.sent, 0); XCTAssertGreaterThan(fixture.stats.stopped, 0)
    }
    func testProfilePrefixBoundsBytesAndSendsNoGatewayOrPlatformCredentials() async throws {
        let fixture = ProfileHTTPFixture(Data(repeating: 7, count: NativeProfilePrefix.limit + 100))
        let url = ProfileHTTPProtocol.add(fixture); defer { ProfileHTTPProtocol.remove(url) }
        let result = try await NativeProfilePrefix(configuration: profileNetworkConfiguration()).read(url)
        XCTAssertEqual(result, Data(fixture.bytes.prefix(NativeProfilePrefix.limit)))
        let request = try XCTUnwrap(fixture.stats.first)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Range"), "bytes=0-1572863")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Accept-Encoding"), "identity")
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization")); XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
        XCTAssertFalse(request.httpShouldHandleCookies)
        for raw in ["http://profile.invalid/a", "file:///a", "https://user:pass@profile.invalid/a"] {
            XCTAssertThrowsError(try NativeProfilePrefix.request(URL(string: raw)!))
        }
    }
    func testProfilePrefixRejectsMalformedRangesAndIncompleteBodies() async throws {
        let url = URL(string: "https://profile.invalid/audio")!
        for headers in [["Content-Range": "bytes 1-8/9"], ["Content-Range": "bytes 0-1572864/2000000"],
                        ["Content-Range": "bytes 0-8/8"], ["Content-Range": "bytes 0-8/9", "Content-Length": "10"],
                        ["Content-Range": "bytes 0-8/9", "Content-Encoding": "gzip"]] {
            let response = HTTPURLResponse(url: url, statusCode: 206, httpVersion: nil, headerFields: headers)!
            XCTAssertThrowsError(try NativeProfilePrefix.responseLength(response))
        }
        for count in [4, 16] {
            let fixture = ProfileHTTPFixture(Data(repeating: 1, count: count)); fixture.advertised = 8
            let source = ProfileHTTPProtocol.add(fixture); defer { ProfileHTTPProtocol.remove(source) }
            do { _ = try await NativeProfilePrefix(configuration: profileNetworkConfiguration()).read(source); XCTFail() }
            catch { XCTAssertTrue(["profile-incomplete-range", "profile-range-overflow", "profile-network"].contains((error as? MobileFailure)?.code ?? "")) }
        }
    }
    func testProfilePrefixCancellationStopsTheTransferAndReleasesItsOwner() async throws {
        let fixture = ProfileHTTPFixture(Data(repeating: 0, count: 300000)); fixture.delay = 0.05
        let url = ProfileHTTPProtocol.add(fixture); defer { ProfileHTTPProtocol.remove(url) }
        var downloader: NativeProfilePrefix? = NativeProfilePrefix(configuration: profileNetworkConfiguration())
        weak var owner = downloader
        var work: Task<Data, Error>? = Task { [captured = downloader!] in try await captured.read(url) }
        try await waitForStream { fixture.stats.sent > 0 }
        work!.cancel()
        do { _ = try await work!.value; XCTFail() } catch { XCTAssertTrue(error is CancellationError) }
        work = nil; downloader = nil
        XCTAssertLessThan(fixture.stats.sent, 300000)
        try await waitForStream { fixture.stats.stopped > 0 && owner == nil }
    }
    func testProfileRedirectCallbackStripsCredentialsAndRejectsDowngradesAndLoops() async throws {
        for loop in [false, true] {
            let fixture = ProfileHTTPFixture(Data(repeating: 0, count: 300000)); fixture.delay = 0.05
            let url = ProfileHTTPProtocol.add(fixture); defer { ProfileHTTPProtocol.remove(url) }
            let downloader = NativeProfilePrefix(configuration: profileNetworkConfiguration())
            let work = Task { try await downloader.read(url) }
            try await waitForStream { fixture.stats.sent > 0 }
            let session = URLSession(configuration: .ephemeral), task = session.dataTask(with: url)
            defer { session.invalidateAndCancel() }
            let response = HTTPURLResponse(url: url, statusCode: 302, httpVersion: nil, headerFields: [:])!
            var request = URLRequest(url: URL(string: "https://other.invalid/audio")!)
            request.setValue("fixture-only", forHTTPHeaderField: "Authorization")
            request.setValue("fixture-only", forHTTPHeaderField: "Cookie")
            for _ in 0..<(loop ? 5 : 1) {
                var accepted: URLRequest?
                downloader.urlSession(session, task: task, willPerformHTTPRedirection: response, newRequest: request) { accepted = $0 }
                XCTAssertEqual(accepted?.url, request.url)
                XCTAssertEqual(accepted?.value(forHTTPHeaderField: "Range"), "bytes=0-1572863")
                XCTAssertNil(accepted?.value(forHTTPHeaderField: "Authorization")); XCTAssertNil(accepted?.value(forHTTPHeaderField: "Cookie"))
            }
            if !loop { request.url = URL(string: "http://other.invalid/audio")! }
            downloader.urlSession(session, task: task, willPerformHTTPRedirection: response, newRequest: request) { XCTAssertNil($0) }
            do { _ = try await work.value; XCTFail() }
            catch { XCTAssertEqual((error as? MobileFailure)?.code, "profile-redirect-unavailable") }
        }
    }
    func testOnlineProfileUsesOnlyTheMeasuredPrefixAndKeepsTailUnknown() async throws {
        let file = try profileAudio(seconds: 24, head: 2, tail: 2)
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file); try? FileManager.default.removeItem(at: folder) }
        let fixture = ProfileHTTPFixture(try Data(contentsOf: file))
        XCTAssertGreaterThan(fixture.bytes.count, NativeProfilePrefix.limit)
        let url = ProfileHTTPProtocol.add(fixture); defer { ProfileHTTPProtocol.remove(url) }
        let identity = try XCTUnwrap(NativeProfileIdentity(song("qq", "prefix")))
        let result = try await NativeTrackProfiler(cacheDirectory: folder).profile(remote: url, identity: identity, configuration: profileNetworkConfiguration())
        let fields = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(result)) as? [String: Any])
        XCTAssertEqual(fields["partial"] as? Bool, true)
        XCTAssertGreaterThan(fields["leadIn"] as? Double ?? 0, 1)
        XCTAssertLessThan(fields["duration"] as? Double ?? 24, 24)
        for key in ["leadOut", "bodyOut", "outroSlope", "endsHot", "outroBpm", "outroKey", "outroTone"] { XCTAssertTrue(fields[key] is NSNull, key) }
    }
    func testOnlineProfileCacheSeparatesProvidersAndRepresentationsAndPurgesOnlyLoggedOutAccount() async throws {
        let file = try profileAudio(seconds: 3, head: 1)
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file); try? FileManager.default.removeItem(at: folder) }
        let fixture = ProfileHTTPFixture(try Data(contentsOf: file)), profiler = NativeTrackProfiler(cacheDirectory: folder)
        let url = ProfileHTTPProtocol.add(fixture); defer { ProfileHTTPProtocol.remove(url) }
        let qq = try XCTUnwrap(NativeProfileIdentity(song("qq", "same"))), netease = try XCTUnwrap(NativeProfileIdentity(song("netease", "same")))
        XCTAssertNotEqual(qq.key, netease.key)
        var variant = song("qq", "same"); variant["sourceRef"] = ["kind": "online", "providerId": "qq", "mediaId": "same", "providerData": ["fileId": "different"]]
        XCTAssertNotEqual(qq.key, NativeProfileIdentity(variant)?.key)
        let config = profileNetworkConfiguration()
        let a = try await profiler.profile(remote: url, identity: qq, configuration: config)
        let b = try await profiler.profile(remote: url, identity: netease, configuration: config)
        let local = try await profiler.profile(file: file)
        let offline = NativeTrackProfiler(bundle: Bundle(for: NativeTests.self), cacheDirectory: folder)
        let rotated = URL(string: url.absoluteString + "?signed=fixture")!
        let hit = try await offline.profile(remote: rotated, identity: qq, configuration: config)
        XCTAssertEqual(a, hit); XCTAssertEqual(fixture.stats.requests, 2)
        await profiler.invalidateProvider("qq")
        let retained = try await offline.profile(remote: url, identity: netease, configuration: config)
        let retainedLocal = try await offline.profile(file: file)
        XCTAssertEqual(b, retained); XCTAssertEqual(local, retainedLocal)
        do { _ = try await offline.profile(remote: url, identity: qq, configuration: config); XCTFail() }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "profile-runtime-unavailable") }
        XCTAssertEqual(fixture.stats.requests, 3)
        let records = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
        for record in records { XCTAssertFalse(try String(contentsOf: record).contains("profile.invalid")) }
    }
    func testOnlineProfileScopeCancellationAndLogoutCannotPublishOldResults() async throws {
        let file = try profileAudio(seconds: 6, head: 1)
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file); try? FileManager.default.removeItem(at: folder) }
        let slow = ProfileHTTPFixture(try Data(contentsOf: file)); slow.delay = 0.03
        let fast = ProfileHTTPFixture(slow.bytes)
        let a = ProfileHTTPProtocol.add(slow), b = ProfileHTTPProtocol.add(fast)
        defer { ProfileHTTPProtocol.remove(a); ProfileHTTPProtocol.remove(b) }
        let qq = song("qq", "old"), netease = song("netease", "new")
        let profiles = NativeTrackProfiles(local: LocalMediaLibrary(root: folder), profiler: NativeTrackProfiler(cacheDirectory: folder.appendingPathComponent("profiles")), configuration: profileNetworkConfiguration())
        defer { profiles.cancel() }
        let ka = NativeProfileIdentity(qq)!.key, kb = NativeProfileIdentity(netease)!.key
        profiles.update([qq], sources: [ka: a])
        try await waitForStream { slow.stats.sent > 0 }
        profiles.invalidateProvider("qq")
        profiles.update([netease], sources: [kb: b])
        try await waitForStream { profiles.value(netease) != nil && slow.stats.stopped > 0 }
        XCTAssertNil(profiles.value(qq)); XCTAssertEqual(profiles.value(netease)?["partial"] as? Bool, true)
        XCTAssertLessThan(slow.stats.sent, slow.bytes.count)
    }
    func testOnlinePrefixProfilesReachTheDecodedQueueWithoutResolvingAgain() async throws {
        let file = try profileAudio(seconds: 10, head: 2)
        defer { try? FileManager.default.removeItem(at: file) }
        let fixture = ProfileHTTPFixture(try Data(contentsOf: file)), url = ProfileHTTPProtocol.add(fixture)
        defer { ProfileHTTPProtocol.remove(url) }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [ProfileHTTPProtocol.self]
        let storage = UserDefaults(suiteName: "folia.online-profile-queue")!
        storage.removePersistentDomain(forName: "folia.online-profile-queue")
        let gateway = AudioFixtureGateway(url: url)
        let tested = PlaybackEngine(gateway: gateway, storage: storage, usesStereoOutput: true, mediaNetworkConfiguration: config)
        tested.network.cancel()
        defer { tested.stop(); tested.clearOutput(); storage.removePersistentDomain(forName: "folia.online-profile-queue") }
        defer { print("FOLIA_PROFILE_TRANSPORT requests=\(fixture.stats.requests) prefixes=\(fixture.prefixRequests) resolves=\(gateway.resolved.count) playing=\(tested.outputIsPlaying) error=\(tested.error ?? "none")") }
        _ = try tested.setTransitionSettings(["enabled": true, "mode": "crossfade", "crossfadeMaxSec": 1.0])
        try tested.setQueue([song("qq", UUID().uuidString), song("netease", UUID().uuidString)], at: 0)
        try await waitForStream { tested.outputIsPlaying && (tested.preparedStream?.entry.preparedPosition ?? 0) > 1 }
        let output = try XCTUnwrap(tested.streamOutput), measurement = OutputMeasurement()
        output.engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { buffer, _ in measurement.consume(buffer) }
        defer { output.engine.mainMixerNode.removeTap(onBus: 0) }
        try tested.command("seek", position: 7.5)
        try await waitForStream { tested.index == 1 && tested.crossfade?.isFading == true && tested.outputIsPlaying }
        XCTAssertGreaterThan(tested.playbackPosition, 1)
        XCTAssertEqual(gateway.resolved.count, 2, "Analysis must use the playing representations without resolving another URL")
        XCTAssertEqual(fixture.prefixRequests, 2)
        try await waitForStream { tested.crossfade?.isFading == false && output.attachedCount == 1 }
        measurement.reset()
        try await waitForStream { measurement.read().frames > 4096 }
        let pcm = measurement.read()
        XCTAssertEqual(pcm.channels, 2); XCTAssertGreaterThan(pcm.rms, 0.01)
        XCTAssertEqual(fixture.prefixRequests, 2)
        XCTAssertEqual(gateway.resolved.count, 2)
        print("FOLIA_ONLINE_PROFILE_QUEUE partialProfiles=\(fixture.prefixRequests) resolves=\(gateway.resolved.count) remainingDecks=\(output.attachedCount) channels=\(pcm.channels) rms=\(pcm.rms)")
    }
}
