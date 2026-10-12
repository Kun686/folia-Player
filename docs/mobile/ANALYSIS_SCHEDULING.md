# 拍点分析并发诊断与串行修复

本轮只操作 `app.folia.validation.App`，个人 `mobile.28` 不更新。
沿用 [联合负载测试](JOINT_LOAD.md) 的完整 133 秒音乐、两个固定原模型、真实音频输出与心象动画。
无新依赖；没有修改模型、前处理公式、窗口、输出容差或界面。

## 真机定位

iPhone XS Max / iOS 18.7.10，起始 thermal=fair。仅加入阶段记录的首轮结果为
**0 通过、1 失败、0 跳过**，模型调度约11.05秒后触发 serious 热保护。

`instrumented-report.json` 的单调时钟事件确认：

- 两首歌的解码分别耗时约368ms、386ms。
- 两项 `beat.prepare` 重叠 **10.285秒**；均未完成，不能将该数值当作完整预处理耗时。
- 没有任何 `ort.*` 事件，分轨也未进入 preparing。因此本轮热保护发生在拍点预处理期间，
  不能归因于 ORT／HTDemucs 执行；动画、环境与初始温度的贡献仍未隔离。
- 热通知记录后，两项实际预处理分别在 **12.35ms、29.73ms** 内退出。
  这是该次通知到工作退出的观测，不是所有输入的取消延迟上界。
- 基线／模型调度／恢复 rAF 平均频率分别为56.56／49.42／47.76Hz；
  100ms主线程轮询的最大间隔约107.27／107.00／107.90ms。
  三阶段采样均未观察到停止，音频tap有双声道非零输出；不等同于物理输出无爆音或GPU呈现帧率。

## 根因与改动

`NativeTrackProfiler` 是 actor，但等待 `NativeBeatAnalysis.grid` 时允许其他调用进入。
每首歌又各自创建一个分析 actor，导致当前／下一首同时运行昂贵的 JavaScript 预处理。
原有全局 ORT 串行队列只约束推理，不能阻止这种重叠。

复用 Swift actor、continuation 和既有取消机制，为每个 profiler 的完整 CPU 分析流程
增加一个 FIFO 通行位：从解码开始，经过拍点预处理、推理、后处理，直到特征分析退出后才交给下一首。
取消等待者只移除该请求；取消执行者必须等待真实工作退出后才释放。缓存命中不排队，
网络前缀下载不占这个通行位。取消与异常均释放，不改变队列身份和迟到结果校验。

`NativeAnalysisTrace` 仅由 QA 注入，默认不创建记录器。最多1024项、超出计数，使用锁保护；
记录阶段、随机任务标识、单调时间、热状态及既有数值诊断，不记录歌曲、地址、PCM或凭据。
解码、预处理、推理等待／校验／执行、后处理均有退出记录，供后续冷机复测使用。

## 验证与未完成项

Release QA 构建通过。真机新增串行取消测试与既有资源压力恢复测试 **2通过、0失败、0跳过**：
验证等待者取消后从未进入分析，下一项在前一项实际退出后才开始，并能得到正常 profile。
串行修复后的完整联合用例启动时 thermal=serious，**0通过、0失败、1跳过**；
Xcode 命令的成功退出不算联合验收通过。没有关闭保护或在热状态下循环重试。

另一次真机队列批次为 **18通过、2失败、0跳过**：两项静音边界用例均超时于等待
`preparedPosition > 1`，当次批次记录thermal=serious。生产 `PlaybackSystem.setupSystem`
在启动时就会将该热状态传给分析队列，暂停所需的静音边界分析。
该批次不能算全部通过，原始失败保留；没有延长超时或关闭资源保护。
卸载QA、停止手机负载，再用干净QA安装只重试这两项：仍为 **0通过、2失败、0跳过**，
同样超时于准备位置。该独立重试没有记录逐项热状态，不能仅凭较早的serious观测排除其他
真机时序原因；不再重试。需要在记录实际热状态、profile阶段与预加载状态的条件下继续定位。

iPad Pro 11-inch M5 / iOS26.5 **模拟器10通过、0失败、0跳过**：两项静音边界、
两项取消／恢复及六项原拍点测试。复用原始30秒音乐参考与固定模型，mel与logits最大绝对差
均为0，拍点网格完全相等，两份完整／部分profile在既有1e-6容差内；缓存分区、批次取消、
取消后恢复与PCM释放均通过。该结果不覆盖手机联合温升或物理iPad验收。

完整 Automix 仍未通过联合验收。串行化后的实际速度与温升改善、原模型完整准备、
WebContent与主进程总内存、锁屏及长期运行、物理iPad与人工听感仍待验证。
本轮原模型数值对照只在模拟器重跑；原JS算法、固定参考数据及模型摘要保持原样。
回退本次调度与诊断改动即可恢复前版，无持久数据迁移。

## 证据

目录 `.mobile-test-results/analysis-stages/`：

- `source-instrumented.json`、`source-serialized.json`：两阶段输入摘要。
- `instrumented-command.json`／`instrumented.xcresult`／`instrumented-summary.json`：真实联合失败。
- `instrumented-report.json`、`analysis.json`：阶段事件、帧间隔、音频与内存原始数据及统计。
- `regression-command.json`／`serialization-regression.xcresult`：两项调度回归。
- `serialized-command.json`／`serialized.xcresult`／`serialized-summary.json`：热状态跳过。
- `queue-regression-command.json`／`queue-regression.xcresult`：18项通过及两项静音边界超时。
- `queue-isolated-retry-command.json`／`queue-isolated-retry.xcresult`：干净QA中两项相同超时，未解决。
- `simulator-command.json`／`simulator.xcresult`／`simulator-summary.json`：10项模拟器验证。
- `package-instrumented.json`、`package-serialized.json`：独立签名与123项前端资源一致性。

包体包含测试插件，不代表个人IPA体积增量；主进程内存采样不包含WebContent。
