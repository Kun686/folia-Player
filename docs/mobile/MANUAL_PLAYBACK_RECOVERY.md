<!-- MANUAL_PLAYBACK_RECOVERY.md — native manual recovery keeps the live position without changing retry policy. -->
# 手动重试保留播放位置

2026-10-14；基线 `ff65462b7baef9b14a26962704f44a8fe2595093` 加本批改动。
按 [当前范围](CURRENT_SCOPE.md) 收敛 QQ／网易云核心播放恢复，不扩展其他功能。

## 问题与修复

断网停止后，系统自动恢复使用中断位置；用户先点播放重试却重新读取 `restoredPosition`。
这个字段保存最近一次选曲的起播位置，不随当前解码进度或已加载歌曲的拖动更新。
结果是歌曲已播到中段，手动继续又回到原起播位置；初次从头播放的歌曲会回到0秒。
先暂停、或在错误状态下先拖动再继续，也会丢失用户期望的位置。

复用原生 `playbackPosition` 与 `StreamOccurrence.hasEnded`，仅修改 `PlaybackSystem.command("play")`
的移动双声道路径：重新打开音源时读取当前位置，包含当前拖动目标；自然播完则从0秒重新播放。
生产 `FoliaNativePlugin` 使用该路径。沿用原 `select` 的取消、代次与联网恢复清理，不新增状态或重试规则。
AVQueuePlayer兼容路径、Web／桌面、平台接口、原动画／布局／设置和依赖均未改。

## 原生验证

复用 `StreamingQueueTests`、`AudioFixtureGateway`、生成音频及 `OutputMeasurement`，新增两平台各一项测试。
每项实际执行：播放到约6秒，断网停止，再分别直接继续、先暂停再继续、先拖至10秒再继续；
检查恢复位置、实际PCM，以及后到的联网通知不重复打开音源。最后自然播完，再播放应回到开头。
网络状态通过直接调用原生系统回调处理方法注入；没有真实平台账户、CDN或无线网络切换。

- **RED**：原代码在iPhone模拟器2项FAIL，共6条位置断言。三种操作恢复到约0.01–0.02秒，而非预期6／10秒。
- **GREEN**：新增测试源码与RED阶段哈希相同；同一12项在iPhone／iPad模拟器各12 PASS、0失败／跳过。
  没有失败后的重复执行；两次原生构建与两次QA签名校验通过。
- 10项既有回归：两平台完整缓存断网播放、失效地址刷新与自动重连、快速选曲、认证与三首失败上限、
  卡住后重试、快速拖动、暂停／中断／平台移除、睡眠到期不自动续播、原暂停淡出与切歌恢复。

| 新增用例的观测 | iPhone 17 Pro | iPad Pro 11-inch (M5) |
| --- | --- | --- |
| 系统／构建 | iOS Simulator26.5（23F77），arm64 Release | 同左 |
| 恢复后的PCM检查点 | 6（两平台各3） | 同左 |
| 每检查点最少帧／声道 | 19200／2 | 19200／2 |
| 最小RMS | 0.0215684552 | 0.0215689433 |
| 450ms检查窗最小位置推进 | 0.4479818594秒 | 0.4480045351秒 |
| 恢复首个观测与期望位置之差 | 0秒 | 0秒 |
| 自然播完后重播最大首个位置 | 0.0106575964秒 | 0.0213378685秒 |

位置检查用于证明恢复语义，不是声音与歌词误差≤150ms的测量。
两台模拟器执行相同12个唯一用例，不累计为24个不同场景。

独立包为 `app.folia.validation.App`，前端沿用 `d5e13c8` 的128个资源与 `0.7.16-mobile.28` 标签。
本批没有前端改动；资源在dist、Capacitor、Xcode产物和QA包中一致；272个原生源码／项目／锁文件
在测试后与打包清单一致。QA首页为空白离线入口，保留生产页面为 `mobile.html`。
证据目录 `.mobile-test-results/manual-network-retry/` 保存阶段包、源码哈希、构建／测试日志、
命令参数、xcresult、摘要、PCM附件和 `metrics.json`；最终提交／CI／清理结果为 `delivery.json`。
测试通过 `codex-bounded 600 -- python3 .mobile-test-results/native-core-integration/run.py <命令JSON>`
执行有限的 `xcodebuild test-without-building` 选择，RED为2项，GREEN为12项。

## 剩余验收与回退

真实账号／CDN、实际网络切换、物理iPhone／iPad、网易云30分钟锁屏、系统挂起／耳机／蓝牙、
iOS17运行时、歌词精度和长期动画／内存／温升本批均 **NOT_RUN**。没有新增WebKit或视觉验收结果。
个人mobile.28和服务器未更新，原版动效与设置UI未改；继续按两平台核心、原版动画、设置UI顺序推进。
回退本批播放命令分支即可，无数据迁移或缓存格式变更。
