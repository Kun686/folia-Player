#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <stdexcept>
#include <vector>

// FoliaStemWindow.hpp — shared production/probe adaptation of htdemucs_runner.py::separate.
// The caller owns one model session; run(chunk, consume) keeps each output alive until accumulation ends.
template<class Run, class Checkpoint>
std::vector<float> foliaStemWindow(const std::vector<float>& samples, size_t segment,
                                   Run run, Checkpoint checkpoint) {
    #pragma clang fp contract(off)
    if (samples.empty() || samples.size() % 2 || samples.size() > 30 * 44100 * 2 ||
        segment < 8 || segment > 1000000) throw std::invalid_argument("invalid stem window");
    for (float value : samples) if (!std::isfinite(value)) throw std::invalid_argument("non-finite window input");
    const size_t total = samples.size() / 2, overlap = segment / 4, stride = segment - overlap;
    const size_t chunks = (total + stride - 1) / stride;
    checkpoint(0);
    std::vector<float> window(segment, 1.0f), weight(total, 0.0f), accumulator(6 * total, 0.0f), chunk(2 * segment);
    for (size_t i = 0; i < overlap; ++i) {
        window[i] = static_cast<float>(i) / static_cast<float>(overlap - 1);
        window[segment - 1 - i] = window[i];
    }
    constexpr std::array<size_t, 3> returned = {0, 1, 3}; // drums, bass, vocals; model row 2 is not used.
    for (size_t c = 0; c < chunks; ++c) {
        const size_t start = c * stride, frames = std::min(segment, total - start);
        std::fill(chunk.begin(), chunk.end(), 0.0f);
        for (size_t channel = 0; channel < 2; ++channel)
            std::copy_n(samples.begin() + channel * total + start, frames, chunk.begin() + channel * segment);
        run(chunk, [&](const float* values, size_t count) {
            if (!values || count != 8 * segment) throw std::runtime_error("invalid stem output size");
            for (size_t track = 0; track < returned.size(); ++track) {
                for (size_t channel = 0; channel < 2; ++channel) {
                    const auto from = values + (returned[track] * 2 + channel) * segment;
                    auto to = accumulator.data() + (track * 2 + channel) * total + start;
                    for (size_t i = 0; i < frames; ++i) {
                        if (!std::isfinite(from[i])) throw std::runtime_error("non-finite stem output");
                        to[i] += from[i] * window[i];
                    }
                }
            }
        });
        for (size_t i = 0; i < frames; ++i) weight[start + i] += window[i];
        checkpoint(c + 1);
    }
    for (size_t track = 0; track < returned.size(); ++track) {
        auto values = accumulator.data() + track * 2 * total;
        for (size_t channel = 0; channel < 2; ++channel) {
            for (size_t i = 0; i < total; ++i) {
                values[channel * total + i] /= std::max(weight[i], 1e-8f);
                if (!std::isfinite(values[channel * total + i])) throw std::runtime_error("non-finite stitched output");
            }
        }
        checkpoint(chunks);
    }
    return accumulator;
}
