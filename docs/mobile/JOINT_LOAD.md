# 原模型、播放与心象动画联合负载

2026-10-12，接续 [实时扩展效果](LIVE_EXPANSION.md)。
**FAIL_RESOURCE_PROTECTION / PASS_DEVICE_RESOURCE_REGRESSION / FULL_AUTOMIX_IN_PROGRESS**。
只使用独立 `app.folia.validation.App`；个人 App 保持 mobile.28，界面与模型不变。

## 真机测量与失败

`NativeJointLoadTests.testOriginalModelsWithLivePlaybackAndCadenza` 在实际 Capacitor 宿主中
运行原 AudioStreaming 播放器、原心象 renderer 与背景。音频为已核验的完整 133 秒音乐，
导入两份作为当前／下一首；歌词为明确标识的生成 LRC，只用于驱动真实渲染器。
两个原模型经生产模型仓库核验安装，队列使用生产分析、准备与推理实现，无伪造分析或分轨结果。
测量范围为正常播放 8 秒、启用完整准备调度、关闭分析后恢复 8 秒；没有请求音乐平台。

设备为 iPhone XS Max / iOS 18.7.10。`device.xcresult` 为 **0 通过、1 失败、0 跳过**：
模型阶段约 **11.53 秒**出现 serious 热通知，分轨队列进入 suspended，未完成准备。
原拍点 profile 仍 pending，分轨还未进入 preparing。本次没有证明 HTDemucs 已执行，
也没有记录拍点预处理与 ORT 执行的分阶段耗时，不能把升温直接归因于某一个内核。
测试保留对 `ready` 的断言，保护性取消不会被算作完整 Automix 通过。

| 阶段 | 时长 | rAF 平均频率 | rAF P95 / 最大间隔 | 主线程 100ms 采样最大间隔 |
|---|---:|---:|---:|---:|
| 基线 | 8.08s | 56.05Hz | 26 / 39ms | 106.97ms |
| 模型准备调度 | 11.53s | 47.98Hz | 29 / 46ms | 115.33ms |
| 关闭分析后的恢复 | 8.11s | 47.56Hz | 29 / 38ms | 107.80ms |

三阶段均为前台展开的心象页面，rAF 未记录隐藏帧，输出 tap 记录到双声道非零音频，
100ms 状态采样未观察到停止。截图附件实际显示原歌词动画与背景。
这些数字是 rAF 调度和音频图观测，**不是 GPU 呈现帧率、物理输出无爆音或歌词同步误差证明**。

主进程 ledger physical-footprint 峰值 **146,884,184 字节（约140.1MiB）**，
未收到内存警告。该值不含 WebContent，且分轨尚未运行，**不能作为完整 Automix 的内存峰值**。
模型阶段末尾的一秒采样仍是 fair；随后日志与恢复阶段确认 serious，不能仅看最后一秒采样否认热通知。
测试启动时已为 fair，缺少冷机对照和重复测量，不将这次耗时当作稳定性能基准。

## 发现并修复的资源通知遗漏

生产 `NativeCrossfade.resourcePressure` 原来只暂停 `NativeTrackStems`；
`NativeTrackProfiles` 不接收压力状态，拍点分析可继续，后续 tick 还能重启工作。
复用既有取消与请求身份校验，增加 profile 队列的压力门控：

- 压力到来时取消待执行任务，保留已测得的 profile，不修改音频、模型、窗口或超时。
- 压力持续期间拒绝新的分析调度；模型／来源变化仍沿用既有失效规则。
- 恢复时通知播放器重新提交当前队列，旧结果不能写回，取消过的队列不会自行复活。

新增用例通过真实 `UIApplication.didReceiveMemoryWarningNotification` 进入播放器，
修复前明确失败于「任务未取消」及「压力期间仍能启动」两项断言。
修复后真机 **21 项通过、0 失败、0 跳过**：包含该回归、profile 队列、分轨队列／缓存、
Crossfade 生命周期；该批次使用生成音频，不运行原模型联合负载。
这证明通知遗漏已修复，**不证明发热原因已解决，也不把早先的联合失败改为通过**。
回归中的取消断言针对调度状态与迟到结果；同步 JavaScript 预处理的实际停止延迟仍需分阶段测量。

## 证据、复验与边界

证据目录 `.mobile-test-results/joint-load/`：

- `source.json`：联合测量时的260项输入；`source-resource-fixed.json`：修复后输入。
- `test-device-command.json`、`device.xcresult`、`device-summary.json`：原始联合失败。
- `device-report.json`、`analysis.json`、`attachments/`：三阶段原始采样、统计及截图。
- `resource-red-command.json`／`resource-red.xcresult`：修复前回归失败。
- `resource-fixed-command.json`／`resource-fixed.xcresult`／`resource-fixed-summary.json`：21项修复后回归。
- 两次初始编译失败分别为 QA 字符串定界及 actor 调用／类型推断错误；修正后通过原生测试
  源码类型检查和 Release 构建，日志分别保留，未调整生产模型算法来取得编译通过。

测试包无内置模型，独立签名的 application-identifier 已核对。原始 staging 文件遵循
[原窗口准备说明](ORT_WINDOW_INTEGRATION.md)，模型、完整音乐摘要与既有清单相同。
可使用记录的 xctestrun 命令复验；实际联合用例要求设备起始低于 serious，否则明确跳过，
跳过不算通过。运行中达到热保护即停止准备并记录恢复，不自动反复施加重负载。

**下一步**：隔离拍点预处理、模型执行与动画的资源争用，测冷机和持续负载；补上
WebContent／整 App 内存、CPU、分轨完成后的真实交接、锁屏与长期温升、物理 iPad 及人工听感。
本轮未复测 QQ／网易云，不更新个人安装，不启用公开 `stems/full` 能力。
回退本提交可撤销压力门控及 QA 用例，无个人数据迁移。

后续分阶段真机记录确认两项拍点预处理重叠、尚未进入ORT；调度串行修复与验收边界见
[ANALYSIS_SCHEDULING.md](ANALYSIS_SCHEDULING.md)。

`package-resource-fixed.json` 核实123项前端资源及两个空 Capacitor 占位文件与同步目录和
最终 QA 包一致。真机可执行文件42,124,864字节、含测试插件的 App 135,989,872字节；
这不是个人 IPA 的净增量。测试后已卸载独立 QA；`cleanup.json` 确认个人 App 完整安装
元数据未变、构建号仍为28，260项修复后输入未变，无本轮构建或测试进程残留。
