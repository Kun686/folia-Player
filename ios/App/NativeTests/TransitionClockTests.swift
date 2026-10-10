import XCTest
import AVFoundation
@testable import App

// TransitionClockTests.swift — inspect actual engine timestamps before choosing a native automation clock.
private final class RenderClockProbe {
    private let lock = NSLock()
    private var samples: [(host: UInt64, start: Double, frames: UInt32)] = []
    func record(_ time: AudioTimeStamp, frames: UInt32) {
        lock.lock(); defer { lock.unlock() }
        if samples.count == 256 { samples.removeFirst(128) }
        samples.append((time.mHostTime, time.mSampleTime, frames))
    }
    func read() -> [(host: UInt64, start: Double, frames: UInt32)] {
        lock.lock(); defer { lock.unlock() }; return samples
    }
}

@MainActor extension NativeTests {
    func testNativeSourceClockAcrossLateAttachPauseAndRestart() async throws {
        try AVAudioSession.sharedInstance().setCategory(.playback)
        try AVAudioSession.sharedInstance().setActive(true)
        let engine = AVAudioEngine(), mix = AVAudioMixerNode()
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        let first = RenderClockProbe(), second = RenderClockProbe()
        func source(_ probe: RenderClockProbe) -> AVAudioSourceNode {
            AVAudioSourceNode(format: format) { silence, time, frames, output in
                probe.record(time.pointee, frames: frames)
                for buffer in UnsafeMutableAudioBufferListPointer(output) {
                    if let data = buffer.mData { memset(data, 0, Int(buffer.mDataByteSize)) }
                }
                silence.pointee = true
                return noErr
            }
        }
        let outgoing = source(first), incoming = source(second)
        engine.attach(mix); engine.attach(outgoing)
        engine.connect(outgoing, to: mix, fromBus: 0, toBus: 0, format: format)
        engine.connect(mix, to: engine.mainMixerNode, format: format)
        engine.prepare(); try engine.start()
        defer { engine.stop() }
        try await Task.sleep(nanoseconds: 150_000_000)
        engine.attach(incoming)
        engine.connect(incoming, to: mix, fromBus: 0, toBus: 1, format: format)
        try await Task.sleep(nanoseconds: 150_000_000)
        let before = try XCTUnwrap(first.read().last)
        let joined = try XCTUnwrap(second.read().first)
        engine.pause()
        let stopped = try XCTUnwrap(first.read().last)
        try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertEqual(first.read().last?.host, stopped.host)
        try engine.start()
        try await Task.sleep(nanoseconds: 150_000_000)
        let resumed = try XCTUnwrap(first.read().first { $0.host > stopped.host })
        engine.stop(); let reset = try XCTUnwrap(first.read().last)
        engine.prepare(); try engine.start()
        try await Task.sleep(nanoseconds: 150_000_000)
        let restarted = try XCTUnwrap(first.read().first { $0.host > reset.host })
        let a = first.read(), b = second.read()
        let pairs = b.compactMap { point -> Double? in
            guard let match = a.first(where: { $0.host == point.host }) else { return nil }
            return abs(point.start - match.start)
        }
        XCTAssertFalse(pairs.isEmpty)
        XCTAssertEqual(pairs.max() ?? -1, 0, accuracy: 0.000001)
        XCTAssertTrue(a.allSatisfy { $0.start.isFinite && $0.frames > 0 })
        print("FOLIA_NATIVE_CLOCK lateJoinFirst=\(joined.start) beforePause=\(before.start) pausedEnd=\(stopped.start + Double(stopped.frames)) resumeStart=\(resumed.start) stoppedEnd=\(reset.start + Double(reset.frames)) restartStart=\(restarted.start) commonHostPairs=\(pairs.count) maximumSampleDifference=\(pairs.max() ?? -1)")
    }
}
