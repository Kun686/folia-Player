# 四轨实际队列接管

2026-10-12，接续 [静音预播](MUTED_PREPLAY.md) 与 [精确媒体时钟](MEDIA_CLOCK.md)。
**PASS_GENERATED_AUDIO_DEVICE_AND_SIMULATOR / FULL_AUTOMIX_IN_PROGRESS**。
仅独立 QA 包 `app.folia.validation.App`；个人 App 保持 mobile.28。本轮没有改动界面、
前端资源、依赖版本或原模型，公开 `stems/full/desktop` 能力仍为 false。

## 复用与实现

复用原版 JS 的转场计划、窗口覆盖判断、四轨观测、手势与总线参数，以及现有原生
共享音频图、静音预播、紧凑分轨窗口和主音轨后备曲线。无需新增依赖或 DSP 算法；
新增的 `NativeStemAlignment` 只负责原生媒体时钟与窗口读位置的绑定。

- `NativeCrossfade` 在两首歌的分轨窗口齐备时，使用原有的一秒提前准备时间。
  下一首先静音预播，再运行原版观测；成对分轨沿用原规则禁用变速弯曲。
- `NativeMasterTransition` 保留计算计划时使用的精确媒体锚点。控制线程可能恰好读到
  两路回调之间，因而最多等待 250ms 取得一致快照，期间检查取消和队列意图。
- `NativeStemAlignment` 保存两路 source、epoch、采样率和媒体位置。真正被音频回调
  接纳时才绑定读偏移，补偿观测与准备期间实际推进的音频。每个量子重新验证锚点，
  允许本量子或紧邻前一量子的快照，兼容两种回调顺序；投影位置差必须小于半采样。
- `NativeStemMixer` 直接保留已有 Int16 窗口，只在绑定时更新两个偏移量，不为实际播放
  再复制整块 Float PCM。解码与实时读取共用原有 WebKit 分数采样还原逻辑，保留末对
  样本外推和窗口结束后的零值行为。
- 静音门控原子替换为四轨程序与主音轨后备曲线，随后转交实际歌曲身份队列的所有权。
  分轨有效期间不重复施加主音轨音色、回声或响度校正；分轨失效后恢复后备曲线和 DSP。
  准备失败时重新计算剩余主音轨计划，不重用过期 hold。
- 尾曲结束会撤销分轨的 gain generation。队列现在识别该撤销并退出旧切换、恢复预加载；
  清理只取消自己仍持有的 generation，避免旧任务取消新命令。

当前实时队列仍使用 `performance: false`。已有离线 expansion 渲染不代表实际图中
的源对齐已通过；`prepareLive` 明确拒绝带 expansion 的请求。

## 本轮失败与修复证据

证据目录：`.mobile-test-results/live-stem-handover/`。保留每次结果，不以最终通过覆盖历史失败。

| 批次 | 结果与说明 |
|---|---|
| `simulator.xcresult` | 63 项，62 通过、1 失败；实际队列退回主音轨，图与 PCM 对照通过 |
| `simulator-clock.xcresult` | 一次时钟读取修正后仍为 62/63；证明仅重试快照未解决根因 |
| `simulator-alignment.xcresult` | 修正取整后的 4 项定向验证全部通过 |
| `device.xcresult` | 64 项全部通过，但当时队列断言仍可能只覆盖 hold，不能单独证明分轨已发声 |
| `device-queue-output.xcresult` | 加强后的 1 项队列测试失败；seek 分支通过，自然结束分支超时 |
| **`device-settle.xcresult`** | **最终代码：64 通过、0 失败、0 跳过** |
| **`simulator-settle.xcresult`** | **同一最终代码：64 通过、0 失败、0 跳过** |

第一处根因是 seek 后媒体原点可能处于采样之间。计划向上取整使本应在 10 秒开始、
12 秒结束的窗口变成 `outAt=10.00002232142857`，原版覆盖规则正确拒绝它。
现改为最近主机采样，半采样平局向前，量化误差不超过半采样；用六种分数原点调用
原 JS 覆盖规则验证。没有放宽窗口覆盖条件。

第二处根因是尾曲 EOF 移除分轨源后改变 generation，旧 fade 继续等待已失效的时钟，
导致自然结束清理和后续预加载无法进行。现在条件清理旧状态，保留当前歌曲实例。
最终两端均覆盖实际四轨输出之后的自然交接与用户 seek 取消。

构建期间抽取响度辅助函数曾触发 MainActor 编译错误，已标明执行域并在调度回调中
重新检查 generation；最终两端构建通过。已有 Sendable 与测试 weak 变量警告仍在。
前一阶段记录的模拟器主音轨切歌超时本轮没有复现，**尚未独立确认其根因**。

## 最终验证范围

最终测试源码哈希清单为 `source-final.json`，包含 249 个文件；与当前提交前源码逐项核对。
实际命令见 `test-device-settle-command.json`、`test-simulator-settle-command.json`，
实际执行数以对应 `*-settle-summary.json` 的 xcresulttool 摘要为准。

| 验证 | 结果 |
|---|---|
| iPhone XS Max / iOS 18.7.10，独立 QA | 64 项通过 |
| iPad Pro 11-inch M5 / iOS 26.5 **模拟器**，独立 QA | 64 项通过 |
| 紧凑窗口与既有分数采样解码路径，四种偏移含尾部边界 | PCM 最大差 0 |
| 真实双解码器图在观测后继续推进 3,840 帧（约 87ms） | 实际绑定后 PCM 最大差 `2.9802322e-08` |
| 两种回调顺序、暂停／恢复 epoch、欠载 | 锚点验证及失效检查通过 |
| 实际 PlaybackEngine 队列、unity rate、自然交接与 seek | 在时钟超过 `curveStart + 4410` 后验证，已进入四轨实际输出区间 |

自然交接和 seek 是同一个 XCTest 的两个分支，不重复计算测试数量。
`Clock.stemActive` 包含 hold 阶段，不能仅凭它断言已发声；最终队列测试额外检查
至少进入窗口 100ms。回调顺序可能使本量子的欠载在下一量子才被发现，不声称即时检测。

本轮使用生成 WAV 和随时间变化的分轨 PCM，队列显式注入 `QueueStemSeparator` 测试实现。
系统解码器、音频图和歌曲队列真实运行，但没有运行 ONNX 分离、请求音乐平台或检查人工听感。
不能将本轮 64 项称为原模型与实际在线播放的完整 Automix 验收。

## 包、清理与回退

`packages-final.json`：两端均无内置模型；123 项前端资源及两个空 Capacitor 占位文件与
`dist-mobile`、同步目录和 QA 包一致。

| QA 包 | 可执行文件字节数 | 含测试插件的 App 字节数 |
|---|---:|---:|
| iPhone | 42,113,056 | 135,174,880 |
| 模拟器 | 42,197,440 | 140,752,034 |

这些数值不是个人 IPA 的净增量。两端 QA 已卸载，模拟器已关闭；清理与一致性结果见
`uninstall-device.json`、`cleanup-simulator.log`、`final-integrity.json`。
个人 App 完整安装元数据前后一致，`BUILD_RECORD.json` SHA256 保持
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。
回退本次提交即可恢复先前静音预播与主音轨路径，无数据迁移。

## 尚未验收

- **NOT_RUN**：原模型推理、实际播放和动画的联合负载、热保护、长时间后台与锁屏模型访问。
  先前独立模型推理数据不能替代这些验证。
- **NOT_RUN**：实际图中的 expansion／performance 源对齐与完整扩展效果、物理 iPad。
- **NOT_RUN**：本轮真实平台回归、人工听感与长期稳定性。
- **待定向复现**：主机采样时钟向后跳变、且没有先经过正常 configuration-change 取消时，
  分轨会失效，但后备曲线可能仍保留旧绝对起点，造成增益恢复／清理等待。
  现有独立分轨时钟跳变测试没有后备主音轨曲线，不能覆盖该组合；公开启用前必须验证。

完整 Automix 与整体移动移植均仍在进行，不据此开启公开能力或更新个人 App。
