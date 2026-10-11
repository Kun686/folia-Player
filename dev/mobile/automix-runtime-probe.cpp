#include <onnxruntime_cxx_api.h>
#include <chrono>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <sys/resource.h>
#include <vector>

// dev/mobile/automix-runtime-probe.cpp — independent macOS compatibility gate, never linked into the App.
// Invoke only after checking the runtime/model SHA256s in AUTOMIX_RUNTIME_DECISION.md.
// Arguments: model [input.f32 output-prefix]; fixed input shapes follow the existing model contract.
int main(int argc, char** argv) {
    if (argc != 2 && argc != 4) { std::cerr << "usage: probe model [input.f32 output-prefix]\n"; return 2; }
    const auto started = std::chrono::steady_clock::now();
    auto checkpoint = [&](const char* stage) {
        rusage usage{};
        if (getrusage(RUSAGE_SELF, &usage) != 0) throw std::runtime_error("getrusage failed");
        std::cout << stage << " elapsed_ms=" << std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - started).count() << " peak_rss_bytes=" << usage.ru_maxrss << std::endl;
    };
    try {
        std::cout << "ORT " << OrtGetApiBase()->GetVersionString() << std::endl;
        Ort::Env environment(ORT_LOGGING_LEVEL_WARNING, "folia-independent-probe");
        Ort::SessionOptions options;
        options.SetIntraOpNumThreads(2).SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
        // Public CPU-arena control is available; it does not replace Python's enable_mem_reuse=False.
        options.DisableCpuMemArena();
        checkpoint("before_load");
        Ort::Session session(environment, argv[1], options);
        checkpoint("loaded");
        if (session.GetInputCount() != 1) throw std::runtime_error("expected one input");
        Ort::AllocatorWithDefaultOptions allocator;
        auto inputName = session.GetInputNameAllocated(0, allocator);
        auto inputType = session.GetInputTypeInfo(0);
        auto inputInfo = inputType.GetTensorTypeAndShapeInfo();
        auto shape = inputInfo.GetShape();
        std::cout << "input " << inputName.get() << " type=" << inputInfo.GetElementType() << " shape=";
        for (auto dimension : shape) std::cout << dimension << ',';
        std::cout << std::endl;
        std::vector<Ort::AllocatedStringPtr> names;
        std::vector<const char*> outputNames;
        for (size_t i = 0; i < session.GetOutputCount(); ++i) {
            names.push_back(session.GetOutputNameAllocated(i, allocator));
            outputNames.push_back(names.back().get());
            std::cout << "output " << outputNames.back() << std::endl;
        }
        if (argc == 2) return 0;
        if (inputInfo.GetElementType() != ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT) throw std::runtime_error("expected float32 input");
        if (std::string(inputName.get()) == "input_spectrogram") shape = {1, 1500, 128};
        size_t count = 1;
        for (auto dimension : shape) {
            if (dimension <= 0 || dimension > 1000000 || count > 10000000 / dimension) throw std::runtime_error("unsupported input shape");
            count *= dimension;
        }
        std::ifstream input(argv[2], std::ios::binary | std::ios::ate);
        if (!input || input.tellg() != static_cast<std::streamoff>(count * sizeof(float))) throw std::runtime_error("input size mismatch");
        input.seekg(0);
        std::vector<float> samples(count);
        if (!input.read(reinterpret_cast<char*>(samples.data()), count * sizeof(float))) throw std::runtime_error("input read failed");
        auto memory = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
        auto tensor = Ort::Value::CreateTensor<float>(memory, samples.data(), samples.size(), shape.data(), shape.size());
        const char* inputNames[] = {inputName.get()};
        checkpoint("before_run");
        auto result = session.Run(Ort::RunOptions{nullptr}, inputNames, &tensor, 1, outputNames.data(), outputNames.size());
        checkpoint("ran");
        for (size_t i = 0; i < result.size(); ++i) {
            auto info = result[i].GetTensorTypeAndShapeInfo();
            if (info.GetElementType() != ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT) throw std::runtime_error("expected float32 output");
            const auto length = info.GetElementCount();
            std::ofstream output(std::string(argv[3]) + "." + std::to_string(i) + ".f32", std::ios::binary);
            if (!output.write(reinterpret_cast<const char*>(result[i].GetTensorData<float>()), length * sizeof(float))) throw std::runtime_error("output write failed");
            std::cout << "saved " << outputNames[i] << " floats=" << length << std::endl;
        }
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "FAILED: " << error.what() << std::endl;
        return 1;
    }
}
