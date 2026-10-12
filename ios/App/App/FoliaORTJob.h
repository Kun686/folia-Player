#import <Foundation/Foundation.h>

// FoliaORTJob.h — one cancellable CPU inference; only NativeORTInference supplies verified model snapshots.
NS_ASSUME_NONNULL_BEGIN
@interface FoliaORTJob : NSObject
@property(nonatomic, readonly) BOOL cancelled;
@property(nonatomic, readonly) BOOL running;
+ (NSString *)runtimeVersion;
- (void)cancel;
- (nullable NSArray<NSData *> *)runModel:(NSURL *)model
                                  kind:(NSString *)kind
                                 input:(NSData *)input
                                frames:(NSInteger)frames
                                 error:(NSError **)error NS_SWIFT_NAME(run(model:kind:input:frames:));
@end
NS_ASSUME_NONNULL_END
