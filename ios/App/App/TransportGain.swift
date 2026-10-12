import Foundation
import AVFoundation

// TransportGain.swift — dedicated post-effects linear gain; control writes never block the render thread.
final class TransportGain {
    private struct Command { var start: Double?; var target: Double; var seconds: Double }
    private let lock = NSLock()
    private var pending: Command?
    // Render-owned state. A new ramp starts at the last rendered sample, like WebKit AudioParam.value.
    private var value = 1.0, start = 1.0, target = 1.0
    private var elapsed = 0, length = 0
    func ramp(to target: Double, seconds: Double) {
        guard target.isFinite, (0...1).contains(target), seconds.isFinite, (0...1).contains(seconds) else { return }
        lock.lock()
        // Preserve a snap preceding a ramp even if both arrive before the next audio block.
        pending = Command(start: seconds == 0 ? target : pending?.start, target: target, seconds: seconds)
        lock.unlock()
    }
    func process(_ buffers: UnsafeMutablePointer<AudioBufferList>, frames: Int, rate: Double) {
        guard frames > 0, rate.isFinite, rate > 0 else { return }
        if lock.try() {
            if let command = pending {
                if let explicit = command.start { value = explicit }
                start = value; target = command.target
                length = Int((command.seconds * rate).rounded()); elapsed = 0
                if length == 0 { value = target }
                pending = nil
            }
            lock.unlock()
        }
        if length == 0 && value == 1 { return }
        let channels = UnsafeMutableAudioBufferListPointer(buffers)
        for frame in 0..<frames {
            if elapsed < length {
                value = start + (target - start) * Double(elapsed) / Double(length)
                elapsed += 1
            } else { value = target; length = 0 }
            let gain = Float(value)
            for channel in channels {
                channel.mData?.assumingMemoryBound(to: Float.self)[frame] *= gain
            }
        }
    }
}
