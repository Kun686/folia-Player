# 分轨转场的时钟断裂恢复

2026-10-12，接续 [四轨实际队列接管](LIVE_STEM_HANDOVER.md)。
**PASS_GENERATED_AUDIO_DEVICE_AND_SIMULATOR / FULL_AUTOMIX_IN_PROGRESS**。
仅独立 QA 包；个人 App 保持 mobile.28。未改界面、依赖、原模型或公开能力开关。

## 问题与最小复现

基线 `afbca4e00dba733e9c67d2595e58e32349e6fa52` 已能使不连续时钟下的分轨 PCM 失效，
但 `TransitionGain` 随即使用仍以旧绝对时间为起点的主音轨后备曲线。
主机时间回退时，该曲线可能继续停留在 hold：旧歌曲增益 1、当前歌曲增益 0。
控制层也会等待旧时间线的结束点，无法及时清理转场与恢复预加载。

最小反馈循环是 `testStemFallbackCannotKeepOldTimelineAfterHostClockDiscontinuity`，
通过实际 `TransitionGain.process/processStems` 的三路回调，加入真实分轨程序与后备曲线，
先连续渲染，再改变采样时间。测试不需要解码器或网络。

初次运行 `red.xcresult`：1 项失败，4 条断言失败；回退到零的 hold／非 hold、两种回调
顺序均得到 PCM 最大差 1，而远距离向前跳变已恰好超过旧曲线终点，未暴露静音。
这排除了回调顺序与解码器倒退，确认旧后备时间线才是原因。最终测试还加入仅跳过
一个量子的向前缺口，避免只覆盖自然超过曲线终点的情况。

可重跑的定向命令（先使用独立 QA xcconfig 完成 build-for-testing）：

```sh
"$HOME/.local/bin/codex-bounded" 600 -- xcodebuild test-without-building \
  -xctestrun ios/DerivedData/Build/Products/App_iphonesimulator26.5-arm64.xctestrun \
  -destination 'platform=iOS Simulator,id=6A3572B5-C76C-49D5-8189-4C1F937D6762' \
  -destination-timeout 30 -parallel-testing-enabled NO \
  -only-testing:FoliaNativeTests/NativeTests/testStemFallbackCannotKeepOldTimelineAfterHostClockDiscontinuity
```

## 复用与修复

复用既有分轨失效旁路、命令 generation 与条件取消，不新增时钟猜测、DSP 或依赖。
普通欠载／媒体 epoch 失效与主机时间断裂分开处理：

- 连续主机时钟下的分轨失效仍使用原主音轨后备曲线。
- `NativeStemTransition.clockInvalid` 标记已渲染窗口的不连续量子；接管前时钟早于
  保存的媒体锚点时同样标记。该状态单向失效，不重新播放旧分轨。
- 时钟断裂后立即停用旧分轨与旧主音轨曲线，复用失效增益让当前歌曲恢复输出。
  对音色／回声更新执行代号，立即停止旧自动化发送；已有回声尾部按原实现衰减。
- `NativeCrossfade.tick` 按相同 generation 清理旧转场、尾曲与待执行工作，继续预加载。
  不等待旧曲线结束，不启动旧曲线的响度校正，也不再发布失效的动画 cue。
- 时钟、generation 与失效标志在一次 `try()` 锁内一起发布。原来分两次发布可能让
  控制侧把旧失效标志与新命令配对；现保持快照一致。音频线程不阻塞等待锁，
  不在该恢复路径增加 PCM 分配。

异常恢复沿用原失效旁路；本轮没有验证人工听感或保证无瞬态声响。

## 验证结果

证据目录 `.mobile-test-results/stem-clock-reset/`。源码哈希为 `source-final.json`，
249 项均与最终代码一致；执行命令见 `test-*-final-command.json`。
结果数量从 `xcresulttool get test-results summary` 提取，不以日志中的 PASS 文本代替断言结果。

| 批次 | 结果 |
|---|---|
| `red.xcresult`，修复前最小复现 | 1 项失败，4 条断言 |
| `simulator-initial.xcresult`，初版恢复与新增队列测试 | 75 项：74 通过、1 失败，4 条断言 |
| `queue-observed.xcresult`，修正观测条件后的队列定向验证 | 1 项通过 |
| **`simulator-final.xcresult`，iPad Pro 11-inch M5 / iOS 26.5 模拟器** | **75 通过、0 失败、0 跳过** |
| **`device-final.xcresult`，iPhone XS Max / iOS 18.7.10** | **同一源码：75 通过、0 失败、0 跳过** |

初版队列测试在切换手动渲染后只拉取一个块，就断言下游已观察到断裂，没有验证
该前提。定向检查证明第二次拉取才出现失效信号；最终测试最多拉取八块，并检查
旧 generation 尚未被配置通知取消，然后调用真实 `tick` 验证清理。
主机输出与手动引擎的时间原点不同：日志中 `manualEnd=1024` 不等于下游时钟的绝对值，
因此该队列分支证明的是**重新配置后的时钟断裂恢复**，不把它描述为下游时间必然归零。

实际下游归零由另一项真实双解码器测试验证：使用 SDK 明确支持的 `AVAudioEngine.reset()`，
分别在分轨接管前、接管后重置手动渲染时间。四个连续输出块与当前双声道歌曲对照，
两端两种时序的 PCM 最大差均为 **0**，旧分轨与旧后备曲线未恢复。

此外验证：hold 内／窗口内断裂、前跳与后跳、两种回调顺序、旧清理不得取消新命令、
真实队列保持当前实例且尾曲释放、自然交接与 seek。新增两个 XCTest，原队列测试增加
一个分支；另纳入九项已有音色、回声、持久音频槽及响度校正测试，合计 75 项。

## 包与回退

`packages-final.json`：两端 Bundle ID 均为 `app.folia.validation.App`，无内置模型；
123 项前端资源及两个空 Capacitor 占位文件与原构建、同步目录一致。

| QA 包 | 可执行文件字节数 | 含测试插件的 App 字节数 |
|---|---:|---:|
| iPhone | 42,113,920 | 135,416,878 |
| 模拟器 | 42,198,304 | 140,994,120 |

这些是 QA 包大小，不是个人 IPA 净增量。两端 QA 已卸载，模拟器关闭；个人 App
安装元数据前后一致，`BUILD_RECORD.json` SHA256 仍为
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。
回退本次提交恢复前一版时钟处理，无持久数据迁移；独立 QA 恢复不影响个人 App。

## 验收边界

本轮分轨仍来自显式生成样本，没有运行原 ONNX 模型或访问 QQ／网易云。
原模型与实际播放／动画联合负载、热保护、锁屏模型访问、长时间后台、完整 expansion
实时源对齐和物理 iPad 均 **NOT_RUN**。既有模拟器偶发主音轨切歌超时仍未独立确认根因。
完整 Automix 与整体移植仍在进行，公开能力开关保持关闭。
