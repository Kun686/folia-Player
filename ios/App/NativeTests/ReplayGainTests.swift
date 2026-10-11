import XCTest
import AVFoundation
@testable import App

// ReplayGainTests.swift — original JS/WebKit oracles, real tagged imports and decoder PCM without WebView.
private struct ReplayGainReference: Decodable {
    struct Row: Decodable {
        struct Action: Decodable { let at: Int, mode: String }
        let rate: Double, actions: [Action], indices: [Int], samples: [Float]
    }
    let frames: Int, info: [String: Double], cases: [Row]
}

@MainActor extension NativeTests {
    func testReplayGainOriginalRulesRunInJavaScriptCore() async throws {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "ReplayGainReference", withExtension: "json"))
        let data = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let planner = NativeTransitionPlanner()
        for row in try XCTUnwrap(data["calculations"] as? [[String: Any]]) {
            let result = try await planner.replayGain(NativeReplayGainInfo(row["info"]))
            XCTAssertEqual(result.track, try XCTUnwrap(row["track"] as? Double), accuracy: 1e-12)
            XCTAssertEqual(result.album, try XCTUnwrap(row["album"] as? Double), accuracy: 1e-12)
        }
        let invalid = NativeReplayGainInfo(["trackGain": true, "albumGain": Double.infinity, "trackPeak": "", "albumPeak": "bad"])
        XCTAssertNil(invalid)
        let strings = NativeReplayGainInfo(["trackGain": " -6 ", "trackPeak": "0.8", "cookie": "never-retained"])
        XCTAssertEqual(strings?.dictionary, ["trackGain": -6, "trackPeak": 0.8])
    }

    func testReplayGainPCMMatchesOriginalWebKitRampsAndReplacement() async throws {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "ReplayGainReference", withExtension: "json"))
        let reference = try JSONDecoder().decode(ReplayGainReference.self, from: Data(contentsOf: url))
        let levels = try await NativeTransitionPlanner().replayGain(NativeReplayGainInfo(reference.info))
        var maximum: Float = 0
        for row in reference.cases {
            for pattern in [[128], [7, 255, 31, 512, 3, 89]] {
                let gain = StreamReplayGain(levels: levels, mode: "track", rate: row.rate)
                let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: row.rate, channels: 2, interleaved: true)!
                let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 512)!
                let pcm = buffer.floatChannelData![0]
                var at = 0, block = 0, next = 0
                while at < reference.frames {
                    if let action = row.actions.first(where: { $0.at == at }) { gain.configure(action.mode) }
                    let nextEvent = row.actions.map(\.at).filter { $0 > at }.min() ?? reference.frames
                    let count = min(pattern[block % pattern.count], nextEvent - at, reference.frames - at)
                    buffer.frameLength = AVAudioFrameCount(count)
                    for i in 0..<count { pcm[i * 2] = 1; pcm[i * 2 + 1] = -0.5 }
                    gain.process(buffer.mutableAudioBufferList, frames: count)
                    while next < row.indices.count && row.indices[next] < at + count {
                        let index = row.indices[next] - at, expected = row.samples[next]
                        maximum = max(maximum, abs(pcm[index * 2] - expected), abs(pcm[index * 2 + 1] + expected * 0.5))
                        next += 1
                    }
                    at += count; block += 1
                }
                XCTAssertEqual(next, row.indices.count)
            }
        }
        XCTAssertLessThan(maximum, 0.000002)
        print("FOLIA_REPLAYGAIN WebKitMaximumPCMError=\(maximum)")
    }

    func testReplayGainSettingsMigratePersistAndRejectInvalidModeAtomically() throws {
        let tested = engine(); tested.network.cancel(); defer { tested.stop() }
        var original = NativeAudioSettings(); original.volume = 0.4; original.isMuted = true
        original.equalizer.gains[3] = 6
        var old = original.dictionary; old.removeValue(forKey: "replayGainMode")
        tested.storage.set(try JSONSerialization.data(withJSONObject: old), forKey: "folia.audio")
        tested.restoreAudioSettings()
        XCTAssertEqual(tested.audioSettings.replayGainMode, "off")
        XCTAssertEqual(tested.audioSettings.volume, 0.4); XCTAssertTrue(tested.audioSettings.isMuted)
        XCTAssertEqual(tested.audioSettings.equalizer.gains[3], 6)
        original.replayGainMode = "album"; _ = try tested.setAudioSettings(original.dictionary)
        tested.restoreAudioSettings(); XCTAssertEqual(tested.audioSettings.replayGainMode, "album")
        let before = tested.storage.data(forKey: "folia.audio")
        original.replayGainMode = "invalid"; original.volume = 0.8
        XCTAssertThrowsError(try tested.setAudioSettings(original.dictionary))
        XCTAssertEqual(tested.storage.data(forKey: "folia.audio"), before)
        XCTAssertEqual(tested.audioSettings.volume, 0.4)
        var value = song("netease", "gain")
        value["replayGain"] = ["trackGain": -6, "trackPeak": 0.8]
        tested.queue = [try PlaybackEngine.sanitizedSong(value)]; tested.index = 0; tested.persist()
        tested.queue = []; tested.restore()
        XCTAssertEqual(NativeReplayGainInfo(tested.currentSong?["replayGain"])?.dictionary, ["trackGain": -6, "trackPeak": 0.8])
    }

    // A standard RIFF ID3v2.4 TXXX chunk exercises AVFoundation's actual metadata reader.
    func taggedReplayGainAudio() throws -> URL {
        let url = try sharedConstantFile(seconds: 8)
        var wave = try Data(contentsOf: url), tags = Data()
        func synchsafe(_ size: Int) -> [UInt8] { [21, 14, 7, 0].map { UInt8((size >> $0) & 0x7f) } }
        for (key, value) in [("TRACK_GAIN", "-6.0 dB"), ("TRACK_PEAK", "0.8"), ("ALBUM_GAIN", "-3.0 dB"), ("ALBUM_PEAK", "0.7")] {
            let body = Data([3]) + Data(("REPLAYGAIN_" + key).utf8) + Data([0]) + Data(value.utf8)
            tags += Data("TXXX".utf8) + Data(synchsafe(body.count)) + Data([0, 0]) + body
        }
        let id3 = Data("ID3".utf8) + Data([4, 0, 0]) + Data(synchsafe(tags.count)) + tags
        var size = UInt32(id3.count).littleEndian
        wave += Data("id3 ".utf8) + withUnsafeBytes(of: &size) { Data($0) } + id3
        if id3.count % 2 != 0 { wave.append(0) }
        var total = UInt32(wave.count - 8).littleEndian
        wave.replaceSubrange(4..<8, with: withUnsafeBytes(of: &total) { Data($0) })
        try wave.write(to: url); return url
    }

    func testReplayGainTaggedImportLazyMigrationAndNativePlayback() async throws {
        let source = try taggedReplayGainAudio(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let library = LocalMediaLibrary(root: root)
        defer { try? FileManager.default.removeItem(at: source); try? FileManager.default.removeItem(at: root) }
        let imported = try await library.importAudio(source), id = try XCTUnwrap(imported["id"] as? String)
        let expected = ["trackGain": -6.0, "albumGain": -3, "trackPeak": 0.8, "albumPeak": 0.7]
        XCTAssertEqual(NativeReplayGainInfo(imported["replayGain"])?.dictionary, expected)
        var legacy = imported; legacy.removeValue(forKey: "replayGain"); legacy.removeValue(forKey: "replayGainScanned")
        try JSONSerialization.data(withJSONObject: legacy).write(to: root.appendingPathComponent(id + "/song.json"))
        let recovered = try await library.audioSource(id)
        XCTAssertEqual(recovered.replayGain?.dictionary, expected)
        let gateway = FailingGateway(), tested = PlaybackEngine(gateway: gateway, storage: engine().storage, local: library, usesStereoOutput: true)
        tested.network.cancel(); defer { tested.stop(); tested.streamOutput?.close() }
        var settings = NativeAudioSettings(); settings.replayGainMode = "track"
        _ = try tested.setAudioSettings(settings.dictionary)
        try tested.setQueue([legacy], at: 0)
        try await waitForStream { tested.stream?.playing == true }
        let output = try XCTUnwrap(tested.streamOutput), measured = OutputMeasurement()
        output.engine.mainMixerNode.installTap(onBus: 0, bufferSize: 512, format: nil) { buffer, _ in measured.consume(buffer) }
        defer { output.engine.mainMixerNode.removeTap(onBus: 0) }
        try await Task.sleep(nanoseconds: 300_000_000)
        measured.reset(); try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertEqual(measured.read().rms, 0.125 * pow(10, -6.0 / 20), accuracy: 0.0001)
        XCTAssertEqual(NativeReplayGainInfo(tested.currentSong?["replayGain"])?.dictionary, expected)
        settings.replayGainMode = "album"; _ = try tested.setAudioSettings(settings.dictionary)
        try await Task.sleep(nanoseconds: 300_000_000)
        measured.reset(); try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertEqual(measured.read().rms, 0.125 * pow(10, -3.0 / 20), accuracy: 0.0001)
        try tested.command("seek", position: 3)
        try await waitForStream { tested.stream?.preparingOutput == false && (tested.stream?.position ?? 0) >= 3 }
        try await Task.sleep(nanoseconds: 300_000_000)
        measured.reset(); try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertEqual(measured.read().rms, 0.125 * pow(10, -3.0 / 20), accuracy: 0.0001)
        XCTAssertEqual(gateway.count, 0)
        print("FOLIA_REPLAYGAIN taggedImport=PASS lazyUpgrade=PASS decodedPCM=PASS modeChange=PASS seek=PASS")
    }

    func testReplayGainUnreadableCatalogIsNotOverwrittenAndMissingAudioKeepsErrorCode() async throws {
        let source = try taggedReplayGainAudio(), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: source); try? FileManager.default.removeItem(at: root) }
        let library = LocalMediaLibrary(root: root), song = try await library.importAudio(source)
        let id = try XCTUnwrap(song["id"] as? String), metadata = root.appendingPathComponent(id + "/song.json")
        let corrupt = Data("{broken metadata".utf8); try corrupt.write(to: metadata)
        let recovered = try await library.audioSource(id)
        XCTAssertTrue(FileManager.default.fileExists(atPath: recovered.url.path)); XCTAssertNil(recovered.replayGain)
        XCTAssertEqual(try Data(contentsOf: metadata), corrupt)
        try await library.remove(id)
        do { _ = try await library.audioSource(id); XCTFail("Deleted audio accepted") }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "local-file-missing") }
    }

    func testReplayGainOverlappingDecksAndBalanceUseIndependentLevels() async throws {
        let url = try sharedConstantFile(seconds: 5), output = try await StreamMixOutput.make(), measured = OutputMeasurement()
        defer { try? FileManager.default.removeItem(at: url); output.close() }
        let planner = NativeTransitionPlanner(), info = NativeReplayGainInfo(["trackGain": -6.0])
        let levels = try await planner.replayGain(info)
        let first = try await StreamOccurrence.prepare(url: url, output: output, replayGain: info, replayGainLevels: levels)
        let second = try await StreamOccurrence.prepare(url: url, output: output)
        let balance = NativeBalanceCorrection()
        defer { balance.cancel(); first.dispose(); second.dispose(); output.engine.mainMixerNode.removeTap(onBus: 0) }
        var settings = NativeAudioSettings(); settings.replayGainMode = "track"; output.apply(settings)
        output.engine.mainMixerNode.installTap(onBus: 0, bufferSize: 512, format: nil) { buffer, _ in measured.consume(buffer) }
        try first.play(); try second.play()
        try await Task.sleep(nanoseconds: 250_000_000)
        measured.reset(); try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertEqual(measured.read().rms, 0.125 * (levels.track + 1), accuracy: 0.0001)
        let envelope = NativeTransitionEnvelope(style: "plainBlend", hold: 0, overlap: 2,
            crossover: 0.5, together: 0, shapeBands: false, sweepOut: false, snappedToBeat: false,
            gain: .init(out: [1, 1], in: [1, 1]), bands: nil)
        let stamp = output.transitionGain.cancel()
        XCTAssertTrue(try output.scheduleGain(outgoing: first.audio, incoming: second.audio, envelope: envelope, generation: stamp))
        balance.start(planner: planner, output: output, outgoing: first, incoming: second, outgoingReference: -6,
                      incomingReference: -12, overlap: 2, generation: stamp, current: { true })
        try await Task.sleep(nanoseconds: 700_000_000)
        measured.reset(); try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertEqual(measured.read().rms, 0.125 * (levels.track + 1), accuracy: 0.0001, "ReplayGain already equalized profile levels; no second attenuation")
        settings.replayGainMode = "off"; output.apply(settings)
        balance.cancel(); output.transitionGain.cancel()
        try await Task.sleep(nanoseconds: 250_000_000)
        measured.reset(); try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertEqual(measured.read().rms, 0.25, accuracy: 0.0001)
    }

    func testReplayGainResolvedSourceAndOfflineCacheKeepMetadata() async throws {
        let file = try sharedConstantFile(seconds: 2), root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file); try? FileManager.default.removeItem(at: root) }
        let raw = ["trackGain": -6.0, "trackPeak": 0.8]
        var value = song("netease", "cached-gain"); value["replayGain"] = ["trackGain": -2.0]
        let resolved = try GatewayClient.audioSource(["url": "https://audio.example.invalid/song?signature=test", "replayGain": raw], song: value)
        XCTAssertEqual(resolved.replayGain?.dictionary, raw)
        XCTAssertThrowsError(try GatewayClient.audioSource(["url": "http://audio.example.invalid/song"], song: value))
        value["replayGain"] = resolved.replayGain?.dictionary
        let fixture = ProfileHTTPFixture(try Data(contentsOf: file)); fixture.status = 200
        let remote = ProfileHTTPProtocol.add(fixture); defer { ProfileHTTPProtocol.remove(remote) }
        let cache = NativeMediaCache(directory: root, configuration: profileNetworkConfiguration(), settings: .init(enabled: true))
        _ = try await cache.store(NativeProfileIdentity(value)!, song: value, source: remote)
        let reopened = NativeMediaCache(directory: root)
        let leased = try await reopened.cached(NativeProfileIdentity(value)!)
        XCTAssertEqual(leased?.replayGain?.dictionary, raw)
        let gateway = FailingGateway(), tested = PlaybackEngine(gateway: gateway, storage: engine().storage, usesStereoOutput: true, mediaCache: reopened)
        tested.network.cancel(); defer { tested.stop(); tested.streamOutput?.close() }
        var settings = NativeAudioSettings(); settings.replayGainMode = "track"
        _ = try tested.setAudioSettings(settings.dictionary)
        // Queue metadata can be absent after restart: the durable cache must supply it.
        value.removeValue(forKey: "replayGain"); try tested.setQueue([value], at: 0)
        try await waitForStream { tested.stream?.playing == true }
        XCTAssertEqual(tested.stream?.replayGain?.dictionary, raw)
        XCTAssertEqual(NativeReplayGainInfo(tested.currentSong?["replayGain"])?.dictionary, raw)
        XCTAssertEqual(gateway.count, 0)
        let catalog = await reopened.catalog()
        XCTAssertFalse(String(data: try JSONSerialization.data(withJSONObject: catalog), encoding: .utf8)!.contains("signature"))
    }
}
