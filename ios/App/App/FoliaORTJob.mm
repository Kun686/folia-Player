#import "FoliaORTJob.h"
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
    std::mutex _lock;
    std::unique_ptr<Ort::RunOptions> _options;
}
- (instancetype)init {
    self = [super init];
    if (self) { _cancelled.store(false); _used.store(false); _running.store(false); }
    return self;
}
+ (NSString *)runtimeVersion { return @(OrtGetApiBase()->GetVersionString()); }
- (BOOL)cancelled { return _cancelled.load(); }
- (BOOL)running { return _running.load(); }
- (void)cancel {
    _cancelled.store(true);
    std::lock_guard<std::mutex> guard(_lock);
    // ORT documents SetTerminate as callable from a separate thread while Run is in progress.
    if (_options) { try { _options->SetTerminate(); } catch (...) {} }
}
- (NSArray<NSData *> *)runModel:(NSURL *)model kind:(NSString *)kind input:(NSData *)input
                        frames:(NSInteger)frames error:(NSError **)error {
    auto fail = [&](NSString *code) -> NSArray<NSData *> * {
        if (error) *error = [NSError errorWithDomain:@"FoliaORT" code:1 userInfo:@{NSLocalizedDescriptionKey: code}];
        return nil;
    };
    if (NSThread.isMainThread) return fail(@"ort-main-thread-forbidden");
    if (_used.exchange(true)) return fail(@"ort-job-already-used");
    const bool beat = [kind isEqualToString:@"beat_this"];
    if (!beat && ![kind isEqualToString:@"htdemucs"]) return fail(@"ort-unsupported-model");
    if (!model.isFileURL || frames < 1 || (beat ? frames > 1500 : frames != 172032)) return fail(@"ort-invalid-input");
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
        const std::vector<int64_t> shape = beat ? std::vector<int64_t>{1, frames, 128} : std::vector<int64_t>{1, 2, frames};
        const char *inputName = beat ? "input_spectrogram" : "mix";
        const char *outputNames[] = {beat ? "beat" : "stems", "downbeat"};
        if (session.GetInputCount() != 1 || session.GetOutputCount() != (beat ? 2 : 1)) return fail(@"ort-model-contract-mismatch");
        auto memory = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
        auto tensor = Ort::Value::CreateTensor<float>(memory, samples.data(), samples.size(), shape.data(), shape.size());
        {
            std::lock_guard<std::mutex> guard(_lock);
            _options = std::make_unique<Ort::RunOptions>();
            if (_cancelled.load()) return fail(@"ort-cancelled");
        }
        _running.store(true);
        auto result = session.Run(*_options, &inputName, &tensor, 1, outputNames, beat ? 2 : 1);
        _running.store(false);
        if (_cancelled.load()) return fail(@"ort-cancelled");
        NSMutableArray<NSData *> *outputs = [NSMutableArray new];
        for (auto &value : result) {
            if (!value.IsTensor()) return fail(@"ort-invalid-output");
            auto type = value.GetTensorTypeAndShapeInfo();
            const auto expected = beat ? std::vector<int64_t>{1, frames} : std::vector<int64_t>{1, 4, 2, frames};
            if (type.GetElementType() != ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT || type.GetShape() != expected)
                return fail(@"ort-invalid-output");
            const float *data = value.GetTensorData<float>();
            for (size_t i = 0; i < type.GetElementCount(); ++i) if (!std::isfinite(data[i])) return fail(@"ort-invalid-output");
            [outputs addObject:[NSData dataWithBytes:data length:type.GetElementCount() * sizeof(float)]];
        }
        return outputs; // Tensors, session, environment and work buffers die before returning to Swift.
    } catch (const std::exception &) {
        _running.store(false);
        return fail(_cancelled.load() ? @"ort-cancelled" : @"ort-inference-failed");
    } catch (...) { _running.store(false); return fail(@"ort-inference-failed"); }
}
@end
