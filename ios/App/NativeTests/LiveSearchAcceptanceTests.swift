import XCTest
import Capacitor
import WebKit
@testable import App

// LiveSearchAcceptanceTests.swift — opt-in observation of real UI submissions; no injected search or account mutation.
@MainActor extension NativeTests {
    func testSignedInQQPlaylistArtworkResponse() async throws {
        guard ProcessInfo.processInfo.environment["FOLIA_LIVE_ARTWORK_QA"] == "1" else {
            throw XCTSkip("Requires an authorized signed-in independent simulator")
        }
        #if !targetEnvironment(simulator)
        throw XCTSkip("Restricted to the independent simulator app")
        #endif
        guard Bundle.main.bundleIdentifier == "app.folia.validation.App" else { throw MobileFailure("live-qa-identity") }
        let credentials = try NativeGatewayStore.shared.snapshot()
        guard !credentials.server.isEmpty, !credentials.token.isEmpty, credentials.sessions["qq"]?.isEmpty == false else {
            throw MobileFailure("live-qa-qq-session-required")
        }
        let controller = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).compactMap { $0.rootViewController as? CAPBridgeViewController }.first)
        let web = try XCTUnwrap(controller.webView)
        let plugin = try XCTUnwrap(controller.bridge?.plugin(withName: "FoliaNative") as? FoliaNativePlugin)
        try await waitForStream({ plugin.engine != nil && !web.isLoading }, seconds: 15)
        let player = try XCTUnwrap(plugin.engine), page = try XCTUnwrap(web.url)
        guard page.scheme == "capacitor", page.host == "localhost", page.query == nil,
              ["", "/", "/index.html"].contains(page.path), controller.bridge?.config.appStartPath == nil,
              type(of: player.gateway) == GatewayClient.self else { throw MobileFailure("live-qa-production-page-required") }
        guard !player.outputIsPlaying else { throw MobileFailure("live-qa-pause-before-artwork") }
        let originalQueue = try JSONSerialization.data(withJSONObject: player.queue, options: [.sortedKeys])
        let position = player.playbackPosition
        try await jointUIReady(web, condition: "!!document.querySelector('.mini-title')")
        _ = try await jointJS(web, livePlaylistArtworkObserver)
        defer { web.evaluateJavaScript("window.__foliaArtworkQA?.dispose();true", completionHandler: nil) }
        print("FOLIA_LIVE_ARTWORK ready: switch away from QQ and back using the UI")
        var report: [String: Any] = [:]
        for tick in 0..<60 {
            let raw = try await jointJS(web, "JSON.stringify(window.__foliaArtworkQA.read())")
            report = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(try XCTUnwrap(raw as? String).utf8)) as? [String: Any])
            if report["response"] != nil, (report["settledMs"] as? Double ?? 0) > 3000 { break }
            if tick % 10 == 0 { print("FOLIA_LIVE_ARTWORK elapsed=\(tick)s") }
            try await Task.sleep(for: .seconds(1))
        }
        let attachment = XCTAttachment(data: try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]), uniformTypeIdentifier: "public.json")
        attachment.name = "live-qq-playlist-artwork"; attachment.lifetime = .keepAlways; add(attachment)
        let response = try XCTUnwrap(report["response"] as? [String: Any])
        XCTAssertEqual(response["status"] as? Int, 200)
        XCTAssertGreaterThan((response["items"] as? [[String: Any]])?.count ?? 0, 0)
        if ProcessInfo.processInfo.environment["FOLIA_ARTWORK_EXPECT_LOADED"] == "1" {
            let rows = report["visible"] as? [[String: Any]] ?? []
            XCTAssertEqual(rows.count, 4)
            XCTAssertEqual(rows.filter { $0["imageCount"] as? Int == 1 && $0["loaded"] as? Bool == true }.count, 3)
            XCTAssertEqual(rows.filter { $0["placeholder"] as? Bool == true }.count, 1)
        }
        XCTAssertFalse(player.outputIsPlaying)
        XCTAssertEqual(player.playbackPosition, position, accuracy: 0.01)
        XCTAssertTrue(try JSONSerialization.data(withJSONObject: player.queue, options: [.sortedKeys]) == originalQueue)
        let after = try NativeGatewayStore.shared.snapshot()
        XCTAssertTrue(after.server == credentials.server && after.token == credentials.token && after.sessions == credentials.sessions)
    }

    func testSignedInQQSearchResponseMatchesVisibleResults() async throws {
        guard ProcessInfo.processInfo.environment["FOLIA_LIVE_SEARCH_QA"] == "1" else {
            throw XCTSkip("Requires explicitly authorized UI operation and an existing signed-in simulator")
        }
        #if !targetEnvironment(simulator)
        throw XCTSkip("Restricted to the independent simulator app")
        #endif
        guard Bundle.main.bundleIdentifier == "app.folia.validation.App" else { throw MobileFailure("live-qa-identity") }
        let credentials = try NativeGatewayStore.shared.snapshot()
        guard !credentials.server.isEmpty, !credentials.token.isEmpty, credentials.sessions["qq"]?.isEmpty == false else {
            throw MobileFailure("live-qa-qq-session-required")
        }
        let controller = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).compactMap { $0.rootViewController as? CAPBridgeViewController }.first)
        let web = try XCTUnwrap(controller.webView)
        let plugin = try XCTUnwrap(controller.bridge?.plugin(withName: "FoliaNative") as? FoliaNativePlugin)
        try await waitForStream({ plugin.engine != nil && !web.isLoading }, seconds: 15)
        let player = try XCTUnwrap(plugin.engine), page = try XCTUnwrap(web.url)
        guard page.scheme == "capacitor", page.host == "localhost", page.query == nil,
              ["", "/", "/index.html"].contains(page.path), controller.bridge?.config.appStartPath == nil,
              type(of: player.gateway) == GatewayClient.self else { throw MobileFailure("live-qa-production-page-required") }
        let originalQueue = try JSONSerialization.data(withJSONObject: player.queue, options: [.sortedKeys])
        guard !player.outputIsPlaying else { throw MobileFailure("live-qa-pause-before-search") }
        try await jointUIReady(web, condition: "!!document.querySelector('.mini-title')")
        _ = try await jointJS(web, liveSearchObserver)
        defer { web.evaluateJavaScript("window.__foliaSearchQA?.dispose();true", completionHandler: nil) }
        print("FOLIA_LIVE_SEARCH ready: operate QQ playlist, then four Power/Love UI searches")
        var report: [String: Any] = [:]
        for tick in 0..<180 {
            let raw = try await jointJS(web, "JSON.stringify(window.__foliaSearchQA.read())")
            report = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(try XCTUnwrap(raw as? String).utf8)) as? [String: Any])
            let completed = (report["requests"] as? [[String: Any]] ?? []).filter { $0["ended"] != nil }
            if completed.count >= 4, (report["settledMs"] as? Double ?? 0) > 750 { break }
            if tick % 10 == 0 { print("FOLIA_LIVE_SEARCH elapsed=\(tick)s completed=\(completed.count)") }
            try await Task.sleep(for: .seconds(1))
        }
        let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "live-qq-search-trace"; attachment.lifetime = .keepAlways; add(attachment)
        let screenshot = XCTAttachment(image: try await web.takeSnapshot(configuration: nil))
        screenshot.name = "live-qq-search-final"; screenshot.lifetime = .keepAlways; add(screenshot)
        let requests = report["requests"] as? [[String: Any]] ?? []
        XCTAssertEqual(requests.count, 4, "Exactly four UI-driven searches are required")
        for request in requests {
            XCTAssertEqual(request["status"] as? Int, 200)
            XCTAssertEqual(request["code"] as? Int, 200)
            XCTAssertEqual(request["businessCode"] as? Int, 0, "Diagnostic route must preserve the upstream business status")
            XCTAssertEqual((request["meta"] as? [String: Any])?["ret"] as? Int, 0)
            XCTAssertGreaterThan(request["count"] as? Int ?? 0, 0, "Actual QQ search returned no songs")
            print("FOLIA_LIVE_SEARCH query=\(request["query"] ?? "") status=\(request["status"] ?? -1) count=\(request["count"] ?? -1)")
        }
        let final = report["final"] as? [String: Any] ?? [:]
        XCTAssertGreaterThan(final["mountedRows"] as? Int ?? 0, 0, "The real response must reach the displayed list")
        XCTAssertEqual(final["empty"] as? Bool, false)
        XCTAssertFalse(player.outputIsPlaying)
        XCTAssertTrue(try JSONSerialization.data(withJSONObject: player.queue, options: [.sortedKeys]) == originalQueue)
        let after = try NativeGatewayStore.shared.snapshot()
        XCTAssertTrue(after.server == credentials.server && after.token == credentials.token && after.sessions == credentials.sessions,
                      "Search observation must preserve server settings and platform sessions")
    }
}

// Capture artwork shape and public host names only. No request options, account IDs, tokens or full response bodies leave the WebView.
private let livePlaylistArtworkObserver = #"""
(() => {
  if(window.__foliaArtworkQA)throw Error('artwork-observer-already-installed');
  const cap=window.Capacitor, original=cap.nativePromise;
  if(typeof original!=='function')throw Error('native-promise-unavailable');
  let response, ended=performance.now();
  const describe=value=>{
    const result={type:value===null?'null':Array.isArray(value)?'array':typeof value};
    if(typeof value==='string'){
      result.length=value.length;result.empty=!value.trim();
      try{const url=new URL(value,'https://relative.invalid');result.scheme=url.protocol;
        result.host=url.hostname;result.relative=!/^https?:\/\//i.test(value);result.hasQuery=!!url.search;}catch{result.urlValid=false;}
    }else if(Array.isArray(value))result.length=value.length;
    else if(value&&typeof value==='object')result.keys=Object.keys(value).sort();
    return result;
  };
  const wrapped=function(plugin,method,options){
    let pathname;try{if(plugin==='FoliaNative'&&method==='request'&&options?.payload?.provider==='qq')
      pathname=new URL(options.payload.path,'https://mobile.invalid').pathname;}catch{}
    if(pathname!=='/user/playlist')return original.apply(this,arguments);
    return original.apply(this,arguments).then(result=>{
      response={status:result.status};ended=performance.now();
      try{const body=JSON.parse(result.body);response.keys=Object.keys(body).sort();
        response.items=(Array.isArray(body.playlist)?body.playlist:[]).slice(0,20).map(item=>({
          keys:Object.keys(item).sort(),artwork:Object.fromEntries(Object.keys(item).filter(key=>/cover|pic|image/i.test(key)).map(key=>[key,describe(item[key])]))}));
      }catch{response.jsonReadable=false;}return result;
    });
  };
  cap.nativePromise=wrapped;
  window.__foliaArtworkQA={read:()=>({response,settledMs:performance.now()-ended,
    visible:[...document.querySelectorAll('.online-collections button')].map(button=>({
      imageCount:button.querySelectorAll('img').length,loaded:[...button.querySelectorAll('img')].every(img=>img.complete&&img.naturalWidth>0),
      placeholder:!!button.querySelector('.song-art svg')}))}),
    dispose:()=>{if(cap.nativePromise===wrapped)cap.nativePromise=original;delete window.__foliaArtworkQA;}};
  return true;
})()
"""#

// Observe only approved public keywords and scalar status/counts. Never store headers, full options, cookies, URLs or raw responses.
private let liveSearchObserver = #"""
(() => {
  if(window.__foliaSearchQA) throw Error('search-observer-already-installed');
  const cap=window.Capacitor, original=cap.nativePromise, requests=[], events=[], snapshots=[];
  if(typeof original!=='function') throw Error('native-promise-unavailable');
  const keyword=value=>['Power','Love'].includes(value)?value:null;
  const now=()=>Math.round(performance.now()), stamp=now();
  let last='', lastEnd=stamp;
  const view=()=>({query:keyword(document.querySelector('form.search input')?.value),
    mountedRows:document.querySelectorAll('.song-list .song-row').length,
    empty:!!document.querySelector('.empty'), busy:!!document.querySelector('p[role="status"]')});
  const sample=()=>{if(!requests.length)return;const value=view(), key=JSON.stringify(value);
    if(key!==last&&snapshots.length<80){last=key;snapshots.push({at:now()-stamp,...value});}};
  const observe=event=>{const form=event.target.closest?.('form.search');if(!form)return;
    const query=keyword(form.querySelector('input')?.value);if(!query||events.length>=40)return;
    if(event.type==='submit'||(event.type==='keydown'&&event.key==='Enter')||(event.type==='click'&&event.target.closest('button')))
      events.push({type:event.type,query,at:now()-stamp});};
  for(const type of ['submit','keydown','click'])document.addEventListener(type,observe,true);
  const observer=new MutationObserver(sample);observer.observe(document.body,{childList:true,subtree:true});
  const wrapped=function(plugin,method,options){
    let parsed;try{if(plugin==='FoliaNative'&&method==='request'&&options?.payload?.provider==='qq')
      parsed=new URL(options.payload.path,'https://mobile.invalid');}catch{}
    const query=parsed?.pathname==='/mobile/search'?keyword(parsed.searchParams.get('key')):null;
    if(!query)return original.apply(this,arguments);
    if(requests.length>=8)return original.apply(this,arguments);
    const entry={query,page:Number(parsed.searchParams.get('page')),limit:Number(parsed.searchParams.get('limit')),started:now()-stamp};
    requests.push(entry);sample();
    return original.apply(this,arguments).then(result=>{
      entry.status=result.status;
      try{const body=JSON.parse(result.body);entry.code=Number.isSafeInteger(body.code)?body.code:null;
        entry.businessCode=Number.isSafeInteger(body.data?.code)?body.data.code:null;
        entry.meta=Object.fromEntries(['ret','sum','curpage','nextpage']
          .filter(key=>Number.isSafeInteger(body.data?.meta?.[key])).map(key=>[key,body.data.meta[key]]));
        entry.count=Array.isArray(body.data?.body?.item_song)?body.data.body.item_song.length:null;}catch{entry.jsonReadable=false;}
      entry.ended=now()-stamp;lastEnd=now();sample();return result;
    },error=>{entry.rejected=true;entry.ended=now()-stamp;lastEnd=now();sample();throw error;});
  };
  cap.nativePromise=wrapped;
  window.__foliaSearchQA={read:()=>{sample();return {requests,events,snapshots,final:view(),settledMs:now()-lastEnd};},
    dispose:()=>{if(cap.nativePromise===wrapped)cap.nativePromise=original;observer.disconnect();
      for(const type of ['submit','keydown','click'])document.removeEventListener(type,observe,true);delete window.__foliaSearchQA;}};
  return true;
})()
"""#
