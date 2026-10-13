import XCTest
import Capacitor
import WebKit
@testable import App

// NavidromeMutationTests.swift — real request encoding, URLSession and Capacitor; no real account/server writes.
@MainActor extension NativeTests {
    private func mutationBody() -> Data { Data("{\"subsonic-response\":{\"status\":\"ok\",\"version\":\"1.16.1\"}}".utf8) }
    func testNavidromeMutationRetainsRepeatedParametersAndSeparatesReadRoutes() throws {
        let fixture = try NavidromePlaybackFixture(gateway: FailingGateway()); defer { fixture.close() }
        let settings = try NativeNavidromeSettings.read(fixture.record)
        let request = try NativeNavidromeRequest.mutation(settings: settings, operation: "updatePlaylist", parameters: [
            "playlistId": "playlist+雪", "name": "A & B", "public": "false", "songIdToAdd": ["a+b", "a&雪"], "songIndexToRemove": ["2", "0"]])
        let url = try XCTUnwrap(request.url), query = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
        XCTAssertEqual(query.filter { $0.name == "songIdToAdd" }.compactMap(\.value), ["a+b", "a&雪"])
        XCTAssertEqual(query.filter { $0.name == "songIndexToRemove" }.compactMap(\.value), ["2", "0"])
        XCTAssertTrue(url.absoluteString.contains("%2B")); XCTAssertFalse(url.absoluteString.contains(settings.password))
        XCTAssertEqual(request.httpMethod, "GET"); XCTAssertFalse(request.httpShouldHandleCookies)
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        for operation in ["createPlaylist", "deletePlaylist", "updatePlaylist", "star", "unstar"] {
            XCTAssertThrowsError(try NativeNavidromeRequest.make(settings: settings, operation: operation, parameters: ["id": "one"]))
        }
        for invalid: [String: Any] in [["playlistId": "p", "u": "override"], ["playlistId": "p", "songIndexToRemove": ["-1"]],
            ["playlistId": "p", "songIdToAdd": "one"], ["playlistId": "p", "public": "1"], ["playlistId": "p"],
            ["playlistId": "p", "songIdToAdd": Array(repeating: "one", count: 1001)], ["playlistId": "p", "name": "a\nb"]] {
            XCTAssertThrowsError(try NativeNavidromeRequest.mutation(settings: settings, operation: "updatePlaylist", parameters: invalid))
        }
        XCTAssertThrowsError(try NativeNavidromeRequest.mutation(settings: settings, operation: "scrobble", parameters: ["id": "one"]))
    }
    func testNavidromeMutationSerializesCancelsOnAccountChangeAndDoesNotRetry() async throws {
        let fixture = try NavidromePlaybackFixture(gateway: FailingGateway()); defer { fixture.close() }
        var body = mutationBody(); body.append(Data(repeating: 32, count: 300_000))
        let request = fixture.route("createPlaylist", id: "", body: body); request.delay = 0.03
        let state = try fixture.client.snapshot(), scope = state["scope"] as! String, revision = state["revision"] as! Int
        let work = Task { try await fixture.client.mutate(id: "one", expected: revision, scope: scope, operation: "createPlaylist", parameters: ["name": "QA", "songId": ["a"]]) }
        try await waitForStream { request.stats.sent > 0 }
        do { _ = try await fixture.client.mutate(id: "two", expected: revision, scope: scope, operation: "createPlaylist", parameters: ["name": "Second"]); XCTFail("parallel mutation") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "invalid-navidrome-request") }
        try fixture.edit(["password": "changed"])
        do { _ = try await work.value; XCTFail("late account mutation") } catch {}
        XCTAssertEqual(request.stats.requests, 1)
        do { _ = try await fixture.client.mutate(id: "old", expected: revision, scope: scope, operation: "createPlaylist", parameters: ["name": "Old"]); XCTFail("old session") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "navidrome-settings-changed") }
        XCTAssertEqual(request.stats.requests, 1)
    }
    func testNavidromeMutationRejectsRedirectAndNeverSendsGatewayCredentials() async throws {
        let fixture = try NavidromePlaybackFixture(gateway: FailingGateway()); defer { fixture.close() }
        let targetFixture = ProfileHTTPFixture(mutationBody()), target = ProfileHTTPProtocol.add(targetFixture)
        defer { ProfileHTTPProtocol.remove(target) }
        let request = fixture.route("star", id: "one", body: mutationBody())
        request.redirect = target; request.completesDeclinedRedirect = true
        let state = try fixture.client.snapshot()
        do { _ = try await fixture.client.mutate(id: "redirect", expected: state["revision"] as! Int, scope: state["scope"] as! String,
            operation: "star", parameters: ["id": "one"]); XCTFail("redirect accepted") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "navidrome-redirect-refused") }
        XCTAssertEqual(targetFixture.stats.requests, 0); XCTAssertEqual(request.stats.requests, 1)
        XCTAssertNil(request.stats.first?.value(forHTTPHeaderField: "Authorization")); XCTAssertNil(request.stats.first?.value(forHTTPHeaderField: "Cookie"))
    }
    func testNavidromeMutationPackagedBridgePreservesArraysAndSafeErrors() async throws {
        guard Bundle.main.bundleIdentifier == "app.folia.validation.App" else { throw MobileFailure("qa-bundle-required") }
        let host = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).compactMap { $0.rootViewController as? CAPBridgeViewController }.first)
        let web = try XCTUnwrap(host.webView)
        try await waitForStream { !web.isLoading && web.url?.scheme == "capacitor" }
        let plugin = try XCTUnwrap(host.bridge?.plugin(withName: "FoliaNative") as? FoliaNativePlugin)
        try await waitForStream { plugin.navidrome != nil }
        let original = plugin.navidrome, fixture = try NavidromePlaybackFixture(gateway: FailingGateway())
        defer { plugin.navidrome = original; fixture.close() }; plugin.navidrome = fixture.client
        let request = fixture.route("updatePlaylist", id: "", body: mutationBody()), state = try fixture.client.snapshot()
        let output = try await web.callAsyncJavaScript("""
            const invoke = options => Capacitor.nativePromise('FoliaNative','navidromeMutation',options);
            const reply = await invoke({...state,id:'write',operation:'updatePlaylist',parameters:{playlistId:'list',songIdToAdd:['a+b','雪'],songIndexToRemove:['2']}});
            let invalid='';
            try { await invoke({...state,id:'bad',operation:'updatePlaylist',parameters:{playlistId:'list',password:'override'}}); }
            catch(e) { invalid=e.message; }
            return {reply, invalid};
            """, arguments: ["state": state], in: nil, contentWorld: .page)
        let result = try XCTUnwrap(output as? [String: Any]); XCTAssertEqual(result["invalid"] as? String, "invalid-navidrome-request")
        XCTAssertEqual(request.stats.requests, 1)
        let url = try XCTUnwrap(request.stats.first?.url), query = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
        XCTAssertEqual(query.filter { $0.name == "songIdToAdd" }.compactMap(\.value), ["a+b", "雪"])
        XCTAssertEqual(query.filter { $0.name == "songIndexToRemove" }.compactMap(\.value), ["2"])
        XCTAssertFalse(String(decoding: try JSONSerialization.data(withJSONObject: result), as: UTF8.self).contains("generated private password"))
    }
}
