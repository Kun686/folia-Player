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

import AVFoundation

// WebAudioCompressor.swift — stereo-linked WebKit envelope with 32-frame divisions independent of callback size.
final class WebAudioCompressor {
    private var curve = WebAudioCompressorCurve()
    private var channels = 0, readIndex = 0, writeIndex = 0, divisionFrame = 0
    private var delay: [Float] = []
    private var detector: Float = 0, gain: Float = 1, maximumAttack: Float = -1
    private var desired: Float = 0, envelope: Float = 0, attackFrames: Float = 0, detectorReleaseFrames: Float = 0
    private var releaseA: Float = 0, releaseB: Float = 0, releaseC: Float = 0, releaseD: Float = 0, releaseE: Float = 0
    private var meterRelease: Float = 0
    private(set) var reduction: Float = 1
    private(set) var latencyFrames = 0
    private(set) var available = false

    func prepare(rate: Double, channels: Int) {
        unprepare()
        guard AudioEffectSources.validRate(rate), (1...2).contains(channels) else { return }
        self.channels = channels; delay = [Float](repeating: 0, count: channels * 1024)
        let frequency = Float(rate)
        latencyFrames = min(1023, Int(Float(0.006) * frequency))
        attackFrames = 0.008 * frequency; detectorReleaseFrames = 0.0025 * frequency
        meterRelease = Float(1 - exp(-1 / (Double(Float(0.325)) * rate)))
        let releaseFrames: Float = frequency * 0.18
        let y1: Float = releaseFrames * 0.09, y2: Float = releaseFrames * 0.16
        let y3: Float = releaseFrames * 0.42, y4: Float = releaseFrames * 0.98
        releaseA = 0.9999999999999998 * y1 + 1.8432219684323923e-16 * y2 - 1.9373394351676423e-16 * y3 + 8.824516011816245e-18 * y4
        releaseB = -1.5788320352845888 * y1 + 2.3305837032074286 * y2 - 0.9141194204840429 * y3 + 0.1623677525612032 * y4
        releaseC = 0.5334142869106424 * y1 - 1.272736789213631 * y2 + 0.9258856042207512 * y3 - 0.18656310191776226 * y4
        releaseD = 0.08783463138207234 * y1 - 0.1694162967925622 * y2 + 0.08588057951595272 * y3 - 0.00429891410546283 * y4
        releaseE = -0.042416883008123074 * y1 + 0.1115693827987602 * y2 - 0.09764676325265872 * y3 + 0.028494263462021576 * y4
        curve = WebAudioCompressorCurve(); curve.set(threshold: 0, knee: 30, ratio: 1)
        available = true; reset()
    }
    func unprepare() { available = false; delay.removeAll(); channels = 0; latencyFrames = 0 }
    func reset() {
        for i in delay.indices { delay[i] = 0 }
        readIndex = 0; writeIndex = latencyFrames; divisionFrame = 0
        detector = 0; gain = 1; maximumAttack = -1; reduction = 1; desired = 0; envelope = 0
    }
    // Parameters are sampled by the wrapper once per Web Audio quantum, not on each hardware callback.
    func set(threshold: Float, knee: Float, ratio: Float) {
        guard threshold.isFinite, (-100...0).contains(threshold), knee.isFinite, (0...40).contains(knee),
              ratio.isFinite, (1...20).contains(ratio) else { return }
        curve.set(threshold: threshold, knee: knee, ratio: ratio)
    }
    private func beginDivision() {
        if !detector.isFinite { detector = 1 }
        desired = asinf(detector) / (0.5 * Float.pi)
        var difference = WebAudioCompressorCurve.db(gain / desired)
        if desired > gain {
            maximumAttack = -1
            if !difference.isFinite { difference = -1 }
            let x: Float = 0.25 * (min(0, max(-12, difference)) + 12), x2 = x * x
            let frames = releaseA + releaseB * x + releaseC * x2 + releaseD * (x2 * x) + releaseE * (x2 * x2)
            envelope = WebAudioCompressorCurve.linear(5 / frames)
        } else {
            if !difference.isFinite { difference = 1 }
            if maximumAttack == -1 || maximumAttack < difference { maximumAttack = difference }
            envelope = 1 - powf(0.25 / max(0.5, maximumAttack), 1 / attackFrames)
        }
    }
    // Caller supplies one complete planar/interleaved frame; both channels use the same detector and gain.
    func processFrame(left: inout Float, right: inout Float) {
        guard available else { return }
        if divisionFrame == 0 { beginDivision() }
        let l = left.isFinite ? left : 0, r = right.isFinite ? right : 0
        delay[writeIndex] = l
        if channels == 2 { delay[1024 + writeIndex] = r }
        let input = channels == 2 ? max(abs(l), abs(r)) : abs(l)
        let attenuation: Float = input <= 0.0001 ? 1 : curve.saturate(input) / input
        let attenuationDB = max(2, -WebAudioCompressorCurve.db(attenuation))
        let release = WebAudioCompressorCurve.linear(attenuationDB / detectorReleaseFrames) - 1
        detector += (attenuation - detector) * (attenuation > detector ? release : 1)
        detector = min(1, detector)
        if !detector.isFinite { detector = 1 }
        if envelope < 1 { gain += (desired - gain) * envelope }
        else { gain = min(1, gain * envelope) }
        let warped = sinf(0.5 * Float.pi * gain), total = curve.makeup * warped
        let realDB = 20 * log10f(warped)
        if realDB < reduction { reduction = realDB }
        else { reduction += (realDB - reduction) * meterRelease }
        left = delay[readIndex] * total
        right = channels == 2 ? delay[1024 + readIndex] * total : left
        readIndex = (readIndex + 1) & 1023; writeIndex = (writeIndex + 1) & 1023
        divisionFrame = (divisionFrame + 1) & 31
        if divisionFrame == 0 {
            if abs(detector) < Float.leastNormalMagnitude { detector = 0 }
            if abs(gain) < Float.leastNormalMagnitude { gain = 0 }
        }
    }
}
