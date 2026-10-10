import XCTest
import AVFoundation
@testable import App

// TrackProfileTests.swift — replay original JS outputs, decode system audio, and check cancellation/large-buffer ownership.
@MainActor extension NativeTests {
    func profilePCM(_ row: [String: Any]) -> NativeProfilePCM {
        let name = row["name"] as! String, count = Int((row["seconds"] as! Double) * 22050)
        var mid = [Float](repeating: 0, count: count)
        var side = (row["stereo"] as! Bool) ? mid : nil
        for index in 0..<count {
            let second = index / 22050, period = name == "structure" && second >= 8 ? 72 : 100
            var amplitude: Float = name == "silence" ? 0 : 0.25
            if name == "edges" { amplitude = second < 1 || second >= 10 ? 0 : second >= 8 ? 0.03125 : 0.25 }
            if name == "groove" { amplitude = index % 11025 < 2205 ? 0.5 : 0.03125 }
            mid[index] = index % period < period / 2 ? amplitude : -amplitude
            if side != nil { side![index] = (index % 137 < 68 ? 1 : -1) * (second < 4 ? 0.25 : 0.015625) }
        }
        func data(_ values: [Float]) -> NSData { values.withUnsafeBytes { NSData(bytes: $0.baseAddress, length: $0.count) } }
        return NativeProfilePCM(mid: data(mid), side: side.map(data))
    }
    func testOriginalTrackProfilesRunWithoutWebViewOrReplacementMath() async throws {
        let url = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "TrackProfileReference", withExtension: "json"))
        let fixture = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let rows = try XCTUnwrap(fixture["rows"] as? [[String: Any]])
        let profiler = NativeTrackProfiler()
        XCTAssertEqual(rows.count, 8)
        for row in rows {
            let data = try await profiler.analyse(profilePCM(row), partial: row["partial"] as! Bool)
            if row["expected"] is NSNull { XCTAssertNil(data) }
            else {
                let result = try JSONSerialization.jsonObject(with: XCTUnwrap(data))
                assertTransitionJSON(result, row["expected"]!, path: row["name"] as! String)
            }
        }
        print("FOLIA_ORIGINAL_PROFILES cases=8 maxFieldTolerance=1e-6")
    }
    func testProfileSystemDecodeResamplesAndPreservesMonoSideAbsence() async throws {
        for stereo in [false, true] {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
            defer { try? FileManager.default.removeItem(at: url) }
            let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: stereo ? 2 : 1)!
            let input = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 88200)!
            input.frameLength = 88200
            input.floatChannelData![0].update(repeating: 0.5, count: 88200)
            if stereo { input.floatChannelData![1].update(repeating: -0.25, count: 88200) }
            do { let writer = try AVAudioFile(forWriting: url, settings: format.settings); try writer.write(from: input) }
            // The decoder runs off the main actor in production; exercise it on a worker here too.
            let decoded = try await Task.detached { try NativeProfilePCM.decode(url) }.value
            XCTAssertEqual(decoded.frames, 44100)
            XCTAssertEqual(decoded.side == nil, !stereo)
            let middle = decoded.mid.bytes.assumingMemoryBound(to: Float.self)[22050]
            XCTAssertEqual(middle, stereo ? 0.125 : 0.5, accuracy: 0.00001)
            if let side = decoded.side { XCTAssertEqual(side.bytes.assumingMemoryBound(to: Float.self)[22050], 0.375, accuracy: 0.00001) }
        }
    }
    func testProfileCancellationInvalidInputAndMissingRuntimeRecover() async throws {
        let profiler = NativeTrackProfiler()
        let input = profilePCM(["name": "groove", "seconds": 60.0, "stereo": true])
        let work = Task.detached { try await profiler.analyse(input) }
        try await Task.sleep(nanoseconds: 10_000_000)
        work.cancel()
        do { _ = try await work.value; XCTFail("Cancelled analysis must not publish a profile") }
        catch { XCTAssertTrue(error is CancellationError) }
        do { _ = try await profiler.analyse(NativeProfilePCM(mid: NSData(bytes: [UInt8](repeating: 0, count: 3), length: 3), side: nil)); XCTFail() }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "invalid-profile-input") }
        let valid = profilePCM(["name": "tone", "seconds": 2.0, "stereo": false])
        do { _ = try await NativeTrackProfiler(bundle: Bundle(for: NativeTests.self)).analyse(valid); XCTFail() }
        catch { XCTAssertEqual((error as? MobileFailure)?.code, "profile-runtime-unavailable") }
        let result = try await profiler.analyse(valid)
        XCTAssertNotNil(result)
    }
    func testProfileRuntimeDoesNotRetainNativePCMForTheNextTrack() async throws {
        let profiler = NativeTrackProfiler()
        weak var owner: NSData?
        var input: NativeProfilePCM? = profilePCM(["name": "tone", "seconds": 3.0, "stereo": true])
        owner = input?.mid
        _ = try await profiler.analyse(input!)
        input = nil
        XCTAssertNil(owner)
    }
}
