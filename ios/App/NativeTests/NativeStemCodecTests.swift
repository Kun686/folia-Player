import XCTest
@testable import App

// NativeStemCodecTests.swift — original WebKit priming, padding and resampling on identical compressed files.
struct StemCodecReference: Decodable {
    struct Window: Decodable {
        let role: String, frames: Int, start: Int, indices: [Int], hashes: [String], channels: [[Float]]
    }
    struct Row: Decodable {
        let name: String, rate: Int, ext: String, base64: String, digest: String, totalFrames: Int, windows: [Window]
    }
    let cases: [Row]
}

@MainActor extension NativeTests {
    func testStemMediaMatchesOriginalCompressedHeadAndTail() async throws {
        let resource = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "StemCodecReference", withExtension: "json"))
        let reference = try JSONDecoder().decode(StemCodecReference.self, from: Data(contentsOf: resource))
        XCTAssertEqual(reference.cases.count, 4)
        let reader = NativeStemMedia()
        for row in reference.cases {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(row.ext)
            let bytes = try XCTUnwrap(Data(base64Encoded: row.base64))
            XCTAssertEqual(NativeProfileCache.digest(bytes), row.digest)
            try bytes.write(to: url); defer { try? FileManager.default.removeItem(at: url) }
            for window in row.windows {
                let role = try XCTUnwrap(NativeStemRole(rawValue: window.role))
                let actual = try await reader.read(file: url, role: role)
                XCTAssertEqual(actual.totalFrames, row.totalFrames, row.name)
                XCTAssertEqual(actual.fromFrame, window.start, row.name)
                XCTAssertEqual(actual.frames, window.frames, row.name)
                XCTAssertEqual(actual.mediaRevision, row.digest, row.name)
                var maximum: Float = 0, exactHashes = 0
                for c in 0..<2 {
                    let hash = actual.channels[c].withUnsafeBytes { NativeProfileCache.digest(Data($0)) }
                    if hash == window.hashes[c] { exactHashes += 1 }
                    if row.rate == 44100 { XCTAssertEqual(hash, window.hashes[c], row.name + " " + window.role) }
                    for (j, i) in window.indices.enumerated() where i < actual.frames {
                        maximum = max(maximum, abs(actual.channels[c][i] - window.channels[c][j]))
                    }
                }
                print("FOLIA_STEM_CODEC name=\(row.name) role=\(window.role) total=\(actual.totalFrames) expected=\(row.totalFrames) maxPCM=\(maximum) exactHashes=\(exactHashes)")
                XCTAssertLessThanOrEqual(maximum, 1e-5, row.name + " " + window.role)
            }
        }
    }

    func testStemPacketDecoderCancellationTimeoutAndRecovery() async throws {
        let resource = try XCTUnwrap(Bundle(for: NativeTests.self).url(forResource: "StemCodecReference", withExtension: "json"))
        let reference = try JSONDecoder().decode(StemCodecReference.self, from: Data(contentsOf: resource))
        let row = try XCTUnwrap(reference.cases.first { $0.name == "aac48" })
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".m4a")
        try XCTUnwrap(Data(base64Encoded: row.base64)).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        XCTAssertThrowsError(try NativeStemFileDecoder.read(url, deadline: ProcessInfo.processInfo.systemUptime - 1) { _ in
            XCTFail("Expired request must not deliver PCM")
        }) { XCTAssertEqual(($0 as? MobileFailure)?.code, "stem-timeout") }
        // Cancel after real compressed decoding has begun, not only at the initial Task guard.
        let cancelled = Task.detached {
            try NativeStemFileDecoder.read(url, deadline: ProcessInfo.processInfo.systemUptime + 30) { _ in
                withUnsafeCurrentTask { $0?.cancel() }
            }
        }
        do { _ = try await cancelled.value; XCTFail("Mid-conversion cancellation must stop reading") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertThrowsError(try NativeStemFileDecoder.read(url, deadline: ProcessInfo.processInfo.systemUptime + 30) { _ in
            throw MobileFailure("fixture-stop")
        }) { XCTAssertEqual(($0 as? MobileFailure)?.code, "fixture-stop") }
        var frames = 0
        let total = try NativeStemFileDecoder.read(url, deadline: ProcessInfo.processInfo.systemUptime + 30) { buffer in
            frames += Int(buffer.frameLength)
        }
        XCTAssertEqual(total, row.totalFrames); XCTAssertEqual(frames, total)
        try FileManager.default.removeItem(at: url)
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
    }
}
