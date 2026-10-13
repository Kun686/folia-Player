# 原生定位状态的线程检查与修复

2026-10-13。仅源码、离线样本与独立模拟器 QA；个人 mobile.28、物理设备、真实账户和服务器未操作。

## 已确认的问题与修复

在 `84313e31e0418eaaa4b53d6cecc5d8943e649f9f` 上启用 Xcode Thread Sanitizer 后，
原生停滞恢复测试 `testStereoStallRecoveryUsesFreshURLAndNewGeneration` 报告数据竞争并终止。
主线程 `AudioPlayer.seek(to:)` 写入 `SeekRequest.requested`，后台 `AudioFileStreamProcessor.decodePackets`
同时无锁读取该字段。写端单独持有锁不能保护无锁读端。提取实际 vendor 状态类和锁的最小并发程序，
也在读写同一字段时报告竞争；修复前日志和二进制均保留。

复用批准的 AudioStreaming 1.4.5 和其 `UnfairLock`，不升级依赖、不改音频算法或界面：

- `SeekRequest` 封装标记、位置和版本，所有读写使用同一把现有锁。
- 解码器取得同一份位置／版本快照，字节定位、包定位和播放时钟使用同一位置。
- 每次新定位增加版本，旧操作完成时只清理自己的版本；旧完成不会清掉较新的定位。
- 已有定位进行中也会排入下一次 source 处理，避免更新留在待处理状态。
- 锁只保护状态快照，不跨越解码、文件操作、暂停或回调；Ogg 原有拖动限制不变。

新增三个回归：定位版本／取消、一个写端与三个解码读端的 50,000 次迭代、真实 PCM 播放与暂停状态下的快速拖动。
同时复用旧队列、缓存、变速、音频中断、曲库刷新和打包 React 设置用例。
没有用 Swift 复制在线 provider 规则，也没有新增通用并发框架。

## 证据与范围

证据目录 `.mobile-test-results/thread-sanitizer/`。
`build-command.json` 明确使用 `-enableThreadSanitizer YES`；Xcode 生成的 xctestrun 注入
`libclang_rt.tsan_iossim_dynamic.dylib`，保留默认 `halt_on_error=1`。
二进制包含 `__tsan_*` 调用，首次报告的栈也确认运行库实际执行。未加入全局或局部忽略规则。
预编译系统库／ONNX Runtime 未因这个开关自动获得源码插桩，本批未运行模型推理或性能验收。

| 验证 | 结果 | 边界 |
| --- | --- | --- |
| 初始小组，iPad 模拟器 | 3 PASS | 切歌、中断和曲库刷新，不覆盖后来发现的恢复路径 |
| 扩展检查，修复前 | 23 PASS／1 FAIL | `expanded.xcresult`；真实 seek 状态竞争 |
| 最小 macOS 状态复现 | RED → PASS | 4 个并发执行者；修复前 TSan 报告，修复后退出 0 |
| 修复后首次完整 TSan 组 | 30 PASS／1 FAIL | `native-after.xcresult`；seek 回归通过，另一份系统 tap 交接报告见下文 |
| 当前流式路径 TSan，iPad Pro 11-inch (M5)／iOS 26.5 模拟器 | 26 PASS／0 skip | `streaming-final.xcresult`；无 TSan／Main Thread Checker 报告 |
| 普通 Release QA，iPhone 17 Pro／iOS 26.5 模拟器 | 39 PASS／0 skip | `native-release.xcresult`；含五个旧 AVPlayer 驱动用例和八个原音效回归 |
| 固定 vendor 源码／完整补丁核对 | PASS | 59 文件，5 文件有本地适配；原始提交和许可证不变 |
| 真实平台、物理设备、系统挂起、长期性能 | NOT_RUN | 本批不操作这些环境 |

最终两组共 39 个不同用例，26 个插桩用例是其中的子集，不能相加为 65 个不同用例。
普通 Release 显式使用 `-enableThreadSanitizer NO`，检查 xctestrun 与二进制没有链接／注入该运行库；
没有 Main Thread Checker 报告。原 EQ WebKit 数值样本、真实 PCM、静音与设置继承均通过。
本批不改前端，复用已构建的移动资源；没有额外执行浏览器 UI 或前端全量本地测试。

## 单独保留的系统回调交接报告

修复定位状态后，旧 AVPlayer 路径的 `testUnplayableAddressRefreshesOnceWithoutWebView` 报告
`AudioEqualizer.prepare/unprepare` 与 `process` 之间的访问缺少 TSan 可见的同步。
栈中两端均由 MediaToolbox 的 tap 生命周期调用，没有捕获到应用绕过宿主并行调用的证据。

本机 iOS 26.5 SDK 的 `MediaToolbox.framework/Headers/MTAudioProcessingTap.h:160-164` 明确规定：

> Process callbacks will only ever be called after the prepare callback returns, and before unprepare is called.

因此，单凭该报告不能认定滤波器正在被并发释放；系统内部同步未被插桩是一种可能解释，仍列为 **INCONCLUSIVE**。
没有修改音效链或在实时回调中增加阻塞锁，也没有把完整 TSan 组改写为通过。
人为重叠 prepare/process 的候选测试违反此宿主约束，已从源码移除，草稿留在证据目录并标明未执行。

最终 26 项 TSan 组针对当前 AudioStreaming 路径，明确排除五个旧 AVPlayer 驱动用例；准确名单在
`legacy-sanitizer-exclusions.json`。普通 Release 另执行旧路径和原音效数值测试，但普通测试通过不解决该诊断的不确定性。
这项范围划分不是关闭检测；当前流式路径中的 TSan 报告仍会立即终止测试。

## 复现、交付和回退

```sh
"$HOME/.local/bin/codex-bounded" 60 -- python3 dev/mobile/verify-audio-vendor.py
"$HOME/.local/bin/codex-bounded" 60 -- python3 dev/mobile/verify-audio-vendor.py --upstream-root ios/DerivedData/SourcePackages/checkouts/AudioStreaming
```

原生构建和选定用例的完整参数见证据目录的 `build-command.json`、`streaming-final-command.json`、
`build-release-command.json`、`native-release-command.json`。QA 使用独立 `app.folia.validation.App`，打包集成测试会拒绝非空网关或平台会话。
`stage-after.py` 保留真实移动资源到 `mobile.html`，用空白启动页保证离线测试先准备再载入实际页面。
`native-after.xctestrun`、QA 副本和 `sanitizer-PackageFrameworks` 保留插桩产物；后续普通构建显式关闭检查器。
重新执行时应配对相应构建和 xctestrun，不把普通框架与检查器二进制混用。

精确 vendor 差异和哈希同步到 `AUDIO_STREAMING_VENDOR.patch`／`.json`，离线校验脚本同时更新文件清单。
补丁中的上游空白上下文保持原样，普通源码通过 `git diff --check`。
`BUILD_RECORD.json` 保持原值；本批未产生或安装个人发布包。
回退需同时恢复三个 vendor 文件、哈希／补丁和校验清单；无需迁移或清理登录、曲库、设置和队列。
完整移植及 Automix 真机验收仍未完成。
