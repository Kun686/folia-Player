import Foundation

// NativeExpansion.swift — original immutable build plan and prepared PCM, ready before any render callback.
struct NativeExpansionPlan: Codable, Equatable {
    struct Repeat: Codable, Equatable { let at: Double, length: Double, sourceAt: Double, sourceLength: Double, rate: Double }
    let intensity: Double, from: Double, to: Double, windowSec: Double, spinbackSec: Double
    let stems: [String], repeats: [Repeat], reason: String
    var frames: Int { max(1, Int(((to - from) * NativeStemPCM.rate).rounded())) }

    func validate() throws {
        guard [0.25, 0.5, 0.75, 1].contains(intensity), windowSec.isFinite, (0.8...30).contains(windowSec),
              from.isFinite, to.isFinite, from >= 0, to <= windowSec, to - from >= 0.35 - 1e-8,
              spinbackSec.isFinite, spinbackSec >= 0, spinbackSec <= (to - from) / 3 + 1e-9,
              stems == (intensity >= 0.75 ? ["drums", "other"] : ["drums"]),
              (1...256).contains(repeats.count), reason.utf8.count <= 1024 else { throw MobileFailure("invalid-expansion-plan") }
        for row in repeats {
            guard [row.at, row.length, row.sourceAt, row.sourceLength, row.rate].allSatisfy(\.isFinite),
                  row.at >= 0, row.length > 0, row.at + row.length <= to - from + 1e-8,
                  row.sourceAt >= 0, row.sourceLength > 0, row.sourceAt + row.sourceLength <= windowSec + 1e-8,
                  (1...1.2).contains(row.rate) else { throw MobileFailure("invalid-expansion-plan") }
        }
    }
}

struct NativeExpansionPCM {
    let plan: NativeExpansionPlan, channels: [[Float]], peak: Float
    init(plan: NativeExpansionPlan, channels: [[Float]]) throws {
        try plan.validate()
        guard channels.count == 2, channels.allSatisfy({ $0.count == plan.frames && $0.allSatisfy(\.isFinite) })
        else { throw MobileFailure("invalid-expansion-pcm") }
        self.plan = plan; self.channels = channels
        peak = channels.reduce(Float(0)) { peak, row in row.reduce(peak) { max($0, abs($1)) } }
    }

    // Original AudioBufferSource starts at plan.from, including its fractional sample position.
    func sample(channel: Int, frame: Int) -> Float {
        let position = Double(frame) - plan.from * NativeStemPCM.rate, row = channels[channel]
        guard position >= 0, position < Double(row.count) else { return 0 }
        let left = min(Int(position), row.count - 2), fraction = position - Double(left)
        return Float(Double(row[left]) + (Double(row[left + 1]) - Double(row[left])) * fraction)
    }
}
