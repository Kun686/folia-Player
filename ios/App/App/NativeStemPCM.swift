import Foundation

// NativeStemPCM.swift — validated stereo window owned by control before transfer to the render thread.
struct NativeStemBusParameters: Decodable {
    let curve: [Float]
    let inputGain: Float
    let spliceSec: Double, sweepQ: Double
}

struct NativeStemPCM {
    static let rate = 44100.0
    let frames: Int
    let peak: Float
    let stems: [NativeStemName: [[Float]]]

    init(_ stems: [NativeStemName: [[Float]]]) throws {
        guard stems.count == 4, let frames = stems[.vocals]?.first?.count,
              (1...1_323_000).contains(frames) else { throw MobileFailure("invalid-stem-pcm") }
        var peak: Float = 0
        for name in NativeStemName.allCases {
            guard let channels = stems[name], channels.count == 2,
                  channels.allSatisfy({ $0.count == frames }) else { throw MobileFailure("invalid-stem-pcm") }
            for channel in channels {
                for sample in channel {
                    guard sample.isFinite else { throw MobileFailure("invalid-stem-pcm") }
                    peak = max(peak, abs(sample))
                }
            }
        }
        self.frames = frames; self.peak = peak; self.stems = stems
    }
}
