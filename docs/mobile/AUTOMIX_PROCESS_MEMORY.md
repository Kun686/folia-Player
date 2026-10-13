# Automix 联合负载的三进程内存测量

2026-10-13，按“继续不依赖真机的工作”执行。独立 QA 包为 `app.folia.validation.App`，
目标为 iPad Pro 11-inch (M5)、iOS 26.5 **模拟器**。个人 mobile.28、真实账号和服务器未操作。

此前 [AUTOMIX_THREAD_MEMORY.md](AUTOMIX_THREAD_MEMORY.md) 已有三轮原模型与心象联合交接证据，
但内存只覆盖播放主进程。本次补充该 WKWebView 实际使用的 WebContent 和 GPU 进程，
没有修改原模型、音乐算法、动画、播放行为或生产依赖。

## 复用与测量方法

复用 `testConsecutiveOriginalModelHandoversWithCadenza`、现有音乐样本、两个原模型、
生产准备／混音链路，以及系统 `/usr/bin/footprint`。新增 Python 工具只使用标准库。

- QA 测试在 `FOLIA_JOINT_PROCESS_SAMPLING=1` 时输出阶段及三个 PID。基线、模型准备、
  实际交接、恢复和清理后均有记录；每轮清理后增加三秒观察窗口。
- `_webProcessIdentifier`、`_gpuProcessIdentifier` 核对自 WebKit 的
  [WKWebViewPrivate.h](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/API/Cocoa/WKWebViewPrivate.h)。
  已保存本轮头文件及摘要。调用前检查 selector；仅模拟器 QA 的 XCTest 使用，不进入生产 target。
- `dev/mobile/sample-joint-processes.py` 校验主进程所在模拟器、QA Bundle 和 WebKit 可执行文件，
  每次要求恰好三个不同 PID。本轮 PID 保持一致，未借用其他 App 的 WebContent 数据。
- 工具要求指定模拟器的 `xcodebuild test-without-building` 命令；整体 540 秒、日志无输出 60 秒、
  单次 footprint 10 秒超时。原始 JSON、退出码和错误保留；缺少任一阶段不能通过。
- 完成标记只停止采样，仍要求 XCTest 正常退出。首轮用例断言通过，但旧采样器在 App 退出后
  误报缺少进程并中断归档。修复完成标记后唯一一次重跑完整通过；首轮保留为失败测量。

最终 `final.xcresult` 为 **1 PASS、0 FAIL、0 SKIP**；一个用例内三轮，不能计为三个测试。
共 **187 次**快照，跨度 205.67 秒；单次调用 61–92ms，中位数 79ms；原始间隔约 1.08–1.13 秒。
分析按原生 uptime 和 footprint 的 Mach 时间重新归属阶段，只纳入完全落在阶段内的快照。
两次已进入下一轮准备的快照被排除，**185 次有效快照覆盖 15 个阶段**。
清理后的每轮三个快照都在明确的三秒观察窗口内。

## 内存结果与口径

以下统一为 **MiB（2²⁰ 字节）**，来自 `auxiliary.phys_footprint`，与此前主进程的物理账本口径一致。
“三进程之和”是同次快照的三个账本值相加，**不是已证明去重的整 App 唯一物理占用**。
三个进程并非原子地同时读取，且可能存在共享记账；Networking 等系统服务未覆盖。

| 轮次 | 准备期间三进程之和最高采样 | 清理后主进程 | 清理后 WebContent | 清理后 GPU | 清理后三者之和 |
|---|---:|---:|---:|---:|---:|
| 1，不同歌曲 | 1417.73 | 94.42 | 138.94 | 25.63 | 258.99 |
| 2，同曲重复 | 1409.63 | 88.38 | 146.99 | 24.86 | 260.23 |
| 3，同曲重复 | 1371.34 | 85.25 | 135.86 | 24.52 | 245.63 |

清理后列为各轮观察窗口最后一个快照，未拼接各进程最低值。
没有出现此前每轮数百 MB 的累积，WebContent 也未逐轮增加。三轮基线末次账本之和为
231.71、259.48、245.74MiB；有初始化／缓存预热差异，不能据三轮短观察认定长期无泄漏。

最高同次采样 `footprint-0031.json`：主进程 1,316,032,328 字节，WebContent 144,198,392 字节，
GPU 26,364,232 字节，合计 **1,486,594,952 字节，约 1.38GiB**。
主进程单独累计账本峰值为 1,360,727,856 字节；没有把各进程不同时间的累计峰值相加冒充同时峰值。

工具还返回另一套 VM region `footprint`／`total footprint`。上述快照 region total 为
1,457,513,352 字节，与账本之和不同。原始数据和 `analysis.json` 分别保留两者，不混算。
秒级采样可能漏掉短峰值；当前峰值仍高，未据此宣布适合所有 iPhone。

## 原流程、播放和动画

三轮使用固定原模型和真实音频，经生产 planner 确定交接点后 seek 到 cue，再由实际渲染时钟交接；
不是等待整曲自然结束。首轮为两首不同歌曲，后两轮同曲。生成 LRC 仅驱动真实心象 renderer，
不代表真实平台歌词或人工听感验收。

- 三轮均 `sawStem=true`、`finished=true`、`preparation=ready-expansion`；结束时 index=1、
  `fading=false`、只剩一个 deck，`stemFailed=false`、`stemClockInvalid=false`。
- 基线、准备、交接及恢复均 `notPlayingSamples=0`，tap 收到双声道非零 PCM。
  交接段为 480,000／1,123,200／1,123,200 帧，RMS 为 0.1287／0.1534／0.1534。
- 基线／准备／恢复的 rAF 平均间隔 16.64–16.67ms，P95 均为 17ms，最大 28ms；
  主线程约 100ms 周期的观察最大间隔 108.13ms。rAF 不等于实际呈现帧率，
  这些阶段统计也不是交接段单独的动画测量。
- 每轮 `memoryWarnings=0`，采样 thermal=0；模拟器该值不证明真机温升通过。
  三份截图及 WebView 数据保留原心象展开状态和三个 canvas；已查看截图确认并非静态占位。

## 构建、复现与边界

源码基线 `48f219ececad7ba69af53421c3ce777009933984`。`npm run build:mobile`、`cap copy ios`
及最终 Release `build-for-testing` 通过。127 个前端文件在 dist-mobile、Capacitor 拷贝和 QA 包中
摘要一致；后两者另有两个相同 Cordova shim。243 个包内文件及 286 个受版本控制的原生目录文件
已记录摘要。前端标签为上述基线／mobile.28，本次 QA 测试源码与采样脚本另有摘要。

本地证据 `.mobile-test-results/joint-webcontent/`，模型、音频和临时产物不提交：

- `measurement/`、`joint.xcresult`、`interrupted-reports/`：首次测量／归档中断；
- `build-final.log`、`final-command.json`、`joint.xctestrun`：最终构建及运行命令；
- `final.xcresult`、`xcresult-summary.json`、`attachments/`：最终 XCTest 与三张截图；
- `final-measurement/`：187 次系统快照、阶段、进程身份及测试日志；
- `analyze.py`、`analysis.json`：阶段时间过滤、两种内存口径和播放／rAF 汇总；
- `final-reports/`、`attachment-parity.json`：九个沙盒 JSON 与 XCTest 附件逐字节相同；
- `package-final.json`、`source-parity.json`、`staging.json`：包、源码、原模型和音乐摘要；
- `cleanup.json`：恢复模拟器原先 Shutdown 状态，已检查的任务进程均退出。

复跑沿用独立 QA 构建及核验素材，给 xctestrun 开启采样环境变量，指定新的结果目录：

```sh
"$HOME/.local/bin/codex-bounded" 600 -- python3 dev/mobile/sample-joint-processes.py \
  /absolute/path/test-command.json SIMULATOR-UUID /absolute/path/new-measurement
```

真实设备的联合负载／温升、长期稳定性、系统挂起、真实在线 Automix 及人工听感仍 **NOT_RUN**。
公开 `stems/full` 继续关闭；不授予完整 Automix 发布通过。回退仅移除可选测试采样和脚本，
无数据迁移。个人 `BUILD_RECORD.json` 摘要保持
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。
