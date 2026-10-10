/*
 * Copyright (C) 2011 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1.  Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
 * ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import Foundation

// WebAudioWaveShaper.swift — Float32 curve interpolation, adapted from the pinned WebKit WaveShaperDSPKernel.
enum WebAudioWaveShaper {
    static func process(_ data: UnsafeMutablePointer<Float>, count: Int, curve: UnsafeBufferPointer<Float>) {
        guard count > 0, !curve.isEmpty, (2...8192).contains(curve.count) else { return }
        for i in 0..<count {
            let input = data[i]
            guard input.isFinite else { data[i] = 0; continue }
            let position = Float(curve.count - 1) * 0.5 * (min(1, max(-1, input)) + 1)
            if position >= Float(curve.count - 1) { data[i] = curve[curve.count - 1] }
            else {
                let index = Int(position), fraction = position - Float(index)
                data[i] = (1 - fraction) * curve[index] + fraction * curve[index + 1]
            }
        }
    }
}
