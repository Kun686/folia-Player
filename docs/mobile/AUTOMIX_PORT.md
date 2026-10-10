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
- 静默准备、暂停和结束不推进歌曲时钟；取消某路不停止另一条解码器。本阶段仅验证能力，
  随后 mobile.8 的默认链路接入见文末。
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
| 原规划与曲线计算 | PASS；Crossfade 原生队列测试已调用，完整 Automix 尚未接入 |
| 两个解码器汇入同一混音与整体 DSP 输出 | PASS；mobile.8 源码已接入 App 默认原生队列 |
| 按采样时钟调度原增益曲线 | PASS，执行层、Crossfade 原生队列与原设置已接入开发源码；未替换 mobile.8 |
| 频带交接、回声、伸缩 | NOT_IMPLEMENTED |
| 本地 profile 获取与分析缓存 | PASS，原分析无模型分支、原生静音边界接线；仅开发源码，见文末 |
| 在线 profile（关闭媒体缓存时） | 已接入原 1.5MiB 前缀策略；受控传输／分析测试通过，真实在线队列验收未通过，见文末 |
| 完整媒体缓存、Beat This! / htdemucs 模型与表演手势 | NOT_IMPLEMENTED |
| Crossfade 队列、暂停、拖动、手动选曲与尾曲清理 | PASS，原生测试及设置接线；默认关闭，尚未生成新交付包 |
| 原开关、模式、时长设置 | PASS，原面板／store／桥接／原生持久化；开发源码 |
| 分析证据、完整 Automix、动画事件接线 | NOT_IMPLEMENTED |
| 真机连续混音、听感、功耗与歌词时序验收 | NOT_RUN |

下一步补完整媒体缓存、在线链路验收与完整 Automix。mobile.7 每个播放项独立处理音效并输出；mobile.8 已改为共用整体音效和最终音量，
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

## 开发阶段：原增益曲线在采样时钟执行

本阶段未生成新安装包，`BUILD_RECORD.json` 仍标识已安装的 mobile.8。
不改现有界面、主题、动画、原规划函数或默认设置；完整 Automix 仍未交付。

### 复用与实现边界

- 继续调用原 `scheduleCrossfade` 对应的 64 点曲线和 `NativeTransitionPlanner`，解码、格式转换、
  共用混音和整体音效不重写。没有新增依赖、修改 vendor 或扩展 WebKit 源码复用范围。
- 新增 `TransitionGain` 只负责原曲线的 AudioParam 时间插值及取消后的 30ms 线性恢复。
  现有 `AudioEffectRamp` 是指数 `setTargetAtTime`，不适用于这里的曲线／线性语义，故不混用。
  曲线在控制侧验证并转成 Float32；音频回调不运行 JavaScript、不创建曲线缓冲、不等待控制锁。
  已替换曲线保留到下一次控制调用释放，避免音频回调释放数组。
- 两路由同一图串行拉取，按同一采样时间只接收一次控制命令。控制操作即使发生在两路拉取之间，
  也不能让它们使用不同方案。每个源有独立 UUID，新的源不继承旧源的静音；取消递增代次并拒绝旧规划结果。
- `StreamMixOutput.scheduleGain` 将原包络接入两个解码器；暂停、系统配置变化取消旧曲线。
  暂停后的恢复从取消前最后渲染的增益开始，不沿跳变的系统时钟继续旧淡出。
  **此接口尚未接入 PlaybackEngine 的自动选曲、尾曲清理、拖动及设置生命周期。**

### 验证证据

- `transition-gain-reference-knots.log`：真实 WebKit `OfflineAudioContext` 调用原版
  `scheduleCrossfade` 和 `rampGain` 生成 48 组样本，覆盖 8/44.1/48/96kHz、三种交叉／平台形状、
  整数及分数采样起点、开始前取消与中途取消；检查曲线节点、回调边缘和恢复终点。
  `TransitionGainReference.json` 只加入原生测试资源，不进入 App 资源。
- `transition-gain-typecheck-retry.log`：TypeScript 检查通过。
- `transition-gain-full.{log,xcresult}`：iPad Pro 11-inch (M5) / iOS 26.5 / Release，
  **105 项原生测试全部通过，44.632 秒**。原队列、凭据和 DSP 测试一并回归。
  新增验证包含两种回调分块、反转源拉取顺序、10 亿帧绝对时间、无效缓冲、旧请求拒绝、
  暂停后时钟跳变，以及两路实际 WAV 解码经过共享混音与效果器的输出。
- WebKit 对照最大绝对样本误差 `9.536743e-07`；实际双解码器经原规划包络执行，最大误差
  `2.9802322e-08`。结束后移除出场曲，入场曲左右声道仍为已知的 `0.125/-0.0625`。
- 真实模拟器音频回调的时钟探针：迟加入的音源与先播放音源在 41 组相同 host time 下，
  sample time 最大差异为 0；暂停／恢复及停止／重启后时钟会前进。

### 失败记录与仍需验证的部分

首轮原生构建因测试 JSON 未加入 NativeTests 文件组而失败，修复资源引用后通过。
初版参考脚本漏展开曲线节点索引，TypeScript 检查指出后已修复并重新生成完整样本。
WebKit 实测表明，原 `rampGain` 读取的是最后渲染样本的 `AudioParam.value`；取消恢复已按这一行为对齐。

双解码器输出测试最初只等待播放进度大于 50ms，随后读到了启动阶段的静音。
增加时钟及 PCM 诊断后，证实该静音在调度增益前已存在，两个解码器均处于 playing 且有约 3.93 秒缓冲；
这排除了本次曲线调度和供数不足作为该失败的原因。格式转换提前拉取和缓存指针假设未得到证据支持。
最终测试先要求两个连续缓冲的左右声道达到已知 PCM 基线，随后逐样本检查全部曲线，容差未放宽。
失败日志 `transition-gain-output*`、`transition-gain-buffer-contract` 均保留。

**当时待查清的启动静音已在下一阶段定位并修正，见下文。** 上述测试证明稳定出声后的曲线执行，
不证明启动无延迟、真实队列已经无缝过渡、150ms 歌词目标、物理设备听感、后台连续混音或功耗通过。
下一阶段仍需接原队列与设置生命周期、频带／回声／伸缩、分析缓存及原过渡动画事件。

## 开发阶段：消除 TimePitch 延迟并接入原生 Crossfade 队列

### 根因与修正

`transition-startup-isolate.{log,xcresult}` 在同一模拟器、同一 44.1kHz 交错 PCM 格式下比较：
系统 input→mixer 首帧在 0；增加已 bypass 的 AVAudioUnitTimePitch 后，首帧变为 4096；
原外部解码输出同样在 4096 才出声。约 92.88ms 的延迟来自旁路的 TimePitch，非供数不足或曲线调度。

外部渲染现直接调用依赖已有 `inRender`，将已校验的宿主缓冲交给其原 PCM 环形缓冲读取，
继续复用缓冲等待、seek、补零和 EOF 处理。不新增解码、复制算法或依赖，也不修改原非外部输出路线。
此接口明确返回原始 PCM；外部宿主拥有整体音量、DSP 以及后续待接入的时间伸缩，不再经过库内 TimePitch。
vendor 仍为同一固定提交的 59 文件、仅两文件有差异，完整补丁和逐文件哈希同步更新并核对原 checkout 通过。

修正后首个非零帧为 0；四秒输入的全部 176,400 帧均保留，最后非零帧为 176,399，包含末尾不满一个回调的 272 帧。
原包络经两路实际解码器和共享音效图的对照最大样本误差为 0。
这不是物理扬声器端到端零延迟或歌词同步验收；系统 I/O 延迟仍需实测。

### 原生队列闭环

- `NativeCrossfade` 直接调用已打包的原 `planForMode(mode: crossfade)` 和原包络函数，
  使用实际解码时长，保留原最大时长、短曲四分之一上限及不足空间时自然结束的规则。
  此阶段离线 profile 与逐 deck 实时分析显式为 null；本地 profile 后续接入见文末，完整原版效果仍未完成。
- 先连接仍静默的待播解码器、提交成对增益，再释放其 PCM 读取，避免下一首先以满音量闯入。
  原生队列切为入场曲，旧曲保留到音频时钟确认淡出结束；尾曲提前 EOF 只释放尾曲，不重置入场曲曲线。
- 按歌曲时间预约原生启动回调，不把过渡起点量化到 250ms 快照轮询。回调再次读取实际媒体位置；
  暂停、拖动、队列变更和新播放意图会取消旧预约及旧规划。音频时钟的代次也参与收尾检查。
- 暂停／中断、拖动、选曲、关闭过渡和删除尾曲所属账号会清理旧过渡。恢复播放或拖动后继续预备下一首。
  只编辑后续队列保留正在发声的两曲。按原 `resolveNextQueueSong`，单曲循环与同歌曲身份之间不做过渡。
- 仍最多两路发声；过渡中不额外预加载第三路，结束后再准备后续曲目。曲目仍按原身份和代次解析，
  没有复制 provider 规则、转发额外认证信息或改动界面与动画。

**此控制器默认关闭；设置接线在下节完成，profile、实时分析、动态响度平衡和动画事件尚未接入。**
它不是已交付的完整 Automix；mobile.8 安装记录未改。

### 本轮证据与失败记录

- `transition-startup-raw-pcm`：首帧、末尾完整性、seek、外部缓冲校验通过；旧测试要求进度大于 50ms
  而新链路仅 23.22ms 就已输出两个完整非零缓冲，导致两条过时断言失败。改为要求实际两个 PCM 缓冲及相应进度，
  并保留原逐样本误差断言。
- `transition-queue-first`：六项中五项通过。账号退出测试在“过渡状态已建立、入场解码器尚未报告 playing”
  时断言正在播放而失败；辅助函数改为等待真实 outputIsPlaying 后执行用户动作。`transition-queue-retry` 四项通过。
- `transition-queue-full`：111 项全部通过，52.647 秒。
- `transition-queue-deadline-full`：包含按媒体时间预约后的最终完整 Release 回归，**111 项全部通过，51.032 秒**。
  设备为 iPad Pro 11-inch (M5) / iOS 26.5 模拟器；除既有测试外，覆盖真实双解码器队列交接、尾曲清理、
  后续预备、暂停恢复、拖动、快速选曲、关闭过渡、原子拒绝非法设置、队列编辑、尾曲账号退出、单曲循环和重复身份。
  不依赖 WKWebView 执行规划或调度，但仍不等于 30 分钟真机锁屏／耳机／网络切换验收。

上一阶段源码 `7b92c1c` 的 [CI 38070318733](https://github.com/Kun686/folia-Player/actions/runs/38070318733)
已确认成功；本阶段远端 CI 以新提交对应 run 为准。


### iPhone 队列验证与测试宿主修正

`transition-queue-device` 首次构建／签名／安装成功，但 Xcode 普通 `test` 启动了仍安装的个人 App，
从个人包路径查找不存在的 XCTest 插件，测试未运行。独立 QA 包使用 `app.folia.validation.App`，
个人包仍为 `app.folia.personal` / build 8；没有覆盖或卸载个人 App。

改用 `build-for-testing` 后，核对生成 `.xctestrun` 的 `TestHostBundleIdentifier` 与实际签名包的
`CFBundleIdentifier` 均为 QA 身份，再执行 `test-without-building -xctestrun …`。
`transition-queue-device-explicit`：iPhone XS Max / iOS18.7.10 / Release，7 项通过，6.786 秒。
真机也测得 TimePitch 4096 帧延迟、修正后原始 PCM 首帧 0／末帧 176399／176400 帧完整，原曲线混音最大误差 0。
仍是音频回调中的受控样本验证，不是扬声器听感或长时间锁屏验收。

## 开发阶段：原设置面板接回原生队列

- 复用 `TransitionSettingsSection`、`useAutomixSettingsStore` 及其原操作，不新建另一套模式或时长规则。
  桌面／Web 的能力判断与行为默认不变；移动容器显式提供当前分析能力，并清楚显示 Automix 暂不可用、
  实际使用 Crossfade。保留原默认关、默认所选模式和 1–25 秒范围，不将 Crossfade 标称为完整 Automix。
- 开关、所选模式、时长由原生验证后保存到 UserDefaults；启动时恢复到原生控制器与前端原 store。
  这是不含秘密的功能配置，平台凭据继续由原 Keychain 路径保存。非法参数不会部分修改播放或持久化。
- 沿用原音量设置的串行写入／快速编辑合并／失败回退逻辑，提取为两者共用的 `connectNativeSettings`。
  初始化失败时禁用编辑；关闭面板保留同步订阅，销毁播放器时取消订阅，迟到结果不更新已卸载界面。
- 设置面板隔离移动播放器的通用按钮样式，保留原版开关外形并扩大触摸区域。设置打开时暂停视觉渲染，
  音频继续由原生拥有。原过渡动画仅画 Automix，不能借 Crossfade 假造动画事件；本轮没有改动该规则。

证据均位于 `.mobile-test-results/`：

| 验证 | 结果 |
| --- | --- |
| `transition-settings-unit.log` | PASS，移动逻辑 46 项，含真实 store 的恢复、并发编辑、回退与卸载竞态 |
| `transition-settings-typecheck.log` | PASS，TypeScript |
| `transition-settings-ui-retry.log` | PASS，手机／iPad／窄窗口的过渡、音量与音效错误路径，共 9 项 |
| `transition-settings-ui-final.log` | PASS，隔离按钮样式后过渡设置三尺寸 3 项；已检查截图 |
| `transition-settings-native-signed.{log,xcresult}` | PASS，iPad 模拟器 Release 全量 112 项，51.365 秒 |
| `transition-settings-sync.log` | PASS，移动生产资源打包及 Capacitor 同步；保留既有大 chunk 警告 |
| `transition-settings-device-build.log` | PASS，独立 QA App 开发签名构建 |
| `transition-settings-device.{log,xcresult}` | PASS，iPhone XS Max / iOS18.7.10 / Release，8 项，6.856 秒；含设置保存恢复与队列闭环 |
| vendor 核对 | PASS，固定上游 59 文件、2 处修改、逐文件哈希及完整补丁 |

失败记录：首轮 UI 音效断言仍使用历史“仅立体声”文案，三个尺寸均因文案不同失败；当前实现已支持单声道，
按现有格式不支持提示修正断言后通过，没有改产品文案迁就测试。原生首轮 `CODE_SIGNING_ALLOWED=NO` 导致
Keychain 测试失败，其余 111 项通过；恢复此前使用的 `CODE_SIGN_IDENTITY=-` 后全部 112 项通过，未改 Keychain 实现。

QA App 已移除，个人 mobile.8 保留，未生成新 IPA、未改 BUILD_RECORD.json。
未完成：原 profile／实时分析输入、动态响度平衡、频带／回声／伸缩、完整 Automix 和原过渡动画接线；
三平台真实账户／流媒体、30 分钟锁屏、物理耳机／蓝牙／网络切换、150ms 歌词同步与功耗验收仍分别保留原状态，
本轮短样本和模拟界面测试不替代这些证据。

## 开发阶段：原本地歌曲分析与静音边界

### 复用与实现边界

- `nativeProfileRuntime.ts` 直接调用原 `analyseTrack`，使用原 version 9、22050Hz 和既有
  `gridless: true` 无模型分支。没有复制频谱、节拍、结构或静音检测算法；未接入 Beat This! / htdemucs，
  不将未运行模型解释为模型已确认无节拍。打包后的 `profiles.js` 为 12,708 字节，这是脚本大小，非安装包增量。
- `analyseTrack` 仅增加可注入的 FFT 运算接口；Web／worker 继续用原 FFT。原生复用项目已有的系统
  Accelerate，提供 2048 点双精度正向变换，所有窗口、权重、节拍／结构判定和参数仍由原 JS 代码决定。
  JSC 的数组指针只保证当前 API 调用期间有效，因此按 SDK 约定立即复制到复用缓冲，再计算和写回；
  不保存临时指针，不为每个分析帧新建工作数组。设置随分析上下文释放，缓存键区分该执行路径。
- 系统 AVAudioFile / AVAudioConverter 解码本地文件，使用最高重采样质量；mid/side 与原版一样先做
  双精度计算再写 Float32。一个 actor 串行运行分析，每次创建短生命周期 JavaScriptCore 上下文；
  PCM 直接作为有原生所有者的 typed array 输入，不经过 JSON 或 WKWebView，不在主线程或音频回调分析。
- `NativeProfileCache` 只保存原 profile，完整本地文件按版本、无模型分支、路径、大小和修改时间隔离。
  SHA256 校验损坏记录，原子写入，首次解锁后可读取；磁盘最多 200 条，内存最多 200 条。
  记录不含路径、音频、平台 Cookie 或签名 URL；缓存失败不影响播放，partial 结果不替换完整缓存。
- 当前／下一首本地歌曲进入分析范围，队列变化取消过时任务；请求 UUID 与结果版本避免迟到结果覆盖新意图。
  原 Crossfade 直接读取实测 leadIn / leadOut，并使用原 0.1 秒入场余量准备下一首。
  手动选曲、关闭过渡后的自然切歌从零开始；预备 seek 即使在 PCM 就绪前取消，也不能误用已偏移的解码器。
- 仅支持系统可解码的单／双声道完整本地文件。工作内存保护上限为 20 分钟，分析执行预算为 45 秒；
  超限或格式不支持时继续普通播放、使用原无 profile 退化规则。尚未完成大文件内存／功耗验收。
  同一 PCM 的分析对照不代表系统重采样与 Web Audio 的所有输出样本完全相同。
- 本地分析阶段尚未接在线获取；后续在线阶段见下文，遵循原 `profileService.ts` 的缓存与带宽策略：关闭缓存时仅取
  1,572,864 字节的 206 前缀，拒绝服务器返回的 200 全量响应，不能暗中下载整首待播歌曲。

未新增依赖、改变原决策规则／默认设置／界面／主题／动效，也没有生成新 IPA 或修改 BUILD_RECORD.json。
完整 Automix 的实时分析、响度平衡、频带交接、回声、伸缩和动画事件仍未完成。

### 验证与失败修正

- `profile-reference.log` 与 `profile-mobile-tests.log`：原分析 8 组确定 PCM 对照，涵盖静音、短曲、
  首尾静音、立体声、结构、节拍及 partial；移动逻辑最终 48 项通过。参考 JSON 只进入测试包。
- `profile-fft-unit.log`：增加可注入 FFT 后，移动逻辑及原 Automix 相关 32 个文件共 **462 项通过**；
  参考数据未重生成，Web 默认仍走原变换。
- `profile-fft-typecheck.log`、`profile-fft-sync.log`：最终 TypeScript、移动资源构建及 Capacitor 同步通过。
- `profile-fft-full.{log,xcresult}`：最终 iPad Pro 11-inch (M5) / iOS26.5 / Release，
  **121 项原生测试全部通过，52.841 秒**。新增 9 项涵盖原 8 组分析数值（1e-6 容差）、
  系统重采样／单声道、取消／错误恢复、PCM 释放、缓存损坏及文件变化、过时范围取消、
  实测静音边界进入真实解码队列、手动选择／关闭过渡及取消预备 seek 的竞态。

首轮构建修正 Int32 与 Int 比较。系统解码初次到达已知 EOF 后再次读取得到无 NSError 的失败，
改为先检查 `framePosition < length`。默认重采样质量将恒定 0.5 变为 0.49998873，
改用系统最高质量后为 0.5000003，保留 1e-5 断言。队列测试最初 seek 到 7.2 秒，
留给测得有声结尾的时间不足原 0.8 秒最短过渡，按原规则不淡化；改为 6.5 秒后通过，未修改算法阈值。
原失败日志 `profile-native-first`、`profile-native-retry`、`profile-decode-eof`、`profile-queue-first` 均保留。

真机首轮 `profile-device` 为 6/9 项通过，三项队列／范围用例因 5 秒时限失败。系统重采样为 0.013 秒，
8 组原 JS 分析耗时 29.460 秒，数值对照通过；耗时集中在分析而非解码。引入系统双精度 FFT 后，
`profile-fft-device.{log,xcresult}` 在同一 iPhone XS Max / iOS18.7.10 / Release 上 **9/9 项通过，
20.874 秒**；同样 8 组分析变为 **3.982 秒**，保持 1e-6 字段容差。未放宽任何队列时限或数值断言。
这是这组受控 PCM 的前后测量，不是所有歌曲、温升或长期性能结论。QA 测试包已卸载，
`profile-qa-uninstall.json` 为 success；`profile-personal-app.json` 回读个人包仍为 build 8。

首次远端 Linux CI `38075172073` 的参考文件断言失败：例如调性置信度仅相差约 6e-16、结构边界约 5e-15。
同一运行时的包装层与原函数仍逐字段精确相等；仅将跨系统保存的 JSON 浮点参考改为 12 位小数精度比较，
整数、字段集合、布尔、null 与数组结构仍精确校验。参考文件及产品代码不变，原生 1e-6 容差不变。

## 开发阶段：在线歌曲的有界前缀分析

### 复用与行为

- `NativeProfilePrefix` 使用系统 URLSession 读取当前／待播解码器已经持有的 HTTPS 地址，
  不调用平台解析接口。原 `profileService.ts` 的关闭媒体缓存路径规定 1,572,864 字节前缀；
  原生请求相同 Range，收到 200 时立即取消，不接受未经约束的全量音频。
- 校验 206、从零开始的 Content-Range、长度一致性及未压缩响应；读取中再次限制实际字节数。
  禁止 HTTP 降级／URL 用户凭据，最多五次 HTTPS 重定向；每次重建请求，禁用 Cookie、认证存储、
  继承请求头和 URL 缓存。模块只返回错误代码，不记录地址或凭据；最多 30 秒资源请求时间。
- 继续复用 AVAudioFile / AVAudioConverter 与原 `analyseTrack` 无模型分支。临时文件有首次解锁保护，
  无论成功或失败均清理；结果明确 `partial: true`，未读取的尾部字段为 null。格式无法解码时保留原无 profile 退化路径。
- `NativeProfileIdentity` 复用原生歌曲清洗，按平台、标准音质、来源标识／representation 元数据与分析版本隔离。
  签名 URL 仅留在当前分析范围内；更换 URL 可重试，缓存记录不保存 URL。只有测得的在线 profile 落盘。
  原本地完整分析缓存不受影响；完整媒体缓存仍未实现，不能把本阶段称为“在线全曲分析”。
- 换歌、删除待播和退出平台会取消过时任务；UUID 防止旧结果发布。退出还清除该平台内存／磁盘分析记录，
  同平台的新分析等待清理完成，保留其他平台与本地记录。单次分析异常不使正在播放的歌曲失败。
- 队列已把当前／待播 occurrence 的实际 URL 传入分析层；原规划读取分析结果。这是源码接线事实，
  目前缺少在线源经真实网络和解码队列发生正确过渡的端到端证据。

### 验证与边界

- `online-profile-first.{log,xcresult}`：前七项专项通过，1.339 秒。
- `online-profile-full.{log,xcresult}`：iPad Pro 11-inch (M5) / iOS26.5 / Release，
  **129 项全部通过，54.321 秒**。本阶段八项新增测试使用 URLSession 的受控 URLProtocol，
  覆盖全量响应拒绝、请求头、范围溢出／截断、取消与所有者释放、重定向回调、实际截断 WAV 解码、
  原分析 partial 字段、跨平台／representation 缓存及退出竞态。既有真实本地解码队列回归也通过。
- 完整回归依照此前基线排除了三个需要独立 HTTP 服务的既有测试，本轮未重跑这三项。
  固定 AudioStreaming 59 文件、两处历史补丁与原 checkout 核对通过；本轮没有改 vendor 或依赖。
- `online-profile-device-build.log`：独立 QA 包构建／签名通过，核对 `.xctestrun` 和签名包均为
  `app.folia.validation.App` 后执行 `test-without-building`。
  `online-profile-device.{log,xcresult}`：iPhone XS Max / iOS18.7.10 / Release，**11 项通过，12.204 秒**，
  包括新增八项与既有本地缓存、范围取消及实测静音边界队列。`online-profile-qa-uninstall.json` 记录 QA 卸载，
  `online-profile-personal-app.json` 回读个人包版本；不把手机上的受控 URLProtocol 测试记为真实联网验收。

`online-profile-queue` 的额外在线队列集成试验未通过：全局注册的 URLProtocol 没有拦截实际解码请求，
请求到达测试域名并失败，队列没有开始播放。`online-profile-queue-config` 改为显式注入分析网络配置后，
仍为 fixture requests=0、prefixes=0、resolves=1、playing=false；确认尚未进入分析链，第二次亦失败。
未继续重试。该用例及仅为它增加的构造注入已撤下；日志保留，不计入通过的回归数量。
需要后续用明确受控的传输接入或可信 HTTPS 音频服务补齐集成证据，不能用本地队列测试替代。

上述测试没有访问真实 QQ／网易云 API 或 CDN，也不验证网络 TLS、真实压缩格式前缀、长时间锁屏、
物理音频输出、150ms 歌词同步与持续性能。完整媒体缓存、完整 Automix、模型、实时测量及原过渡动画仍待接入。
未修改界面、主题、默认设置、音效参数或 BUILD_RECORD.json；本阶段源码尚未进入个人 mobile.8 安装包。
