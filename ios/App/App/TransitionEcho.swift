import Foundation

// TransitionEcho.swift — original send automation and feedback return, separate from a deck's dry fade.
struct NativeEchoSchedule: Codable {
    let delay: Double, opensAt: Double, peaksAt: Double, closesAt: Double
    let send: Double, feedback: Double, defaultDelay: Double
    func validate() throws {
        guard [delay, opensAt, peaksAt, closesAt, send, feedback, defaultDelay].allSatisfy(\.isFinite),
              (0.08...1).contains(delay), (0...50).contains(opensAt),
              peaksAt > opensAt, closesAt > peaksAt, closesAt <= 51,
              (0...1).contains(send), (0..<1).contains(feedback), (0...2).contains(defaultDelay) else {
            throw MobileFailure("invalid-transition-echo")
        }
    }
}

final class TransitionEcho {
    private let line = AudioDelayLine()
    private let feedbackLine = AudioDelayLine()
    private let rate: Double
    private var generation: UInt64?
    private var schedule: NativeEchoSchedule?
    private var anchor = 0.0, resetAt = 0.0, resetFrames = 0.0
    private var lastSend: Float = 0, resetFrom: Float = 0, feedback: Float = 0
    private var delay = 0.0
    private var activated = false

    init(rate: Double) {
        self.rate = rate
        line.prepare(rate: rate, channels: 2, seconds: 2)
        feedbackLine.prepare(rate: rate, channels: 2, seconds: 128 / rate)
    }
    // Called once per shared graph command. No allocation or JS on the render thread.
    func adopt(_ schedule: NativeEchoSchedule?, generation: UInt64?, anchor: Double,
               sampleTime: Double, immediate: Bool) {
        guard self.generation != generation else { return }
        self.generation = generation; self.schedule = schedule; self.anchor = anchor
        if let schedule {
            if !activated { delay = Double(Float(schedule.defaultDelay)) * rate }
            activated = true; feedback = Float(schedule.feedback)
        } else {
            stopSending(at: sampleTime, immediate: immediate)
        }
    }
    func stopSending(at sampleTime: Double, immediate: Bool = false) {
        schedule = nil
        resetFrom = lastSend; resetAt = sampleTime; resetFrames = immediate ? 0 : 0.05 * rate
    }
    // WebKit's feedback GainNode contributes its previous 128-frame render quantum. This latency is
    // in the feedback path only: moving the main delay would also move the first repeat incorrectly.
    func next(left: Float, right: Float, frame: Double) -> (Float, Float) {
        guard activated, line.available else { return (0, 0) }
        if let schedule {
            let elapsed = (frame - anchor) / rate
            if elapsed >= schedule.opensAt { delay = Double(Float(schedule.delay)) * rate }
            let value: Double
            if elapsed < schedule.opensAt || elapsed >= schedule.closesAt { value = 0 }
            else if elapsed < schedule.peaksAt {
                value = (elapsed - schedule.opensAt) / (schedule.peaksAt - schedule.opensAt)
            } else {
                value = (schedule.closesAt - elapsed) / (schedule.closesAt - schedule.peaksAt)
            }
            lastSend = Float(Double(Float(schedule.send)) * value)
        } else {
            lastSend = resetFrames > 0
                ? Float(Double(resetFrom) * max(0, 1 - (frame - resetAt) / resetFrames)) : 0
        }
        let tap = line.tap(delay), a = line.read(tap, channel: 0), b = line.read(tap, channel: 1)
        let feedbackTap = feedbackLine.tap(128)
        let oldLeft = feedbackLine.read(feedbackTap, channel: 0), oldRight = feedbackLine.read(feedbackTap, channel: 1)
        feedbackLine.write(a, channel: 0); feedbackLine.write(b, channel: 1); feedbackLine.advance()
        line.write(left * lastSend + oldLeft * feedback, channel: 0)
        line.write(right * lastSend + oldRight * feedback, channel: 1)
        line.advance()
        return (a, b)
    }
}
