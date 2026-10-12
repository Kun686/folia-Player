import Foundation

// NativeStemAlignment.swift — immutable media anchors, revalidated by the serial audio graph at adoption.
struct NativeStemClocks {
    let outgoing: NativeMediaClock, incoming: NativeMediaClock
    init?(outgoing: NativeMediaClock?, incoming: NativeMediaClock?) {
        guard let outgoing, let incoming, outgoing.sampleEnd == incoming.sampleEnd,
              outgoing.sampleRate == NativeStemPCM.rate, incoming.sampleRate == NativeStemPCM.rate,
              outgoing.source != incoming.source else { return nil }
        self.outgoing = outgoing; self.incoming = incoming
    }
}

struct NativeStemAlignment {
    let plannedStart: Double
    let clocks: NativeStemClocks
    let outFrom: Double, inFrom: Double
    private let outgoing: NativeTempoHandover, incoming: NativeTempoHandover

    // A stream's media origin can lie between output samples after seeking. Use the nearest host
    // sample (ties earlier): always rounding up can put a tail-ending window one whole sample outside
    // stemWindowCoverage, even though the intended window fits. The timing quantization is <= 0.5 sample.
    static func start(clock: NativeMediaClock, hold: Double) -> Double? {
        guard hold.isFinite, (0...25).contains(hold) else { return nil }
        let frame = ceil(clock.sampleEnd + hold * clock.sampleRate - 0.5)
        return frame.isFinite && abs(frame) < 4_503_599_627_370_496 ? frame : nil
    }

    init(clocks: NativeStemClocks, plannedStart: Double, outFrom: Double, inFrom: Double,
         outgoing: NativeTempoHandover, incoming: NativeTempoHandover) throws {
        guard plannedStart.isFinite, plannedStart.rounded() == plannedStart,
              abs(plannedStart - clocks.outgoing.sampleEnd) <= 25 * NativeStemPCM.rate,
              outFrom.isFinite, inFrom.isFinite, outFrom >= 0, inFrom >= 0 else {
            throw MobileFailure("invalid-stem-alignment")
        }
        self.clocks = clocks; self.plannedStart = plannedStart; self.outFrom = outFrom; self.inFrom = inFrom
        self.outgoing = outgoing; self.incoming = incoming
    }
    // Render-only: either deck may have run first in this quantum. Both must describe this boundary
    // on the same unchanged unity-rate timeline. No lock, clock guess or control callback is involved.
    func valid(at frame: Double, frames: Int) -> Bool {
        func matches(_ current: NativeMediaClock?, _ expected: NativeMediaClock) -> Bool {
            guard let current, current.source == expected.source, current.epoch == expected.epoch,
                  current.sampleRate == expected.sampleRate,
                  current.sampleEnd == frame || current.sampleEnd == frame + Double(frames),
                  let actual = current.position(at: frame), let projected = expected.position(at: frame) else { return false }
            return abs(actual - projected) * NativeStemPCM.rate < 0.5
        }
        return matches(outgoing.renderMediaClock, clocks.outgoing) && matches(incoming.renderMediaClock, clocks.incoming)
    }
    func offsets(at frame: Double) -> (outgoing: Double, incoming: Double)? {
        guard let outAt = clocks.outgoing.position(at: frame), let inAt = clocks.incoming.position(at: frame) else { return nil }
        return ((outAt - outFrom) * NativeStemPCM.rate, (inAt - inFrom) * NativeStemPCM.rate)
    }
}
