#import <UIKit/UIKit.h>
#include <cstdio>
#include <string>
#include <vector>

// Isolated QA host only. Reuses the exact C++ probe with bundled, hash-verified fixtures.
// The generated QA project and ORT binary live outside the personal App's project.
#define main foliaAutomixProbeMain
#include "automix-runtime-probe.cpp"
#undef main

@interface FoliaORTProbeDelegate : UIResponder <UIApplicationDelegate>
@property(strong, nonatomic) UIWindow *window;
@property(strong, nonatomic) UILabel *label;
@property(copy, nonatomic) NSString *resultPath;
@property(copy, nonatomic) NSString *model;
@property(nonatomic) NSUInteger memoryWarnings;
@property(nonatomic) BOOL finished;
@property(nonatomic) BOOL cancelOnce;
@end

@implementation FoliaORTProbeDelegate
- (void)saveResult:(NSString *)status exitCode:(int)code {
    task_vm_info_data_t memory{};
    mach_msg_type_number_t count = TASK_VM_INFO_COUNT;
    kern_return_t memoryResult = task_info(mach_task_self(), TASK_VM_INFO,
        reinterpret_cast<task_info_t>(&memory), &count);
    NSDictionary *result = @{
        @"status": status, @"exitCode": @(code), @"model": self.model ?: @"unknown",
        @"runtime": @(OrtGetApiBase()->GetVersionString()),
        @"system": UIDevice.currentDevice.systemVersion,
        @"memoryWarnings": @(self.memoryWarnings), @"memoryResult": @(memoryResult),
        @"footprintBytes": @(memory.phys_footprint), @"peakFootprintBytes": @(memory.ledger_phys_footprint_peak),
        @"runs": @3, @"memoryPattern": @"disabled", @"cancelOnce": @(self.cancelOnce),
        @"timestamp": @(NSDate.date.timeIntervalSince1970)
    };
    NSError *error;
    NSData *json = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted error:&error];
    if (!json || ![json writeToFile:self.resultPath options:NSDataWritingAtomic error:&error]) {
        self.label.text = [NSString stringWithFormat:@"QA report failed: %@", error.localizedDescription];
        return;
    }
    self.label.text = [NSString stringWithFormat:@"Folia Automix QA\n%@\n%@\n独立探针；正式播放器未变更", self.model, status];
}

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
    self.window = [[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];
    UIViewController *controller = [UIViewController new];
    controller.view.backgroundColor = UIColor.systemBackgroundColor;
    self.label = [UILabel new];
    self.label.translatesAutoresizingMaskIntoConstraints = NO;
    self.label.numberOfLines = 0;
    self.label.textAlignment = NSTextAlignmentCenter;
    self.label.text = @"Folia Automix 独立 QA\n等待指定模型";
    [controller.view addSubview:self.label];
    [NSLayoutConstraint activateConstraints:@[
        [self.label.centerXAnchor constraintEqualToAnchor:controller.view.centerXAnchor],
        [self.label.centerYAnchor constraintEqualToAnchor:controller.view.centerYAnchor],
        [self.label.widthAnchor constraintLessThanOrEqualToAnchor:controller.view.widthAnchor multiplier:0.9]
    ]];
    self.window.rootViewController = controller;
    [self.window makeKeyAndVisible];
    NSArray<NSString *> *arguments = NSProcessInfo.processInfo.arguments;
    NSUInteger modelIndex = [arguments indexOfObject:@"--model"];
    if (modelIndex == NSNotFound || modelIndex + 1 >= arguments.count) return YES;
    self.model = arguments[modelIndex + 1];
    self.cancelOnce = [arguments containsObject:@"--cancel-once"];
    if (![@[@"htdemucs", @"beat_this"] containsObject:self.model]) {
        self.label.text = @"Unsupported QA model";
        return YES;
    }
    NSString *documents = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
    NSString *resultName = self.cancelOnce ? [self.model stringByAppendingString:@"-cancel"] : self.model;
    NSString *directory = [documents stringByAppendingPathComponent:resultName];
    NSError *error;
    if (![NSFileManager.defaultManager createDirectoryAtPath:directory withIntermediateDirectories:NO attributes:nil error:&error]) {
        self.label.text = [NSString stringWithFormat:@"QA needs a new result directory: %@", error.localizedDescription];
        return YES;
    }
    self.resultPath = [directory stringByAppendingPathComponent:@"result.json"];
    [self saveResult:@"RUNNING" exitCode:-1];
    NSString *logPath = [directory stringByAppendingPathComponent:@"probe.log"];
    if (!freopen(logPath.fileSystemRepresentation, "w", stdout) || !freopen(logPath.fileSystemRepresentation, "a", stderr)) {
        [self saveResult:@"LOG_OPEN_FAILED" exitCode:2];
        return YES;
    }
    setvbuf(stdout, nullptr, _IOLBF, 0);
    NSString *modelPath = [NSBundle.mainBundle pathForResource:self.model ofType:@"onnx"];
    NSString *inputName = [self.model isEqualToString:@"beat_this"] ? @"beat-input" : @"htdemucs-input";
    NSString *inputPath = [NSBundle.mainBundle pathForResource:inputName ofType:@"f32"];
    if (!modelPath || !inputPath) {
        [self saveResult:@"MISSING_FIXTURE" exitCode:2];
        return YES;
    }
    NSString *outputPrefix = [directory stringByAppendingPathComponent:@"output"];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 50 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        if (!self.finished) {
            [self saveResult:@"TIMEOUT" exitCode:124];
            fflush(nullptr);
            exit(124); // QA watchdog; no such behavior exists in the personal App.
        }
    });
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        @autoreleasepool {
            std::vector<std::string> args = {"FoliaORTProbe", modelPath.fileSystemRepresentation,
                inputPath.fileSystemRepresentation, outputPrefix.fileSystemRepresentation, "3", "no-memory-pattern"};
            if (self.cancelOnce) args.push_back("cancel-once");
            std::vector<char *> argv;
            for (auto& argument : args) argv.push_back(argument.data());
            int code = foliaAutomixProbeMain(static_cast<int>(argv.size()), argv.data());
            fflush(nullptr);
            dispatch_async(dispatch_get_main_queue(), ^{
                self.finished = YES;
                [self saveResult:code == 0 ? @"INFERENCE_COMPLETE_COMPARE_REQUIRED" : @"FAILED" exitCode:code];
            });
        }
    });
    return YES;
}

- (void)applicationDidReceiveMemoryWarning:(UIApplication *)application {
    self.memoryWarnings += 1;
    std::cout << "memory_warning" << std::endl;
}
@end

int main(int argc, char *argv[]) {
    @autoreleasepool { return UIApplicationMain(argc, argv, nil, NSStringFromClass(FoliaORTProbeDelegate.class)); }
}
