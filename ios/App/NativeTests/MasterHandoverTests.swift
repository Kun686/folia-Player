import XCTest
import AVFoundation
@testable import App

// MasterHandoverTests.swift — replay desktop schedules, then run measured plans on real native queue output.
@MainActor extension NativeTests {
    func masterFixture() throws -> [[String: Any]] {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "MasterHandoverReference", withExtension: "json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [[String: Any]])
    }
    func testOriginalMasterHandoverSchedulesExecuteInJavaScriptCore() async throws {
        let planner = NativeTransitionPlanner(), rows = try masterFixture()
        XCTAssertEqual(rows.count, 24)
        for row in rows {
            let result = try await planner.master(JSONSerialization.data(withJSONObject: XCTUnwrap(row["input"])))
            assertTransitionJSON(try JSONSerialization.jsonObject(with: JSONEncoder().encode(result)),
                                 try XCTUnwrap(row["expected"]), path: row["name"] as? String ?? "master")
        }
    }

    func testNativeAutomixSelectsMeasuredStyleBendsOutgoingAndCancelsOnPause() async throws {
        let row = try XCTUnwrap(try masterFixture().first { ($0["name"] as? String)?.hasPrefix("bass-132-") == true })
        let input = try XCTUnwrap(row["input"] as? [String: Any])
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let file = try sharedConstantFile(seconds: 30, stereo: true)
        defer { try? FileManager.default.removeItem(at: file); try? FileManager.default.removeItem(at: root) }
        let local = LocalMediaLibrary(root: root)
        let songs = [try await local.importAudio(file), try await local.importAudio(file)]
        let folder = root.appendingPathComponent("profiles"), cache = NativeProfileCache(directory: folder)
        var tracks: [[String: Any]] = []
        for (index, name) in ["from", "to"].enumerated() {
            var track = try XCTUnwrap(input[name] as? [String: Any])
            var profile = try XCTUnwrap(track["profile"] as? [String: Any])
            profile["duration"] = 30; profile["gridless"] = true
            track["duration"] = 30; track["profile"] = profile
            tracks.append(track)
            let identity = try XCTUnwrap(NativeProfileIdentity(songs[index]))
            let url = try await local.resolve(XCTUnwrap(identity.localID))
            cache.save(try JSONSerialization.data(withJSONObject: profile), key: try cache.key(for: url))
        }
        let suite = "folia.master-handover." + UUID().uuidString
        let storage = UserDefaults(suiteName: suite)!
        defer { storage.removePersistentDomain(forName: suite) }
        let tested = PlaybackEngine(gateway: FailingGateway(), storage: storage, local: local, usesStereoOutput: true)
        tested.network.cancel()
        tested.crossfade = NativeCrossfade(owner: tested, profiler: NativeTrackProfiler(cacheDirectory: folder))
        defer { tested.stop(); tested.clearOutput() }
        _ = try tested.setTransitionSettings(["enabled": true, "mode": "automix", "crossfadeMaxSec": 1.0])
        XCTAssertEqual(tested.crossfade?.mode, "automix")
        let planner = NativeTransitionPlanner()
        let planned = try await planner.plan(JSONSerialization.data(withJSONObject: ["version": 1,
            "settings": ["mode": "automix", "crossfadeMaxSec": 1, "performance": false],
            "from": tracks[0], "to": tracks[1], "bpm": 120, "at": 0]))
        XCTAssertEqual(planned.style, "bassSwap"); XCTAssertGreaterThan(planned.stretch, 1)
        try tested.setQueue(songs, at: 0)
        try await waitForStream { tested.outputIsPlaying && tested.preparedStream != nil }
        let outgoing = try XCTUnwrap(tested.stream)
        try tested.command("seek", position: max(0, planned.outStart - 0.6))
        try await waitForStream { tested.crossfade?.cueSnapshot != nil && tested.index == 1 }
        let cue = try XCTUnwrap(tested.crossfade?.cueSnapshot)
        XCTAssertEqual(cue["style"] as? String, "bassSwap")
        XCTAssertEqual(cue["plain"] as? Bool, false)
        XCTAssertEqual(outgoing.rate, planned.stretch, accuracy: 0.000001)
        let adoptedRate = outgoing.rate
        XCTAssertEqual(tested.stream?.rate, 1)
        XCTAssertEqual(tested.streamOutput?.attachedCount, 2)
        XCTAssertGreaterThan(cue["seconds"] as? Double ?? 0, 1)
        try tested.command("pause")
        XCTAssertNil(tested.crossfade?.cueSnapshot); XCTAssertFalse(tested.crossfade!.isFading)
        XCTAssertEqual(tested.streamOutput?.attachedCount, 1)
        let paused = tested.playbackPosition
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertFalse(tested.outputIsPlaying); XCTAssertEqual(tested.playbackPosition, paused, accuracy: 0.001)
        print("FOLIA_MASTER_QUEUE style=bassSwap outgoingRate=\(adoptedRate) incomingRate=1 pause=PASS")
    }

    func testMasterCurveAcceptsOriginalSlowBendWindowWithoutChangingMediaLimit() throws {
        let curve = try TransitionGainCurve(outgoing: UUID(), incoming: UUID(), out: [1, 0], input: [0, 1],
                                            rate: 44100, seconds: 25 / 0.88)
        XCTAssertGreaterThan(curve.seconds, 25)
        XCTAssertThrowsError(try TransitionGainCurve(outgoing: UUID(), incoming: UUID(), out: [1, 0],
                                                    input: [0, 1], rate: 44100, seconds: 30))
    }
}
