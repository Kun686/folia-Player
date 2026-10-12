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

// Original JS sample addresses/gains are immutable. Render only binds the original rounded source
// slice; repeat, wrap and spinback arithmetic never runs in Swift or on the audio thread.
struct NativeExpansionProgram {
    let plan: NativeExpansionPlan, peak: Double
    private let map: [Double], lanes: [NativeStemWindow.Packed]
    private let materialFrames: Int, windowFrames: Int, plannedOffset: Double
    var storedBytes: Int { map.count * MemoryLayout<Double>.size }

    init(plan: NativeExpansionPlan, map: [Double], window: NativeStemWindow, plannedOffset: Double) throws {
        try plan.validate()
        let length = Int((plan.windowSec * NativeStemPCM.rate).rounded())
        guard window.role == .tail, plannedOffset.isFinite, plannedOffset >= 0,
              plannedOffset.rounded() + Double(length) <= Double(window.frames), map.count == plan.frames * 2 else {
            throw MobileFailure("invalid-expansion-pcm")
        }
        for i in stride(from: 0, to: map.count, by: 2) {
            guard map[i].isFinite, map[i].rounded() == map[i], map[i] >= -1, map[i] < Double(length),
                  map[i + 1].isFinite, (0...1).contains(map[i + 1]) else { throw MobileFailure("invalid-expansion-pcm") }
        }
        self.plan = plan; self.map = map; self.plannedOffset = plannedOffset
        materialFrames = window.frames; windowFrames = length
        lanes = plan.stems.map { window.packed[NativeStemName(rawValue: $0)!]! }
        peak = lanes.reduce(0) { $0 + $1.gain * 32768 / 32767 }
    }
    // Keep round(planned) + round(late), not round(planned + late): they differ at half samples.
    func sourceOffset(at actualOffset: Double) -> Int? {
        guard actualOffset.isFinite, actualOffset >= plannedOffset - 1e-6,
              actualOffset <= Double(materialFrames) else { return nil }
        let offset = Int(plannedOffset.rounded()) + Int(max(0, actualOffset - plannedOffset).rounded())
        return offset <= materialFrames - windowFrames ? offset : nil
    }
    func sample(channel: Int, frame: Int, sourceOffset: Int) -> Float {
        let position = Double(frame) - plan.from * NativeStemPCM.rate
        guard position >= 0, position < Double(plan.frames) else { return 0 }
        let left = min(Int(position), plan.frames - 2), fraction = position - Double(left)
        func restored(_ index: Int) -> Float {
            let address = Int(map[index * 2]), gain = map[index * 2 + 1]
            guard address >= 0 else { return 0 }
            var value: Float = 0
            for lane in lanes {
                let raw = lane.sample(at: Double(sourceOffset + address), channel: channel, frames: materialFrames)
                value += Float(Double(raw) * gain)
            }
            return value
        }
        let a = Double(restored(left)), b = Double(restored(left + 1))
        return Float(a + (b - a) * fraction)
    }
}
