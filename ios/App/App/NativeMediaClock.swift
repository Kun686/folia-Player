import Foundation

// NativeMediaClock.swift — exact unity-rate PCM position tied to the host sample timeline, never wall time.
struct NativeMediaClock: Equatable {
    let source: UUID, epoch: UInt64
    let sampleRate: Double, sampleEnd: Double, mediaEnd: Double
    let quantumFrames: Int

    // A caller projecting a future splice must also revalidate source/epoch and queue intent at adoption.
    func position(at sampleTime: Double) -> Double? {
        guard Self.valid(sampleTime) else { return nil }
        let value = mediaEnd + (sampleTime - sampleEnd) / sampleRate
        return value.isFinite && value >= 0 ? value : nil
    }
    func isCurrent(at renderedEnd: Double) -> Bool {
        // A missed publication may hide an underrun. Even one older quantum is not evidence that
        // media advanced through the current one; callers can wait for another coherent snapshot.
        Self.valid(renderedEnd) && renderedEnd == sampleEnd
    }
    fileprivate static func valid(_ frame: Double) -> Bool {
        frame.isFinite && abs(frame) < 4_503_599_627_370_496 && frame.rounded() == frame
    }
}

// One render owner writes this value. Snapshot publication uses the existing handover lock.
// Source identity is allocated at construction, while callbacks only update scalar fields.
struct NativeMediaClockTracker {
    private let source = UUID()
    private var epoch: UInt64 = 0
    private var previous: NativeMediaClock?

    mutating func invalidate() { epoch &+= 1; previous = nil }

    mutating func record(sampleTime: Double?, frames: Int, sampleRate: Double,
                         mediaEnd: Double, complete: Bool) -> NativeMediaClock? {
        guard complete, let sampleTime, NativeMediaClock.valid(sampleTime),
              (1...8192).contains(frames), NativeMediaClock.valid(sampleTime + Double(frames)),
              AudioEffectSources.validRate(sampleRate), mediaEnd.isFinite,
              mediaEnd * sampleRate >= Double(frames) - 0.5 else {
            invalidate(); return nil
        }
        if let previous, previous.sampleRate != sampleRate || previous.sampleEnd != sampleTime
            || abs((mediaEnd - previous.mediaEnd) * sampleRate - Double(frames)) >= 0.5 {
            invalidate()
        }
        let result = NativeMediaClock(source: source, epoch: epoch, sampleRate: sampleRate,
            sampleEnd: sampleTime + Double(frames), mediaEnd: mediaEnd, quantumFrames: frames)
        previous = result; return result
    }
}
