# 不同歌曲的原模型交接与取消回归

2026-10-13。**PASS_DISTINCT_SONG_SIMULATOR / INTERMITTENT_CLOCK_FALLBACK_UNRESOLVED**。
此为当时状态；后续已复现1帧时钟域差异并完成三轮联合回归修复，见 [PREPLAY_CLOCK.md](PREPLAY_CLOCK.md)。
按用户要求继续不依赖真机的工作，只使用 `app.folia.validation.App` 的 iPad 模拟器。
个人 mobile.28、服务器、界面、原模型与音乐算法未更新。完整 Automix 尚未通过稳定性验收。

## 范围与最小改动

复用 [联合负载](JOINT_LOAD.md)、[原前处理与交接](MEL_PREPARATION.md) 的实际播放器、
原规划器、两个原 ONNX 模型、完整头尾分轨窗口、扩展混音和心象 renderer。
新增 `testDistinctOriginalSongsCompleteStemHandoverWithCadenza`，将两份同曲扩展为两首不同歌曲，
用既有文件快照校验实际输入摘要不同；保存完整、非 gridless 的 profile 和独立报告。
通过正常 seek 移至原规划器交接点前1.5秒，随后由真实渲染时钟接管；不伪造模型、分轨或计划。

回归暴露取消测试的时序假设问题。`NativeTrackProfiler` 仅将两处重复的许可获取、
取消检查和 `defer` 释放提取到 `withAnalysisPermit`，原 FIFO、等待者取消和实际分析不变。
测试使用标准 continuation 明确保持工作未退出，验证等待取消、执行取消不提前释放、
幸存等待者的 FIFO 顺序、已取消调用不进入分析和真实模型错误后的恢复。无新增依赖。

另将已有 `clock-unavailable` 只读诊断细分为 `:source`、`:pair`、`:changed`，
分别表示原始锚点缺失、成对快照缺失、来源或 epoch 改变；没有放宽精度或更改回退行为。

## 音频与模型身份

| 曲目 | 完整长度 | 测得 BPM | 解码 WAV SHA256 |
|---|---:|---:|---|
| Karissa Hobbs — Let's Go Fishin' | 132.9879365秒 | 88.2352941 | `d7db2870d3ab5c1b56f793288c045a34043c1e1cfda468010a3e200f4e8c38a2` |
| Kevin MacLeod — Vibe Ace | 61.4559637秒 | 130.4347826 | `ae4bfab915528a50d7f3eec75b0769c9981af4172c92e30402705716f86ee249` |

第一首来源与许可差异见 [AUTOMIX_MUSIC.md](AUTOMIX_MUSIC.md)。第二首取自
[librosa 官方音频](https://librosa.org/data/audio/Kevin_MacLeod_-_Vibe_Ace.hq.ogg)，
1,452,719字节，SHA256 `73d6443ef90a7c022f164e5aa90e56c2291585930b39b1656d0765abbc1f1779`，
与[官方登记](https://github.com/librosa/librosa/blob/main/librosa/util/example_data/registry.txt)一致。
其官方 TXT 为 CC-BY-3.0、TOML 为 CC-BY-4.0，两份文件及登记摘要均保存。
使用已有系统 `afconvert` 解码为44100Hz、双声道 Float32；不新增解码依赖。
音频仅用于本机验证，不提交、分发或打入个人 App。

两个模型仍按 `shared/modelManifest.json` 核验，未转换或量化。
数值回归沿用优化前固定参考，`beatThis.ts` 参考来自提交
`3b57ca129247e3cee5c2a848d13f343a912d20e8`，文件摘要
`d624df5aa26d2ccdd8c66c30b0eba917165d6f47e975fb76cc3b30691948b418`。
参考其余源码与当前相同，所有输入／输出文件及模型逐项校验，不重生成期望值。

## 实际结果

环境：iPad Pro 11-inch (M5)，iOS26.5／23F77，arm64 **模拟器**，Release 独立 QA。
以下按最终 xcresult 统计，各批存在重复用例，不累加成独立覆盖数。

| xcresult | 通过 | 失败 | 跳过 | 说明 |
|---|---:|---:|---:|---|
| `native` | 1 | 0 | 0 | 初次不同歌曲完整交接 |
| `regression` | 2 | 1 | 0 | 同曲交接／资源恢复通过，旧取消测试失败 |
| `scheduling-final` | 4 | 0 | 0 | 确定性取消／FIFO／错误恢复及资源压力 |
| `final` | 10 | 1 | 2 | 不同歌曲及常规 profile 回归通过；同曲回退；两项缺素材 |
| `clock-diagnostic` | 1 | 0 | 0 | 同曲独立诊断复测通过，不能消除偶发失败 |
| `references-staged` | 3 | 0 | 0 | 补齐素材后原完整／部分 profile、缓存隔离、成对接管前恢复1× |

`final` 中不同歌曲模型准备 **29.08秒**；out=123.98秒、in=0.14秒。
交接观察 **10.06秒**，99个采样中84个观察到分轨在真实音频图中渲染，状态 `ready-expansion`。
未观察到停止、分轨失败或时钟失效；结束时 index=1、继续播放、淡化结束、只保留1个音频节点。
音频 tap 记录480,000帧双声道，RMS约0.12868。

基线／模型／恢复 rAF 平均调度约60.13／59.83／60.00Hz，模型阶段P95间隔17ms、最大42ms；
100ms主线程采样最大间隔约107.88ms。主进程footprint采样峰值1,958,744,288字节，
ORT报告峰值1,965,412,576字节，0次内存警告，采样thermal均为0。
这些数值排除WebContent内存，不代表GPU呈现帧率、手机速度／温升、扬声器听感或150ms歌词精度。
截图可见原心象画布；歌词是用于驱动 renderer 的生成 LRC，不作为真实歌词匹配验收。

## 保留的失败与未解决项

旧取消测试等待历史 `beat.prepare/begin`，然后假定不存在的 `/missing.onnx` 会一直占用分析。
该任务可以先以 `MobileFailure` 退出并合法释放许可；观察到开始不等于仍在执行。
旧用例出现两条顺序断言失败和一个非取消错误，xcresult计为**一个失败用例**。
这次未保存旧用例的阶段时间线，不虚构其重叠耗时。新测试独立控制工作出口，
保留“取消等待者从未分析、下一项必须等到真实退出”的断言，并附上18项阶段事件。
真实缺模型错误恢复另有专项通过，不再依赖机器速度拖住任务。

`final` 中同曲用例**失败**：模型准备完成，但 `clock-unavailable` 触发普通主音轨淡化。
播放未停、队列完成交接，但 `sawStem=false`，所以不满足完整分轨验收。
这一失败发生在细分诊断之前，不能判断是原锚点缺失、成对读数缺失还是 epoch 改变。
增加精确原因后，在新测试进程只单独复测一次：23.67秒内233个采样有218个观察到分轨，
最终只剩1个节点且继续播放。只读诊断并未修复时序，**偶发回退根因仍 UNVERIFIED**。
不把重跑通过当作问题已解决，不放宽时钟一致性、关闭保护或允许回退通过断言。
下一步应在失败条件下取得具体原因，再围绕该时钟边界构造最小复现；本轮不继续盲目重试。

两项原模型测试最初因 QA 沙盒缺 `BeatQA/report.json` 跳过。随后核验并复制固定参考11项、
报告和原模型共13项，再定向运行，两项均通过；原跳过记录保留。完整／部分profile仍用原1e-6容差。

手机联合负载／温升、WebContent与主进程总内存、真实QQ／网易云在线Automix、
长期后台、物理iPad和人工听感仍 **NOT_RUN**。本轮不解除公开完整Automix能力限制。

## 构建、证据与回退

代码基线 `93c4769b37900683e7551769ade4745d23d6f909`，各阶段源码及可执行文件摘要
保存在 `.mobile-test-results/distinct-handover/package*.json`。Release build-for-testing和
模拟器签名验证通过；`dist-mobile`、Capacitor拷贝及QA包的123项前端资源逐文件相同。
前端沿用上批已核验的构建产物，内嵌 `build-identity.json` 仍标记 `b0a883d…/mobile.28`；
这是旧的构建标签，不将它当作本批Swift源码身份。前端未变，本轮未重跑WebKit／TypeScript构建。
既有Sendable、测试weak变量及AppIntents提取警告仍存在，不宣称零警告。

测试命令分别在 `command.json`、`*-command.json`；选定现成QA包执行，例如：

```sh
"$HOME/.local/bin/codex-bounded" 600 -- xcodebuild test-without-building \
  -xctestrun ios/DerivedData/Build/Products/App_iphonesimulator26.5-arm64.xctestrun \
  -destination 'platform=iOS Simulator,id=6A3572B5-C76C-49D5-8189-4C1F937D6762' \
  -destination-timeout 30 -parallel-testing-enabled NO \
  -only-testing:FoliaNativeTests/NativeTests/testDistinctOriginalSongsCompleteStemHandoverWithCadenza \
  -test-timeouts-enabled YES -maximum-test-execution-time-allowance 180
```

需先在独立QA `Documents/ORTQA` 放入核验后的 `music.wav`、`distinct.wav` 和两个原模型，
数值用例另需 `BeatQA` 固定参考；缺素材时必须记录SKIP，不得视作PASS。
构建沿用独立 `transition-validation.xcconfig`、`ENABLE_TESTABILITY=YES`，不操作个人包。

证据目录还包含：`source.json`／`fixtures.json`／`beat-staging.json`（素材身份），
`final-reports`、`clock-diagnostic-reports`、`analysis-final.json`（原始报告与统计），
`*-attachments`／`*-attachment-parity.json`（XCTest附件及容器报告字节校验），
`scheduling-trace.json`（取消／FIFO顺序）、所有初始失败与跳过的log／xcresult／summary。
包摘要分别对应初次用例、串行许可提取后和细分时钟诊断后，不能混用。

个人 `BUILD_RECORD.json` SHA256保持
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。
测试结束已停止独立QA并将模拟器恢复为起始的Shutdown状态，见 `cleanup.json`；
无本批构建／测试进程残留。没有操作物理设备或个人App。
回退本批提交只恢复许可代码布局、测试及诊断文本，无曲库、凭据、模型或设置迁移。
