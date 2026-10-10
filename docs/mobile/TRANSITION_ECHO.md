# 原回声过渡执行层

2026-10-11。源码开发阶段，个人已安装版本仍为 `BUILD_RECORD.json` 的 mobile.10。
本阶段不生成新 IPA，不启用尚未完整的 Automix；当前 Crossfade 原规划不会要求回声。

## 实现与复用

- 从原 `crossfadeGraph.ts` 提取 `planEchoThrow` 和常量到 `echoThrow.ts`，保留原注释。
  Web Audio 和原生 JavaScriptCore 使用同一函数。原 `automixSession.ts` 的抛出时间计算也共用
  `echoThrowAt`：beatCut 在起点，其余在交叉点。原曲线、节拍规则及参数没有另定。
- 默认延迟 0.25 秒，有节拍时使用半拍并限制为 0.08–1 秒；发送增益 0.6，反馈 0.45，
  提前 0.15 秒开启，至少 1ms 的晚到保护，在抛出后 30ms 关闭；取消发送按原 50ms 恢复。
- 从既有 `AudioWowDelay` 提取原线性插值缓冲 `AudioDelayLine`，供抖晃和回声复用；
  不新增依赖、系统音效替代品、解码器或第三方源码复用范围。缓冲在控制侧预分配，
  音频回调不分配数组、不运行 JS、不等待控制锁。每路两秒立体声缓冲约 0.67MiB@44.1kHz，
  另有 128 帧反馈缓冲；这是运行时缓冲估算，不是 IPA 或实测峰值内存。
- `TransitionEcho` 从 tone 后、fade 前的 PCM 取声，回声返回绕过 dry fade，再进入原有共享效果链。
  调度由同一采样时钟及代次驱动；取消发送保留已在缓冲中的尾音。未请求过回声时返回严格零。
- 实测 WebKit 的反馈 GainNode 使用上一轮 **128 帧** 渲染块。这一延迟仅放在反馈路径，
  第一遍回声保持原延迟；不把反馈渲染延迟错误地加到整条延迟线上。
- 旧包、默认 Crossfade 行为、主题、设置和歌词动画不变。新 `echo` 包络字段只在原规划要求回声时出现，
  原 36 组无回声曲线参考保持不变，Swift 边界验证有限数值、时序和缓冲范围。

## 独立数值与接线证据

- `echo-webkit-reference.log`：在抽取前用真实 WebKit OfflineAudioContext 调用原
  `connectAutomixDeck`、`scheduleEchoThrow`、`resetThrow`，只替换离线媒体元素源。
  24 组覆盖 8/44.1/48/96kHz、无节拍、分数延迟、上下界、开始前／中途取消和停输入后的反馈尾音。
  原干声增益为零，保证参考实际来自原回声支路。JSON 只进入 NativeTests，不进入 App 资源。
- `echo-webkit-serialized.log`：抽取后逐字段／逐数值与上述冻结 JSON **精确一致**；仅对两侧使用
  相同 JSON 表示，消除 JSON 不保留负零的差异。没有重生成基线。
- `echo-unit-corrected.log`：移动与原 Automix 36 文件、489 项 PASS。
- `echo-native-quantum.{log,xcresult}`：原生专项 7 项 PASS，1.294 秒。24 组 PCM 以两种回调
  分块及 10 亿帧绝对时钟重放，最大误差 **8.195639e-08**；无效输入／空回声，以及提取缓冲后
  原抖晃的四项 WebKit／声道／取消／重置测试均通过。
- 双 WAV 解码器在真实 AVAudioEngine 共享图执行原频带、增益和回声包络，确认 dry fade 已为零时
  PCM 中仍可测得回声；所有样本对照通过。此接线预期使用上述独立 WebKit 验证过的原生执行器，
  不将它另算一份独立 DSP 对照。未将 PCM 测量称为人耳听感验收。
- `echo-final-typecheck.log`、`echo-mobile-build.log`：最终 TypeScript／移动构建 PASS。
- `echo-full.{log,xcresult}`：iPad Pro 11-inch (M5) / iOS26.5 / Release，**157 项 PASS，
  69.583 秒**。沿用既有基线，排除三个需独立 HTTP fixture 服务的测试，本轮未重跑这三项。
  原队列、DSP、受控在线传输、凭据与缓存回归通过。固定 AudioStreaming 的 59 文件及两处历史
  补丁核对通过，本阶段 vendor、依赖锁文件和冻结的旧基线均未改变。
- `echo-device.{log,xcresult}`：iPhone XS Max / iOS18.7.10 / Release，**7 项 PASS，1.279 秒**。
  包括三个回声测试与四个原抖晃测试；PCM 最大误差仍为 8.195639e-08。
  `echo-device-build.log` 记录独立 QA 构建；签名 App、测试插件和清单宿主均核验为 QA 身份，
  记录 `echo-device-identity.json`。本次清单无需修改宿主 ID，保留原清单并使用副本运行。
  完成后卸载 QA（`echo-qa-uninstall.json`），回读确认个人包仍为 build 10（`echo-personal-app.json`）。
  这些均是受控 PCM 短测试，不代表真实平台、物理听感或后台长期验收。

## 失败与修正

`echo-native-first` 的 6 项中，回声 PCM 一项产生 40 条断言失败，最大误差 0.05153873；
另外五项通过。逐项诊断表明第一遍回声位置正确，差异从第二次重复开始。比较主路径与反馈路径
各增加 128 帧的四种时序，只在反馈路径增加一轮时，四种采样率的默认样本均恢复匹配；进一步
重放全部 24 组后确认。原生回归验证该修正，不调整音乐参数、不放宽 1e-5 PCM 断言。

`echo-unit` 首次失败为测试把 `2.001 + 0.03` 写成了二进制表示不同的字面值 `2.031`，
期望改用原加法表达式后通过；产品公式未变。`echo-webkit-extracted` 首次精确比较仅有负零与零
差异，统一 JSON 表示后通过，非零值继续逐值精确校验。失败日志均保留。

## 后续阶段：固定双路音频链与解码器生命周期

原 Web `settle` 暂停出场媒体元素、重置发送，却保留两路音频图及延迟缓冲。现在原生也保留两个
逻辑 deck：每路由系统 mixer 与复用的 `AudioEffectUnit` 适配器承载 `TransitionDeckProcessor`，
两路再汇入既有的一份整体音效与最终音量。原始解码节点只负责 PCM 和效果前分析，可以独立拆除。

- `StreamMixOutput.remove` 不再随解码器销毁 tone／echo；空 mixer 继续提供零输入，已发出的尾音
  继续通过同一音频时钟渲染。没有保留旧播放器、网络任务或签名地址来维持声音。
- 新来源身份通过音频回调邮箱采纳：新歌不继承旧身份的淡出或 trim，不进入旧回声发送；已发出的
  回声返回继续存在。两个逻辑 deck 固定复用，不为每首歌累计新增音效链。
- AU 输入和输出均为双声道 Float32，系统 Accelerate 做布局转换；不重采样、不新增 DSP 算法。
  工作缓冲在渲染前分配并验证上限；同采样率的 AU 资源重分配保留 tone／echo 历史。
- 继续沿用原暂停、配置变化、队列清理与关闭入口；完整回归验证已有行为和对象释放。
  实际暂停期间的回声听感、长时间后台与路由切换仍需随完整 Automix 做真机验收。

证据在 `.mobile-test-results/`：

| 验证 | 结果 |
| --- | --- |
| `deck-lifetime-first.{log,xcresult}` | 原增益、频带、回声的真实双解码器 3 项 PASS；PCM 最大误差 0 |
| `deck-lifetime-graph.{log,xcresult}` | 新增生命周期与资源重分配 2 项 PASS |
| `deck-lifetime-full.{log,xcresult}` | iPad Pro 11-inch (M5) / iOS26.5 / Release，159 项 PASS，69.953 秒 |
| `deck-lifetime-device-build.log` | 独立 QA 开发签名构建 PASS |
| `deck-lifetime-device.{log,xcresult}` | iPhone XS Max / iOS18.7.10 / Release，12 项 PASS，7.410 秒 |

新增用例故意在旧发送窗口尚未关闭时移除出场曲，确认解码器弱引用已释放，再渲染尾音及接入新歌。
模拟器与 iPhone 均测得跨拆除尾音峰值 0.075、复用后尾音峰值 0.07289541，逐样本最大误差
**2.9802322e-08**；源节点数量拆除时减一、复用时恢复，公共时钟连续，新歌干声保持正常。
这是使用前述 WebKit 独立验证过的执行器检查图连接及生命周期，不另算一份独立 DSP 基准。
资源重分配用例还覆盖左右不同输入、连续替换待采纳身份、缓冲增长及非法容量／采样率。

真机其余用例回归原曲线、独立回声参考、共享音效／静音、分析、暂停／seek、账号移除、配置通知和
所有者释放。中断／路由事件仍为受控注入。完整模拟器回归沿用此前三个 HTTP 服务用例的排除项；
本轮未重跑独立 HTTP 服务测试，也没有访问真实音乐平台。固定上游 59 文件、2 处历史补丁再次核对通过。

App、测试插件与 `.xctestrun` 宿主的签名身份均为独立 QA；核验记录
`deck-lifetime-device-identity.json`，原清单保留，本次无需修正宿主 ID。
QA 已移除（`deck-lifetime-qa-uninstall.json`）；回读个人安装仍为 build 10
（`deck-lifetime-personal-app.json`）。没有新 IPA、依赖／vendor、主题、设置或 Web 算法变更。

本阶段编译与测试均首轮通过。检查工具的两次非产品错误为设备查询 shell 引号不配对，以及读取
测试插件不提供的 `CFBundleVersion`；修正检查方式后核验通过，签名及宿主 ID 验证没有省略。

## 尚未完成

共享输出的回声尾音生命周期已有上述证据，完整 Automix 控制器仍未启用，Crossfade 默认规则仍不产生回声。
伸缩、档案与实时节拍对齐、完整模式、原过渡动画、ReplayGain、模型分支也仍待接入。

真实 QQ／网易云 API/CDN、长时间锁屏、耳机／蓝牙／网络切换、歌词 150ms 目标和持续性能
未在本阶段验收，不以这些短测试替代。
