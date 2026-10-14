<!-- WARMED_VISUALIZER_RESOURCES.md — repeated same-renderer simulator evidence; footprint growth is not a leak diagnosis. -->
# 同一动效反复挂载的资源检查

2026-10-14，生产源码基线 `faab49f87cad047d745c5dd7828b024ebe0a093a`。
按 [CURRENT_SCOPE.md](CURRENT_SCOPE.md) 完成当前动效检查，只扩展现有原生 QA 与进程采样元数据。
没有改播放器、渲染算法、设置样式或依赖；个人 App 仍为 mobile.28，服务器未更新。

**结论：反复开关设置期间，原生播放与动效恢复通过；WebContent 占用仍增长，长期资源稳定性未通过验收。
本次没有取得对象保留链，不能判断增长是缓存／延迟回收还是泄漏，也没有实施所谓泄漏修复。**

## 方法与包身份

复用 `VisualizerContainerTests.swift` 的生产页面、真实 Capacitor／PlaybackEngine、`OutputMeasurement`、
生成音频及固定在线歌词。QQ／网易云是受控歌曲身份，各播放独立的120秒样本，不访问真实账号或 CDN。
音频样本只作离线测试材料，不扩展本地曲库功能。

新增 `testWarmedDioramaSettingsCyclesPreserveNativePlayback`：固定 Diorama，每个平台连续开关设置16次。
设置开启观察450ms、恢复后观察4000ms；每平台约73秒，未跨过样本结尾。
两个平台顺序运行于同一 WebView，结果不能解释为平台间内存成本的差异。
原有两个模式组测试的默认循环数与观察时间保持不变，本批没有重跑它们。

使用独立 `app.folia.validation.App`、Release／arm64、iOS Simulator 26.5（23F77），
iPhone 17 Pro 与 iPad Pro 11-inch M5 串行执行同一个新增用例。
原生 `build-for-testing` PASS，272份原生源码／工程／锁文件摘要与测试包记录一致。
128个前端资源在 dist、Capacitor、Xcode产物和QA副本中逐文件一致。
前端沿用设置隔离批次已构建的资源，内嵌标识仍为 mobile.28／`a62a98a`；
其生产源码包含随后提交的 `faab49f` 设置隔离修改，不把内嵌旧提交号当成新安装包版本。
QA 副本仍用原离线首页，未改动的生产页面映射为 `mobile.html`，签名校验通过。

`sample-joint-processes.py` 使用原有原生阶段标记与系统 `footprint`，核对宿主、WebContent、GPU三个PID。
新增采样结束时的阶段／结束标志，分析排除跨阶段、测试清理期和设置开启期样本。
只保留阶段名及诊断字符串，不持有 GL 对象，不强制 GC 或修改渲染 API。

采样前保存的 `analysis-plan.json`：丢弃周期0–1作为初始预热，每周期取有效样本的 footprint 中位数，
比较早期周期2–4的中位数与末期周期13–15的中位数。两周期预热并不保证全部缓存已稳定。
这是描述性比较，没有设置“低于某增长量就算无泄漏”的阈值；三进程涉及共享记账，不能简单相加。

## 实际结果

| 检查 | iPhone 模拟器 | iPad 模拟器 |
| --- | --- | --- |
| XCTest | 1 PASS，0失败／跳过 | 同一用例1 PASS，0失败／跳过 |
| 测试时长 | 171.4秒 | 166.5秒 |
| 播放／设置恢复阶段 | 64 | 64 |
| 各阶段真实PCM | 双声道，至少19200帧，RMS≥0.12482 | 同样通过 |
| 各阶段播放位置推进 | ≥0.44798秒 | ≥0.44800秒 |
| 歌名、模式、设置状态、画布恢复 | 全部对应；队列保持两首及正确索引 | 同样通过 |
| 页面异常／仍挂载画布上下文丢失 | 0／0 | 0／0 |
| footprint 样本 | 132次，116次符合分析条件 | 132次，119次符合分析条件 |
| 有效恢复阶段覆盖 | 两平台各16周期 | 两平台各16周期 |
| 进程身份 | 全程同一组3个PID | 全程同一组3个PID |

这是**1个唯一 XCTest、2次执行**；128个阶段不是128个独立用例。
两端各保留32条 THREE.Clock 弃用警告，无上下文数量／丢失警告。
没有测量音频全程逐样本断流率、视觉帧率、触摸命中或歌词≤150ms同步。

下表为预热后早期→末期的中位 footprint，单位MiB：

| 设备／歌曲身份 | App | WebContent | GPU |
| --- | --- | --- | --- |
| iPhone／QQ | 92.21→91.99（−0.22） | 196.07→228.49（+32.42） | 45.39→63.77（+18.38） |
| iPhone／网易云 | 87.35→87.30（−0.05） | 228.33→242.08（+13.75） | 62.38→64.02（+1.64） |
| iPad／QQ | 92.92→92.71（−0.21） | 193.19→229.78（+36.59） | 49.10→68.80（+19.70） |
| iPad／网易云 | 88.21→88.13（−0.08） | 235.86→247.62（+11.76） | 71.58→67.69（−3.89） |

宿主App本窗口没有持续增长，WebContent两端仍增长；GPU后半段增长收窄或回落。
这补上此前多模式首次加载测试缺少的重复负载观察，但未证明长期平台稳定，也未定位责任对象。
源码中已有纹理、粒子材质与动画回调清理路径，不能仅凭 footprint 再添加清理、降级动画或强制 GC。
下一步资源诊断应针对实际增长的 WebContent／GPU取得对象／资源保留证据；
只抓宿主App的memgraph不足以解释这次增长。此类诊断需与连续音频检查分开记录，避免采样扰动混淆结论。

## 证据与边界

本地证据目录 `.mobile-test-results/warmed-visualizer-cycles/`：
`package.json`、`native-build.log`、`native.xctestrun`、`*-command.json`、`*.xcresult`、
`*-summary.json`、`*-attachments/`、`*-processes/`、`analysis-plan.json`、`analyze.py`、`metrics.json`。
用标准库脚本可重算同阶段结果：

```sh
"$HOME/.local/bin/codex-bounded" 60 -- python3 .mobile-test-results/warmed-visualizer-cycles/analyze.py
```

两次测试无失败重试。一次事后只读检查因嵌套shell引号解析失败、未执行；改为直接Python heredoc后通过，
没有据此重跑测试。测试结束时两台模拟器均Shutdown，采样／测试及所跟踪的三个进程均退出；见 `cleanup.json`。

旧 [WebKit 生命周期矩阵](VISUALIZER_LIFECYCLE.md) 的8通过／3失败／31未运行保持原记录，本次不是其重试。
真实账号、物理设备、实际系统挂起、网易云30分钟锁屏、长期帧率／温升／内存及完整视觉验收仍 `NOT_RUN`。
继续按两平台核心、原版特效、设置UI顺序推进，范围不扩展为本地音乐或完整Automix。
