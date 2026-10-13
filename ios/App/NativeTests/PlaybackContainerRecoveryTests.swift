import XCTest
import WebKit
@testable import App

// PlaybackContainerRecoveryTests.swift — real transport/PCM and page reload; only failure timing is injected.
@MainActor extension NativeTests {
    func testPackagedPlaybackFeedbackAndPageReload() async throws {
        var phases: [[String: Any]] = []
        defer {
            if let data = try? JSONSerialization.data(withJSONObject: phases, options: [.prettyPrinted, .sortedKeys]) {
                let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                attachment.name = "playback-container-recovery"; attachment.lifetime = .keepAlways; add(attachment)
            }
        }
        try await checkPackagedVisualizers(["classic"]) { web, label, player, audio in
            let title = try XCTUnwrap(player.currentSong?["name"] as? String)
            let index = player.index, revision = player.queueRevision
            // Measure the existing output tap; playing flags alone do not prove decoded audio.
            func checkpoint(_ step: String, playing: Bool, reset: Bool = true) async throws {
                if !playing { try await Task.sleep(for: .milliseconds(150)) }
                if reset { audio.reset() }
                let position = player.playbackPosition
                try await Task.sleep(for: .milliseconds(450))
                let pcm = audio.read(), advanced = player.playbackPosition - position
                let value = try await self.jointJS(web, #"JSON.stringify({title:document.querySelector('.track-description h2')?.textContent,queue:document.querySelector('.section-heading button')?.textContent,position:document.querySelector('.playback-progress input')?.value,alerts:[...document.querySelectorAll('.player-panel [role=alert],.library-playback-error')].map(n=>n.textContent),lateReadAlerts:window.playbackRecoveryQA?.lateAlerts??[],diagnostics:window.visualizerContainerQA})"#)
                let data = try XCTUnwrap((value as? String)?.data(using: .utf8))
                let ui = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
                phases.append(["phase": label + "-" + step, "frames": pcm.frames, "channels": pcm.channels,
                               "rms": pcm.rms, "positionAdvanced": advanced, "playing": player.outputIsPlaying, "ui": ui])
                XCTAssertEqual(player.outputIsPlaying, playing, step)
                XCTAssertEqual(player.index, index); XCTAssertEqual(player.queueRevision, revision)
                XCTAssertEqual(player.queue.count, 2); XCTAssertEqual(player.currentSong?["name"] as? String, title)
                XCTAssertEqual(ui["title"] as? String, title)
                XCTAssertTrue((ui["queue"] as? String)?.hasSuffix("· 2") == true)
                if playing {
                    XCTAssertGreaterThan(pcm.frames, 1000); XCTAssertEqual(pcm.channels, 2)
                    XCTAssertGreaterThan(pcm.rms, 0.00001); XCTAssertGreaterThan(advanced, 0.1)
                } else {
                    XCTAssertLessThan(abs(advanced), 0.01); XCTAssertLessThan(pcm.rms, 0.00001)
                }
                let diagnostics = try XCTUnwrap(ui["diagnostics"] as? [String: Any])
                XCTAssertEqual(diagnostics["errors"] as? [String], [])
                print("PLAYBACK_CONTAINER \(label)-\(step) frames=\(pcm.frames) rms=\(pcm.rms) playing=\(playing)")
            }
            _ = try await self.jointJS(web, #"""
            (() => {
              const bridge = window.Capacitor.nativePromise.bind(window.Capacitor);
              const qa = window.playbackRecoveryQA = {failPause:true,delayRead:false,rejectRead:null};
              window.Capacitor.nativePromise = async (plugin, method, options) => {
                if (method === 'command' && options.action === 'pause' && qa.failPause) {
                  qa.failPause = false; throw new Error('controlled-command-failure');
                }
                const value = await bridge(plugin, method, options);
                if (method === 'getState' && qa.delayRead) {
                  qa.delayRead = false;
                  return new Promise((_resolve,reject) => {qa.rejectRead=()=>reject(new Error('controlled-read-failure'));});
                }
                return value;
              };
              document.querySelector('.player-wake')?.click(); return true;
            })()
            """#)
            try await self.jointUIReady(web, condition: "!document.querySelector('.player-heading').inert")
            _ = try await self.jointJS(web, "document.querySelector('.player-collapse').click(); true")
            _ = try await self.jointJS(web, "document.querySelector('.mini-player > button:last-child').click(); true")
            try await self.jointUIReady(web, condition: "!!document.querySelector('.library-playback-error')")
            try await checkpoint("mini-failed", playing: true)
            _ = try await self.jointJS(web, "document.querySelector('.mini-title').click(); true")
            try await self.jointUIReady(web, condition: "!document.querySelector('.player-controls').inert")
            _ = try await self.jointJS(web, "document.querySelector('.primary-play').click(); true")
            try await self.waitForStream { !player.intentToPlay && !player.outputIsPlaying }
            try await self.jointUIReady(web, condition: "!document.querySelector('.player-panel [role=alert]')")
            try await checkpoint("retried-paused", playing: false)
            _ = try await self.jointJS(web, "document.querySelector('.primary-play').click(); true")
            try await self.waitForStream { player.outputIsPlaying }
            try await checkpoint("resumed", playing: true)

            _ = try await self.jointJS(web, #"""
            (() => {
              const qa = window.playbackRecoveryQA; qa.lateAlerts = [];
              qa.alertObserver = new MutationObserver(() => {
                const alert = document.querySelector('.player-panel [role=alert]');
                if (alert && qa.lateAlerts.length < 20) qa.lateAlerts.push(alert.textContent);
              });
              qa.alertObserver.observe(document.querySelector('.player-panel'), {subtree:true,childList:true,characterData:true});
              qa.delayRead=true; document.dispatchEvent(new Event('visibilitychange')); return true;
            })()
            """#)
            try await self.jointUIReady(web, condition: "typeof window.playbackRecoveryQA.rejectRead==='function'")
            let prior = player.revision
            try await self.waitForStream { player.revision > prior }
            try await self.jointUIReady(web, condition: "Number(document.querySelector('.playback-progress input').value)>0")
            _ = try await self.jointJS(web, "window.playbackRecoveryQA.rejectRead(); true")
            try await Task.sleep(for: .milliseconds(50))
            try await self.jointUIReady(web, condition: "!document.querySelector('.player-panel [role=alert]')")
            try await checkpoint("late-read-discarded", playing: true)
            let transientAlerts = try await self.jointJS(web, "window.playbackRecoveryQA.alertObserver.disconnect(); JSON.stringify(window.playbackRecoveryQA.lateAlerts)")
            XCTAssertEqual(transientAlerts as? String, "[]", "A later native tick must not conceal a transient stale-read error")

            // A real document reload drops JS state/listeners while the same native queue keeps decoding.
            _ = try await self.jointJS(web, "window.playbackRetiredDocument=true; true")
            audio.reset(); web.reload()
            try await self.jointUIReady(web, condition: "!window.playbackRetiredDocument && !!document.querySelector('.mini-title')")
            try await self.installVisualizerDiagnostics(web)
            try await self.jointUIReady(web, condition: "document.querySelector('.section-heading button')?.textContent.endsWith('· 2') === true")
            _ = try await self.jointJS(web, "document.querySelector('.mini-title').click(); true")
            try await self.jointUIReady(web, condition: "document.querySelectorAll('.lyric-stage canvas').length >= 2 && !document.querySelector('.empty-lyrics') && !document.querySelector('.lyric-notice')")
            try await checkpoint("reloaded", playing: true, reset: false)
            let config = WKSnapshotConfiguration(); config.afterScreenUpdates = true
            let screenshot = XCTAttachment(image: try await web.takeSnapshot(configuration: config))
            screenshot.name = label + "-reloaded"; screenshot.lifetime = .keepAlways; self.add(screenshot)
        }
    }
}
