#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <fstream>
#include <vector>
#include "../../ios/App/App/FoliaStemWindow.hpp"

// dev/mobile/automix-window-probe.hpp — isolated adaptation of htdemucs_runner.py::separate.
// Same segment-derived quarter overlap, float32 window accumulation and returned track order.
// Production and this independent file-based probe now call the same pure overlap-add helper.
template<class Checkpoint>
void foliaProbeStemWindow(Ort::Session& session, const char* inputPath, const char* outputPrefix, Checkpoint checkpoint) {
    #pragma clang fp contract(off)
    const auto shape = session.GetInputTypeInfo(0).GetTensorTypeAndShapeInfo().GetShape();
    if (shape.size() != 3 || shape[0] != 1 || shape[1] != 2 || shape[2] < 8 || shape[2] > 1000000 ||
        session.GetOutputCount() != 1) throw std::runtime_error("unsupported stem model shape");
    const size_t segment = static_cast<size_t>(shape[2]);
    const size_t overlap = segment / 4, stride = segment - overlap;
    std::ifstream input(inputPath, std::ios::binary | std::ios::ate);
    if (!input) throw std::runtime_error("window input open failed");
    const auto bytes = input.tellg();
    if (bytes <= 0 || bytes % 8 != 0 || bytes > 30 * 44100 * 8)
        throw std::runtime_error("window must be nonempty planar float32 stereo, at most 30 seconds");
    const size_t total = static_cast<size_t>(bytes) / 8;
    std::vector<float> samples(2 * total);
    input.seekg(0);
    if (!input.read(reinterpret_cast<char*>(samples.data()), bytes)) throw std::runtime_error("window read failed");
    for (float value : samples) if (!std::isfinite(value)) throw std::runtime_error("non-finite window input");
    Ort::AllocatorWithDefaultOptions allocator;
    auto inputName = session.GetInputNameAllocated(0, allocator);
    auto outputName = session.GetOutputNameAllocated(0, allocator);
    if (std::string(inputName.get()) != "mix" || std::string(outputName.get()) != "stems")
        throw std::runtime_error("expected original htdemucs names");
    const char* inputs[] = {inputName.get()};
    const char* outputs[] = {outputName.get()};
    const auto memory = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
    const size_t chunks = (total + stride - 1) / stride;
    std::cout << "window_frames=" << total << " segment=" << segment << " overlap=" << overlap
        << " stride=" << stride << " chunks=" << chunks << std::endl;
    checkpoint("window_before_run");
    auto accumulator = foliaStemWindow(samples, segment, [&](auto& chunk, auto consume) {
        auto tensor = Ort::Value::CreateTensor<float>(memory, chunk.data(), chunk.size(), shape.data(), shape.size());
        const auto result = session.Run(Ort::RunOptions{nullptr}, inputs, &tensor, 1, outputs, 1);
        const auto info = result[0].GetTensorTypeAndShapeInfo();
        if (info.GetElementType() != ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT ||
            info.GetShape() != std::vector<int64_t>({1, 4, 2, static_cast<int64_t>(segment)}))
            throw std::runtime_error("invalid stem output shape/type");
        consume(result[0].template GetTensorData<float>(), info.GetElementCount());
    }, [&](size_t completed) {
        checkpoint(("window_completed_" + std::to_string(completed)).c_str());
    });
    constexpr std::array<const char*, 3> names = {"drums", "bass", "vocals"};
    for (size_t track = 0; track < names.size(); ++track) {
        auto values = accumulator.data() + track * 2 * total;
        const std::string path = std::string(outputPrefix) + "." + names[track] + ".f32";
        std::ofstream output(path, std::ios::binary);
        if (!output.write(reinterpret_cast<const char*>(values), 2 * total * sizeof(float)))
            throw std::runtime_error("stitched output write failed");
        output.close();
        if (!output) throw std::runtime_error("stitched output flush failed");
    }
    checkpoint("window_saved");
}
