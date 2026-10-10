import AVFoundation

// TransitionGain.swift — bounded, audio-clock execution of the original Web Audio gain curves.
struct TransitionGainCurve {
    let outgoing: UUID, incoming: UUID
    let out: [Float], input: [Float]
    let rate: Double, seconds: Double, hold: Double
    let bands: TransitionBandCurve?
    let echo: NativeEchoSchedule?

    init(outgoing: UUID, incoming: UUID, out: [Double], input: [Double], rate: Double,
         seconds: Double, hold: Double = 0, bands: NativeTransitionEnvelope.Bands? = nil,
         echo: NativeEchoSchedule? = nil) throws {
        guard outgoing != incoming, AudioEffectSources.validRate(rate),
              seconds.isFinite, seconds > 0, seconds <= 25,
              hold.isFinite, hold >= 0, hold <= 25,
              (2...256).contains(out.count), out.count == input.count,
              out.allSatisfy({ $0.isFinite && (0...1).contains($0) }),
              input.allSatisfy({ $0.isFinite && (0...1).contains($0) }) else {
            throw MobileFailure("invalid-transition-curve")
        }
        self.outgoing = outgoing; self.incoming = incoming
        self.out = out.map(Float.init); self.input = input.map(Float.init)
        self.rate = rate; self.seconds = seconds; self.hold = hold
        self.bands = try bands.map(TransitionBandCurve.init)
        try echo?.validate(); self.echo = echo
    }

    // AudioParam setValueCurveAtTime uses linear interpolation between equally spaced Float32 knots.
    func value(incoming: Bool, elapsed: Double) -> Float {
        let points = incoming ? input : out
        if elapsed < 0 { return incoming ? 0 : 1 }
        return Self.interpolate(points, elapsed: elapsed, duration: seconds * rate)
    }
    static func interpolate(_ points: [Float], elapsed: Double, duration: Double) -> Float {
        let progress = max(0, elapsed / duration)
        if progress >= 1 { return points[points.count - 1] }
        let index = progress * Double(points.count - 1), left = Int(index)
        return Float(Double(points[left]) + (Double(points[left + 1]) - Double(points[left])) * (index - Double(left)))
    }
}

final class TransitionGain {
    struct Clock { let renderedEnd: Double?; let curveStart: Double?; let generation: UInt64? }
    private final class Command {
        let curve: TransitionGainCurve?
        let restoreSeconds: Double
        let cancelledAt: Double?
        let generation: UInt64
        init(generation: UInt64, curve: TransitionGainCurve? = nil, restoreSeconds: Double = 0.03, cancelledAt: Double? = nil) {
            self.generation = generation
            self.curve = curve; self.restoreSeconds = restoreSeconds; self.cancelledAt = cancelledAt
        }
    }
    private let lock = NSLock()
    private var generation: UInt64 = 0
    private var ready: Command?, retired: Command?
    private var renderedEnd: Double?
    private var curveStart: Double?
    private var appliedGeneration: UInt64?
    var clock: Clock {
        lock.lock(); defer { lock.unlock() }
        return Clock(renderedEnd: renderedEnd, curveStart: curveStart, generation: appliedGeneration)
    }
    // AVAudioEngine pulls this graph serially. Render owns these fields, including both decks' quantum.
    private var active: Command?
    private var quantum: Double?
    private var start = 0.0, restoreFrames = 0.0
    private var outID: UUID?, inID: UUID?
    private var outFrom: Float = 1, inFrom: Float = 1
    private struct TrimRequest { let generation: UInt64; let gain: Float; let seconds: Double; let heldAt: Double? }
    private var pendingTrim: TrimRequest?
    private var trimFrom: Float = 1, trimTo: Float = 1
    private var trimStart = 0.0, trimFrames = 0.0

    // Call on control side before asynchronous planning. A previous result cannot revive a cancelled fade.
    @discardableResult func cancel(immediate: Bool = false) -> UInt64 {
        lock.lock(); defer { lock.unlock() }
        generation &+= 1
        pendingTrim = nil
        // Original rampGain explicitly sets AudioParam.value: WebKit exposes the last rendered sample.
        ready = Command(generation: generation, restoreSeconds: immediate ? 0 : 0.03,
                        cancelledAt: renderedEnd.map { $0 - 1 }); retired = nil
        return generation
    }
    @discardableResult func schedule(_ curve: TransitionGainCurve, generation expected: UInt64) -> Bool {
        let command = Command(generation: expected, curve: curve)
        lock.lock(); defer { lock.unlock() }
        guard expected == generation else { return false }
        retired = nil; ready = command
        return true
    }
    @discardableResult func trim(gain: Double, seconds: Double, generation expected: UInt64) -> Bool {
        guard gain.isFinite, (0...1).contains(gain), seconds.isFinite, seconds > 0, seconds <= 1 else { return false }
        lock.lock(); defer { lock.unlock() }
        guard expected == generation else { return false }
        retired = nil; pendingTrim = TrimRequest(generation: expected, gain: Float(gain), seconds: seconds,
                                               heldAt: renderedEnd.map { $0 - 1 })
        return true
    }

    private func trimValue(at frame: Double) -> Float {
        guard trimFrames > 0 else { return trimTo }
        let progress = min(1, max(0, (frame - trimStart) / trimFrames))
        return Float(Double(trimFrom) + (Double(trimTo) - Double(trimFrom)) * progress)
    }

    private func value(incoming: Bool, at frame: Double) -> Float {
        if let curve = active?.curve { return curve.value(incoming: incoming, elapsed: frame - start) }
        guard restoreFrames > 0, frame < start + restoreFrames else { return 1 }
        let from = incoming ? inFrom : outFrom
        return Float(Double(from) + (1 - Double(from)) * max(0, frame - start) / restoreFrames)
    }

    // Adopt at most once per shared timestamp, so a command between deck pulls cannot split a pair.
    // try() never waits; replaced curve storage is retained until a later CONTROL call, never freed here.
    private func beginQuantum(_ frame: Double, frames: Int, rate: Double) {
        guard quantum != frame else { return }
        quantum = frame
        if lock.try() {
            if let next = ready, retired == nil {
                let heldAt = next.cancelledAt ?? frame
                outFrom = value(incoming: false, at: heldAt); inFrom = value(incoming: true, at: heldAt)
                retired = active; active = next; ready = nil
                appliedGeneration = next.generation
                if let curve = next.curve {
                    outID = curve.outgoing; inID = curve.incoming
                    start = frame + curve.hold * rate
                    curveStart = start
                    restoreFrames = 0
                    trimFrom = 1; trimTo = 1; trimFrames = 0
                } else {
                    start = frame; curveStart = nil; restoreFrames = next.restoreSeconds * rate
                    trimFrom = trimValue(at: heldAt); trimTo = 1; trimStart = frame; trimFrames = restoreFrames
                }
            }
            if let trim = pendingTrim, trim.generation == appliedGeneration {
                trimFrom = trimValue(at: trim.heldAt ?? frame); trimTo = trim.gain
                trimStart = frame; trimFrames = trim.seconds * rate; pendingTrim = nil
            }
            renderedEnd = frame + Double(frames)
            lock.unlock()
        }
    }

    // Decoder buffers are interleaved stereo. Validation precedes clock changes and sample writes.
    @discardableResult func process(_ buffers: UnsafeMutablePointer<AudioBufferList>, frames: Int,
                                    sampleTime: Double, rate: Double, source: UUID, tone: TransitionTone? = nil,
                                    echo: TransitionEcho? = nil) -> Bool {
        let list = UnsafeMutableAudioBufferListPointer(buffers)
        guard frames > 0, frames <= 65536, sampleTime.isFinite, abs(sampleTime) < 4_503_599_627_370_496,
              AudioEffectSources.validRate(rate), list.count == 1, list[0].mNumberChannels == 2,
              Int(list[0].mDataByteSize) >= frames * 2 * MemoryLayout<Float>.size,
              let data = list[0].mData?.assumingMemoryBound(to: Float.self) else { return false }
        beginQuantum(sampleTime, frames: frames, rate: rate)
        let participating = source == outID || source == inID
        guard active?.curve == nil || active?.curve?.rate == rate else { return false }
        let incoming = source == inID
        // Trim precedes tone and fade, while the per-deck measurement tap remains ahead of all three.
        if participating && !incoming, trimFrom != 1 || trimTo != 1 {
            for index in 0..<frames {
                let trim = trimValue(at: sampleTime + Double(index))
                data[index * 2] *= trim; data[index * 2 + 1] *= trim
            }
        }
        tone?.process(data, frames: frames, sampleTime: sampleTime, rate: rate,
                      curve: participating ? active?.curve?.bands : nil, incoming: incoming, start: start,
                      duration: (active?.curve?.seconds ?? 0) * rate,
                      generation: appliedGeneration, immediate: active?.restoreSeconds == 0)
        echo?.adopt(participating && !incoming ? active?.curve?.echo : nil, generation: appliedGeneration,
                    anchor: start - (active?.curve?.hold ?? 0) * rate, sampleTime: sampleTime,
                    immediate: active?.restoreSeconds == 0)
        for index in 0..<frames {
            let gain = participating ? value(incoming: incoming, at: sampleTime + Double(index)) : 1
            let wet = echo?.next(left: data[index * 2], right: data[index * 2 + 1],
                                 frame: sampleTime + Double(index)) ?? (0, 0)
            data[index * 2] = data[index * 2] * gain + wet.0
            data[index * 2 + 1] = data[index * 2 + 1] * gain + wet.1
        }
        return true
    }
}
