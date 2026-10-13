import XCTest
import AVFoundation
import Capacitor
import WebKit
@testable import App

// NativeAudioRouteTests.swift — isolated system UI lifetime and native playback; no real output-device claim.
@MainActor extension NativeTests {
    private var routeLabels: [String: String] {
        ["title": "播放设备", "hint": "轻点 AirPlay 图标选择可用的播放设备。蓝牙设备需先在系统设置中配对。", "close": "关闭", "fallback": "系统默认"]
    }
    private func routeHost() throws -> CAPBridgeViewController {
        guard Bundle.main.bundleIdentifier == "app.folia.validation.App" else { throw MobileFailure("route-qa-only") }
        let gateway = try NativeGatewayStore.shared.snapshot()
        guard gateway.server.isEmpty, gateway.sessions.values.allSatisfy({ $0.isEmpty }) else { throw MobileFailure("route-qa-gateway-not-empty") }
        let host = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).compactMap { $0.rootViewController as? CAPBridgeViewController }.first)
        let plugin = try XCTUnwrap(host.bridge?.plugin(withName: "FoliaNative") as? FoliaNativePlugin)
        plugin.engine?.stop(); plugin.engine?.network.cancel()
        return host
    }
    func testAudioRouteRejectsInvalidLabelsAndDetachedPresentation() throws {
        _ = try routeHost()
        for labels in [[:], routeLabels.merging(["hint": " "], uniquingKeysWith: { _, new in new }),
                       routeLabels.merging(["title": String(repeating: "x", count: 513)], uniquingKeysWith: { _, new in new })] {
            XCTAssertThrowsError(try NativeAudioRoutePicker(labels: labels, light: false, completion: {}))
        }
        var completed = false
        XCTAssertThrowsError(try NativeAudioRoutePicker.present(on: UIViewController(), labels: routeLabels, light: false) { completed = true })
        XCTAssertFalse(completed)
    }
    func testAudioRoutePresentationPreservesPCMAndReleasesAfterClose() async throws {
        let host = try routeHost()
        let source = try streamingTone(); defer { try? FileManager.default.removeItem(at: source) }
        let player = stereoEngine(AudioFixtureGateway(url: source)); defer { player.stop(); player.clearOutput() }
        try player.setQueue([song("qq", "route-fixture")], at: 0)
        try await waitForStream { player.outputIsPlaying && player.playbackPosition > 0.1 }
        let output = try XCTUnwrap(player.streamOutput), measured = OutputMeasurement()
        output.engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { buffer, _ in measured.consume(buffer) }
        defer { output.engine.mainMixerNode.removeTap(onBus: 0) }
        let session = AVAudioSession.sharedInstance(), category = session.category, mode = session.mode
        let before = player.playbackPosition, occurrence = player.stream
        var completions = 0
        try NativeAudioRoutePicker.present(on: host, labels: routeLabels, light: false) { completions += 1 }
        try await waitForStream { host.presentedViewController?.viewIfLoaded?.window != nil && host.presentedViewController?.isBeingPresented == false }
        var picker: NativeAudioRoutePicker? = try XCTUnwrap(host.presentedViewController as? NativeAudioRoutePicker)
        weak var weakPicker = picker
        defer { host.dismiss(animated: false) }
        XCTAssertFalse(try XCTUnwrap(picker).routePicker.prioritizesVideoDevices)
        XCTAssertEqual(picker?.overrideUserInterfaceStyle, .dark)
        XCTAssertEqual(picker?.presentationController?.traitCollection.userInterfaceStyle, .dark)
        XCTAssertThrowsError(try NativeAudioRoutePicker.present(on: host, labels: routeLabels, light: false) { completions += 100 })
        XCTAssertEqual(completions, 0)
        NotificationCenter.default.post(name: AVAudioSession.routeChangeNotification, object: session,
            userInfo: [AVAudioSessionRouteChangeReasonKey: AVAudioSession.RouteChangeReason.routeConfigurationChange.rawValue])
        let names = session.currentRoute.outputs.map(\.portName).joined(separator: " / ")
        XCTAssertEqual(picker?.routeLabel.text, names.isEmpty ? routeLabels["fallback"] : names)
        try await waitForStream { measured.read().rms > 0.005 && player.playbackPosition > before + 0.2 }
        XCTAssertTrue(player.outputIsPlaying); XCTAssertTrue(player.stream === occurrence)
        XCTAssertEqual(session.category, category); XCTAssertEqual(session.mode, mode)
        let view = try XCTUnwrap(picker?.view)
        let image = UIGraphicsImageRenderer(bounds: view.bounds).image { _ in view.drawHierarchy(in: view.bounds, afterScreenUpdates: true) }
        let screenshot = XCTAttachment(image: image); screenshot.name = "native-audio-route"; screenshot.lifetime = .keepAlways; add(screenshot)
        picker?.closeSheet()
        try await waitForStream { host.presentedViewController == nil && completions == 1 }
        if let presentation = picker?.presentationController { picker?.presentationControllerDidDismiss(presentation) }
        XCTAssertEqual(completions, 1)
        picker = nil
        try await waitForStream { weakPicker == nil }
        XCTAssertTrue(player.outputIsPlaying); XCTAssertNil(player.error)
        print("AUDIO_ROUTE_QA PCM continues; current route refreshed; duplicate rejected; completion once; picker released")
    }
    func testAudioRouteCapacitorBridgeDismissalAndBusyRecovery() async throws {
        let host = try routeHost(), web = try XCTUnwrap(host.webView)
        try await waitForStream { !web.isLoading && web.url?.scheme == "capacitor" }
        let data = try JSONSerialization.data(withJSONObject: ["labels": routeLabels, "light": true])
        let options = try XCTUnwrap(String(data: data, encoding: .utf8))
        _ = try await web.evaluateJavaScript("window.routeResult='pending'; Capacitor.Plugins.FoliaNative.chooseAudioRoute(\(options)).then(()=>window.routeResult='closed',e=>window.routeResult=e.message); true")
        try await waitForStream { host.presentedViewController is NativeAudioRoutePicker && host.presentedViewController?.isBeingPresented == false }
        let picker = try XCTUnwrap(host.presentedViewController as? NativeAudioRoutePicker)
        defer { host.dismiss(animated: false) }
        XCTAssertEqual(picker.overrideUserInterfaceStyle, .light)
        XCTAssertEqual(picker.presentationController?.traitCollection.userInterfaceStyle, .light)
        let pending = try await web.evaluateJavaScript("window.routeResult")
        XCTAssertEqual(pending as? String, "pending")
        let busy = try await web.callAsyncJavaScript("try { await Capacitor.Plugins.FoliaNative.chooseAudioRoute(\(options)); return 'unexpected'; } catch (e) { return e.message; }",
            arguments: [:], in: nil, contentWorld: .page)
        XCTAssertEqual(busy as? String, "audio-route-busy")
        // Host dismissal exercises the lifecycle path used by adaptive presentation, not the close button.
        host.dismiss(animated: false)
        try await waitForStream { host.presentedViewController == nil }
        for _ in 0..<50 {
            if (try await web.evaluateJavaScript("window.routeResult")) as? String == "closed" { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        let closed = try await web.evaluateJavaScript("window.routeResult")
        XCTAssertEqual(closed as? String, "closed")
        _ = try await web.evaluateJavaScript("window.routeResult='pending'; Capacitor.Plugins.FoliaNative.chooseAudioRoute(\(options)).then(()=>window.routeResult='closed'); true")
        try await waitForStream { host.presentedViewController is NativeAudioRoutePicker && host.presentedViewController?.isBeingPresented == false }
        (host.presentedViewController as? NativeAudioRoutePicker)?.closeSheet()
        try await waitForStream { host.presentedViewController == nil }
    }
}
