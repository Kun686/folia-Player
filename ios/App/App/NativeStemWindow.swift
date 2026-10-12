import Foundation

// NativeStemWindow.swift — original peak-scaled planar Int16 storage; floats exist only for a playing slice.
enum NativeStemRole: String, Hashable { case head, tail }
struct NativeStemWindowAlignment: Decodable { let covered: Bool, late: Double; let expansionOffset: Int?, inOffset: Int?, length: Int? }

final class NativeStemWindow {
    struct Packed {
        let gain: Double; let pcm: [Int16]
        // Shared by control-side decoding and late-bound render reads. Preserve WebKit's last-pair extrapolation.
        func sample(at position: Double, channel: Int, frames: Int) -> Float {
            guard position >= 0, position < Double(frames) else { return 0 }
            let left = frames == 1 ? 0 : min(Int(position), frames - 2)
            let a = Float(Double(pcm[channel * frames + left]) / 32767 * gain)
            if frames == 1 { return a }
            let b = Float(Double(pcm[channel * frames + left + 1]) / 32767 * gain)
            return Float(Double(a) + (Double(b) - Double(a)) * (position - Double(left)))
        }
    }
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
        try NativeStemPCM(Dictionary(uniqueKeysWithValues: NativeStemName.allCases.map {
            ($0, try decodedStem($0, offset: offset, count: count))
        }))
    }

    func decodedStem(_ name: NativeStemName, offset: Double = 0, count: Int? = nil) throws -> [[Float]] {
        let count = count ?? frames
        guard offset.isFinite, offset >= 0, offset < Double(frames),
              (1...1_323_000).contains(count) else { throw MobileFailure("invalid-stem-window") }
        let stem = packed[name]!
        return (0..<2).map { channel in
            (0..<count).map { stem.sample(at: offset + Double($0), channel: channel, frames: frames) }
        }
    }

    // Original session sums the restored lanes in this order, with a Float32 store after each add.
    // Only one decoded stereo stem is held at a time; no four-stem float copy is retained for analysis.
    func mixed(offset: Int = 0, count: Int? = nil) throws -> [[Float]] {
        let count = count ?? frames
        guard offset >= 0, count > 0, count <= frames, offset <= frames - count else {
            throw MobileFailure("invalid-stem-window")
        }
        var result = Array(repeating: Array(repeating: Float(0), count: count), count: 2)
        for name in [NativeStemName.vocals, .drums, .bass, .other] {
            try Task.checkCancellation()
            let channels = try decodedStem(name, offset: Double(offset), count: count)
            for c in 0..<2 { for i in 0..<count { result[c][i] += channels[c][i] } }
        }
        return result
    }
}

struct NativeStemWindowPair {
    let outgoing: NativeStemPCM, incoming: NativeStemPCM
    let seconds: Double, late: Double
    private let originalOut: NativeStemWindow
    private let expansionOffset: Int, expansionFrames: Int

    // The original build reads a rounded slice, unlike the fractional AudioBufferSource media offset.
    func expansionChannels(_ name: NativeStemName) throws -> [[Float]] {
        try originalOut.decodedStem(name, offset: Double(expansionOffset), count: expansionFrames)
    }

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
        guard let offset = alignment.expansionOffset, let length = alignment.length,
              offset >= 0, length > 0, offset <= out.frames - length else { throw MobileFailure("invalid-stem-alignment") }
        let late = alignment.late, rate = NativeStemPCM.rate
        let frames = Int(ceil(seconds * rate))
        return try NativeStemWindowPair(
            outgoing: out.decoded(offset: max(0, (outAt + late - out.from) * rate), count: frames),
            incoming: incoming.decoded(offset: max(0, (inAt + late - incoming.from) * rate), count: frames),
            seconds: seconds, late: late, originalOut: out, expansionOffset: offset, expansionFrames: length)
    }
}
