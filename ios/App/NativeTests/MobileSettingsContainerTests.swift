import XCTest
import Capacitor
import WebKit
@testable import App

// MobileSettingsContainerTests.swift — current settings over real Capacitor/PCM and isolated native credentials.
@MainActor extension NativeTests {
    func testPackagedSettingsReturnAndCacheRetryPreservePlayback() async throws {
        var phases: [[String: Any]] = []
        defer {
            if let data = try? JSONSerialization.data(withJSONObject: phases, options: [.prettyPrinted, .sortedKeys]) {
                let item = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                item.name = "settings-container-phases"; item.lifetime = .keepAlways; add(item)
            }
        }
        try await checkPackagedVisualizers(["classic"]) { web, label, player, audio in
            let index = player.index, revision = player.queueRevision
            func checkpoint(_ phase: String) async throws {
                audio.reset(); let before = player.playbackPosition
                try await Task.sleep(for: .milliseconds(450))
                let pcm = audio.read(), advanced = player.playbackPosition - before
                XCTAssertTrue(player.outputIsPlaying); XCTAssertEqual(player.index, index)
                XCTAssertEqual(player.queueRevision, revision); XCTAssertEqual(player.queue.count, 2)
                XCTAssertGreaterThan(pcm.frames, 1000); XCTAssertEqual(pcm.channels, 2)
                XCTAssertGreaterThan(pcm.rms, 0.00001); XCTAssertGreaterThan(advanced, 0.1)
                let result = try await self.jointJS(web, #"JSON.stringify({draft:document.querySelector('.appearance-transfer textarea')?.value,open:[...document.querySelectorAll('.visual-settings details')].filter(n=>n.open).length,cache:document.querySelector('.settings-sheet .mobile-cache-controls')?.textContent,diagnostics:window.visualizerContainerQA})"#)
                let bytes = try XCTUnwrap((result as? String)?.data(using: .utf8))
                let ui = try XCTUnwrap(try JSONSerialization.jsonObject(with: bytes) as? [String: Any])
                phases.append(["phase": label + "-" + phase, "frames": pcm.frames, "channels": pcm.channels,
                               "rms": pcm.rms, "positionAdvanced": advanced, "ui": ui])
                print("SETTINGS_CONTAINER \(label)-\(phase) frames=\(pcm.frames) rms=\(pcm.rms) advanced=\(advanced)")
            }
            _ = try await self.jointJS(web, "document.querySelector('.player-wake')?.click(); true")
            try await self.jointUIReady(web, condition: "!document.querySelector('.player-heading').inert")
            _ = try await self.jointJS(web, "document.querySelector('.player-heading button[aria-haspopup=dialog]').click(); true")
            try await self.jointUIReady(web, condition: "!!document.querySelector('.player-options button')")
            _ = try await self.jointJS(web, "document.querySelector('.player-options button').click(); true")
            try await self.jointUIReady(web, condition: "!!document.querySelector('.appearance-transfer textarea')")
            _ = try await self.jointJS(web, #"""
            (() => {
              const transfer=document.querySelector('.appearance-transfer'); transfer.open=true;
              document.querySelector('.typography-controls > details').open=true;
              const text=transfer.querySelector('textarea');
              window.settingsDraftScale=localStorage.getItem('lyrics_font_scale')==='1.3'?1.2:1.3;
              window.settingsDraft=JSON.stringify({visualizerMode:'classic',lyricsFontScale:window.settingsDraftScale});
              Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(text,window.settingsDraft);
              text.dispatchEvent(new Event('input',{bubbles:true})); return true;
            })()
            """#)
            // A second JS turn lets React accept the draft before navigation.
            _ = try await self.jointJS(web, #"""
            (() => { const button=document.querySelector('.mobile-theme-entry'); button.scrollIntoView({block:'center'});
              window.settingsReturnScroll=document.querySelector('.visual-settings .sheet-body').scrollTop;
              button.click(); return true; })()
            """#)
            try await self.jointUIReady(web, condition: "!!document.querySelector('.mobile-theme-editor') && document.querySelector('.visual-settings').closest('.sheet-backdrop').hidden")
            let hidden = try await self.jointJS(web, "(()=>{const p=document.querySelector('.visual-settings').closest('.sheet-backdrop');return p.inert && getComputedStyle(p).display==='none'})()")
            XCTAssertEqual(hidden as? Bool, true)
            try await checkpoint("theme-editor")
            _ = try await self.jointJS(web, "document.querySelector('.mobile-theme-editor > header button').click(); true")
            try await self.jointUIReady(web, condition: "!document.querySelector('.mobile-theme-editor') && !document.querySelector('.visual-settings').closest('.sheet-backdrop').hidden")
            let retained = try await self.jointJS(web, #"""
            (()=>{const t=document.querySelector('.appearance-transfer'), body=document.querySelector('.visual-settings .sheet-body');
              return t.open && document.querySelector('.typography-controls > details').open
                && t.querySelector('textarea').value===window.settingsDraft
                && body.scrollTop===window.settingsReturnScroll && localStorage.getItem('lyrics_font_scale')!==String(window.settingsDraftScale);})()
            """#)
            XCTAssertEqual(retained as? Bool, true)
            try await checkpoint("returned-draft")
            _ = try await self.jointJS(web, "document.querySelector('.appearance-transfer .actions button:last-child').click(); true")
            try await self.jointUIReady(web, condition: "localStorage.getItem('lyrics_font_scale')===String(window.settingsDraftScale) && document.querySelector('.appearance-transfer textarea').value===''")
            _ = try await self.jointJS(web, "document.querySelector('.visual-settings > header button').click(); true")
            try await self.jointUIReady(web, condition: "!document.querySelector('.visual-settings') && document.querySelectorAll('.lyric-stage canvas').length>=2")
            try await checkpoint("applied-lyrics")

            _ = try await self.jointJS(web, #"""
            (()=>{
              document.querySelector('.player-wake')?.click();
              const original=window.Capacitor.nativePromise.bind(window.Capacitor);
              const qa=window.settingsCacheQA={original,failRead:false,holdSave:true,loads:0,saves:0};
              window.Capacitor.nativePromise=async (plugin,method,options)=>{
                if(method==='getMediaCacheSettings') qa.loads++;
                if(method==='mediaCacheState' && qa.failRead) throw Error('controlled-cache-read');
                if(method==='setMediaCacheSettings') {
                  qa.saves++;
                  if(qa.holdSave) { qa.holdSave=false; await new Promise(resolve=>qa.release=resolve); }
                }
                const value=await original(plugin,method,options);
                if(method==='setMediaCacheSettings') qa.saved=true;
                return value;
              }; return true;
            })()
            """#)
            defer { web.evaluateJavaScript("window.Capacitor.nativePromise=window.settingsCacheQA.original") }
            try await self.jointUIReady(web, condition: "!document.querySelector('.player-heading').inert")
            _ = try await self.jointJS(web, "document.querySelector('.player-collapse').click(); document.querySelector('.brand button').click(); true")
            try await self.jointUIReady(web, condition: "!!document.querySelector('.settings-sheet .mobile-cache-controls') && !document.querySelector('.settings-sheet .mobile-cache-controls').disabled")
            let initial = await player.mediaCache.settings.enabled
            _ = try await self.jointJS(web, "document.querySelector('.settings-sheet .mobile-cache-controls [role=switch]').click(); true")
            try await self.jointUIReady(web, condition: "typeof window.settingsCacheQA.release==='function'")
            _ = try await self.jointJS(web, "window.settingsCacheQA.failRead=true; document.dispatchEvent(new Event('visibilitychange')); true")
            try await self.jointUIReady(web, condition: "!!document.querySelector('.settings-sheet .mobile-cache-controls [role=alert]')")
            _ = try await self.jointJS(web, #"""
            (()=>{window.settingsCacheQA.failRead=false;
              document.querySelector('section[aria-labelledby="settings-cache"] > button').click(); return true;})()
            """#)
            try await self.jointUIReady(web, condition: "!document.querySelector('.settings-sheet .mobile-cache-controls [role=alert]')")
            let beforeRelease = try await self.jointJS(web, "window.settingsCacheQA.loads===0 && window.settingsCacheQA.saves===1")
            XCTAssertEqual(beforeRelease as? Bool, true, "Retry must not reconnect settings while a native save is pending")
            try await checkpoint("cache-retry-pending-save")
            _ = try await self.jointJS(web, "window.settingsCacheQA.release(); true")
            try await self.jointUIReady(web, condition: "window.settingsCacheQA.saved===true && !document.querySelector('.settings-sheet .mobile-cache-controls [role=alert]')")
            let saved = await player.mediaCache.settings.enabled
            XCTAssertEqual(saved, !initial)
            let checked = try await self.jointJS(web, "document.querySelector('.settings-sheet .mobile-cache-controls [role=switch]').getAttribute('aria-checked')")
            XCTAssertEqual(checked as? String, String(!initial))
            try await checkpoint("cache-saved")
            _ = try await self.jointJS(web, "document.querySelector('.settings-sheet > header button').click(); document.querySelector('.mini-title').click(); true")
            try await self.jointUIReady(web, condition: "!document.querySelector('.settings-sheet') && document.querySelectorAll('.lyric-stage canvas').length>=2")
            let config = WKSnapshotConfiguration(); config.afterScreenUpdates = true
            let shot = XCTAttachment(image: try await web.takeSnapshot(configuration: config))
            shot.name = label + "-settings-recovered"; shot.lifetime = .keepAlways; self.add(shot)
        }
    }

    func testPackagedSessionPersistenceIsolationUsesNativeStore() async throws {
        #if !targetEnvironment(simulator)
        throw XCTSkip("Independent simulator credentials only")
        #endif
        guard Bundle.main.bundleIdentifier == "app.folia.validation.App" else { throw MobileFailure("session-qa-only") }
        let credentials = try NativeGatewayStore.shared.snapshot()
        guard credentials.server.isEmpty, credentials.sessions.values.allSatisfy({ $0.isEmpty }) else {
            throw MobileFailure("session-qa-credentials-not-empty")
        }
        defer { try? SecureStore.write("gateway.credentials", credentials.dictionary()) }
        let controller = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).compactMap { $0.rootViewController as? CAPBridgeViewController }.first)
        let web = try XCTUnwrap(controller.webView)
        try await waitForStream({ !web.isLoading }, seconds: 15)
        let script = try XCTUnwrap(Bundle.main.url(forResource: "online-session-qa", withExtension: "js", subdirectory: "public"))
        _ = try await jointJS(web, String(contentsOf: script, encoding: .utf8))
        for failed in ["qq", "netease"] {
            let other = failed == "qq" ? "netease" : "qq"
            let result = try await web.callAsyncJavaScript(#"""
                const qa=FoliaOnlineSessionQA, cap=window.Capacitor, original=cap.nativePromise.bind(cap);
                await qa.initializeRuntime(); const port=qa.getMobileRuntime();
                let reject=true;
                cap.nativePromise=(plugin,method,options)=>original(plugin,method,
                  method==='saveSession' && options.provider===failed && reject ? {...options,scope:'expired-qa-scope'} : options);
                try {
                  port.write(failed,'cookie','pending-'+failed);
                  port.write(other,'cookie','saved-'+other);
                  await qa.flushSessions([other]);
                  const blocked=async providers=>{try {await qa.flushSessions(providers);return false;}catch{return true;}};
                  const own=await blocked([failed]), mixed=await blocked([other,failed]), all=await blocked(undefined);
                  const state=await original('FoliaNative','bootstrap',{});
                  const isolated=state.sessions[other]?.cookie==='saved-'+other && state.sessions[failed]?.cookie!=='pending-'+failed;
                  reject=false; port.write(failed,'cookie','recovered-'+failed); await qa.flushSessions();
                  await qa.initializeRuntime();
                  return {own,mixed,all,isolated,restored:qa.getMobileRuntime().read(failed,'cookie')==='recovered-'+failed};
                } finally {cap.nativePromise=original;}
                """#, arguments: ["failed": failed, "other": other], in: nil, contentWorld: .page)
            let values = try XCTUnwrap(result as? [String: Bool])
            XCTAssertEqual(values, ["own": true, "mixed": true, "all": true, "isolated": true, "restored": true])
            let reopened = try NativeGatewayStore().snapshot()
            XCTAssertEqual(reopened.sessions[failed]?["cookie"], "recovered-" + failed)
            XCTAssertEqual(reopened.sessions[other]?["cookie"], "saved-" + other)
            print("SESSION_PERSISTENCE_NATIVE \(failed) rejected by native scope guard; \(other) durable; retry restored")
        }
    }
}
