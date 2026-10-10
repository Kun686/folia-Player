import XCTest
import AVFoundation
@testable import App

// DeckAnalysisTests.swift — frozen pre-extraction state and independent WebKit DSP reference.
private struct DeckReference: Decodable {
    struct Snapshot: Decodable { let frames: Int; let samples: [Float]; let spectrum: [Float?] }
    struct Case: Decodable { let rate: Double; let channels: [Double]; let snapshots: [Snapshot] }
    struct Live: Decodable {
        struct Tick: Decodable { let frames: Int; let state: State }
        struct State: Decodable { let loudnessDb: Double?; let tempo: NativeDeckState.Tempo?; let nextBeatIn: Double? }
        let rate: Double; let states: [Tick]
    }
    let cases: [Case]
    let live: [Live]
}
private struct DeckStateReference: Decodable {
    let frame: Int; let db: Double?; let tempo: NativeDeckState.Tempo?; let next: Double?
    let history: NativeDeckState.History?
}
@MainActor extension NativeTests {
    func testDeckStateInJavaScriptCoreMatchesOriginalWebAudioState() throws {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "deckMeasurementsReference", withExtension: "json"))
        let fixture = try JSONDecoder().decode([String: [DeckStateReference]].self, from: Data(contentsOf: url))
        for mode in ["steady", "gap", "reset"] {
            let state = try NativeDeckMeasurements(rate: 44100)
            let expected = try XCTUnwrap(fixture[mode])
            var samples = [Float](repeating: 0, count: 1024), spectrum = [Float](repeating: 0, count: 512)
            for frame in 0..<400 {
                if mode == "reset" && frame == 200 { try state.reset() }
                let amplitude = frame < 190 ? 0.12 : frame < 250 ? 0.003 : 0.2
                for i in samples.indices { samples[i] = Float(amplitude * sin(Double(i) * 0.037 + Double(frame) * 0.19)) }
                for i in spectrum.indices {
                    spectrum[i] = i > 170 ? -.infinity : Float(-80 + (frame % 20 < 2 ? 30.0 : 0) + sin(Double(i) * 0.07) * 8)
                }
                let time = 100 + Double(frame) * 0.025 + (mode == "gap" && frame > 180 ? 0.8 : 0)
                try state.feed(samples: samples, spectrum: spectrum, time: time)
                if let reference = expected.first(where: { $0.frame == frame }) {
                    let actual = try state.snapshot(at: time + 0.013, history: true)
                    func equal(_ a: Double?, _ b: Double?) {
                        if let a, let b { XCTAssertEqual(a, b, accuracy: 1e-8) } else { XCTAssertNil(a); XCTAssertNil(b) }
                    }
                    equal(actual.loudnessDb, reference.db)
                    equal(actual.nextBeatIn, reference.next)
                    equal(actual.tempo?.bpm, reference.tempo?.bpm)
                    equal(actual.tempo?.periodSec, reference.tempo?.periodSec)
                    equal(actual.tempo?.confidence, reference.tempo?.confidence)
                    equal(actual.tempo?.beatOffsetHops, reference.tempo?.beatOffsetHops)
                    equal(actual.history?.hopSec, reference.history?.hopSec)
                    if let a = actual.history, let b = reference.history {
                        XCTAssertEqual(a.db.count, b.db.count)
                        for (a, b) in zip(a.db, b.db) { XCTAssertEqual(a, b, accuracy: 1e-8) }
                    } else { XCTAssertNil(actual.history); XCTAssertNil(reference.history) }
                }
            }
        }
    }

    func testDeckKWeightAndFloatingSpectrumMatchWebKitWithoutEditingSound() throws {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "DeckPCMReference", withExtension: "json"))
        let fixture = try JSONDecoder().decode(DeckReference.self, from: Data(contentsOf: url))
        var maximumPCM: Float = 0, maximumDB: Float = 0
        for entry in fixture.cases {
            for block in [128, 257] {
                let capture = NativeDeckCapture(rate: entry.rate), spectrum = AudioSpectrum(size: 1024, smoothing: 0)
                capture.enable(true)
                let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: entry.rate, channels: 2, interleaved: true)!
                var previous = 0
                for snapshot in entry.snapshots {
                    while previous < snapshot.frames {
                        let count = min(block, snapshot.frames - previous)
                        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count))!
                        buffer.frameLength = buffer.frameCapacity
                        let pcm = buffer.floatChannelData![0]
                        for i in 0..<count {
                            let frame = Double(previous + i)
                            let tone = 0.1 * sin(frame * 2 * .pi * 97 / entry.rate)
                                + 0.03 * cos(frame * 2 * .pi * 997 / entry.rate)
                                + 0.02 * sin(frame * 2 * .pi * 3901 / entry.rate)
                            for channel in 0..<2 { pcm[i * 2 + channel] = Float(entry.channels[channel] * tone) }
                        }
                        let original = Array(UnsafeBufferPointer(start: pcm, count: count * 2))
                        capture.consume(buffer.mutableAudioBufferList, frames: count, sampleTime: Double(previous), time: Double(previous + count) / entry.rate)
                        XCTAssertEqual(Array(UnsafeBufferPointer(start: pcm, count: count * 2)), original)
                        previous += count
                    }
                    let frame = try XCTUnwrap(capture.snapshot(after: nil))
                    XCTAssertNil(capture.snapshot(after: frame.revision))
                    spectrum.analyse(frame.samples)
                    maximumPCM = max(maximumPCM, zip(frame.samples, snapshot.samples).map { abs($0 - $1) }.max() ?? 1)
                    for (actual, expected) in zip(spectrum.decibels, snapshot.spectrum) {
                        if let expected, expected > -85 { maximumDB = max(maximumDB, abs(actual - expected)) }
                        else if expected == nil {
                            if entry.channels == [1, -1] { XCTAssertEqual(actual, -.infinity) }
                            else { XCTAssertLessThan(actual, -150, "FFT roundoff below the useful signal floor") }
                        }
                    }
                }
            }
        }
        XCTAssertLessThan(maximumPCM, 0.000002)
        XCTAssertLessThan(maximumDB, 0.08)
        print("Deck WebKit PCM max=\(maximumPCM), spectrum dB max=\(maximumDB)")
    }

    func testNativePCMToLiveDecisionsMatchesOriginalWebKitDeck() throws {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "DeckPCMReference", withExtension: "json"))
        let fixture = try JSONDecoder().decode(DeckReference.self, from: Data(contentsOf: url))
        var maximumDB = 0.0, maximumConfidence = 0.0
        for entry in fixture.live {
            let capture = NativeDeckCapture(rate: entry.rate), state = try NativeDeckMeasurements(rate: entry.rate)
            capture.enable(true)
            let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: entry.rate, channels: 2, interleaved: true)!
            var previous = 0
            for expected in entry.states {
                let count = expected.frames - previous
                let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count))!
                buffer.frameLength = buffer.frameCapacity
                let pcm = buffer.floatChannelData![0]
                for i in 0..<count {
                    let frame = Double(previous + i)
                    let amplitude = (frame / entry.rate).truncatingRemainder(dividingBy: 0.5) < 0.065 ? 0.2 : 0.015
                    let tone = sin(frame * 2 * .pi * 97 / entry.rate)
                        + 0.3 * cos(frame * 2 * .pi * 997 / entry.rate)
                        + 0.2 * sin(frame * 2 * .pi * 3901 / entry.rate)
                    pcm[i * 2] = Float(amplitude * tone); pcm[i * 2 + 1] = Float(amplitude * tone * 0.3)
                }
                let time = Double(expected.frames) / entry.rate
                capture.consume(buffer.mutableAudioBufferList, frames: count, sampleTime: Double(previous), time: time)
                try state.tick(XCTUnwrap(capture.snapshot(after: nil)))
                let actual = try state.snapshot(at: time + 0.013)
                if let a = actual.loudnessDb, let b = expected.state.loudnessDb { maximumDB = max(maximumDB, abs(a - b)) }
                else { XCTAssertNil(actual.loudnessDb); XCTAssertNil(expected.state.loudnessDb) }
                if let a = actual.tempo, let b = expected.state.tempo {
                    XCTAssertEqual(a.bpm, b.bpm, accuracy: 0.0001)
                    XCTAssertEqual(a.beatOffsetHops, b.beatOffsetHops, accuracy: 0.0001)
                    maximumConfidence = max(maximumConfidence, abs(a.confidence - b.confidence))
                } else { XCTAssertNil(actual.tempo); XCTAssertNil(expected.state.tempo) }
                if let a = actual.nextBeatIn, let b = expected.state.nextBeatIn { XCTAssertEqual(a, b, accuracy: 0.0001) }
                else { XCTAssertNil(actual.nextBeatIn); XCTAssertNil(expected.state.nextBeatIn) }
                previous = expected.frames
            }
        }
        XCTAssertLessThan(maximumDB, 0.001); XCTAssertLessThan(maximumConfidence, 0.002)
        print("Live WebKit level max=\(maximumDB) dB; tempo confidence max=\(maximumConfidence)")
    }

    func testDeckCaptureResetDisabledAndInvalidBuffersNeverReturnOldState() throws {
        let capture = NativeDeckCapture(rate: 44100)
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 44100, channels: 2, interleaved: true)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1024)!
        buffer.frameLength = 1024; buffer.floatChannelData![0].update(repeating: 0.1, count: 2048)
        capture.consume(buffer.mutableAudioBufferList, frames: 1024, sampleTime: 0)
        XCTAssertNil(capture.snapshot(after: nil))
        capture.enable(true); capture.consume(buffer.mutableAudioBufferList, frames: 1024, sampleTime: 0)
        let first = try XCTUnwrap(capture.snapshot(after: nil))
        capture.reset(); XCTAssertNil(capture.snapshot(after: nil))
        capture.consume(buffer.mutableAudioBufferList, frames: 1025, sampleTime: 0)
        XCTAssertNil(capture.snapshot(after: nil))
        capture.consume(buffer.mutableAudioBufferList, frames: 1024, sampleTime: 0)
        XCTAssertNotEqual(capture.snapshot(after: nil)?.epoch, first.epoch)
        capture.enable(false); XCTAssertNil(capture.snapshot(after: nil))
        let state = try NativeDeckMeasurements(rate: 44100)
        XCTAssertThrowsError(try state.feed(samples: [0], spectrum: [], time: 0))
        XCTAssertThrowsError(try NativeDeckMeasurements(rate: 44100, bundle: Bundle(for: NativeTests.self)))
    }

    func testDeckAnalysisIsIndependentOfFadeAndReleasesBothDecoders() async throws {
        let url = try streamingTone()
        defer { try? FileManager.default.removeItem(at: url) }
        var output: StreamMixOutput? = try await StreamMixOutput.make()
        var first: StreamOccurrence? = try await StreamOccurrence.prepare(url: url, output: output)
        var second: StreamOccurrence? = try await StreamOccurrence.prepare(url: url, output: output)
        weak var outputOwner = output
        weak var firstOwner = first, secondOwner = second
        defer { first?.dispose(); second?.dispose(); output?.close() }
        output!.setAnalysisEnabled(true)
        try first!.play(); try second!.play()
        let envelope = NativeTransitionEnvelope(style: "plainBlend", hold: 0, overlap: 1,
            crossover: 0.5, together: 0, shapeBands: false, sweepOut: false, snappedToBeat: false,
            gain: .init(out: [0, 0], in: [1, 1]), bands: nil)
        XCTAssertTrue(try output!.scheduleGain(outgoing: first!.audio, incoming: second!.audio,
            envelope: envelope, generation: output!.transitionGain.cancel()))
        try await Task.sleep(nanoseconds: 750_000_000)
        let a = await output!.deckState(first!.audio), b = await output!.deckState(second!.audio)
        XCTAssertEqual(try XCTUnwrap(a?.loudnessDb), try XCTUnwrap(b?.loudnessDb), accuracy: 0.01,
            "A faded-out deck must still report its own pre-fade level")
        first!.dispose(); first = nil
        try await Task.sleep(nanoseconds: 100_000_000)
        let remaining = await output!.deckState(second!.audio)
        XCTAssertNotNil(remaining?.loudnessDb); XCTAssertTrue(second!.playing); XCTAssertNil(firstOwner)
        second!.dispose(); second = nil; output!.close(); output = nil
        XCTAssertNil(secondOwner); XCTAssertNil(outputOwner)
    }

    func testRealDecoderDeckAnalysisRunsWithoutWebViewAndSurvivesPauseSeek() async throws {
        let url = try streamingTone()
        defer { try? FileManager.default.removeItem(at: url) }
        let output = try await StreamMixOutput.make()
        defer { output.close() }
        output.setAnalysisEnabled(true)
        let entry = try await StreamOccurrence.prepare(url: url, output: output)
        defer { entry.dispose() }
        let pending = try await StreamOccurrence.prepare(url: url, output: output)
        defer { pending.dispose() }
        try entry.play()
        try await Task.sleep(nanoseconds: 650_000_000)
        let initialState = await output.deckState(entry.audio)
        let initial = try XCTUnwrap(initialState)
        XCTAssertNotNil(initial.loudnessDb)
        let unplayed = await output.deckState(pending.audio)
        XCTAssertNil(unplayed); XCTAssertEqual(pending.position, 0)
        // Master gain and effects are downstream of this tap.
        var settings = NativeAudioSettings(); settings.isMuted = true; output.apply(settings)
        try await Task.sleep(nanoseconds: 250_000_000)
        let muted = await output.deckState(entry.audio)
        XCTAssertEqual(try XCTUnwrap(muted?.loudnessDb), try XCTUnwrap(initial.loudnessDb), accuracy: 0.25)
        entry.pause(); output.pause()
        let paused = await output.deckState(entry.audio)
        try await Task.sleep(nanoseconds: 600_000_000)
        let stillPaused = await output.deckState(entry.audio)
        XCTAssertEqual(paused?.time, stillPaused?.time)
        try entry.play(); try await Task.sleep(nanoseconds: 150_000_000)
        let resumed = await output.deckState(entry.audio, history: true)
        XCTAssertNil(resumed?.history, "A pause gap is not a continuous complete play-through")
        try entry.seek(to: 0.3)
        let afterSeek = await output.deckState(entry.audio)
        XCTAssertNil(afterSeek?.loudnessDb, "Seek must discard previous song position measurements")
        try await Task.sleep(nanoseconds: 600_000_000)
        let afterNewPCM = await output.deckState(entry.audio, history: true)
        XCTAssertNotNil(afterNewPCM?.loudnessDb)
        XCTAssertNil(afterNewPCM?.history, "A seek must never turn a partial play-through into a complete history")
        output.setAnalysisEnabled(false)
        let disabled = await output.deckState(entry.audio)
        XCTAssertNil(disabled); XCTAssertTrue(entry.playing)
        entry.dispose()
        let removed = await output.deckState(entry.audio)
        XCTAssertNil(removed)
    }
}
