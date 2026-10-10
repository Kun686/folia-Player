import Accelerate
import Foundation

// AudioSpectrum.swift — Web Audio analyser math; PCM capture and bridge lifetime live in AudioMeter.
// https://webaudio.github.io/web-audio-api/#fft-windowing-and-smoothing-over-time
final class AudioSpectrum {
    static let size = 2048
    private var window = [Float](repeating: 0, count: size)
    private var input = [Float](repeating: 0, count: size)
    private let imaginary = [Float](repeating: 0, count: size)
    private var real = [Float](repeating: 0, count: size)
    private var imag = [Float](repeating: 0, count: size)
    private var magnitude = [Float](repeating: 0, count: size / 2)
    private(set) var bytes = [Int](repeating: 0, count: size / 2)
    private let fft = vDSP_DFT_zop_CreateSetup(nil, vDSP_Length(size), .FORWARD)
    var available: Bool { fft != nil }

    init() {
        for i in 0..<Self.size {
            let phase = 2 * Double.pi * Double(i) / Double(Self.size)
            window[i] = Float(0.42 - 0.5 * cos(phase) + 0.08 * cos(2 * phase))
        }
    }
    deinit { if let fft { vDSP_DFT_DestroySetup(fft) } }
    func reset() {
        for i in magnitude.indices { magnitude[i] = 0; bytes[i] = 0 }
    }
    // Called once per fresh capture, outside the render callback. Repeated reads do not advance smoothing.
    func analyse(_ samples: [Float]) {
        guard let fft, samples.count == Self.size else { return }
        vDSP_vmul(samples, 1, window, 1, &input, 1, vDSP_Length(Self.size))
        vDSP_DFT_Execute(fft, input, imaginary, &real, &imag)
        for bin in magnitude.indices {
            let amplitude = hypot(Double(real[bin]), Double(imag[bin])) / Double(Self.size)
            magnitude[bin] = Float(0.6 * Double(magnitude[bin]) + 0.4 * amplitude)
            let db = magnitude[bin] > 0 ? 20 * log10(Double(magnitude[bin])) : -100
            bytes[bin] = Int(min(255, max(0, (db + 100) * 255 / 70)))
        }
    }
}
