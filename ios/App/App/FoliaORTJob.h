#import <Foundation/Foundation.h>

// FoliaORTJob.h — one cancellable CPU inference; only NativeORTInference supplies verified model snapshots.
NS_ASSUME_NONNULL_BEGIN
@interface FoliaORTJob : NSObject
@property(nonatomic, readonly) BOOL cancelled;
@property(nonatomic, readonly) BOOL running;
@property(nonatomic, readonly) NSUInteger completedSegments;
+ (NSString *)runtimeVersion;
- (void)cancel;
- (nullable NSArray<NSData *> *)runModel:(NSURL *)model
                                  kind:(NSString *)kind
                                 input:(NSData *)input
                                frames:(NSInteger)frames
                                 error:(NSError **)error NS_SWIFT_NAME(run(model:kind:input:frames:));
- (nullable NSArray<NSData *> *)separateWindowAtModel:(NSURL *)model
                                               input:(NSData *)input
                                              frames:(NSInteger)frames
                                               error:(NSError **)error NS_SWIFT_NAME(separateWindow(model:input:frames:));
@end
NS_ASSUME_NONNULL_END
