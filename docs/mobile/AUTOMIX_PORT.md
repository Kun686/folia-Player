# 原版 Automix 移植记录

2026-10-11。本文件记录移植过程，已交付安装包以 BUILD_RECORD.json 为准。
完整 Automix 尚未接入移动播放器。

## 已验证：原规则独立于 WebView 执行

- `nativeRuntime.ts` 只增加 JSON 边界，直接调用既有 `planForMode`、`planBlendShape`、
  `shapeBlend`、`buildCrossfadeCurves`、`buildBandCurves`。原算法、常量和默认 64 点曲线不改。
- 已有 Vite 将这组纯计算模块打包为 `public/native/transitions.js`；系统 JavaScriptCore
  执行本地脚本，Swift actor 串行持有上下文。请求作为函数参数传入，不能变成脚本源码。
  没有新增 npm、SPM、模型或运行库依赖，不通过 WKWebView、服务器或网络执行。
- 输入限制大小、嵌套深度、节点数、有限数值、模式和数据结构；取消前后均检查，错误不带输入。
- TypeScript 检查、四个相关 Vitest 文件共 78 项测试通过，证据
  `.mobile-test-results/transition-boundary-json.log`。其中参考覆盖 80 组方案和 36 组曲线。
  首轮两项失败是 JSON 把负零序列化为零，统一序列化后通过；非零样本仍精确比较，原算法未改。
- iPad Pro 11-inch (M5) / iOS 26.5 / Release：四项原生测试通过（0.168 秒），
  在 JavaScriptCore 重放同一组 80 方案、36 曲线，另测错误恢复、缺失资源、取消与 16 个并发请求隔离。
  数值容差 1e-6。证据 `transition-native-first.{log,xcresult}`。
- `npm run ios:sync` 通过，证据 `transition-runtime-build.log`。规划资源首次构建为 99,630 字节，
  这只是脚本资源大小，不是 IPA 或安装体积增量。

这证明原规则可在原生运行时执行；不证明后台音频过渡已经发生。参考输入含受控 profile 和歌词，
不等于移动端已经能从真实歌曲测出这些输入。

## 已验证：解码器接入单一系统混音输出

- 固定 AudioStreaming 增加可选 `externallyRendered` 模式，默认关闭。启用时不创建、启动或停止
  每首歌的 RemoteIO 输出，只由外部图拉取既有解码器的双声道 PCM。解码、网络、缓冲和进度仍由原库管理。
- `StreamRenderSource` 用系统 AVAudioSourceNode 将交错 PCM 转为标准格式，输出接入同一
  AVAudioMixerNode，再经过一份既有 AudioEffectUnit 和最终音量。没有自研格式转换或解码算法。
  引用随音源节点存活，宿主停止渲染并拆除节点后才能释放；回调校验容量、声道和工作模式。
- 静默准备、暂停和结束不推进歌曲时钟；取消某路不停止另一条解码器。此能力尚未接入 App 默认链路。
- `shared-output-planar.{log,xcresult}`：三个专项测试通过，包含两路各 0.125 的样本相加为 0.25、
  待播开头保持、暂停恢复、独立停止、最终音量、拖动及 EOF。
- `shared-output-system-conversion.{log,xcresult}`：iPad Pro 11-inch (M5) / iOS 26.5 / Release，
  **完整 98 项原生测试通过，43.469 秒**。新增五项覆盖上述行为、不同左右样本（误差 1e-6），
  以及实际系统音频回调中的双解码器、共用音效和最终静音；既有队列、DSP、会话和四项规划测试回归通过。
  音频回调实测 RMS 0.04315842，500 Hz 低通后 0.00285365；加入噪声／混响后最终静音低于 1e-6。
  这里的实际输出是模拟器 AVAudioEngine 的输出回调，**不是物理 iPhone/iPad 听感或锁屏验收**。
- vendor 59 文件、哈希和完整补丁均与固定上游 checkout 核对通过，仍只改 AudioPlayer.swift、Package.swift。
  补丁保存上游原始空白，不改其版权说明。没有新增依赖或更改固定版本。

失败与修正记录：`shared-output-first` 的外部输出容量／静默测试通过，随后因节点输出连接使用交错格式
触发系统 -10868，停止该次测试。最初用预分配转换验证后，按 SDK 的 AVAudioSourceNode.h 改为系统自带
转换，节点输出连接使用标准格式；最终代码无手写声道搬运。`shared-output-full` 为 97/98 项通过，
声道逐样本检查出现 1024 条断言失败，均是测试在上游一秒启动缓冲完成前读到了零。
现在先要求播放时钟推进，再保持原精度断言；最终完整回归通过。所有原失败日志保留。

源码规划提交 `274fbb5` 的远端 [CI 38066581994](https://github.com/Kun686/folia-Player/actions/runs/38066581994)
通过 TypeScript、移动逻辑、vendor 和移动构建。共享输出后续提交的 CI 以对应 GitHub run 为准。

## 待接入的完整播放行为

| 部分 | 状态 |
| --- | --- |
| 原规划与曲线计算 | PASS，尚未接入 PlaybackEngine |
| 两个解码器汇入同一混音与整体 DSP 输出 | PASS；mobile.8 源码已接入 App 默认原生队列 |
| 按采样时钟调度增益、频带交接、回声、伸缩 | NOT_IMPLEMENTED |
| profile 获取、分析缓存、Beat This! / htdemucs 模型与表演手势 | NOT_IMPLEMENTED |
| 原设置与队列、暂停、拖动、失败、后台状态接线 | NOT_IMPLEMENTED |
| 真机连续混音、听感、功耗与歌词时序验收 | NOT_RUN |

下一步接原过渡调度。mobile.7 每个播放项独立处理音效并输出；mobile.8 已改为共用整体音效和最终音量，
但尚未进行音乐性过渡，所以不能据此宣称 Automix 等价。
原版 `connectStemBus` 的软限幅仅用于分离音轨的过渡总线，普通 crossfade 不经过它；
后续按原分支接入，不把限幅永久加到单曲或普通淡化路径。

解码、网络分段、缓冲与取消继续复用已批准依赖；任何 vendor 调整都同步完整补丁和文件哈希。
未经数值与实际输出验证，不启用新混音路径作为默认。旧包与旧播放路径保留回退。

## mobile.8：共享输出接回原生队列

- `StreamMixOutput` 管理一份系统混音、既有整体音效与最终音量。当前、待播仍按歌曲身份分别解析和缓冲；
  只有实际开始播放的解码器才连接输出。预加载不运行音效、不消费开头，也不改变当前输出图。
- `StreamOccurrence` 支持共用输出；队列沿用原请求代次、取消、登录失效、地址刷新与连续失败停止规则。
  删除待播项不重启当前歌曲；下一首继续使用同一份音效和频谱状态。
- 暂停、音频中断和队列清空会停共享输出，包含噪声与混响；解码器暂停不会被误认为全部音频已暂停。
  系统输出配置变化仅在仍有播放意图时恢复；已暂停的歌曲不会被配置通知唤醒。
- 曲目释放先从图拆除，再停止解码；播放器释放会停止系统图、取消通知并释放当前与待播项。
  无新增依赖，无主题、动效或原音效参数改动；原 AVQueuePlayer 路径保留。
- `shared-queue-first.{log,xcresult}`：首轮七项专项测试全部通过。
- `shared-queue-full.{log,xcresult}`：iPad Pro 11-inch (M5) / iOS 26.5 / Release，100 项全部通过，43.681 秒。
- `shared-queue-http.{log,xcresult}`：受控 HTTP Range 原生队列测试通过，1.400 秒；5,292,044 字节
  合成音乐在仅传输部分数据时已播放，删除已缓冲下一首后当前不中断，seek 后自动切到新下一首。
  loopback 测试服务完成后已关闭，不是真实平台验收。
- `shared-queue-device.{log,xcresult}`：iPhone XS Max / iOS 18.7.10 / Release，七项全部通过，8.906 秒。
  包括共享输出真实 PCM／音效／静音、四曲自动推进、缓冲删除、暂停／拖动／中断、配置变化与对象释放。
  中断与配置变化通过通知注入，未实际拔耳机或切蓝牙；短测试不代替长时间锁屏及听感验收。

mobile.8 最终签名安装和包体证据在 VALIDATION.md 单独记录；本节的原生测试 App 不等于最终交付包。
