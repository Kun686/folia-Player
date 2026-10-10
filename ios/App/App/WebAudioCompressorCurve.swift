/*
 * Copyright (C) 2011 Google Inc. All rights reserved.
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

import Foundation

// WebAudioCompressorCurve.swift — static knee/ratio and perceptual makeup from the pinned WebKit compressor.
struct WebAudioCompressorCurve {
    private var threshold: Float = .nan, knee: Float = .nan, ratio: Float = .nan
    private var linearThreshold: Float = 0, kneeThreshold: Float = 0, kneeDB: Float = 0
    private var kneeOutputDB: Float = 0, slope: Float = 1, k: Float = 5
    private(set) var makeup: Float = 1

    static func db(_ linear: Float) -> Float { 20 * log10f(linear) }
    static func linear(_ db: Float) -> Float { powf(10, 0.05 * db) }

    mutating func set(threshold: Float, knee: Float, ratio: Float) {
        guard threshold != self.threshold || knee != self.knee || ratio != self.ratio else { return }
        self.threshold = threshold; self.knee = knee; self.ratio = ratio
        linearThreshold = Self.linear(threshold); slope = 1 / ratio
        let x = Self.linear(threshold + knee)
        var minimum: Float = 0.1, maximum: Float = 10000, next: Float = 5
        // Match the upper-knee derivative to the requested ratio using WebKit's geometric search.
        for _ in 0..<15 {
            if slopeAt(x, next) < slope { maximum = next } else { minimum = next }
            next = sqrtf(minimum * maximum)
        }
        k = next; kneeDB = threshold + knee; kneeThreshold = Self.linear(kneeDB)
        kneeOutputDB = Self.db(kneeCurve(kneeThreshold, k))
        makeup = powf(1 / saturate(1), 0.6)
    }
    private func kneeCurve(_ x: Float, _ k: Float) -> Float {
        x < linearThreshold ? x : linearThreshold + (1 - expf(-k * (x - linearThreshold))) / k
    }
    private func slopeAt(_ x: Float, _ k: Float) -> Float {
        if x < linearThreshold { return 1 }
        let x2 = Float(Double(x) * 1.001)
        return (Self.db(kneeCurve(x2, k)) - Self.db(kneeCurve(x, k))) / (Self.db(x2) - Self.db(x))
    }
    func saturate(_ x: Float) -> Float {
        x < kneeThreshold ? kneeCurve(x, k) : Self.linear(kneeOutputDB + slope * (Self.db(x) - kneeDB))
    }
}
