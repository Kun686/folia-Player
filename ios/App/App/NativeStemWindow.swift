import Foundation

// NativeStemWindow.swift — original peak-scaled planar Int16 storage; floats exist only for a playing slice.
enum NativeStemRole: String, Hashable { case head, tail }
struct NativeStemWindowAlignment: Decodable { let covered: Bool, late: Double }

final class NativeStemWindow {
    struct Packed { let gain: Double; let pcm: [Int16] }
    let fromFrame: Int, frames: Int
    let role: NativeStemRole
    let vocalEnd: Double?
    let packed: [NativeStemName: Packed]
    var from: Double { Double(fromFrame) / NativeStemPCM.rate }
    var duration: Double { Double(frames) / NativeStemPCM.rate }
    var storedBytes: Int { frames * 2 * 4 * MemoryLayout<Int16>.size }

    // Mirrors stems.ts: preserve drums/bass/vocals, derive other from the original mix BEFORE quantization.
    // Input is already decoded/resampled at 44100 Hz. No model, network, file I/O or render-thread work here.
    init(fromFrame: Int, role: NativeStemRole, mix: [[Float]], separated: [NativeStemName: [[Float]]],
         vocalEnd: Double? = nil) throws {
        let frames = mix.first?.count ?? 0
        guard (1...1_323_000).contains(frames), fromFrame >= 0, fromFrame < 4_503_599_627_370_496,
              role == .tail || fromFrame == 0,
              vocalEnd == nil || (role == .tail && vocalEnd!.isFinite && vocalEnd! >= 0
                && vocalEnd! <= Double(frames) / NativeStemPCM.rate + 0.300001) else {
            throw MobileFailure("invalid-stem-window")
        }
        func valid(_ channels: [[Float]]) -> Bool {
            channels.count == 2 && channels.allSatisfy { $0.count == frames && $0.allSatisfy(\.isFinite) }
        }
        guard valid(mix), let drums = separated[.drums], let bass = separated[.bass], let vocals = separated[.vocals],
              valid(drums), valid(bass), valid(vocals) else { throw MobileFailure("invalid-stem-window") }
        self.frames = frames; self.fromFrame = fromFrame; self.role = role; self.vocalEnd = vocalEnd
        var result: [NativeStemName: Packed] = [:]
        for (name, channels) in [(NativeStemName.drums, drums), (.bass, bass), (.vocals, vocals)] {
            result[name] = Self.pack(channels)
        }
        var other = Array(repeating: Array(repeating: Float(0), count: frames), count: 2)
        for channel in 0..<2 { for i in 0..<frames {
            // JS evaluates the subtraction in Double, with one Float32 store at the end.
            let value = Float(Double(mix[channel][i]) - Double(drums[channel][i])
                - Double(bass[channel][i]) - Double(vocals[channel][i]))
            guard value.isFinite else { throw MobileFailure("invalid-stem-window") }
            other[channel][i] = value
        } }
        result[.other] = Self.pack(other); packed = result
    }

    private static func pack(_ channels: [[Float]]) -> Packed {
        let peak = channels.reduce(1.0) { peak, row in row.reduce(peak) { max($0, abs(Double($1))) } }
        let scale = 32767 / peak
        // Math.round ties toward positive infinity, unlike Swift's default rounding for negatives.
        return Packed(gain: peak, pcm: channels.flatMap { row in
            row.map {
                let value = Double($0) * scale, base = floor(value)
                let rounded = value - base < 0.5 ? base : base + 1
                return Int16(max(-32768, min(32767, rounded)))
            }
        })
    }

    // At unity rate, WebKit linearly interpolates a fractional read index. At the very last sample it
    // extrapolates from the final two samples; after the buffer ends it emits zero. The fixture uses
    // actual connectStemDeck output, including a discontinuous final pair, to fix these edge semantics.
    func decoded(offset: Double = 0, count: Int? = nil) throws -> NativeStemPCM {
        let count = count ?? frames
        guard offset.isFinite, offset >= 0, offset < Double(frames),
              (1...1_323_000).contains(count) else { throw MobileFailure("invalid-stem-window") }
        var channels: [NativeStemName: [[Float]]] = [:]
        for name in NativeStemName.allCases {
            let stem = packed[name]!
            func sample(_ index: Int, _ channel: Int) -> Float {
                Float(Double(stem.pcm[channel * frames + index]) / 32767 * stem.gain)
            }
            channels[name] = (0..<2).map { channel in
                (0..<count).map { i in
                    let position = offset + Double(i)
                    guard position < Double(frames) else { return Float(0) }
                    if frames == 1 { return sample(0, channel) }
                    let left = min(Int(position), frames - 2), fraction = position - Double(left)
                    let a = Double(sample(left, channel)), b = Double(sample(left + 1, channel))
                    return Float(a + (b - a) * fraction)
                }
            }
        }
        return try NativeStemPCM(channels)
    }
}

struct NativeStemWindowPair {
    let outgoing: NativeStemPCM, incoming: NativeStemPCM
    let seconds: Double, late: Double

    // Same coverage and late-wiring clamp as automixSession.scheduleStemGesture. Callers pass measured
    // media positions at the window's intended opening, including the incoming decoder's elapsed hold.
    static func prepare(out: NativeStemWindow, incoming: NativeStemWindow, outAt: Double, inAt: Double,
                        seconds: Double, lateBy: Double = 0, planner: NativeTransitionPlanner) async throws -> NativeStemWindowPair? {
        guard out.role == .tail, incoming.role == .head, seconds.isFinite, (0.8...30).contains(seconds),
              outAt.isFinite, inAt.isFinite, outAt >= 0, inAt >= 0, lateBy.isFinite, lateBy >= 0 else {
            throw MobileFailure("invalid-stem-alignment")
        }
        let input: [String: Any] = ["version": 1, "outAt": outAt, "outFrom": out.from, "outFrames": out.frames,
            "inAt": inAt, "inFrom": incoming.from, "inFrames": incoming.frames, "seconds": seconds, "lateBy": lateBy]
        let alignment = try await planner.stemWindow(JSONSerialization.data(withJSONObject: input))
        guard alignment.covered else { return nil }
        let late = alignment.late, rate = NativeStemPCM.rate
        let frames = Int(ceil(seconds * rate))
        return try NativeStemWindowPair(
            outgoing: out.decoded(offset: max(0, (outAt + late - out.from) * rate), count: frames),
            incoming: incoming.decoded(offset: max(0, (inAt + late - incoming.from) * rate), count: frames),
            seconds: seconds, late: late)
    }
}
