#include <onnxruntime_cxx_api.h>
#include <chrono>
#include <fstream>
#include <iostream>
#include <mach/mach.h>
#include <stdexcept>
#include <sys/resource.h>
#include <thread>
#include <vector>

// Independent macOS / isolated iOS QA gate, never linked into the personal App.
// Invoke only after checking the runtime/model SHA256s in AUTOMIX_RUNTIME_DECISION.md.
// Arguments: model [input.f32 output-prefix [runs [no-memory-pattern [cancel-once]]]].
int main(int argc, char** argv) {
    if (argc != 2 && (argc < 4 || argc > 7)) {
        std::cerr << "usage: probe model [input.f32 output-prefix [runs [no-memory-pattern [cancel-once]]]]\n"; return 2;
    }
    const auto started = std::chrono::steady_clock::now();
    auto checkpoint = [&](const char* stage) {
        rusage usage{};
        if (getrusage(RUSAGE_SELF, &usage) != 0) throw std::runtime_error("getrusage failed");
        task_vm_info_data_t memory{};
        mach_msg_type_number_t count = TASK_VM_INFO_COUNT;
        if (task_info(mach_task_self(), TASK_VM_INFO, reinterpret_cast<task_info_t>(&memory), &count) != KERN_SUCCESS)
            throw std::runtime_error("task_info failed");
        std::cout << stage << " elapsed_ms=" << std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - started).count() << " peak_rss_bytes=" << usage.ru_maxrss
            << " footprint_bytes=" << memory.phys_footprint
            << " peak_footprint_bytes=" << memory.ledger_phys_footprint_peak << std::endl;
    };
    try {
        size_t runs = 1;
        if (argc >= 5) {
            size_t consumed = 0;
            runs = std::stoul(argv[4], &consumed);
            if (consumed != std::string(argv[4]).size() || runs < 1 || runs > 8)
                throw std::runtime_error("runs must be an integer from 1 to 8");
        }
        if (argc >= 6 && std::string(argv[5]) != "no-memory-pattern")
            throw std::runtime_error("unsupported memory option");
        if (argc == 7 && std::string(argv[6]) != "cancel-once")
            throw std::runtime_error("unsupported cancellation option");
        std::cout << "ORT " << OrtGetApiBase()->GetVersionString() << std::endl;
        Ort::Env environment(ORT_LOGGING_LEVEL_WARNING, "folia-independent-probe");
        Ort::SessionOptions options;
        options.SetIntraOpNumThreads(2).SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
        // Public CPU-arena control is available; it does not replace Python's enable_mem_reuse=False.
        options.DisableCpuMemArena();
        // Public pattern allocation is distinct from the unavailable internal memory-reuse flag.
        if (argc >= 6) options.DisableMemPattern();
        std::cout << "runs=" << runs << " memory_pattern=" << (argc >= 6 ? "disabled" : "default") << std::endl;
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
        Ort::RunOptions runOptions;
        if (argc == 7) {
            // Exercise actual cancellation from another thread, then reuse the same session/options.
            std::exception_ptr cancellationError;
            std::exception_ptr runError;
            std::thread cancel([&] {
                std::this_thread::sleep_for(std::chrono::milliseconds(25));
                try { runOptions.SetTerminate(); } catch (...) { cancellationError = std::current_exception(); }
            });
            bool cancelled = false;
            try {
                session.Run(runOptions, inputNames, &tensor, 1, outputNames.data(), outputNames.size());
            } catch (const Ort::Exception& error) {
                cancelled = std::string(error.what()).find("terminate") != std::string::npos;
                if (!cancelled) runError = std::current_exception();
            } catch (...) { runError = std::current_exception(); }
            cancel.join();
            if (cancellationError) std::rethrow_exception(cancellationError);
            if (runError) std::rethrow_exception(runError);
            if (!cancelled) throw std::runtime_error("expected live inference cancellation");
            checkpoint("cancelled");
            runOptions.UnsetTerminate();
        }
        std::vector<Ort::Value> result;
        for (size_t run = 0; run < runs; ++run) {
            result.clear();
            result = session.Run(runOptions, inputNames, &tensor, 1, outputNames.data(), outputNames.size());
            checkpoint(("ran_" + std::to_string(run + 1)).c_str());
        }
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
