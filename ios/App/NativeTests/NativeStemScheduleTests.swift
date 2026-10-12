import XCTest
import AVFoundation
@testable import App

// NativeStemScheduleTests.swift — three render lanes must adopt, cancel and release one command together.
struct StemClockFixture {
    let outPCM: NativeStemPCM, inPCM: NativeStemPCM
    let gesture: NativeStemGesture, bus: NativeStemBusParameters
    init(seconds: Double = 0.8, expansion: Double? = nil) async throws {
        let planner = NativeTransitionPlanner()
        let cells = Int(floor(seconds / 0.05)), frames = Int(ceil(seconds * 44100))
        let request: [String: Any] = ["version": 1, "windowSec": seconds, "outgoingBarSec": NSNull(),
            "incomingBarSec": NSNull(), "downbeats": [], "vocals": Array(repeating: 0.5, count: cells),
            "mix": Array(repeating: 0.5, count: cells), "incoming": [:] as [String: Bool],
            "expansion": expansion as Any? ?? NSNull()]
        gesture = try await planner.stems(JSONSerialization.data(withJSONObject: request)); bus = try await planner.stemBus()
        func pcm(right: Float) throws -> NativeStemPCM {
            try NativeStemPCM(Dictionary(uniqueKeysWithValues: NativeStemName.allCases.map { name in
                (name, [Array(repeating: name == .drums ? Float(0.125) : 0, count: frames),
                        Array(repeating: name == .drums ? right : 0, count: frames)])
            }))
        }
        outPCM = try pcm(right: 0.125); inPCM = try pcm(right: -0.0625)
    }
    func mixer() throws -> NativeStemMixer { try NativeStemMixer(outgoing: outPCM, incoming: inPCM, gesture: gesture, bus: bus) }
    func schedule(out: UUID, incoming: UUID, hold: Double = 0) throws -> NativeStemTransition {
        try NativeStemTransition(outgoing: out, incoming: incoming, mixer: mixer(), seconds: gesture.schedule.windowSec, hold: hold, splice: bus.spliceSec)
    }
    static func buffer(_ count: Int = 512) -> AVAudioPCMBuffer {
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 44100, channels: 2, interleaved: true)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count))!
        buffer.frameLength = AVAudioFrameCount(count); return buffer
    }
}

private struct StemClockCase: Decodable {
    let hold: Double, level: Double, seconds: Double
    let frames: Int, cancel: Int?, indices: [Int], outgoing: [Float], incoming: [Float]
}

@MainActor extension NativeTests {
    func testStemFallbackCannotKeepOldTimelineAfterHostClockDiscontinuity() async throws {
        let fixture = try await StemClockFixture()
        for hold in [0.0, 0.4] { for jump in [0.0, 1_000_640.0, 2_000_000.0] { for order in [[0, 1, 2], [2, 1, 0]] {
            let gain = TransitionGain(), out = UUID(), incoming = UUID(), buffer = StemClockFixture.buffer(128)
            let fallback = try TransitionGainCurve(outgoing: out, incoming: incoming, out: [1, 0], input: [0, 1],
                rate: 44100, seconds: 0.8, hold: hold)
            let generation = try XCTUnwrap(gain.replace(try fixture.schedule(out: out, incoming: incoming, hold: hold),
                fallback: fallback, generation: gain.cancel()))
            for block in 0..<4 {
                XCTAssertTrue(gain.processStems(buffer.mutableAudioBufferList, frames: 128, sampleTime: 1_000_000 + Double(block * 128)))
            }
            XCTAssertTrue(gain.clock.stemActive)
            var maximum: Float = 0
            for lane in order {
                let data = buffer.floatChannelData![0]
                data.update(repeating: 1, count: 256)
                if lane == 2 { XCTAssertTrue(gain.processStems(buffer.mutableAudioBufferList, frames: 128, sampleTime: jump)) }
                else { XCTAssertTrue(gain.process(buffer.mutableAudioBufferList, frames: 128, sampleTime: jump,
                    rate: 44100, source: lane == 0 ? out : incoming)) }
                let expected: Float = lane == 1 ? 1 : 0
                for i in 0..<256 { maximum = max(maximum, abs(data[i] - expected)) }
            }
            XCTAssertEqual(maximum, 0, "A broken clock must return the current deck, not keep a stale hold or fade")
            XCTAssertTrue(gain.clock.stemFailed); XCTAssertFalse(gain.clock.stemActive)
            XCTAssertTrue(gain.clock.stemClockInvalid, "Control must retire the fade without waiting for the obsolete absolute end")
            XCTAssertEqual(gain.clock.generation, generation)
            let next = try XCTUnwrap(gain.replace(fallback, generation: generation))
            XCTAssertFalse(gain.cancel(ifCurrent: generation), "Old clock-failure cleanup cannot cancel a newer intent")
            buffer.floatChannelData![0].update(repeating: 1, count: 256)
            XCTAssertTrue(gain.process(buffer.mutableAudioBufferList, frames: 128, sampleTime: jump + 128, rate: 44100, source: incoming))
            XCTAssertEqual(gain.clock.generation, next); XCTAssertFalse(gain.clock.stemClockInvalid)
            print("FOLIA_STEM_CLOCK_RESET hold=\(hold) jump=\(jump) firstLane=\(order[0]) maxPCM=\(maximum)")
        } } }
    }
    func testStemElementSplicesAndCancellationMatchOriginalWebKit() async throws {
        let fixture = try await StemClockFixture()
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "StemClockReference", withExtension: "json"))
        let rows = try JSONDecoder().decode([StemClockCase].self, from: Data(contentsOf: url)); XCTAssertEqual(rows.count, 16)
        var maximum: Float = 0
        for row in rows { for blocks in [[128], [7, 255, 31, 512, 3, 89]] {
            let gain = TransitionGain(), out = UUID(), incoming = UUID(), buffer = StemClockFixture.buffer()
            let data = buffer.floatChannelData![0], base = 1_000_000_000.0
            let old = try TransitionGainCurve(outgoing: out, incoming: incoming, out: [row.level, row.level], input: [0, 0], rate: 44100, seconds: 2)
            XCTAssertTrue(gain.schedule(old, generation: gain.cancel()))
            data.update(repeating: 1, count: 1024)
            XCTAssertTrue(gain.process(buffer.mutableAudioBufferList, frames: 128, sampleTime: base - 128, rate: 44100, source: out))
            let program = try fixture.schedule(out: out, incoming: incoming, hold: row.hold / 44100)
            XCTAssertTrue(gain.scheduleStems(program, generation: gain.cancel()))
            var at = 0, block = 0, cursor = 0, error: Float = 0
            while at < row.frames {
                if row.cancel == at { gain.cancel() }
                var count = min(blocks[block % blocks.count], row.frames - at)
                if let cancel = row.cancel, cancel > at { count = min(count, cancel - at) }
                // Exercise all three pull positions for the stem bus, and reverse the decoder order.
                let order = [[0, 1, 2], [2, 1, 0], [1, 0, 2], [0, 2, 1], [2, 0, 1], [1, 2, 0]][block % 6]
                for lane in order {
                    data.update(repeating: 1, count: count * 2)
                    if lane == 2 { XCTAssertTrue(gain.processStems(buffer.mutableAudioBufferList, frames: count, sampleTime: base + Double(at))) }
                    else {
                        XCTAssertTrue(gain.process(buffer.mutableAudioBufferList, frames: count, sampleTime: base + Double(at), rate: 44100, source: lane == 0 ? out : incoming))
                        var next = cursor
                        while next < row.indices.count && row.indices[next] < at + count {
                            error = max(error, abs(data[(row.indices[next] - at) * 2] - (lane == 0 ? row.outgoing[next] : row.incoming[next])))
                            next += 1
                        }
                    }
                }
                while cursor < row.indices.count && row.indices[cursor] < at + count { cursor += 1 }
                at += count; block += 1
            }
            XCTAssertEqual(cursor, row.indices.count); XCTAssertLessThan(error, 0.000008)
            XCTAssertFalse(gain.clock.stemFailed); maximum = max(maximum, error)
        } }
        print("Original stem element clock maximum PCM error=\(maximum)")
    }

    func testStemClockDefersMidQuantumCancelAndRejectsStaleIntent() async throws {
        let fixture = try await StemClockFixture(), gain = TransitionGain(), out = UUID(), incoming = UUID()
        let buffer = StemClockFixture.buffer(128), data = buffer.floatChannelData![0]
        let program = try fixture.schedule(out: out, incoming: incoming), epoch = gain.cancel()
        XCTAssertTrue(gain.scheduleStems(program, generation: epoch))
        data.update(repeating: 1, count: 256)
        XCTAssertTrue(gain.process(buffer.mutableAudioBufferList, frames: 128, sampleTime: 0, rate: 44100, source: out))
        let cancelled = gain.cancel()
        XCTAssertFalse(gain.scheduleStems(program, generation: epoch))
        data.update(repeating: 1, count: 256)
        XCTAssertTrue(gain.process(buffer.mutableAudioBufferList, frames: 128, sampleTime: 0, rate: 44100, source: incoming))
        XCTAssertEqual(data[0], 0, "Cancel between pulls cannot split one quantum")
        XCTAssertTrue(gain.processStems(buffer.mutableAudioBufferList, frames: 128, sampleTime: 0))
        XCTAssertGreaterThan(data[254], 0, "The already adopted stem half completes the same quantum")
        XCTAssertTrue(gain.processStems(buffer.mutableAudioBufferList, frames: 128, sampleTime: 128))
        XCTAssertTrue(UnsafeBufferPointer(start: data, count: 256).allSatisfy { $0 == 0 })
        XCTAssertEqual(gain.clock.generation, cancelled)
        XCTAssertFalse(gain.scheduleStems(program, generation: cancelled), "A consumed program cannot replay")
    }

    func testStemClockFailureReturnsCurrentDeckAndDoesNotReplayPCM() async throws {
        let fixture = try await StemClockFixture(), gain = TransitionGain(), out = UUID(), incoming = UUID()
        let buffer = StemClockFixture.buffer(128), data = buffer.floatChannelData![0]
        XCTAssertTrue(gain.scheduleStems(try fixture.schedule(out: out, incoming: incoming), generation: gain.cancel()))
        XCTAssertTrue(gain.processStems(buffer.mutableAudioBufferList, frames: 128, sampleTime: 0))
        for (id, expected) in [(out, Float(0)), (incoming, Float(1)), (UUID(), Float(1))] {
            data.update(repeating: 1, count: 256)
            XCTAssertTrue(gain.process(buffer.mutableAudioBufferList, frames: 128, sampleTime: 4096, rate: 44100, source: id))
            XCTAssertEqual(data[0], expected)
        }
        XCTAssertTrue(gain.processStems(buffer.mutableAudioBufferList, frames: 128, sampleTime: 4096))
        XCTAssertTrue(UnsafeBufferPointer(start: data, count: 256).allSatisfy { $0 == 0 }); XCTAssertTrue(gain.clock.stemFailed)
    }

    func testStemRemovalHonoursNewestIntentAndReclaimsOnControl() async throws {
        let fixture = try await StemClockFixture(), gain = TransitionGain(), out = UUID(), incoming = UUID()
        let buffer = StemClockFixture.buffer(128)
        var original: NativeStemTransition? = try fixture.schedule(out: out, incoming: incoming)
        weak var released = original
        XCTAssertTrue(gain.scheduleStems(original!, generation: gain.cancel())); original = nil
        XCTAssertTrue(gain.processStems(buffer.mutableAudioBufferList, frames: 128, sampleTime: 0))
        let nextOut = UUID(), nextIn = UUID(), nextEpoch = gain.cancel()
        XCTAssertTrue(gain.scheduleStems(try fixture.schedule(out: nextOut, incoming: nextIn), generation: nextEpoch))
        gain.removeStemSource(out)
        XCTAssertTrue(gain.processStems(buffer.mutableAudioBufferList, frames: 128, sampleTime: 128))
        XCTAssertNotNil(released, "PCM cannot be freed on render during replacement")
        XCTAssertEqual(gain.clock.generation, nextEpoch); XCTAssertNil(released, "Control status read reclaims retired PCM")
        gain.removeStemSource(nextOut)
        XCTAssertTrue(gain.processStems(buffer.mutableAudioBufferList, frames: 128, sampleTime: 256))
        XCTAssertTrue(UnsafeBufferPointer(start: buffer.floatChannelData![0], count: 256).allSatisfy { $0 == 0 })
        gain.closeWhileStopped(); XCTAssertNil(gain.clock.curveStart)
        XCTAssertFalse(gain.scheduleStems(try fixture.schedule(out: out, incoming: incoming), generation: nextEpoch))
    }
}
