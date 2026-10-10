import XCTest
import AVFoundation
import AudioStreaming
@testable import App

// TempoStreamTests.swift — observe decoded EOF synchronously, then measure the audible media clock.
@MainActor extension NativeTests {
    func testExternalReadObservationDistinguishesMediaFromPaddingAndEOF() async throws {
        let url = try sharedConstantFile(seconds: 2, stereo: true)
        defer { try? FileManager.default.removeItem(at: url) }
        let player = try await preparedExternalPlayer(url)
        defer { player.stop() }
        for _ in 0..<100 {
            if player.bufferedDuration >= 2 { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        let pcm = AVAudioPCMBuffer(pcmFormat: player.externalOutputFormat, frameCapacity: 8192)!
        pcm.frameLength = 512
        var read = AudioPlayer.ExternalAudioRead()
        XCTAssertEqual(player.renderExternalAudio(frames: 512, output: pcm.mutableAudioBufferList, observation: &read), noErr)
        XCTAssertEqual(read.frames, 0); XCTAssertFalse(read.endOfStream)
        XCTAssertTrue(player.startPreparedPlayback())
        var copied = 0, eof = false
        for block in 0..<30 {
            let frames: UInt32 = [8192, 257, 4096][block % 3]
            pcm.frameLength = frames
            XCTAssertEqual(player.renderExternalAudio(frames: frames, output: pcm.mutableAudioBufferList, observation: &read), noErr)
            XCTAssertFalse(read.discontinuity)
            copied += Int(read.frames)
            if read.endOfStream {
                XCTAssertEqual(copied, 88200); XCTAssertEqual(read.position, 2, accuracy: 1e-9)
                XCTAssertLessThan(read.frames, frames)
                eof = true; break
            }
            XCTAssertEqual(read.frames, frames)
        }
        XCTAssertTrue(eof, "EOF must be visible before the main queue can deliver its delegate event")
        XCTAssertEqual(copied, 88200)
    }

    func testTempoInputTimelineHoldsUnderrunsRejectsJumpsAndBoundsHistory() {
        let clock = TempoInputTimeline()
        clock.reset(origin: 441000)
        XCTAssertTrue(clock.append(requested: 512, copied: 400, end: 441400))
        XCTAssertEqual(clock.media(at: 399), 441399)
        XCTAssertEqual(clock.media(at: 450), 441400)
        XCTAssertTrue(clock.append(requested: 512, copied: 0, end: 0))
        XCTAssertEqual(clock.media(at: 1000), 441400)
        XCTAssertFalse(clock.append(requested: 512, copied: 512, end: 900000))
        XCTAssertEqual(clock.frames, 1024)
        XCTAssertTrue(clock.append(requested: 512, copied: 512, end: 441912))
        XCTAssertEqual(clock.media(at: 1536), 441912)
        XCTAssertNil(clock.media(at: .nan)); XCTAssertNil(clock.media(at: -1))
        for index in 0..<80 {
            XCTAssertTrue(clock.append(requested: 2, copied: 1, end: 441913 + Double(index)))
        }
        XCTAssertNil(clock.media(at: 1), "Evicted history is unavailable, never falsely extrapolated")
        XCTAssertEqual(clock.media(at: Double(clock.frames)), 441992)
        clock.reset(); XCTAssertNil(clock.media(at: 0)); XCTAssertEqual(clock.frames, 0)
    }

    func testTempoStreamClockTracksAudibleMarkersAcrossRatesAndChanges() async throws {
        let rate = 44100.0, markers = [0.25, 0.75, 1.25, 1.75]
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        defer { try? FileManager.default.removeItem(at: url) }
        let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2)!
        do {
            let data = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 88200)!
            data.frameLength = data.frameCapacity
            for frame in 0..<88200 {
                let time = Double(frame) / rate
                let distance = markers.map { abs(time - $0) }.min()!
                let envelope = distance < 0.06 ? exp(-pow(distance / 0.018, 2)) : 0
                let sample = Float(0.2 * envelope * sin(2 * .pi * 1000 * time))
                data.floatChannelData![0][frame] = sample; data.floatChannelData![1][frame] = -sample * 0.5
            }
            let file = try AVAudioFile(forWriting: url, settings: format.settings); try file.write(from: data)
        }
        var maximumError = 0.0
        for speed in [0.88, 1, 1.12] {
            for changes in [false, true] {
                let player = try await preparedExternalPlayer(url)
                defer { player.stop() }
                for _ in 0..<100 {
                    if player.bufferedDuration >= 2 { break }
                    try await Task.sleep(nanoseconds: 10_000_000)
                }
                let stream = try NativeTempoStream(player: player, rate: speed)
                defer { stream.close() }
                XCTAssertTrue(player.startPreparedPlayback())
                let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512)!
                var groups: [(weight: Double, time: Double)] = []
                var weight = 0.0, weightedTime = 0.0, lastSignal = -100000, outputFrame = 0
                var previous = 0.0, sawEOF = false, reachedDrain = false
                for block in 0..<400 {
                    if changes && block == 56 { try stream.request(rate: 0.9); try stream.request(rate: 1.1) }
                    if changes && block == 125 { try stream.request(rate: 0.91) }
                    pcm.frameLength = 512
                    let status = stream.render(pcm.mutableAudioBufferList, frames: 512)
                    guard status == noErr else { XCTFail("Stream render failed: \(status)"); return }
                    let state = stream.snapshot()
                    XCTAssertGreaterThanOrEqual(state.position, previous); previous = state.position
                    XCTAssertLessThanOrEqual(state.position, 2.00001)
                    sawEOF = sawEOF || state.decoderEnded
                    for frame in 0..<512 {
                        let value = Double(pcm.floatChannelData![0][frame])
                        if abs(value) > 0.0001 {
                            if outputFrame + frame - lastSignal > 5292 && weight > 0 {
                                groups.append((weight, weightedTime)); weight = 0; weightedTime = 0
                            }
                            let media = state.position - Double(512 - frame) / rate * state.rate
                            weight += value * value; weightedTime += value * value * media
                            lastSignal = outputFrame + frame
                        }
                    }
                    outputFrame += 512
                    if state.drained { reachedDrain = true; break }
                }
                if weight > 0 { groups.append((weight, weightedTime)) }
                XCTAssertTrue(sawEOF); XCTAssertTrue(reachedDrain); XCTAssertEqual(groups.count, markers.count)
                for (group, expected) in zip(groups, markers) {
                    let measured = group.time / group.weight
                    maximumError = max(maximumError, abs(measured - expected))
                    XCTAssertEqual(measured, expected, accuracy: 0.04, "rate=\(speed), changes=\(changes)")
                }
            }
        }
        print("FOLIA_TEMPO_MEDIA markerCases=6 maximumErrorSeconds=\(maximumError)")
    }

    func testTempoStreamPauseSeekDrainAndClose() async throws {
        let url = try sharedConstantFile(seconds: 2, stereo: true)
        defer { try? FileManager.default.removeItem(at: url) }
        var player: AudioPlayer? = try await preparedExternalPlayer(url)
        weak var released = player
        let stream = try NativeTempoStream(player: player!)
        defer { stream.close(); player?.stop() }
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512)!
        pcm.frameLength = 512
        XCTAssertTrue(player!.startPreparedPlayback())
        for _ in 0..<35 { XCTAssertEqual(stream.render(pcm.mutableAudioBufferList, frames: 512), noErr) }
        player!.pause()
        for _ in 0..<30 { XCTAssertEqual(stream.render(pcm.mutableAudioBufferList, frames: 512), noErr) }
        let paused = stream.snapshot().position
        for _ in 0..<30 { XCTAssertEqual(stream.render(pcm.mutableAudioBufferList, frames: 512), noErr) }
        XCTAssertEqual(stream.snapshot().position, paused)
        XCTAssertFalse(stream.snapshot().decoderEnded); XCTAssertFalse(stream.snapshot().drained)
        player!.seek(to: 0.75)
        XCTAssertThrowsError(try stream.reset(), "A pending decoder seek cannot reuse old PCM")
        try await Task.sleep(nanoseconds: 30_000_000)
        // AudioStreaming processes a paused seek on resume. The external graph is still stopped:
        // resume the decoder, await its new PCM, then reset the stretcher before any output pull.
        player!.resume()
        for _ in 0..<100 {
            if !player!.isSeeking && player!.bufferedDuration > 0 { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        try stream.reset(rate: 0.88)
        XCTAssertEqual(stream.snapshot().position, 0.75, accuracy: 0.001)
        var afterEOF: Float = 0, drained = false
        for _ in 0..<350 {
            let status = stream.render(pcm.mutableAudioBufferList, frames: 512)
            guard status == noErr else { XCTFail("Seek render failed: \(status)"); return }
            let state = stream.snapshot()
            if state.decoderEnded {
                for frame in 0..<512 { afterEOF = max(afterEOF, abs(pcm.floatChannelData![0][frame])) }
            }
            if state.drained { drained = true; break }
        }
        XCTAssertTrue(drained); XCTAssertGreaterThan(afterEOF, 0.01)
        player!.stop(); player = nil
        stream.close()
        for _ in 0..<100 {
            if released == nil { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertNil(released, "Closed stream must release decoder even if its wrapper is retained")
        XCTAssertThrowsError(try stream.reset())
    }

    func testTempoStreamDrainPreservesSubthresholdTail() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        defer { try? FileManager.default.removeItem(at: url) }
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        do {
            let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44100)!
            pcm.frameLength = pcm.frameCapacity
            pcm.floatChannelData![0].update(repeating: 1e-8, count: 44100)
            pcm.floatChannelData![1].update(repeating: -2e-8, count: 44100)
            let file = try AVAudioFile(forWriting: url, settings: format.settings); try file.write(from: pcm)
        }
        let actualPlayer = try await preparedExternalPlayer(url), referencePlayer = try await preparedExternalPlayer(url)
        defer { actualPlayer.stop(); referencePlayer.stop() }
        let stream = try NativeTempoStream(player: actualPlayer, rate: 1.12)
        let reference = try NativeTempoProcessor(format: referencePlayer.externalOutputFormat, rate: 1.12) { _, _, frames, _, output in
            referencePlayer.renderExternalAudio(frames: frames, output: output)
        }
        defer { stream.close(); reference.close() }
        XCTAssertTrue(actualPlayer.startPreparedPlayback()); XCTAssertTrue(referencePlayer.startPreparedPlayback())
        let a = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512)!
        let b = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512)!
        var maxError: Float = 0, tail: Float = 0, drainBlock: Int?
        for block in 0..<300 {
            a.frameLength = 512; b.frameLength = 512
            XCTAssertEqual(stream.render(a.mutableAudioBufferList, frames: 512), noErr)
            XCTAssertEqual(reference.render(b.mutableAudioBufferList, frames: 512), noErr)
            let snapshot = stream.snapshot()
            if snapshot.drained && drainBlock == nil { drainBlock = block }
            for channel in 0..<2 {
                for frame in 0..<512 {
                    let value = a.floatChannelData![channel][frame]
                    maxError = max(maxError, abs(value - b.floatChannelData![channel][frame]))
                    if snapshot.decoderEnded { tail = max(tail, abs(value)) }
                    if drainBlock != nil { XCTAssertEqual(b.floatChannelData![channel][frame], 0) }
                }
            }
        }
        XCTAssertNotNil(drainBlock); XCTAssertEqual(maxError, 0)
        XCTAssertGreaterThan(tail, 1e-9); XCTAssertLessThan(tail, 1e-6)
        print("FOLIA_TEMPO_DRAIN quietTailPeak=\(tail) maxPCM=\(maxError) drainBlock=\(drainBlock ?? -1)")
    }
}
