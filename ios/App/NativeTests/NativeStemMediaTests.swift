import XCTest
import AVFoundation
@testable import App

// NativeStemMediaTests.swift — actual audio files, bounded head/tail material and full-representation identity.
enum StemMediaFixture {
    static func sample(_ i: Int, _ channel: Int) -> Float { Float((i * (channel + 3)) % 257 - 128) / 512 }
    static func write(frames: Int, rate: Double = 44100, channels: UInt32 = 2, sine: Bool = false, nan: Bool = false) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        let format: AVAudioFormat
        if channels == 4 {
            let layout = try XCTUnwrap(AVAudioChannelLayout(layoutTag: kAudioChannelLayoutTag_Quadraphonic))
            format = AVAudioFormat(standardFormatWithSampleRate: rate, channelLayout: layout)
        } else { format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: rate, channels: channels)) }
        let file = try AVAudioFile(forWriting: url, settings: format.settings)
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096))
        let samples = try XCTUnwrap(buffer.floatChannelData)
        for at in stride(from: 0, to: frames, by: 4096) {
            let count = min(4096, frames - at); buffer.frameLength = AVAudioFrameCount(count)
            for c in 0..<Int(channels) { for i in 0..<count {
                samples[c][i] = sine
                    ? Float(sin(Double(at + i) * 2 * .pi * (c == 0 ? 440 : 997) / rate) * (c == 0 ? 0.5 : 0.25))
                    : sample(at + i, c)
                if nan && at + i == 3 { samples[c][i] = .nan }
            } }
            try file.write(from: buffer)
        }
        return url
    }
    static func snapshots() throws -> Set<String> {
        Set(try FileManager.default.contentsOfDirectory(atPath: FileManager.default.temporaryDirectory.path).filter { $0.hasPrefix("FoliaStem-") })
    }
}

@MainActor extension NativeTests {
    func testStemMediaPreservesExactOriginalHeadAndTailSamples() async throws {
        let reader = NativeStemMedia(); var samples = 0
        for (frames, channels) in [(441, UInt32(1)), (1323000, 2), (1415297, 2), (2646123, 2), (4097, 4)] {
            let url = try StemMediaFixture.write(frames: frames, channels: channels)
            defer { try? FileManager.default.removeItem(at: url) }
            let digest = NativeProfileCache.digest(try Data(contentsOf: url))
            for role in [NativeStemRole.head, .tail] {
                let actual = try await reader.read(file: url, role: role)
                let count = min(frames, 1323000), start = role == .tail ? frames - count : 0
                XCTAssertEqual(actual.totalFrames, frames); XCTAssertEqual(actual.fromFrame, start)
                XCTAssertEqual(actual.frames, count); XCTAssertEqual(actual.mediaRevision, digest)
                var different = 0
                for c in 0..<2 { for i in 0..<count {
                    if actual.channels[c][i].bitPattern != StemMediaFixture.sample(start + i, channels == 1 ? 0 : c).bitPattern { different += 1 }
                } }
                XCTAssertEqual(different, 0, "\(frames) \(channels) \(role)"); samples += count * 2
            }
        }
        print("FOLIA_STEM_MEDIA exactSamples=\(samples) windowFrames=1323000")
    }

    func testStemMediaResamplesContinuouslyWithCorrectTimeAndChannels() async throws {
        let reader = NativeStemMedia(); var maximum = 0.0
        for rate in [22050.0, 48000.0, 96000.0] {
            let frames = Int(rate * 32) + 137, url = try StemMediaFixture.write(frames: frames, rate: rate, sine: true)
            defer { try? FileManager.default.removeItem(at: url) }
            for role in [NativeStemRole.head, .tail] {
                let value = try await reader.read(file: url, role: role)
                XCTAssertEqual(value.frames, 1323000)
                XCTAssertLessThanOrEqual(abs(Double(value.totalFrames) - Double(frames) / rate * 44100), 1)
                XCTAssertEqual(value.fromFrame, role == .tail ? value.totalFrames - 1323000 : 0)
                for c in 0..<2 { for i in stride(from: 2048, to: value.frames - 2048, by: 31) {
                    let expected = sin(Double(value.fromFrame + i) * 2 * .pi * (c == 0 ? 440 : 997) / 44100) * (c == 0 ? 0.5 : 0.25)
                    maximum = max(maximum, abs(Double(value.channels[c][i]) - expected))
                } }
            }
        }
        XCTAssertLessThan(maximum, 0.001)
        print("FOLIA_STEM_RESAMPLE rates=3 roles=2 maxSineError=\(maximum)")
    }

    func testStemSnapshotOwnsCompleteBytesAndRejectsMidReadMutation() throws {
        let manager = FileManager.default, before = try StemMediaFixture.snapshots()
        let source = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".bin")
        let data = Data((0..<3_145_728).map { UInt8($0 % 251) })
        try data.write(to: source); defer { try? manager.removeItem(at: source) }
        var snapshot: NativeStemSnapshot? = try NativeStemSnapshot.capture(source, deadline: ProcessInfo.processInfo.systemUptime + 30)
        let held = snapshot!.url
        XCTAssertEqual(snapshot!.bytes, Int64(data.count)); XCTAssertEqual(snapshot!.digest, NativeProfileCache.digest(data))
        try manager.removeItem(at: source)
        XCTAssertEqual(try Data(contentsOf: held), data)
        snapshot = nil; XCTAssertFalse(manager.fileExists(atPath: held.path))
        try data.write(to: source)
        var changed = false
        XCTAssertThrowsError(try NativeStemSnapshot.capture(source, deadline: ProcessInfo.processInfo.systemUptime + 30) { _ in
            if !changed {
                changed = true
                let writer = try FileHandle(forWritingTo: source); defer { try? writer.close() }
                try writer.seek(toOffset: 2_000_000); try writer.write(contentsOf: Data([255]))
            }
        }) { XCTAssertEqual(($0 as? MobileFailure)?.code, "stem-source-changed") }
        XCTAssertThrowsError(try NativeStemSnapshot.capture(source, deadline: ProcessInfo.processInfo.systemUptime + 30) { _ in throw CancellationError() })
        let alias = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try manager.createSymbolicLink(at: alias, withDestinationURL: source); defer { try? manager.removeItem(at: alias) }
        XCTAssertThrowsError(try NativeStemSnapshot.capture(alias, deadline: ProcessInfo.processInfo.systemUptime + 30))
        XCTAssertThrowsError(try NativeStemSnapshot.capture(source, deadline: ProcessInfo.processInfo.systemUptime - 1))
        XCTAssertEqual(try StemMediaFixture.snapshots(), before)
    }

    func testStemCachedLeaseSurvivesEvictionAndFeedsWindowCache() async throws {
        let manager = FileManager.default, reader = NativeStemMedia(), analysis = NativeStemAnalysis()
        let source = try StemMediaFixture.write(frames: 1415297)
        defer { try? manager.removeItem(at: source) }
        let bytes = try Data(contentsOf: source)
        let lease = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        try manager.linkItem(at: source, to: lease)
        let cached = NativeCachedMedia(url: lease, generation: UUID().uuidString)
        var removed = false
        let snapshot = try NativeStemSnapshot.capture(cached: cached, deadline: ProcessInfo.processInfo.systemUptime + 30) { _ in
            if !removed { try manager.removeItem(at: source); removed = true }
        }
        XCTAssertEqual(snapshot.digest, NativeProfileCache.digest(bytes))
        let material = try await reader.read(cached: cached, role: .tail)
        XCTAssertEqual(material.mediaRevision, snapshot.digest)
        let zero = Array(repeating: Array(repeating: Float(0), count: material.frames), count: 2)
        let window = try await analysis.window(fromFrame: material.fromFrame, role: material.role, mix: material.channels,
            separated: [.drums: material.channels, .bass: zero, .vocals: zero])
        XCTAssertNil(window.vocalEnd); XCTAssertEqual(window.fromFrame, 92297)
        let id = UUID().uuidString
        let song: [String: Any] = ["id": id, "name": "Generated material", "artists": [],
            "sourceRef": ["kind": "local", "mediaId": id]]
        let identity = try XCTUnwrap(NativeProfileIdentity(song)), digest = String(repeating: "a", count: 64)
        let key = try material.key(identity: identity, modelDigest: digest), cache = NativeStemCache()
        await cache.setWanted([key]); let pending = await cache.begin(key), ticket = try XCTUnwrap(pending)
        let stored = await cache.finish(ticket, window: window)
        XCTAssertTrue(stored)
        let hit = await cache.read(key); XCTAssertTrue(hit === window)
        XCTAssertNotEqual(try material.key(identity: identity, modelDigest: String(repeating: "b", count: 64)), key)
    }

    func testStemMediaCancellationCorruptFilesAndRecovery() async throws {
        let before = try StemMediaFixture.snapshots(), reader = NativeStemMedia()
        let source = try StemMediaFixture.write(frames: 44100), bad = try StemMediaFixture.write(frames: 44100, nan: true)
        defer { try? FileManager.default.removeItem(at: source); try? FileManager.default.removeItem(at: bad) }
        let cancelled = Task { try await reader.read(file: source, role: .head) }; cancelled.cancel()
        do { _ = try await cancelled.value; XCTFail("Cancelled reads must not publish material") }
        catch { XCTAssertTrue(error is CancellationError) }
        for url in [URL(string: "https://example.invalid/audio.wav")!, bad] {
            do { _ = try await reader.read(file: url, role: .tail); XCTFail("Invalid input must fail") } catch { XCTAssertTrue(error is MobileFailure) }
        }
        let valid = try await reader.read(file: source, role: .tail)
        XCTAssertEqual(valid.frames, 44100); XCTAssertEqual(valid.fromFrame, 0)
        XCTAssertEqual(try StemMediaFixture.snapshots(), before)
    }
}
