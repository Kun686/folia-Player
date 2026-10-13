import XCTest
import WebKit
@testable import App

// OverlayCompositionTests.swift — compare native display capture and WKSnapshot at the same stable chrome state.
@MainActor extension NativeTests {
    func testPackagedPlayerOverlayComposition() async throws {
        try await checkPackagedVisualizers(["cappella", "monet"]) { web, label in
            // Keyboard focus legitimately keeps controls visible while the external sampler captures the screen.
            _ = try await self.jointJS(web, "document.querySelector('.primary-play').focus(); window.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab'})); true")
            try await self.jointUIReady(web, condition: "document.querySelector('.player-panel')?.dataset.controlsHidden === 'false'")
            try await self.recordOverlayComposition(web, phase: "overlay-" + label + "-shown", hidden: false)
            // Exercise the existing stage tap handlers; this does not claim a physical touch hit-test.
            _ = try await self.jointJS(web, #"""
            (() => {
              document.activeElement?.blur();
              const stage = document.querySelector('.lyric-stage');
              for (const type of ['pointerdown','pointerup']) stage.dispatchEvent(new PointerEvent(type,
                {bubbles:true,pointerId:1,isPrimary:true,button:0,clientX:10,clientY:200}));
              return true;
            })()
            """#)
            try await Task.sleep(for: .milliseconds(100))
            _ = try await self.jointJS(web, "document.querySelector('.lyric-stage').click(); true")
            try await self.jointUIReady(web, condition: "document.querySelector('.player-panel')?.dataset.controlsHidden === 'true'")
            try await self.recordOverlayComposition(web, phase: "overlay-" + label + "-hidden", hidden: true)
            _ = try await self.jointJS(web, "document.querySelector('.player-wake').click(); true")
        }
    }

    // No rendering API hooks: retain only scalar DOM geometry, computed styles, text and snapshot pixels.
    private func recordOverlayComposition(_ web: WKWebView, phase: String, hidden: Bool) async throws {
        try await jointUIReady(web, condition: "Number(getComputedStyle(document.querySelector('.player-heading')).opacity) \(hidden ? "< 0.01" : "> 0.99")")
        let value = try await jointJS(web, #"""
        JSON.stringify({hidden:document.querySelector('.player-panel').dataset.controlsHidden,
          width:innerWidth,height:innerHeight,active:document.activeElement?.className,
          nodes:['.mobile-transition-card','.mobile-transition-card > div','[data-toast-card]',
                 '[data-toast-cover]','[data-toast-card] > div:last-child','.player-heading','.player-controls'].map(selector => {
            const node = document.querySelector(selector); if (!node) return {selector,exists:false};
            const style = getComputedStyle(node), rect = node.getBoundingClientRect();
            return {selector,exists:true,rect:rect.toJSON(),text:node.textContent?.slice(0,250),
              opacity:style.opacity,display:style.display,visibility:style.visibility,position:style.position,
              bottom:style.bottom,transform:style.transform,backdropFilter:style.backdropFilter};
          })})
        """#)
        let data = try XCTUnwrap((value as? String)?.data(using: .utf8))
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = phase + "-dom"; attachment.lifetime = .keepAlways; add(attachment)
        let config = WKSnapshotConfiguration(); config.afterScreenUpdates = true
        let image = try await web.takeSnapshot(configuration: config)
        let screenshot = XCTAttachment(image: image)
        screenshot.name = phase + "-web"; screenshot.lifetime = .keepAlways; add(screenshot)
        try jointProcessCheckpoint(phase, web: web)
        // The bounded external sampler captures simctl's display image and verifies this phase did not change.
        try await Task.sleep(for: .seconds(4))
        let current = try await jointJS(web, "document.querySelector('.player-panel').dataset.controlsHidden")
        XCTAssertEqual(current as? String, hidden ? "true" : "false", phase)
    }
}
