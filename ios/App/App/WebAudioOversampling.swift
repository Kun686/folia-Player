/*
 * Copyright (C) 2013 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Apple Inc. ("Apple") nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import Accelerate
import Foundation

// WebAudioOversampling.swift — fixed WebKit half-band kernels, with Accelerate FIR and bounded streaming buffers.
// Adapted from UpSampler/DownSampler at WebKit 9c50e091cb1b47fddb7afa7ffec7f9f22c0ee38b.
final class WebAudioOversampling {
    static let maximumFrames = 128
    static let latencyFrames = 192
    private let up1 = HalfBand(up: true, maximumInput: 128)
    private let up2 = HalfBand(up: true, maximumInput: 256)
    private let down2 = HalfBand(up: false, maximumInput: 512)
    private let down1 = HalfBand(up: false, maximumInput: 256)
    private var twice = [Float](repeating: 0, count: 256)
    private var fourTimes = [Float](repeating: 0, count: 512)

    func reset() { up1.reset(); up2.reset(); down1.reset(); down2.reset() }

    // Small callbacks do not require padding or add block latency. Each filter retains its own causal history.
    @discardableResult func process(_ input: UnsafeBufferPointer<Float>, into output: UnsafeMutableBufferPointer<Float>,
                                    curve: UnsafeBufferPointer<Float>) -> Bool {
        guard (1...Self.maximumFrames).contains(input.count), output.count >= input.count,
              curve.isEmpty || (2...8192).contains(curve.count) else { return false }
        let count = input.count
        twice.withUnsafeMutableBufferPointer { a in
            fourTimes.withUnsafeMutableBufferPointer { b in
                up1.process(input.baseAddress!, into: a.baseAddress!, count: count)
                up2.process(a.baseAddress!, into: b.baseAddress!, count: count * 2)
                WebAudioWaveShaper.process(b.baseAddress!, count: count * 4, curve: curve)
                down2.process(b.baseAddress!, into: a.baseAddress!, count: count * 4)
                down1.process(a.baseAddress!, into: output.baseAddress!, count: count * 2)
            }
        }
        return true
    }
}

private final class HalfBand {
    private let up: Bool
    private let kernel: [Float]
    private var raw: [Float]
    private var odd: [Float]

    init(up: Bool, maximumInput: Int) {
        self.up = up
        // Up: 128-tap fractional sinc. Down: odd coefficients of a 256-tap half-band sinc.
        kernel = (0..<128).map { index in
            let position = up ? Double(index) + 0.5 : Double(index * 2 + 1)
            let size = up ? 128.0 : 256.0
            let argument = (up ? 1.0 : 0.5) * Double.pi * (position - size / 2)
            let sinc = (argument == 0 ? 1 : sin(argument) / argument) * (up ? 1 : 0.5)
            let phase = 2 * Double.pi * position / size
            return Float(sinc * (0.42 - 0.5 * cos(phase) + 0.08 * cos(2 * phase)))
        }
        raw = [Float](repeating: 0, count: (up ? 127 : 128) + maximumInput)
        odd = up ? [] : [Float](repeating: 0, count: 127 + maximumInput / 2)
    }
    func reset() {
        for i in raw.indices { raw[i] = 0 }
        for i in odd.indices { odd[i] = 0 }
    }
    func process(_ source: UnsafePointer<Float>, into destination: UnsafeMutablePointer<Float>, count: Int) {
        raw.withUnsafeMutableBufferPointer { history in
            let p = history.baseAddress!, prefix = up ? 127 : 128
            for i in 0..<count { p[prefix + i] = source[i].isFinite ? source[i] : 0 }
            kernel.withUnsafeBufferPointer { coefficients in
                if up {
                    vDSP_conv(p, 1, coefficients.baseAddress! + 127, -1, destination + 1, 2, vDSP_Length(count), 128)
                    for i in 0..<count { destination[i * 2] = p[127 + i - 64] }
                } else {
                    odd.withUnsafeMutableBufferPointer { reduced in
                        let q = reduced.baseAddress!, length = count / 2
                        for i in 0..<length { q[127 + i] = p[128 + i * 2 - 1] }
                        vDSP_conv(q, 1, coefficients.baseAddress! + 127, -1, destination, 1, vDSP_Length(length), 128)
                        for i in 0..<length { destination[i] += 0.5 * p[i * 2] }
                        memmove(q, q + length, 127 * MemoryLayout<Float>.size)
                    }
                }
            }
            memmove(p, p + count, prefix * MemoryLayout<Float>.size)
        }
    }
}
