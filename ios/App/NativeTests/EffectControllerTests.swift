import XCTest
import AVFoundation
@testable import App

// EffectControllerTests.swift — slow builds, latest-intent wins, uninterrupted history and resource retirement.
private final class EffectBuildProbe {
    let entered = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0)
    var blockedRate: Double?, blockedHighpass: Double?
    private let lock = NSLock()
    private var builds = 0
    private weak var first: AudioEffectProgram?
    private weak var latest: AudioEffectProgram?
    private weak var firstNoise: AudioNoiseBuffer?
    private weak var firstReverb: AudioReverbKernel?
    var count: Int { lock.lock(); defer { lock.unlock() }; return builds }
    var firstReleased: Bool { lock.lock(); defer { lock.unlock() }; return first == nil }
    var latestReleased: Bool { lock.lock(); defer { lock.unlock() }; return latest == nil }
    var branchesReleased: Bool { lock.lock(); defer { lock.unlock() }; return firstNoise == nil && firstReverb == nil }
    func build(rate: Double, values: [String: Double]) -> AudioEffectProgram? {
        if rate == blockedRate || values["highpass"] == blockedHighpass {
            entered.signal()
            guard release.wait(timeout: .now() + 3) == .success else { return nil }
        }
        let result = AudioEffectProgram(rate: rate, values: values, random: { 0.6 })
        lock.lock(); builds += 1
        if builds == 1 { first = result; firstNoise = result?.noise; firstReverb = result?.reverb }; latest = result
        lock.unlock(); return result
    }
}
@MainActor extension NativeTests {
    private func waitForEffects(_ condition: () -> Bool) async throws {
        for _ in 0..<120 {
            if condition() { return }
            try await Task.sleep(nanoseconds: 25_000_000)
        }
        XCTFail("Effect control operation did not finish within 3 seconds")
        throw MobileFailure("effect-test-timeout")
    }
    func testEffectControllerCoalescesStalePreparationWithoutResettingAudio() async throws {
        let probe = EffectBuildProbe(); probe.blockedHighpass = 90
        let control = AudioEffectController(build: probe.build)
        defer { probe.release.signal(); control.unprepare() }
        control.prepare(rate: 44100, channels: 2)
        try await waitForEffects { control.status.prepared == control.status.requested }
        let initial = try XCTUnwrap(AudioEffectProgram(rate: 44100, values: NativeEqualizerSettings.neutral))
        let reference = try XCTUnwrap(AudioEffectGraph(program: initial))
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        let actual = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 128)!, expected = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 128)!
        actual.frameLength = 128; expected.frameLength = 128
        var frame = 0
        func renderAndCompare() {
            for channel in 0..<2 {
                for i in 0..<128 {
                    let value = Float(sin(Double(frame + i) * 0.1) * (channel == 0 ? 0.1 : -0.07))
                    actual.floatChannelData![channel][i] = value; expected.floatChannelData![channel][i] = value
                }
            }
            XCTAssertTrue(control.process(actual.mutableAudioBufferList, frames: 128))
            reference.process(expected.mutableAudioBufferList, frames: 128)
            for channel in 0..<2 {
                let a = actual.floatChannelData![channel], b = expected.floatChannelData![channel]
                XCTAssertLessThan((0..<128).map { abs(a[$0] - b[$0]) }.max() ?? 1, 0.000001)
            }
            frame += 128
        }
        for _ in 0..<4 { renderAndCompare() }
        var next = NativeEqualizerSettings.neutral; next["highpass"] = 90
        XCTAssertTrue(control.configure(next))
        try await waitForEffects { probe.entered.wait(timeout: .now()) == .success }
        for _ in 0..<8 { renderAndCompare() } // preparation cannot stall, bypass or reset the audible graph
        for value in 100..<180 { next["highpass"] = Double(value); XCTAssertTrue(control.configure(next)) }
        next["highpass"] = 420; XCTAssertTrue(control.configure(next))
        probe.release.signal()
        try await waitForEffects { control.status.prepared == control.status.requested }
        let finalProgram = try XCTUnwrap(AudioEffectProgram(rate: 44100, values: next))
        XCTAssertTrue(reference.apply(finalProgram))
        for _ in 0..<16 { renderAndCompare() }
        XCTAssertEqual(control.status.applied, control.status.requested)
        XCTAssertEqual(probe.count, 3, "One initial, one superseded and one latest build")
        let revision = control.status.requested; next["drive"] = .nan
        XCTAssertFalse(control.configure(next)); XCTAssertEqual(control.status.requested, revision)
        control.unprepare()
        try await waitForEffects { probe.firstReleased && probe.latestReleased }
        XCTAssertFalse(control.status.available)
        withExtendedLifetime((initial, finalProgram)) {}
    }
    func testEffectControllerRejectsLateFormatBuildAndReleasesResources() async throws {
        let probe = EffectBuildProbe(); probe.blockedRate = 44100
        let control = AudioEffectController(build: probe.build)
        defer { probe.release.signal(); control.unprepare() }
        control.prepare(rate: 44100, channels: 2)
        try await waitForEffects { probe.entered.wait(timeout: .now()) == .success }
        control.unprepare(); control.prepare(rate: 48000, channels: 2)
        probe.release.signal()
        try await waitForEffects { control.status.prepared == control.status.requested }
        XCTAssertTrue(probe.firstReleased, "The discarded format must not survive as an active or ready graph")
        let buffer = AVAudioPCMBuffer(pcmFormat: AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 2)!, frameCapacity: 128)!
        buffer.frameLength = 128
        for channel in 0..<2 { buffer.floatChannelData![channel].update(repeating: 0, count: 128) }
        XCTAssertFalse(control.process(buffer.mutableAudioBufferList, frames: 129))
        XCTAssertEqual(control.status.applied, 0)
        XCTAssertTrue(control.process(buffer.mutableAudioBufferList, frames: 128))
        XCTAssertTrue(control.status.available); XCTAssertEqual(control.status.applied, control.status.requested)
        control.unprepare(); try await waitForEffects { probe.latestReleased }
        XCTAssertFalse(control.process(buffer.mutableAudioBufferList, frames: 128))
    }
    func testEffectControllerReportsPreparationFailureAndRejectsMono() async throws {
        let control = AudioEffectController(build: { _, _ in nil })
        defer { control.unprepare() }
        control.prepare(rate: 44100, channels: 1)
        XCTAssertEqual(control.status.error, "unsupported-effect-format")
        XCTAssertFalse(control.status.available)
        control.prepare(rate: 44100, channels: 2)
        try await waitForEffects { control.status.prepared == control.status.requested }
        XCTAssertEqual(control.status.error, "audio-effect-preparation-failed")
        XCTAssertFalse(control.status.available)
        control.unprepare(); XCTAssertNil(control.status.error)
    }
    func testEffectControllerRetainsFadingBranchesUntilSafeRetirement() async throws {
        let probe = EffectBuildProbe(), control = AudioEffectController(build: { rate, values in probe.build(rate: rate, values: values) })
        defer { control.unprepare() }
        var values = NativeEqualizerSettings.neutral; values["noise"] = 0.4; values["space"] = 0.2
        XCTAssertTrue(control.configure(values)); control.prepare(rate: 8000, channels: 2)
        try await waitForEffects { control.status.prepared == control.status.requested }
        let buffer = AVAudioPCMBuffer(pcmFormat: AVAudioFormat(standardFormatWithSampleRate: 8000, channels: 2)!, frameCapacity: 8192)!
        buffer.frameLength = buffer.frameCapacity
        func render(_ count: Int) {
            for channel in 0..<2 { buffer.floatChannelData![channel].update(repeating: 0, count: 8192) }
            XCTAssertTrue(control.process(buffer.mutableAudioBufferList, frames: count))
        }
        render(128); XCTAssertFalse(probe.branchesReleased)
        XCTAssertTrue(control.configure(NativeEqualizerSettings.neutral))
        try await waitForEffects { control.status.prepared == control.status.requested }
        render(128)
        try await waitForEffects { probe.firstReleased }
        XCTAssertFalse(probe.branchesReleased, "The adopted neutral program must retain resources while the original branches fade")
        render(8192) // More than 800 ms; graph no longer reads these resources.
        values = NativeEqualizerSettings.neutral; values["highpass"] = 200
        XCTAssertTrue(control.configure(values))
        try await waitForEffects { control.status.prepared == control.status.requested }
        render(128)
        try await waitForEffects { probe.branchesReleased }
        control.unprepare(); try await waitForEffects { probe.latestReleased }
    }
}
