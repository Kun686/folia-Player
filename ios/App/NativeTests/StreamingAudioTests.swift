import XCTest
import AVFoundation
@testable import AudioStreaming
@testable import App

// StreamingAudioTests.swift — measure actual post-insert PCM for mono local/HTTP decoding.
private final class StreamEvents: AudioPlayerDelegate {
    var started: [AudioEntryId] = []
    var buffered: [AudioEntryId] = []
    var cancelled: [AudioEntryId] = []
    var errors: [AudioPlayerError] = []
    func audioPlayerDidStartPlaying(player: AudioPlayer, with entryId: AudioEntryId) { started.append(entryId) }
    func audioPlayerDidFinishBuffering(player: AudioPlayer, with entryId: AudioEntryId) { buffered.append(entryId) }
    func audioPlayerStateChanged(player: AudioPlayer, with newState: AudioPlayerState, previous: AudioPlayerState) {}
    func audioPlayerDidFinishPlaying(player: AudioPlayer, entryId: AudioEntryId, stopReason: AudioPlayerStopReason, progress: Double, duration: Double) {}
    func audioPlayerUnexpectedError(player: AudioPlayer, error: AudioPlayerError) { errors.append(error) }
    func audioPlayerDidCancel(player: AudioPlayer, queuedItems: [AudioEntryId]) { cancelled.append(contentsOf: queuedItems) }
    func audioPlayerDidReadMetadata(player: AudioPlayer, metadata: [String: String]) {}
}

private final class FileStreamProbe: AudioStreamSourceDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var bytes = 0
    var receivedBytes: Int { lock.lock(); defer { lock.unlock() }; return bytes }
    func dataAvailable(source: CoreAudioStreamSource, data: Data) {
        lock.lock(); bytes += data.count; lock.unlock()
    }
    func errorOccurred(source: CoreAudioStreamSource, error: Error) {}
    func endOfFileOccurred(source: CoreAudioStreamSource) {}
    func metadataReceived(data: [String: String]) {}
}

final class OutputMeasurement {
    private let lock = NSLock()
    private var frames = 0, channels = 0
    private var energy = 0.0, difference = 0.0
    func reset() { lock.lock(); defer { lock.unlock() }; frames = 0; energy = 0; difference = 0 }
    func read() -> (frames: Int, channels: Int, rms: Double, difference: Double) {
        lock.lock(); defer { lock.unlock() }
        return (frames, channels, sqrt(energy / Double(max(1, frames))), sqrt(difference / Double(max(1, frames))))
    }
    func consume(_ buffer: AVAudioPCMBuffer) {
        guard buffer.format.commonFormat == .pcmFormatFloat32, buffer.format.channelCount == 2,
              let data = buffer.floatChannelData else { return }
        let stride = buffer.stride
        let left = data[0], right = buffer.format.isInterleaved ? data[0] + 1 : data[1]
        var energy = 0.0, difference = 0.0
        for i in 0..<Int(buffer.frameLength) {
            let l = Double(left[i * stride]), r = Double(right[i * stride])
            energy += (l * l + r * r) / 2; difference += (l - r) * (l - r)
        }
        lock.lock(); defer { lock.unlock() }
        frames += Int(buffer.frameLength); channels = 2
        self.energy += energy; self.difference += difference
    }
}

@MainActor extension NativeTests {
    func testFileSourceDelegateCancellationDuringReadIsAtomic() async throws {
        let url = try streamingTone()
        defer { try? FileManager.default.removeItem(at: url) }
        let queue = DispatchQueue(label: "folia.file-delegate-regression")
        let source = FileAudioSource(url: url, underlyingQueue: queue, readSize: 64)
        let probe = FileStreamProbe()
        source.delegate = probe
        queue.sync { source.seek(at: 0) }
        defer { queue.sync { source.close() } }
        // Reproduce stop/deinit clearing a protocol-typed weak delegate during CFStream delivery.
        let changed = expectation(description: "bounded concurrent cancellation")
        DispatchQueue.global().async {
            for _ in 0..<200_000 { source.delegate = nil; source.delegate = probe }
            changed.fulfill()
        }
        await fulfillment(of: [changed], timeout: 10)
        for _ in 0..<500 {
            if queue.sync(execute: { source.position >= source.length }) { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertGreaterThan(probe.receivedBytes, 0)
        XCTAssertTrue(queue.sync { source.position >= source.length })
    }

    func testEffectUnitRejectsMismatchedFormatsAndOversizedPulls() async throws {
        let node = try await AudioEffectUnit.makeNode()
        let unit = try XCTUnwrap(node.auAudioUnit as? AudioEffectUnit)
        let mono = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1)!
        try unit.inputBusses[0].setFormat(mono)
        XCTAssertThrowsError(try unit.allocateRenderResources())
        try unit.inputBusses[0].setFormat(unit.outputBusses[0].format)
        unit.maximumFramesToRender = 256
        try unit.allocateRenderResources(); defer { unit.deallocateRenderResources() }
        let buffer = AVAudioPCMBuffer(pcmFormat: unit.outputBusses[0].format, frameCapacity: 512)!
        var flags = AudioUnitRenderActionFlags(), time = AudioTimeStamp()
        XCTAssertEqual(unit.internalRenderBlock(&flags, &time, 512, 0, buffer.mutableAudioBufferList, nil, nil), kAudioUnitErr_TooManyFramesToProcess)
        XCTAssertEqual(unit.internalRenderBlock(&flags, &time, 256, 0, buffer.mutableAudioBufferList, nil, nil), kAudioUnitErr_NoConnection)
    }

    func testEffectUnitSuppliesPlanarBuffersAndClearsSilentInput() async throws {
        // AUAudioUnitBus accepts standard (deinterleaved Float32) format per the SDK.
        // AudioStreaming's engine converts its interleaved decoder output before this node.
        do {
            let node = try await AudioEffectUnit.makeNode()
            let unit = try XCTUnwrap(node.auAudioUnit as? AudioEffectUnit)
            let interleaved = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 44100, channels: 2, interleaved: true)!
            XCTAssertThrowsError(try unit.inputBusses[0].setFormat(interleaved))
            let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
            try unit.inputBusses[0].setFormat(format); try unit.outputBusses[0].setFormat(format)
            unit.maximumFramesToRender = 256
            try unit.allocateRenderResources(); defer { unit.deallocateRenderResources() }
            let output = AudioBufferList.allocate(maximumBuffers: 2)
            defer { output.unsafeMutablePointer.deallocate() }
            for i in output.indices { output[i] = AudioBuffer(mNumberChannels: 1, mDataByteSize: 0, mData: nil) }
            var flags = AudioUnitRenderActionFlags(), time = AudioTimeStamp()
            let fill: AURenderPullInputBlock = { _, _, frames, _, buffers in
                for buffer in UnsafeMutableAudioBufferListPointer(buffers) {
                    guard let data = buffer.mData else { return kAudioUnitErr_InvalidPropertyValue }
                    data.assumingMemoryBound(to: Float.self).update(repeating: 0.125, count: Int(frames * buffer.mNumberChannels))
                }
                return noErr
            }
            XCTAssertEqual(unit.internalRenderBlock(&flags, &time, 256, 0, output.unsafeMutablePointer, nil, fill), noErr)
            for buffer in output {
                XCTAssertEqual(buffer.mDataByteSize, 256 * 4 * buffer.mNumberChannels)
                let data = try XCTUnwrap(buffer.mData).assumingMemoryBound(to: Float.self)
                for i in 0..<Int(256 * buffer.mNumberChannels) { XCTAssertEqual(data[i], 0.125) }
            }
            let silence: AURenderPullInputBlock = { flags, _, _, _, _ in
                flags.pointee.insert(.unitRenderAction_OutputIsSilence); return noErr
            }
            XCTAssertEqual(unit.internalRenderBlock(&flags, &time, 256, 0, output.unsafeMutablePointer, nil, silence), noErr)
            for buffer in output {
                let data = try XCTUnwrap(buffer.mData).assumingMemoryBound(to: Float.self)
                for i in 0..<Int(256 * buffer.mNumberChannels) { XCTAssertEqual(data[i], 0) }
            }
        }
    }

    func testLocalMonoStreamingHasAudibleStereoEffectsAndSeek() async throws {
        let source = try streamingTone()
        defer { try? FileManager.default.removeItem(at: source) }
        try await verifyStreamingEffects(source)
    }

    func testAACMonoStreamingHasAudibleStereoEffectsAndSeek() async throws {
        let wave = try streamingTone()
        let encoded = wave.deletingPathExtension().appendingPathExtension("m4a")
        defer { try? FileManager.default.removeItem(at: wave); try? FileManager.default.removeItem(at: encoded) }
        let input = try AVAudioFile(forReading: wave)
        let pcm = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: input.processingFormat, frameCapacity: AVAudioFrameCount(input.length)))
        try input.read(into: pcm)
        do {
            let output = try AVAudioFile(forWriting: encoded, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 44100, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 128000])
            try output.write(from: pcm)
        }
        try await verifyStreamingEffects(encoded)
    }

    func streamingTone() throws -> URL {
        let source = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44100 * 20)!
        buffer.frameLength = buffer.frameCapacity
        for i in 0..<Int(buffer.frameLength) { buffer.floatChannelData![0][i] = Float(sin(Double(i) * 2 * .pi * 2000 / 44100) * 1000 / 32768) }
        do { let file = try AVAudioFile(forWriting: source, settings: format.settings); try file.write(from: buffer) }
        return source
    }

    func testIndependentPreloadIsSilentAndCancellationPreservesCurrentPCM() async throws {
        let source = try streamingTone()
        defer { try? FileManager.default.removeItem(at: source) }
        try await verifyIndependentPreload(source)
    }

    private func verifyIndependentPreload(_ url: URL) async throws {
        try AVAudioSession.sharedInstance().setCategory(.playback)
        try AVAudioSession.sharedInstance().setActive(true)
        let source = try streamingTone()
        defer { try? FileManager.default.removeItem(at: source) }
        let configuration = AudioPlayerConfiguration(bufferSizeInSeconds: 2, enableLogs: false)
        let current = AudioPlayer(configuration: configuration)
        let measured = OutputMeasurement()
        current.frameFiltering.add(entry: "current") { buffer, _ in measured.consume(buffer) }
        current.play(url: source)
        defer { current.stop(); current.frameFiltering.removeAll() }
        for _ in 0..<100 {
            if current.progress > 0.2 { break }
            try await Task.sleep(nanoseconds: 25_000_000)
        }
        XCTAssertGreaterThan(current.progress, 0.2)
        let before = current.progress
        var pending: AudioPlayer? = AudioPlayer(configuration: configuration, automaticallyStartsOutput: false)
        weak var cancelled = pending
        let silent = OutputMeasurement()
        pending!.frameFiltering.add(entry: "pending") { buffer, _ in silent.consume(buffer) }
        pending!.play(url: url)
        for _ in 0..<160 {
            if pending!.bufferedDuration >= 1.5 { break }
            try await Task.sleep(nanoseconds: 25_000_000)
        }
        XCTAssertGreaterThanOrEqual(pending!.bufferedDuration, 1.5)
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertEqual(pending!.framesPlayed, 0); XCTAssertEqual(pending!.progress, 0)
        XCTAssertEqual(silent.read().frames, 0, "Prepared output must never start hardware or silently consume the start of a song")
        let cancelledBuffered = pending!.bufferedDuration
        pending!.stop(); pending!.frameFiltering.removeAll(); pending = nil
        for _ in 0..<80 {
            if cancelled == nil { break }
            try await Task.sleep(nanoseconds: 25_000_000)
        }
        XCTAssertNil(cancelled, "Cancellation releases a decoder even while its bounded PCM buffer is full")
        XCTAssertEqual(current.state, .playing)
        XCTAssertGreaterThan(current.progress, before + 0.15)
        XCTAssertGreaterThan(measured.read().rms, 0.005)

        // The same URL is a new occurrence; no library URL queue or URL-based cancellation is involved.
        let replacement = AudioPlayer(configuration: configuration, automaticallyStartsOutput: false)
        defer { replacement.stop(); replacement.frameFiltering.removeAll() }
        let nextOutput = OutputMeasurement()
        replacement.frameFiltering.add(entry: "next") { buffer, _ in nextOutput.consume(buffer) }
        replacement.play(url: url)
        for _ in 0..<160 {
            if replacement.bufferedDuration >= 1.5 { break }
            try await Task.sleep(nanoseconds: 25_000_000)
        }
        XCTAssertEqual(replacement.framesPlayed, 0)
        current.pause()
        XCTAssertTrue(replacement.startPreparedPlayback())
        for _ in 0..<80 {
            if replacement.progress > 0.2 && nextOutput.read().rms > 0.005 { break }
            try await Task.sleep(nanoseconds: 25_000_000)
        }
        XCTAssertEqual(replacement.state, .playing)
        XCTAssertGreaterThan(replacement.progress, 0.2)
        XCTAssertGreaterThan(nextOutput.read().rms, 0.005)
        XCTAssertEqual(silent.read().frames, 0)
        print("FOLIA_INDEPENDENT_PRELOAD remote=\(!url.isFileURL) cancelledBufferedSeconds=\(cancelledBuffered) silentFrames=\(silent.read().frames) currentPreserved=PASS replacement=PASS")
    }

    #if FOLIA_AUDIO_OUTPUT_PROBE
    func testIndependentHTTPPreloadIsSilentAndCancellable() async throws {
        try await verifyIndependentPreload(URL(string: "http://127.0.0.1:18779/mono.wav")!)
    }
    // A capability diagnostic for pinned 1.4.5, not acceptance of Folia's queue semantics.
    func testBufferedRemovalCapabilityProbe() async throws {
        try AVAudioSession.sharedInstance().setCategory(.playback)
        try AVAudioSession.sharedInstance().setActive(true)
        let first = try silentAudio(), second = try silentAudio()
        defer { try? FileManager.default.removeItem(at: first); try? FileManager.default.removeItem(at: second) }
        let player = AudioPlayer(configuration: AudioPlayerConfiguration(enableLogs: false))
        let events = StreamEvents(); player.delegate = events
        defer { player.stop(); player.delegate = nil }
        player.play(url: first)
        let startingCount = events.started.count
        for _ in 0..<80 {
            if events.started.count > startingCount { break }
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        player.queue(url: second)
        for _ in 0..<100 {
            if events.buffered.contains(where: { $0.id == second.absoluteString }) { break }
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        XCTAssertTrue(events.buffered.contains(where: { $0.id == second.absoluteString }))
        XCTAssertFalse(events.started.contains(where: { $0.id == second.absoluteString }))
        player.removeFromQueue(url: second)
        for _ in 0..<60 {
            if events.started.contains(where: { $0.id == second.absoluteString }) { break }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        let removedStillPlays = events.started.contains(where: { $0.id == second.absoluteString })
        print("FOLIA_BUFFERED_REMOVAL supported=\(!removedStillPlays) errors=\(events.errors.count)")
        XCTAssertTrue(removedStillPlays, "Pinned 1.4.5 only removes upcoming entries; this probe captures the integration blocker")
        XCTAssertTrue(events.errors.isEmpty)
    }

    func testHTTPMonoStreamingHasAudibleStereoEffectsAndSeek() async throws {
        try await verifyStreamingEffects(URL(string: "http://127.0.0.1:18779/mono.wav")!)
    }
    #endif

    func testStreamingQueueAdvancesAndReplacementCancelsBufferedSong() async throws {
        try AVAudioSession.sharedInstance().setCategory(.playback)
        try AVAudioSession.sharedInstance().setActive(true)
        let first = try silentAudio(), second = try silentAudio(), replacement = try silentAudio()
        defer { for url in [first, second, replacement] { try? FileManager.default.removeItem(at: url) } }
        let player = AudioPlayer(configuration: AudioPlayerConfiguration(enableLogs: false))
        let events = StreamEvents(); player.delegate = events
        defer { player.stop(); player.delegate = nil }
        player.play(url: first)
        let startingCount = events.started.count
        for _ in 0..<80 {
            if events.started.count > startingCount { break }
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        player.queue(url: second)
        for _ in 0..<80 {
            if events.started.count >= 2 { break }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTAssertEqual(events.started.map(\.id), [first.absoluteString, second.absoluteString])
        let previousStartCount = events.started.count
        let previousBufferCount = events.buffered.count
        player.play(url: first)
        for _ in 0..<80 {
            if events.started.count > previousStartCount { break }
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        player.queue(url: second)
        for _ in 0..<80 {
            if events.buffered.count >= previousBufferCount + 2 { break }
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        let startCount = events.started.count
        player.play(url: replacement)
        try await Task.sleep(nanoseconds: 1_500_000_000)
        XCTAssertEqual(events.started.dropFirst(startCount).map(\.id), [replacement.absoluteString])
        XCTAssertTrue(events.cancelled.contains(where: { $0.id == second.absoluteString }))
        XCTAssertTrue(events.errors.isEmpty)
    }

    private func verifyStreamingEffects(_ url: URL) async throws {
        try AVAudioSession.sharedInstance().setCategory(.playback)
        try AVAudioSession.sharedInstance().setActive(true)
        let player = AudioPlayer(configuration: AudioPlayerConfiguration(flushQueueOnSeek: false, enableLogs: false))
        let node = try await AudioEffectUnit.makeNode()
        let unit = try XCTUnwrap(node.auAudioUnit as? AudioEffectUnit)
        player.attach(node: node)
        let measured = OutputMeasurement()
        player.frameFiltering.add(entry: "test-output") { buffer, _ in measured.consume(buffer) }
        defer { player.stop(); player.frameFiltering.removeAll() }
        player.play(url: url)
        for _ in 0..<120 {
            if player.progress > 0.25 && measured.read().rms > 0.005 { break }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTAssertEqual(player.state, .playing)
        XCTAssertEqual(measured.read().channels, 2)
        XCTAssertGreaterThan(measured.read().rms, 0.005, "Silence cannot satisfy the filter baseline")
        measured.reset(); try await Task.sleep(nanoseconds: 400_000_000)
        let baseline = measured.read().rms
        XCTAssertGreaterThan(baseline, 0.005)
        XCTAssertLessThan(measured.read().difference, 0.00001, "Mono decoder duplicates the original input")
        var values = NativeEqualizerSettings.neutral; values["lowpass"] = 500
        XCTAssertTrue(unit.meter.effects.configure(values))
        try await settle(unit)
        measured.reset(); try await Task.sleep(nanoseconds: 400_000_000)
        let filtered = measured.read().rms
        XCTAssertGreaterThan(measured.read().frames, 1000)
        XCTAssertLessThan(filtered, baseline * 0.2, "The insert must change the audible path, not an observation buffer")
        values["lowpass"] = 20000; values["noise"] = 0.6; values["space"] = 0.4
        XCTAssertTrue(unit.meter.effects.configure(values))
        try await settle(unit)
        measured.reset(); try await Task.sleep(nanoseconds: 400_000_000)
        let stereo = measured.read()
        XCTAssertGreaterThan(stereo.difference, 0.0001, "Mono source must produce genuinely different L/R effects")
        XCTAssertTrue(unit.meter.effects.configure(NativeEqualizerSettings.neutral))
        try await settle(unit)
        measured.reset(); try await Task.sleep(nanoseconds: 400_000_000)
        XCTAssertGreaterThan(measured.read().rms, baseline * 0.8)
        XCTAssertTrue(player.isSeekable)
        player.seek(to: 10)
        for _ in 0..<80 {
            if player.progress > 10.2 && player.state == .playing { break }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTAssertGreaterThan(player.progress, 10.2)
        player.pause()
        let paused = player.progress
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertEqual(player.state, .paused); XCTAssertEqual(player.progress, paused, accuracy: 0.05)
        player.resume()
        try await Task.sleep(nanoseconds: 400_000_000)
        XCTAssertEqual(player.state, .playing); XCTAssertGreaterThan(player.progress, paused)
        print("FOLIA_STEREO_STREAM remote=\(!url.isFileURL) channels=\(stereo.channels) baseline=\(baseline) filtered=\(filtered) stereoDifference=\(stereo.difference) seek=PASS pauseResume=PASS")
    }

    private func settle(_ unit: AudioEffectUnit) async throws {
        for _ in 0..<100 {
            let status = unit.meter.effects.status
            if status.available && status.applied == status.requested { break }
            try await Task.sleep(nanoseconds: 25_000_000)
        }
        XCTAssertTrue(unit.meter.effects.status.available)
        XCTAssertEqual(unit.meter.effects.status.applied, unit.meter.effects.status.requested)
        try await Task.sleep(nanoseconds: 600_000_000)
    }
}
