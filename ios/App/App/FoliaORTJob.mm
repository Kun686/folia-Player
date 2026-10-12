#import "FoliaORTJob.h"
#include "FoliaStemWindow.hpp"
#include <onnxruntime/onnxruntime_cxx_api.h>
#include <atomic>
#include <cmath>
#include <mutex>
#include <vector>

// FoliaORTJob.mm — thin official ORT boundary, with no alternative preprocessing or model algorithms.
@implementation FoliaORTJob {
    std::atomic_bool _cancelled;
    std::atomic_bool _used;
    std::atomic_bool _running;
    std::atomic_size_t _completedSegments;
    std::mutex _lock;
    std::unique_ptr<Ort::RunOptions> _options;
}
- (instancetype)init {
    self = [super init];
    if (self) { _cancelled.store(false); _used.store(false); _running.store(false); _completedSegments.store(0); }
    return self;
}
+ (NSString *)runtimeVersion { return @(OrtGetApiBase()->GetVersionString()); }
- (BOOL)cancelled { return _cancelled.load(); }
- (BOOL)running { return _running.load(); }
- (NSUInteger)completedSegments { return _completedSegments.load(); }
- (void)cancel {
    _cancelled.store(true);
    std::lock_guard<std::mutex> guard(_lock);
    // ORT documents SetTerminate as callable from a separate thread while Run is in progress.
    if (_options) { try { _options->SetTerminate(); } catch (...) {} }
}
- (NSArray<NSData *> *)runModel:(NSURL *)model kind:(NSString *)kind input:(NSData *)input
                        frames:(NSInteger)frames error:(NSError **)error {
    return [self runModel:model kind:kind inputs:@[input] frameCounts:@[@(frames)] window:NO error:error];
}
- (NSArray<NSData *> *)separateWindowAtModel:(NSURL *)model input:(NSData *)input
                                     frames:(NSInteger)frames error:(NSError **)error {
    return [self runModel:model kind:@"htdemucs" inputs:@[input] frameCounts:@[@(frames)] window:YES error:error];
}
- (NSArray<NSData *> *)runBeatChunksAtModel:(NSURL *)model inputs:(NSArray<NSData *> *)inputs
                                    frames:(NSArray<NSNumber *> *)frames error:(NSError **)error {
    return [self runModel:model kind:@"beat_this" inputs:inputs frameCounts:frames window:NO error:error];
}
// A full window shares this single session and RunOptions across all original overlap-add chunks.
- (NSArray<NSData *> *)runModel:(NSURL *)model kind:(NSString *)kind inputs:(NSArray<NSData *> *)inputs
                   frameCounts:(NSArray<NSNumber *> *)frameCounts window:(BOOL)window error:(NSError **)error {
    auto fail = [&](NSString *code) -> NSArray<NSData *> * {
        if (error) *error = [NSError errorWithDomain:@"FoliaORT" code:1 userInfo:@{NSLocalizedDescriptionKey: code}];
        return nil;
    };
    if (NSThread.isMainThread) return fail(@"ort-main-thread-forbidden");
    if (_used.exchange(true)) return fail(@"ort-job-already-used");
    const bool beat = [kind isEqualToString:@"beat_this"];
    if (!beat && ![kind isEqualToString:@"htdemucs"]) return fail(@"ort-unsupported-model");
    if (!model.isFileURL || inputs.count == 0 || inputs.count > (beat ? 41 : 1) || frameCounts.count != inputs.count)
        return fail(@"ort-invalid-input");
    for (NSUInteger index = 0; index < inputs.count; ++index) {
        const NSInteger n = frameCounts[index].integerValue;
        if (n < 1 || frameCounts[index].doubleValue != n || (beat ? n > 1500 : window ? n > 1323000 : n != 172032) ||
            inputs[index].length != static_cast<size_t>(n) * (beat ? 128 : 2) * sizeof(float)) return fail(@"ort-invalid-input");
    }
    NSData *input = inputs.firstObject;
    const NSInteger frames = frameCounts.firstObject.integerValue;
    const size_t count = static_cast<size_t>(frames) * (beat ? 128 : 2);
    if (input.length != count * sizeof(float)) return fail(@"ort-invalid-input");
    if (_cancelled.load()) return fail(@"ort-cancelled");
    try {
        std::vector<float> samples(count);
        memcpy(samples.data(), input.bytes, input.length);
        for (float x : samples) if (!std::isfinite(x)) return fail(@"ort-invalid-input");
        Ort::Env environment(ORT_LOGGING_LEVEL_FATAL, "folia");
        Ort::SessionOptions settings;
        settings.SetIntraOpNumThreads(2).SetInterOpNumThreads(1).SetExecutionMode(ExecutionMode::ORT_SEQUENTIAL);
        settings.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
        settings.DisableCpuMemArena().DisableMemPattern();
        if (strcmp(OrtGetApiBase()->GetVersionString(), "1.30.0") != 0) return fail(@"ort-runtime-version-mismatch");
        Ort::Session session(environment, model.fileSystemRepresentation, settings);
        if (_cancelled.load()) return fail(@"ort-cancelled");
        const char *inputName = beat ? "input_spectrogram" : "mix";
        const char *outputNames[] = {beat ? "beat" : "stems", "downbeat"};
        if (session.GetInputCount() != 1 || session.GetOutputCount() != (beat ? 2 : 1)) return fail(@"ort-model-contract-mismatch");
        const auto shape = beat ? std::vector<int64_t>{1, frames, 128}
            : session.GetInputTypeInfo(0).GetTensorTypeAndShapeInfo().GetShape();
        if (!beat && (shape.size() != 3 || shape[0] != 1 || shape[1] != 2 || shape[2] < 8 ||
                      shape[2] > 1000000 || (!window && shape[2] != frames)))
            return fail(@"ort-model-contract-mismatch");
        auto memory = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
        {
            std::lock_guard<std::mutex> guard(_lock);
            _options = std::make_unique<Ort::RunOptions>();
            if (_cancelled.load()) return fail(@"ort-cancelled");
        }
        _running.store(true);
        struct ResetRunning { std::atomic_bool& flag; ~ResetRunning() { flag.store(false); } } reset{_running};
        if (window) {
            auto stitched = foliaStemWindow(samples, static_cast<size_t>(shape[2]), [&](auto& chunk, auto consume) {
                if (_cancelled.load()) throw std::runtime_error("cancelled");
                auto tensor = Ort::Value::CreateTensor<float>(memory, chunk.data(), chunk.size(), shape.data(), shape.size());
                auto result = session.Run(*_options, &inputName, &tensor, 1, outputNames, 1);
                if (!result[0].IsTensor()) throw std::runtime_error("invalid stem output");
                auto type = result[0].GetTensorTypeAndShapeInfo();
                if (type.GetElementType() != ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT ||
                    type.GetShape() != std::vector<int64_t>({1, 4, 2, shape[2]})) throw std::runtime_error("invalid stem output");
                consume(result[0].template GetTensorData<float>(), type.GetElementCount());
            }, [&](size_t completed) {
                _completedSegments.store(completed);
                if (_cancelled.load()) throw std::runtime_error("cancelled");
            });
            NSMutableArray<NSData *> *outputs = [NSMutableArray new];
            for (size_t track = 0; track < 3; ++track) {
                if (_cancelled.load()) return fail(@"ort-cancelled");
                [outputs addObject:[NSData dataWithBytes:stitched.data() + track * count length:input.length]];
            }
            return outputs;
        }
        NSMutableArray<NSData *> *outputs = [NSMutableArray new];
        // Beat This! receives original JS chunks. Keep one session, return interleaved beat/downbeat outputs.
        for (NSUInteger index = 0; index < inputs.count; ++index) {
            if (_cancelled.load()) return fail(@"ort-cancelled");
            const NSInteger n = frameCounts[index].integerValue;
            if (index > 0) {
                samples.resize(inputs[index].length / sizeof(float));
                memcpy(samples.data(), inputs[index].bytes, inputs[index].length);
                for (float x : samples) if (!std::isfinite(x)) return fail(@"ort-invalid-input");
            }
            const auto tensorShape = beat ? std::vector<int64_t>{1, n, 128} : shape;
            auto tensor = Ort::Value::CreateTensor<float>(memory, samples.data(), samples.size(), tensorShape.data(), tensorShape.size());
            auto result = session.Run(*_options, &inputName, &tensor, 1, outputNames, beat ? 2 : 1);
            if (_cancelled.load()) return fail(@"ort-cancelled");
            for (auto &value : result) {
                if (!value.IsTensor()) return fail(@"ort-invalid-output");
                auto type = value.GetTensorTypeAndShapeInfo();
                const auto expected = beat ? std::vector<int64_t>{1, n} : std::vector<int64_t>{1, 4, 2, n};
                if (type.GetElementType() != ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT || type.GetShape() != expected)
                    return fail(@"ort-invalid-output");
                const float *data = value.GetTensorData<float>();
                for (size_t i = 0; i < type.GetElementCount(); ++i) if (!std::isfinite(data[i])) return fail(@"ort-invalid-output");
                [outputs addObject:[NSData dataWithBytes:data length:type.GetElementCount() * sizeof(float)]];
            }
            _completedSegments.store(index + 1);
        }
        return outputs; // Tensors, session, environment and work buffers die before returning to Swift.
    } catch (const std::exception &) {
        _running.store(false);
        return fail(_cancelled.load() ? @"ort-cancelled" : @"ort-inference-failed");
    } catch (...) { _running.store(false); return fail(@"ort-inference-failed"); }
}
@end
