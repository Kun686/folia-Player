import XCTest
import AVFoundation
@testable import AudioStreaming
@testable import App

// LiveSeekAlignmentTests.swift — compare real song PCM to a full sequential decode, without changing the user's queue.
private enum SeekFingerprint {
    static func reference(_ url: URL) throws -> [Double] {
        let file = try AVAudioFile(forReading: url)
        let frames = AVAudioFrameCount((file.processingFormat.sampleRate / 100).rounded())
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: frames))
        var result: [Double] = []
        while file.framePosition < file.length {
            try file.read(into: buffer, frameCount: frames)
            guard buffer.frameLength == frames else { break }
            result.append(energy(buffer))
        }
        return result
    }

    static func energy(_ buffer: AVAudioPCMBuffer) -> Double {
        guard let channels = buffer.floatChannelData else { return 0 }
        var total = 0.0
        for frame in 0..<Int(buffer.frameLength) {
            for channel in 0..<Int(buffer.format.channelCount) {
                let value = buffer.format.isInterleaved ? channels[0][frame * buffer.stride + channel] : channels[channel][frame]
                total += Double(value) * Double(value)
            }
        }
        return sqrt(total / Double(max(1, Int(buffer.frameLength) * Int(buffer.format.channelCount))))
    }

    // Correlate the energy envelope, then require a confident match before judging timing.
    static func locate(_ signal: [Double], in reference: [Double]) throws -> (time: Double, score: Double) {
        guard !signal.isEmpty, reference.count > signal.count else { throw MobileFailure("seek-qa-short-audio") }
        // Smooth three 10ms buckets so different codec priming does not dominate the match.
        func smooth(_ input: [Double]) -> [Double] {
            var output: [Double] = []
            for index in 1..<(input.count - 1) {
                let neighbors: Double = input[index - 1] + input[index + 1]
                output.append((neighbors + input[index]) / 3.0)
            }
            return output
        }
        let signal = smooth(signal), reference = smooth(reference)
        let average = signal.reduce(0, +) / Double(signal.count)
        let centered = signal.map { $0 - average }
        let energy = centered.reduce(0) { $0 + $1 * $1 }
        guard energy > 1e-10 else { throw MobileFailure("seek-qa-silent-window") }
        var best = (-1.0, 0)
        for offset in 0...(reference.count - signal.count) {
            var sum = 0.0, squares = 0.0, dot = 0.0
            for index in signal.indices {
                let value = reference[offset + index]
                sum += value; squares += value * value; dot += centered[index] * value
            }
            let variance = max(0, squares - sum * sum / Double(signal.count))
            let score = variance > 1e-10 ? dot / sqrt(variance * energy) : -1
            if score > best.0 { best = (score, offset) }
        }
        return (Double(best.1) / 100, best.0)
    }
}

// Capture only error categories/codes; never serialize network error userInfo or signed URLs.
private final class SeekFailureProbe: AudioPlayerDelegate {
    private weak var target: AudioPlayerDelegate?
    private(set) var failures: [String] = []
    init(_ target: AudioPlayerDelegate) { self.target = target }
    func audioPlayerUnexpectedError(player: AudioPlayer, error: AudioPlayerError) {
        let category: String
        switch error {
        case .codecError: category = "codec"
        case .dataNotFound: category = "missing-data"
        case .other: category = "other"
        case .streamParseBytesFailure(let code): category = "parser:\(code)"
        case .audioSystemError(let code): category = "audio-system:\(code)"
        case .networkError(let error):
            switch error {
            case .failure(let underlying): category = "network:\((underlying as NSError).code)"
            case .serverError: category = "network-server"
            case .missingData: category = "network-missing-data"
            }
        }
        failures.append(category)
        target?.audioPlayerUnexpectedError(player: player, error: error)
    }
    func audioPlayerDidStartPlaying(player: AudioPlayer, with entryId: AudioEntryId) {
        target?.audioPlayerDidStartPlaying(player: player, with: entryId)
    }
    func audioPlayerDidFinishBuffering(player: AudioPlayer, with entryId: AudioEntryId) {
        target?.audioPlayerDidFinishBuffering(player: player, with: entryId)
    }
    func audioPlayerStateChanged(player: AudioPlayer, with newState: AudioPlayerState, previous: AudioPlayerState) {
        target?.audioPlayerStateChanged(player: player, with: newState, previous: previous)
    }
    func audioPlayerDidFinishPlaying(player: AudioPlayer, entryId: AudioEntryId, stopReason: AudioPlayerStopReason,
                                    progress: Double, duration: Double) {
        target?.audioPlayerDidFinishPlaying(player: player, entryId: entryId, stopReason: stopReason,
                                           progress: progress, duration: duration)
    }
    func audioPlayerDidCancel(player: AudioPlayer, queuedItems: [AudioEntryId]) {
        target?.audioPlayerDidCancel(player: player, queuedItems: queuedItems)
    }
    func audioPlayerDidReadMetadata(player: AudioPlayer, metadata: [String: String]) {
        target?.audioPlayerDidReadMetadata(player: player, metadata: metadata)
    }
}

@MainActor extension NativeTests {
    func testRemoteHeaderProbeIsCancelledBySeekAndClose() throws {
        let fixture = ProfileHTTPFixture(Data([0, 0]))
        let url = ProfileHTTPProtocol.add(fixture)
        defer { ProfileHTTPProtocol.remove(url) }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ProfileHTTPProtocol.self]
        let queue = DispatchQueue(label: "seek.header.lifetime.test")
        let client = NetworkingClient(configuration: configuration, networkQueue: queue)
        let source = RemoteAudioSource(networking: client, url: url, underlyingQueue: queue)
        defer { queue.sync { source.close(); client.session.invalidateAndCancel() } }
        // Hold response delivery until all three opens and the final close have happened.
        // This exposes leaked header probes deterministically, without a music service.
        queue.sync {
            for _ in 0..<3 { source.seek(at: 0) }
            XCTAssertEqual(client.tasksLock.withLock { client.tasks.leftValues.count }, 1,
                           "Only the latest header probe may remain registered")
            source.close()
            XCTAssertTrue(client.tasksLock.withLock { client.tasks.isEmpty },
                          "Closing must cancel the header probe as well as the media request")
        }
    }

    func testSignedInQQMixedOutputSeekMatchesClock() async throws {
        guard ProcessInfo.processInfo.environment["FOLIA_LIVE_MIX_SEEK_QA"] == "1",
              Bundle.main.bundleIdentifier == "app.folia.validation.App" else {
            throw XCTSkip("Opt-in independent simulator output-chain diagnosis")
        }
        #if !targetEnvironment(simulator)
        throw XCTSkip("Independent simulator only")
        #endif
        let data = try XCTUnwrap(UserDefaults.standard.data(forKey: "folia.queue"))
        let saved = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let queue = try XCTUnwrap(saved["queue"] as? [[String: Any]])
        let environment = ProcessInfo.processInfo.environment
        let songID = environment["FOLIA_LIVE_MIX_SEEK_SONG_ID"]
        let quality = environment["FOLIA_LIVE_MIX_SEEK_QUALITY"] ?? "standard"
        guard ["standard", "exhigh", "lossless", "hires"].contains(quality) else { throw MobileFailure("seek-qa-quality") }
        let song = try XCTUnwrap(queue.first {
            guard let ref = $0["sourceRef"] as? [String: Any], ref["providerId"] as? String == "qq" else { return false }
            return songID == nil || ref["mediaId"] as? String == songID
        })
        let source = try await GatewayClient().resolve(song, quality: quality)
        let file = try await NativeMediaDownload(maximumBytes: 150 * 1024 * 1024, resourceTimeout: 30).read(source.url)
        defer { try? FileManager.default.removeItem(at: file.url) }
        let decoded = try AVAudioFile(forReading: file.url)
        print("MIX_SEEK_QA song=\(song["name"] ?? "") quality=\(quality) format=\(file.fileExtension) rate=\(decoded.processingFormat.sampleRate)")
        let reference = try SeekFingerprint.reference(file.url)
        var rows: [[String: Any]] = []
        defer {
            if let data = try? JSONSerialization.data(withJSONObject: rows, options: [.prettyPrinted, .sortedKeys]) {
                let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                attachment.name = "real-qq-mixed-seek-alignment"; attachment.lifetime = .keepAlways; add(attachment)
            }
        }
        for (transport, url) in [("file", file.url), ("stream", source.url)] {
            let graph = try await StreamMixOutput.make()
            defer { graph.close() }
            let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2))
            try graph.engine.enableManualRenderingMode(.realtime, format: format, maximumFrameCount: 441)
            let entry = try await StreamOccurrence.prepare(url: url, output: graph, allowsTempo: true)
            defer { entry.dispose() }
            let failureProbe = SeekFailureProbe(entry)
            entry.audio.delegate = failureProbe
            defer { withExtendedLifetime(failureProbe) {} }
            try entry.play()
            var baseline = 0.0
            for (step, target) in [0.0, 30.0, 90.0, 15.0, 75.0].enumerated() {
                if target > 0 {
                    if step == 4 {
                        for intermediate in [25.0, 40.0, 55.0, 65.0, 85.0] {
                            try entry.seek(to: intermediate)
                            try await Task.sleep(for: .milliseconds(5))
                        }
                    }
                    try entry.seek(to: target)
                    try await waitForStream({ (!entry.seeking && !entry.preparingOutput) || entry.hasFailed }, seconds: 20)
                    XCTAssertFalse(entry.hasFailed, "\(transport) target=\(target) decoder=\(failureProbe.failures)")
                    if entry.hasFailed { throw MobileFailure("seek-qa-decoder-failed") }
                }
                let window = try await captureMixedWindow(graph, entry: entry)
                let match = try SeekFingerprint.locate(window.values, in: reference)
                let offset = match.time - window.position
                if target == 0 { baseline = offset }
                let drift = offset - baseline
                rows.append(["title": song["name"] ?? "", "quality": quality, "fileExtension": file.fileExtension,
                             "sourceSampleRate": decoded.processingFormat.sampleRate, "transport": transport, "rapid": step == 4,
                             "target": target, "reported": window.position, "matched": match.time,
                             "correlation": match.score, "driftFromStart": drift])
                print("MIX_SEEK_QA transport=\(transport) target=\(target) clock=\(window.position) audio=\(match.time) correlation=\(match.score) drift=\(drift)")
                XCTAssertGreaterThan(match.score, 0.85)
                XCTAssertLessThanOrEqual(abs(drift), 0.15)
            }
        }
    }

    private func captureMixedWindow(_ graph: StreamMixOutput, entry: StreamOccurrence) async throws -> (position: Double, values: [Double]) {
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 441))
        var first: Double?, values: [Double] = []
        for index in 0..<400 {
            buffer.frameLength = 441
            var error: OSStatus = noErr
            let status = graph.engine.manualRenderingBlock(441, buffer.mutableAudioBufferList, &error)
            guard status == .success, error == noErr else { throw MobileFailure("seek-qa-mix-render") }
            if index >= 100 {
                if first == nil { first = entry.position - 0.01 }
                values.append(SeekFingerprint.energy(buffer))
            }
            if index % 10 == 0 { try await Task.sleep(for: .milliseconds(1)) }
        }
        return (try XCTUnwrap(first), values)
    }

    func testSignedInSeekPCMMatchesReportedClock() async throws {
        guard ProcessInfo.processInfo.environment["FOLIA_LIVE_SEEK_QA"] == "1" else {
            throw XCTSkip("Opt-in real-account seek diagnosis; no fixture songs")
        }
        #if !targetEnvironment(simulator)
        throw XCTSkip("Independent simulator only")
        #endif
        guard Bundle.main.bundleIdentifier == "app.folia.validation.App" else { throw MobileFailure("live-qa-identity") }
        let credentials = try NativeGatewayStore.shared.snapshot()
        let original = try XCTUnwrap(UserDefaults.standard.data(forKey: "folia.queue"))
        let saved = try XCTUnwrap(JSONSerialization.jsonObject(with: original) as? [String: Any])
        let queue = try XCTUnwrap(saved["queue"] as? [[String: Any]])
        let extraData = Data((ProcessInfo.processInfo.environment["FOLIA_LIVE_SEEK_SONGS"] ?? "[]").utf8)
        let previousSongs = try XCTUnwrap(JSONSerialization.jsonObject(with: extraData) as? [[String: Any]])
        var rows: [[String: Any]] = []
        defer {
            if let data = try? JSONSerialization.data(withJSONObject: rows, options: [.prettyPrinted, .sortedKeys]) {
                let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                attachment.name = "real-song-seek-alignment"; attachment.lifetime = .keepAlways; add(attachment)
            }
        }
        for provider in ["qq", "netease"] {
            guard credentials.sessions[provider]?.isEmpty == false else { throw MobileFailure("live-qa-session-missing") }
            let song = try XCTUnwrap((queue + previousSongs).first { ($0["sourceRef"] as? [String: Any])?["providerId"] as? String == provider })
            print("SEEK_QA resolving provider=\(provider)")
            let source = try await GatewayClient().resolve(song, quality: "standard")
            let file = try await NativeMediaDownload(maximumBytes: 50 * 1024 * 1024, resourceTimeout: 30).read(source.url)
            defer { try? FileManager.default.removeItem(at: file.url) }
            let reference = try SeekFingerprint.reference(file.url)
            for (transport, url) in [("file", file.url), ("stream", source.url)] {
                let player = AudioPlayer(configuration: AudioPlayerConfiguration(enableLogs: false),
                                         automaticallyStartsOutput: false, externallyRendered: true)
                defer { player.stop() }
                player.play(url: url)
                try await waitForStream({ player.bufferedDuration > 0.5 }, seconds: 20)
                XCTAssertTrue(player.startPreparedPlayback())
                var baseline = 0.0
                for (step, target) in [0.0, 30.0, 90.0, 15.0, 75.0].enumerated() {
                    if target > 0 {
                        if step == 4 {
                            for intermediate in [25.0, 40.0, 55.0, 65.0, 85.0] {
                                player.seek(to: intermediate)
                                try await Task.sleep(for: .milliseconds(5))
                            }
                        }
                        player.seek(to: target)
                        try await waitForStream({ !player.isSeeking && player.bufferedDuration > 0.5 }, seconds: 20)
                    }
                    let window = try await captureSeekWindow(player)
                    let match = try SeekFingerprint.locate(window.values, in: reference)
                    let offset = match.time - window.position
                    if target == 0 { baseline = offset }
                    let drift = offset - baseline
                    rows.append(["provider": provider, "title": song["name"] ?? "", "transport": transport, "rapid": step == 4,
                                 "target": target, "reported": window.position, "matched": match.time,
                                 "correlation": match.score, "driftFromStart": drift])
                    print("SEEK_QA provider=\(provider) transport=\(transport) target=\(target) clock=\(window.position) audio=\(match.time) correlation=\(match.score) drift=\(drift)")
                    XCTAssertGreaterThan(match.score, 0.85, "A low-confidence fingerprint cannot establish alignment")
                    XCTAssertLessThanOrEqual(abs(drift), 0.15, "Seek must preserve the initial audio/clock alignment")
                }
            }
        }
        let after = try NativeGatewayStore.shared.snapshot()
        XCTAssertTrue(after.server == credentials.server && after.token == credentials.token && after.sessions == credentials.sessions)
        let final = try XCTUnwrap(UserDefaults.standard.data(forKey: "folia.queue"))
        XCTAssertTrue(NSDictionary(dictionary: saved).isEqual(to: try XCTUnwrap(JSONSerialization.jsonObject(with: final) as? [String: Any])))
    }

    private func captureSeekWindow(_ player: AudioPlayer) async throws -> (position: Double, values: [Double]) {
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: player.externalOutputFormat, frameCapacity: 441))
        var first: Double?, values: [Double] = [], discarded = 0
        let deadline = ProcessInfo.processInfo.systemUptime + 15
        while values.count < 300 {
            guard ProcessInfo.processInfo.systemUptime < deadline else { throw MobileFailure("seek-qa-buffer-timeout") }
            buffer.frameLength = 441
            var read = AudioPlayer.ExternalAudioRead()
            let status = player.renderExternalAudio(frames: 441, output: buffer.mutableAudioBufferList, observation: &read)
            guard status == noErr, !read.discontinuity else { throw MobileFailure("seek-qa-render") }
            if read.frames == 441 {
                // Measure after the first second, including at startup where MP3 decoder priming differs.
                if discarded < 100 { discarded += 1 }
                else {
                    if first == nil { first = read.position - 0.01 }
                    values.append(SeekFingerprint.energy(buffer))
                }
            } else if read.frames != 0 { throw MobileFailure("seek-qa-partial-window") }
            if values.count % 10 == 0 || read.frames == 0 { try await Task.sleep(for: .milliseconds(1)) }
        }
        return (try XCTUnwrap(first), values)
    }
}
