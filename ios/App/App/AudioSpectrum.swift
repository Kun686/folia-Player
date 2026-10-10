import Accelerate
import Foundation

// AudioSpectrum.swift — Web Audio analyser math; PCM capture and bridge lifetime live in AudioMeter.
// https://webaudio.github.io/web-audio-api/#fft-windowing-and-smoothing-over-time
final class AudioSpectrum {
    static let size = 2048
    private let count: Int
    private let smoothing: Double
    private var window: [Float]
    private var input: [Float]
    private let imaginary: [Float]
    private var real: [Float]
    private var imag: [Float]
    private var magnitude: [Float]
    private(set) var bytes: [Int]
    private(set) var decibels: [Float]
    private let fft: vDSP_DFT_Setup?
    var available: Bool { fft != nil }

    init(size: Int = AudioSpectrum.size, smoothing: Double = 0.6) {
        precondition([1024, 2048].contains(size) && (0...1).contains(smoothing))
        count = size; self.smoothing = smoothing
        window = [Float](repeating: 0, count: size); input = window; imaginary = window; real = window; imag = window
        magnitude = [Float](repeating: 0, count: size / 2)
        bytes = [Int](repeating: 0, count: size / 2); decibels = [Float](repeating: -.infinity, count: size / 2)
        fft = vDSP_DFT_zop_CreateSetup(nil, vDSP_Length(size), .FORWARD)
        for i in 0..<size {
            let phase = 2 * Double.pi * Double(i) / Double(size)
            window[i] = Float(0.42 - 0.5 * cos(phase) + 0.08 * cos(2 * phase))
        }
    }
    deinit { if let fft { vDSP_DFT_DestroySetup(fft) } }
    func reset() {
        for i in magnitude.indices { magnitude[i] = 0; bytes[i] = 0; decibels[i] = -.infinity }
    }
    // Called once per fresh capture, outside the render callback. Repeated reads do not advance smoothing.
    func analyse(_ samples: [Float]) {
        guard let fft, samples.count == count else { return }
        vDSP_vmul(samples, 1, window, 1, &input, 1, vDSP_Length(count))
        vDSP_DFT_Execute(fft, input, imaginary, &real, &imag)
        for bin in magnitude.indices {
            let amplitude = hypot(Double(real[bin]), Double(imag[bin])) / Double(count)
            magnitude[bin] = Float(smoothing * Double(magnitude[bin]) + (1 - smoothing) * amplitude)
            let db = magnitude[bin] > 0 ? 20 * log10(Double(magnitude[bin])) : -100
            decibels[bin] = magnitude[bin] > 0 ? Float(db) : -.infinity
            bytes[bin] = Int(min(255, max(0, (db + 100) * 255 / 70)))
        }
    }
}
