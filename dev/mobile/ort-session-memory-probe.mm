#import <Foundation/Foundation.h>
#import "FoliaORTJob.h"
#include <cmath>
#include <cstdio>
#include <cstring>
#include <condition_variable>
#include <future>
#include <malloc/malloc.h>
#include <stdexcept>
#include <thread>
#include <vector>

// ort-session-memory-probe.mm — Mac-only diagnostics using the unchanged production ORT job.
// Verify the fixed runtime, model and reference report before invoking; never linked into the App.
static NSDictionary *snapshot(NSString *phase) {
    NSMutableDictionary *row = [[FoliaORTJob new].diagnostics mutableCopy];
    malloc_statistics_t stats{};
    malloc_zone_statistics(nullptr, &stats);
    row[@"phase"] = phase;
    row[@"mallocInUseBytes"] = @(stats.size_in_use);
    row[@"mallocAllocatedBytes"] = @(stats.size_allocated);
    return row;
}

static NSData *readFile(NSURL *directory, NSString *name) {
    NSError *error = nil;
    NSData *data = [NSData dataWithContentsOfURL:[directory URLByAppendingPathComponent:name]
                                      options:0 error:&error];
    if (!data) throw std::runtime_error("fixture read failed");
    return data;
}

// Compare the same original reference outputs on every fresh session, after releasing the job.
static NSDictionary *runRound(NSURL *model, NSArray<NSData *> *inputs, NSArray<NSNumber *> *frames,
                             NSArray<NSData *> *reference, NSUInteger round) {
    NSDictionary *timing;
    float maximum = 0;
    @autoreleasepool {
        FoliaORTJob *job = [FoliaORTJob new];
        NSError *error = nil;
        NSArray<NSData *> *output = [job runBeatChunksAtModel:model inputs:inputs frames:frames error:&error];
        if (!output || output.count != reference.count) throw std::runtime_error("beat inference failed");
        for (NSUInteger i = 0; i < output.count; ++i) {
            if (output[i].length != reference[i].length || output[i].length % sizeof(float))
                throw std::runtime_error("output size mismatch");
            for (NSUInteger offset = 0; offset < output[i].length; offset += sizeof(float)) {
                float actual, expected;
                memcpy(&actual, static_cast<const char *>(output[i].bytes) + offset, sizeof(float));
                memcpy(&expected, static_cast<const char *>(reference[i].bytes) + offset, sizeof(float));
                if (!std::isfinite(actual) || !std::isfinite(expected)) throw std::runtime_error("nonfinite output");
                maximum = std::max(maximum, std::abs(actual - expected));
            }
        }
        if (maximum > 0.0001f) throw std::runtime_error("original output tolerance exceeded");
        timing = job.diagnostics;
    }
    NSMutableDictionary *row = [snapshot([NSString stringWithFormat:@"round-%lu", (unsigned long)round]) mutableCopy];
    row[@"loadSeconds"] = timing[@"loadSeconds"];
    row[@"runSeconds"] = timing[@"runSeconds"];
    row[@"completedSegments"] = timing[@"completedSegments"];
    row[@"maxAbsError"] = @(maximum);
    printf("round=%lu footprint=%llu mallocInUse=%llu error=%.9g\n", (unsigned long)round,
           [row[@"footprintBytes"] unsignedLongLongValue], [row[@"mallocInUseBytes"] unsignedLongLongValue], maximum);
    fflush(stdout);
    return row;
}

int main(int argc, const char **argv) {
    if (argc != 5 || (strcmp(argv[4], "shared") && strcmp(argv[4], "retained") && strcmp(argv[4], "joined"))) {
        fprintf(stderr, "usage: probe verified-fixture-directory model.onnx NEW-report.json shared|retained|joined\n"); return 2;
    }
    @autoreleasepool {
        if (strcmp(FoliaORTJob.runtimeVersion.UTF8String, "1.30.0")) return 2;
        NSURL *directory = [NSURL fileURLWithPath:@(argv[1]) isDirectory:YES];
        NSURL *model = [NSURL fileURLWithPath:@(argv[2])];
        NSURL *destination = [NSURL fileURLWithPath:@(argv[3])];
        if ([[NSFileManager defaultManager] fileExistsAtPath:destination.path]) return 2;
        try {
            NSDictionary *report = [NSJSONSerialization JSONObjectWithData:readFile(directory, @"report.json") options:0 error:nil];
            NSArray *chunks = report[@"chunks"];
            if (![chunks isKindOfClass:NSArray.class] || chunks.count < 1 || chunks.count > 41)
                throw std::runtime_error("invalid chunk report");
            NSMutableArray *inputs = [NSMutableArray new], *frames = [NSMutableArray new], *reference = [NSMutableArray new];
            for (NSUInteger i = 0; i < chunks.count; ++i) {
                [inputs addObject:readFile(directory, [NSString stringWithFormat:@"input-%lu.f32", (unsigned long)i])];
                [frames addObject:chunks[i][@"frames"]];
                for (NSString *name in @[@"beat", @"downbeat"])
                    [reference addObject:readFile(directory, [NSString stringWithFormat:@"%@-%lu.f32", name, (unsigned long)i])];
            }
            NSMutableArray *rows = [NSMutableArray arrayWithObject:snapshot(@"baseline")];
            std::exception_ptr failure;
            printf("runtime=1.30.0 pid=%d chunks=%lu\n", NSProcessInfo.processInfo.processIdentifier, (unsigned long)chunks.count);
            fflush(stdout);
            // The production API forbids the main thread. One real worker also avoids dispatch_sync inlining.
            const bool shared = !strcmp(argv[4], "shared"), retained = !strcmp(argv[4], "retained");
            std::vector<std::thread> workers;
            std::mutex mutex; std::condition_variable release; bool done = false;
            try {
                for (NSUInteger i = 0; i < (shared ? 1 : 3); ++i) {
                    std::promise<void> completed; auto future = completed.get_future();
                    workers.emplace_back([&, i, completed = std::move(completed)]() mutable {
                        @autoreleasepool {
                            try {
                                if (shared) for (NSUInteger round = 0; round < 3; ++round)
                                    [rows addObject:runRound(model, inputs, frames, reference, round)];
                                else [rows addObject:runRound(model, inputs, frames, reference, i)];
                            } catch (...) { failure = std::current_exception(); }
                        }
                        completed.set_value();
                        if (retained) {
                            std::unique_lock<std::mutex> lock(mutex);
                            release.wait_for(lock, std::chrono::seconds(30), [&] { return done; });
                        }
                    });
                    future.get(); // Each job finishes before the next begins, even when old threads remain alive.
                    if (!retained) {
                        workers.back().join();
                        [rows addObject:snapshot([NSString stringWithFormat:@"joined-%lu", (unsigned long)i])];
                    }
                    if (failure) break;
                }
            } catch (...) { failure = std::current_exception(); }
            { std::lock_guard<std::mutex> lock(mutex); done = true; }
            release.notify_all();
            for (auto& worker : workers) if (worker.joinable()) worker.join();
            if (failure) std::rethrow_exception(failure);
            [rows addObject:snapshot(@"worker-joined")];
            NSData *data = [NSJSONSerialization dataWithJSONObject:@{
                @"scope": @"macOS diagnostic; unchanged FoliaORTJob; original fixed references; no iOS acceptance",
                @"runtime": FoliaORTJob.runtimeVersion, @"threadMode": @(argv[4]), @"samples": rows
            } options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys error:nil];
            NSError *error = nil;
            if (!data || ![data writeToURL:destination options:NSDataWritingWithoutOverwriting error:&error])
                throw std::runtime_error("report write failed");
            return 0;
        } catch (const std::exception& error) { fprintf(stderr, "FAILED: %s\n", error.what()); return 1; }
    }
}
