import Accelerate
import AVFoundation

// AudioEqualizer.swift — Web Audio's ten filters on native decoded PCM, independent of visualizer polling.
final class AudioEqualizer {
    static let frequencies: [Double] = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
    private let mailbox = NSLock()
    private var requested = [Double](repeating: 0, count: 10)
    private var target = [Double](repeating: 0, count: 10)
    private var current = [Double](repeating: 0, count: 10)
    private var coefficients = [Double](repeating: 0, count: 50)
    private var filters: [vDSP_biquadm_Setup] = []
    private var rate = 44100.0
    private var needsInitialGains = true
    private(set) var available = false
    var configuredGains: [Double] {
        mailbox.lock(); defer { mailbox.unlock() }; return requested
    }

    func configure(enabled: Bool, gains: [Double]) {
        guard gains.count == 10, gains.allSatisfy({ $0.isFinite && abs($0) <= 12 }) else { return }
        mailbox.lock(); defer { mailbox.unlock() }
        for i in 0..<10 { requested[i] = enabled ? gains[i] : 0 }
    }
    func prepare(_ format: AudioStreamBasicDescription) {
        unprepare()
        guard format.mFormatID == kAudioFormatLinearPCM, format.mFormatFlags & kAudioFormatFlagIsFloat != 0,
              format.mBitsPerChannel == 32, format.mSampleRate.isFinite, format.mSampleRate >= 8000,
              (1...8).contains(format.mChannelsPerFrame) else { return }
        rate = format.mSampleRate
        for band in 0..<10 { Self.writeCoefficients(band: band, gain: 0, rate: rate, into: &coefficients) }
        for _ in 0..<format.mChannelsPerFrame {
            guard let filter = vDSP_biquadm_CreateSetup(coefficients, 10, 1) else { unprepare(); return }
            filters.append(filter)
        }
        available = true
    }
    func unprepare() {
        filters.forEach(vDSP_biquadm_DestroySetup); filters.removeAll()
        available = false; needsInitialGains = true
    }
    deinit { unprepare() }

    // Cookbook coefficients match audioEqualizerGraph.ts: shelves at the ends, peaking Q=1.4 inside.
    // https://www.w3.org/TR/audio-eq-cookbook/ (shelf slope S=1).
    static func writeCoefficients(band: Int, gain: Double, rate: Double, frequency: Double? = nil, into values: inout [Double]) {
        let offset = band * 5
        if gain == 0 {
            values[offset] = 1
            for i in 1..<5 { values[offset + i] = 0 }
            return
        }
        let a = pow(10, gain / 40), omega = 2 * Double.pi * min(frequency ?? frequencies[band], rate * 0.475) / rate
        let c = cos(omega), s = sin(omega)
        let b0: Double, b1: Double, b2: Double, a0: Double, a1: Double, a2: Double
        if band == 0 || band == 9 {
            let k = 2 * sqrt(a) * s / sqrt(2)
            if band == 0 {
                b0 = a * ((a + 1) - (a - 1) * c + k); b1 = 2 * a * ((a - 1) - (a + 1) * c)
                b2 = a * ((a + 1) - (a - 1) * c - k)
                a0 = (a + 1) + (a - 1) * c + k; a1 = -2 * ((a - 1) + (a + 1) * c)
                a2 = (a + 1) + (a - 1) * c - k
            } else {
                b0 = a * ((a + 1) + (a - 1) * c + k); b1 = -2 * a * ((a - 1) + (a + 1) * c)
                b2 = a * ((a + 1) + (a - 1) * c - k)
                a0 = (a + 1) - (a - 1) * c + k; a1 = 2 * ((a - 1) - (a + 1) * c)
                a2 = (a + 1) - (a - 1) * c - k
            }
        } else {
            let alpha = s / (2 * 1.4)
            b0 = 1 + alpha * a; b1 = -2 * c; b2 = 1 - alpha * a
            a0 = 1 + alpha / a; a1 = -2 * c; a2 = 1 - alpha / a
        }
        values[offset] = b0 / a0; values[offset + 1] = b1 / a0; values[offset + 2] = b2 / a0
        values[offset + 3] = a1 / a0; values[offset + 4] = a2 / a0
    }

    // All render buffers/setups are preallocated. A busy control thread never blocks audio.
    func process(_ buffers: UnsafeMutablePointer<AudioBufferList>, frames: Int, discontinuity: Bool = false) {
        guard available, frames > 0 else { return }
        if mailbox.try() {
            for i in 0..<10 { target[i] = requested[i] }
            mailbox.unlock()
        }
        if discontinuity { filters.forEach(vDSP_biquadm_ResetState) }
        let list = UnsafeMutableAudioBufferListPointer(buffers)
        var count = 0
        for buffer in list {
            guard buffer.mData != nil, buffer.mNumberChannels > 0,
                  Int(buffer.mDataByteSize) / (MemoryLayout<Float>.size * Int(buffer.mNumberChannels)) >= frames else { return }
            count += Int(buffer.mNumberChannels)
        }
        guard count == filters.count else { return }
        var offset = 0
        while offset < frames {
            let length = min(32, frames - offset)
            let decay = exp(-Double(length) / (rate * 0.015))
            var changed = needsInitialGains
            var neutral = true
            for band in 0..<10 {
                let value = needsInitialGains ? target[band] : target[band] + (current[band] - target[band]) * decay
                let next = abs(value - target[band]) < 0.00001 ? target[band] : value
                if next != current[band] || needsInitialGains {
                    current[band] = next
                    Self.writeCoefficients(band: band, gain: next, rate: rate, into: &coefficients)
                    changed = true
                }
                neutral = neutral && next == 0
            }
            needsInitialGains = false
            if changed { for filter in filters { vDSP_biquadm_SetCoefficientsDouble(filter, coefficients, 0, 0, 10, 1) } }
            if !neutral {
                var channel = 0
                for buffer in list {
                    let stride = Int(buffer.mNumberChannels), data = buffer.mData!.assumingMemoryBound(to: Float.self)
                    for local in 0..<stride {
                        var input: UnsafePointer<Float> = UnsafePointer(data + offset * stride + local)
                        var output = data + offset * stride + local
                        vDSP_biquadm(filters[channel], &input, vDSP_Stride(stride), &output, vDSP_Stride(stride), vDSP_Length(length))
                        channel += 1
                    }
                }
            } else if changed { filters.forEach(vDSP_biquadm_ResetState) }
            offset += length
        }
    }
}
