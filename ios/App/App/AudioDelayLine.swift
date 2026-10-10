import Foundation

// AudioDelayLine.swift — preallocated fractional delay storage shared by tape modulation and echo throws.
final class AudioDelayLine {
    struct Tap { let newer: Int, older: Int; let fraction: Float }
    private var history: [Float] = []
    private var capacity = 0, cursor = 0
    private(set) var available = false

    @discardableResult func prepare(rate: Double, channels: Int, seconds: Double) -> Bool {
        unprepare()
        guard AudioEffectSources.validRate(rate), (1...8).contains(channels), seconds.isFinite,
              seconds > 0, seconds <= 2 else { return false }
        capacity = Int(ceil(rate * seconds)) + 2
        history = [Float](repeating: 0, count: capacity * channels)
        available = true
        return true
    }
    func unprepare() { history.removeAll(); capacity = 0; cursor = 0; available = false }
    func reset() { for i in history.indices { history[i] = 0 }; cursor = 0 }
    func tap(_ delay: Double) -> Tap {
        let value = delay.isFinite ? max(0, min(Double(capacity - 2), delay)) : 0
        let whole = Int(floor(value)), fraction = Float(value - Double(whole))
        let newer = (cursor - whole + capacity) % capacity
        return Tap(newer: newer, older: (newer - 1 + capacity) % capacity, fraction: fraction)
    }
    func write(_ value: Float, channel: Int) { history[channel * capacity + cursor] = value.isFinite ? value : 0 }
    func read(_ tap: Tap, channel: Int) -> Float {
        let start = channel * capacity, a = history[start + tap.newer], b = history[start + tap.older]
        return a + tap.fraction * (b - a)
    }
    func advance() { cursor = (cursor + 1) % capacity }
}
