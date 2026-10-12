import AVFoundation

// NativeStemMixer.swift — render-owner DSP for the original stem bus, before shared EQ/effects/master gain.
// Window alignment, master-deck splicing and cancellation remain the scheduler's responsibility.
final class NativeStemMixer {
    private struct Lane { let left: [Float], right: [Float], curve: [Float] }
    // Web Audio connects the outgoing sweep to changeover before the other three gain nodes.
    private static let order: [NativeStemName] = [.other, .drums, .bass, .vocals]
    private let outgoing: [Lane], incoming: [Lane]
    private let bus: NativeStemBusParameters, sweep: NativeStemSchedule.Sweep
    private let duration: Double
    private let expansion: NativeExpansionPCM?, expansionLevel: Float
    let frames: Int
    private(set) var position = 0
    private var left = AudioEffectBiquadState(), right = AudioEffectBiquadState()
    private var sweepVariable = true

    init(outgoing: NativeStemPCM, incoming: NativeStemPCM, gesture: NativeStemGesture,
         bus: NativeStemBusParameters, outLevel: Double = 1, inLevel: Double = 1,
         expansion: NativeExpansionPCM? = nil) throws {
        let seconds = gesture.schedule.windowSec, sweep = gesture.schedule.otherSweep
        guard seconds.isFinite, (0.8...30).contains(seconds),
              bus.curve.count == 8192, bus.curve.allSatisfy({ $0.isFinite && abs($0) <= 1 }),
              bus.inputGain.isFinite, bus.inputGain > 0, bus.inputGain <= 1,
              bus.spliceSec.isFinite, bus.spliceSec > 0, bus.spliceSec < seconds / 2,
              bus.sweepQ.isFinite, abs(bus.sweepQ) <= 24,
              sweep.fromHz.isFinite, sweep.toHz.isFinite, sweep.fromHz > 0,
              sweep.toHz >= sweep.fromHz, sweep.toHz < NativeStemPCM.rate / 2,
              sweep.seconds.isFinite, sweep.seconds > 0, sweep.seconds <= seconds else {
            throw MobileFailure("invalid-stem-mix")
        }
        let frames = Int(ceil(seconds * NativeStemPCM.rate))
        guard outgoing.frames >= frames, incoming.frames >= frames else { throw MobileFailure("invalid-stem-pcm") }
        let knots = max(2, Int(ceil(seconds * 200)))
        // Fold ReplayGain into Float32 knots, exactly where the original session applies it.
        func lanes(_ pcm: NativeStemPCM, _ curves: [NativeStemName: [Float]], _ level: Double, order: [NativeStemName]) throws -> [Lane] {
            guard level.isFinite, level >= 0, Float(level).isFinite, curves.count == 4 else {
                throw MobileFailure("invalid-stem-mix")
            }
            return try order.map { name in
                guard let curve = curves[name], curve.count == knots,
                      curve.allSatisfy({ $0.isFinite && (0...1).contains($0) }) else { throw MobileFailure("invalid-stem-mix") }
                let scaled = curve.map { Float(Double($0) * level) }
                guard scaled.allSatisfy({ $0.isFinite && Double($0) * Double(pcm.peak) < Double(Float.greatestFiniteMagnitude) / 16 })
                else { throw MobileFailure("invalid-stem-mix") }
                return Lane(left: pcm.stems[name]![0], right: pcm.stems[name]![1], curve: scaled)
            }
        }
        self.outgoing = try lanes(outgoing, gesture.outgoing, outLevel, order: Self.order)
        self.incoming = try lanes(incoming, gesture.incoming, inLevel, order: [.drums, .bass, .other, .vocals])
        guard gesture.expansion == expansion?.plan,
              expansion == nil || (expansion!.plan.windowSec == seconds
                && Double(expansion!.peak) * outLevel < Double(Float.greatestFiniteMagnitude) / 16) else {
            throw MobileFailure("invalid-expansion-pcm")
        }
        self.expansion = expansion; expansionLevel = Float(outLevel)
        self.bus = bus; self.sweep = sweep; duration = seconds * NativeStemPCM.rate; self.frames = frames
    }

    private func frequency(_ frame: Int) -> Float {
        Float(sweep.fromHz * pow(sweep.toHz / sweep.fromHz,
            min(1, Double(frame) / (sweep.seconds * NativeStemPCM.rate))))
    }

    // Sequential pulls are driven by the host audio clock. No allocation, locking, JS or model work here.
    // Invalid buffers never advance the window; the caller handles the error before mixing this bus.
    @discardableResult func render(_ buffers: UnsafeMutablePointer<AudioBufferList>, frames count: Int) -> Bool {
        let list = UnsafeMutableAudioBufferListPointer(buffers)
        guard count > 0, count <= 65536, list.count == 1, list[0].mNumberChannels == 2,
              Int(list[0].mDataByteSize) >= count * 2 * MemoryLayout<Float>.size,
              let output = list[0].mData?.assumingMemoryBound(to: Float.self) else { return false }
        let audible = min(count, max(0, frames - position))
        for index in 0..<count {
            guard position < frames else { output[index * 2] = 0; output[index * 2 + 1] = 0; continue }
            let frame = position, time = Double(frame)
            if frame % 128 == 0 { sweepVariable = frequency(frame) != frequency(frame + 127) }
            let filter = AudioEffectBiquadCoefficients(frequency: Double(frequency(frame)), rate: NativeStemPCM.rate,
                                                     highpass: true, q: bus.sweepQ)
            var outL: Float = 0, outR: Float = 0, inL: Float = 0, inR: Float = 0
            for lane in 0..<4 {
                let outGain = TransitionGainCurve.interpolate(outgoing[lane].curve, elapsed: time, duration: duration)
                let inGain = TransitionGainCurve.interpolate(incoming[lane].curve, elapsed: time, duration: duration)
                var l = outgoing[lane].left[frame] * outGain, r = outgoing[lane].right[frame] * outGain
                if lane == 0 {
                    l = left.process(l, filter, roundFeedback: sweepVariable)
                    r = right.process(r, filter, roundFeedback: sweepVariable)
                }
                outL += l; outR += r
                inL += incoming[lane].left[frame] * inGain; inR += incoming[lane].right[frame] * inGain
            }
            if let expansion {
                // Same outgoing changeover node: original build bypasses the stem sweep, then shares
                // the 8ms element splice, ReplayGain and common limiter. Never add it after the limiter.
                outL += expansion.sample(channel: 0, frame: frame) * expansionLevel
                outR += expansion.sample(channel: 1, frame: frame) * expansionLevel
            }
            let splice = bus.spliceSec * NativeStemPCM.rate
            let outChange = Float(min(1, time / splice)), inChange = Float(min(1, max(0, (duration - time) / splice)))
            output[index * 2] = (outL * outChange + inL * inChange) * bus.inputGain
            output[index * 2 + 1] = (outR * outChange + inR * inChange) * bus.inputGain
            position += 1
            if position % 128 == 0 { left.finishQuantum(); right.finishQuantum() }
        }
        // The original bus's memoryless, non-oversampled WaveShaper; never applied to ordinary playback.
        // Do not shape the zero-filled region beyond the window: the scheduler has disconnected the bus.
        bus.curve.withUnsafeBufferPointer { curve in
            WebAudioWaveShaper.process(output, count: audible * 2, curve: curve)
        }
        return true
    }
}
