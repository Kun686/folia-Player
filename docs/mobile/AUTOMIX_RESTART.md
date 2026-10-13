# 原模型 Automix 的跨进程离线恢复

2026-10-13。继续不依赖真机的工作，补上此前 [在线缓存验证](ONLINE_AUTOMIX.md) 未覆盖的进程退出边界。
使用独立 `app.folia.validation.App`、iPad Pro 11-inch (M5)／iOS26.5 arm64 模拟器。
个人 mobile.28、物理设备、真实账号与服务器未操作。

## 实现与复用

本批只增加原生 QA 用例及工程测试注册，没有修改生产播放、模型、算法、界面或依赖。
复用 `PlaybackEngine` 的队列保存／恢复、`NativeMediaCache`、`NativeTrackProfiler`、
`PlaybackModels`、`NativeTrackStems` 和原在线交接测试助手。
两次宿主启动使用同一个新 UUID 的隔离目录与 UserDefaults suite，不使用个人配置。

1. `seed`：用原受控 HTTPS 传输播放两首不同的音乐，歌曲身份为 QQ／网易云的同名媒体 ID。
   通过生产模型仓库安装原 Beat This!／HTDemucs，完成完整缓存、拍点分析和两个30秒分轨窗口。
   设置列表循环和 Automix 表现模式，跳转至12.25秒附近，暂停并保存真实播放位置。
2. 第一阶段完成后核对 XCTest 成功、确认宿主 PID 已退出，随后单独运行 `restore`。
   新进程只读取持久数据，**不调用 setQueue，不重新导入或安装模型，不注册在线音频响应**。
   解析器拒绝远程播放地址请求，音频 URLSession 由拒绝所有 HTTP／HTTPS 的 URLProtocol 计数。
3. 检查队列来源、索引、循环、表现模式、媒体缓存偏好和两模型恢复；启动保持暂停。
   用户播放命令后从保存位置继续，复用磁盘完整 profile，重新生成进程内的分轨 PCM。
   然后按原规划器交接点 seek 至前1.5秒，观察真实音频时钟执行交接及循环队列的后续预加载。

原 `NativeStemCache` 是进程内四窗口缓存；重新生成窗口是原行为，不新增分轨落盘机制。
新用例确认初始分轨缓存为空，恢复后的 profile 摘要与前一进程一致，分析 trace 没有再次进入 decode。
两份完整音频摘要与固定样本一致，模型按原 manifest 核验。素材来源／许可沿用
[DISTINCT_HANDOVER.md](DISTINCT_HANDOVER.md)，本批没有下载或提交模型／音频。

## 证据与结果

本地目录 `.mobile-test-results/automix-restart/`，基线 `fab38f25686fecd1e2dd2487a75fdd98e50d5f37`。

最终 seed 为 **1 PASS／0 FAIL／0 SKIP**，restore 及回归为 **7 PASS／0 FAIL／0 SKIP**。
合计8次测试执行，覆盖**7个不同用例**；同一个重启用例的两个阶段不重复计为两个功能测试。

- 最终进程：seed PID 79496 已退出，restore PID 80242；两阶段为独立 xcodebuild 调用。
- 保存／恢复位置均为 **12.473990929705215秒**，恢复时无播放器流、无播放意图，实际保持暂停。
- 恢复阶段播放地址解析 **0次**、音频 HTTP 尝试 **0次**；未使用第一进程的 URL 或内存对象。
- 分轨交接实际发生：98次状态采样、480,000帧输出、RMS约0.12870；未采样到停止、分轨失败或时钟失效。
  普通主音轨淡化无法满足 `sawStem` 断言。
- 交接完成后，循环下一首缓冲超过0.5秒；声音输出图只保留当前歌曲，预加载保持静音且不接图。
- Release build-for-testing、前端构建与 Capacitor 拷贝通过；286项原生目录输入和127项前端资源已核对。
  同步目录与 QA 包均另含两个相同的生成 shim，不把它们计为前端构建资源。

`seed-fixed-summary.json`／`restore-fixed-summary.json` 为最终 XCTest 结果；
`process-boundary-final.json` 记录第一进程退出；`seed-report-fixed.json`／`restore-report-fixed.json`
保存测量，`attachments/` 保留 XCTest 原附件及逐字节核对。
`source-final.json`／`package-final.json` 绑定源码与包；确切命令在 `*-command.json`。
CI 只运行已有 vendor、TypeScript、移动逻辑和前端构建，不运行此双进程原生用例。
准确提交的结果见 `ci.json`；`cleanup.json`／`completion.json` 记录最后清理和源码核验。

## 失败与复测

首次恢复测试失败于测试助手新增的“预加载后应有两个已连接声音节点”假设。
`StreamMixOutput.attach` 与既有队列回归明确规定只有发声的解码器加入输出图；
预加载在图外进行。该次真实分轨已进入，但因最终断言超时，整项仍记 FAIL。
`restore.xcresult` 保留1项失败／6项通过，不能以交接日志替代最终结果。

修正助手为检查下一首身份、实际缓冲时长与**仍只有一个输出节点**，生产代码不变。
使用全新 UUID、最终构建重新执行 seed／进程退出／restore，并回归原在线与同进程离线交接、
队列保存、缓存设置恢复、缓存租约／损坏、离线拖动及原子模型安装恢复。

## 复现与边界

需先按 [ONLINE_AUTOMIX.md](ONLINE_AUTOMIX.md) 准备独立 QA 的四个已核验模型／音乐文件。
使用现有 `transition-validation.xcconfig` 执行 `build-for-testing`，保持 QA Bundle ID。
复制生成的 `.xctestrun` 为两个文件；若放到另一目录，应将其中的 `__TESTROOT__` 替换为原 Products 绝对路径。
在两份 `FoliaNativeTests.EnvironmentVariables` 中分别设置：

| 变量 | 第一份 | 第二份 |
|---|---|---|
| `FOLIA_AUTOMIX_RESTART_ID` | 一个新 UUID | 同一个 UUID |
| `FOLIA_AUTOMIX_RESTART_PHASE` | `seed` | `restore` |

分别执行 `xcodebuild test-without-building`，限定
`-only-testing:FoliaNativeTests/NativeTests/testOriginalAutomixRestoresOfflineAcrossProcessRestart`、
`-parallel-testing-enabled NO`、模拟器 destination 和独立 resultBundlePath。
仅在第一阶段最终通过且其 PID 已退出后启动第二阶段。缺显式阶段／UUID或身份不符会 SKIP，不能算 PASS。
使用600秒有界 runner，60秒无输出终止进程组；不得复用已有 seed 目录覆盖失败证据。
导出附件后停止 QA、关闭本轮启动的模拟器，再删除该 UUID 对应的目录与偏好文件。

这是独立 App 宿主中、使用隔离存储的生产原生组件跨进程验证。
它不证明系统强杀／Jetsam 时最后一次未保存进度的恢复，不验证实际 WebView 挂起、默认插件目录的冷启动 UI、
真实平台／TLS、音频物理输出听感、手机温升或总内存。100ms采样也不能排除更短的断音。
这些项目及真机验收仍 **NOT_RUN**；公开 `stems/full` 能力继续关闭，完整移植目标仍未完成。

无生产迁移，撤销本批测试／文档提交即可回退。个人 `BUILD_RECORD.json` SHA256 保持
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。
