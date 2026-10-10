# 移动候选验证记录

## mobile.7 之后：原版过渡规划（仅源码）

原版 Automix／crossfade 规则已能在系统 JavaScriptCore 中执行，无 WKWebView 参与。
相关 Vitest 78 项、iPad Release 原生 4 项通过，覆盖 80 方案、36 曲线及取消／并发／错误恢复。
这部分尚未接入实际过渡播放，完整 Automix 未完成；详情和证据见 [AUTOMIX_PORT.md](AUTOMIX_PORT.md)。
另修正三种语言中已过时的“附加音效需要立体声音源”提示。已安装 mobile.7 和 BUILD_RECORD.json 不变。

## mobile.7 双声道输出接入（当前开发候选）

已安装iPhone XS Max / iOS18.7.10并启动，设备回读build 7；开发候选仍不代表完整移植验收通过。
源码`f303ada6bae36e1547f2d9d19e384cc0887d5e05`，258个输入文件指纹
`ab2cb085e8eec2f1aff19ca6a4991b0a349d0bc79ee016ee4713e94355befd44`。
安装包`Folia-0.7.16-mobile.7-ab2cb085-development.ipa`，7,375,321字节，
SHA256 `0daab3726abe21c8f88d9bd4009e0e43f7a8e0524df49dc5f52455e032b285bb`。
较同为Release的mobile.6增加484,525字节（约473KiB）；这是完整集成差值，不是单独依赖开销。
App普通文件合计14,994,037字节。mobile.6旧包及其元数据保持原样用于回退。

已按用户批准接入固定AudioStreaming 1.4.5及Ogg／Vorbis 0.1.2，保留原界面、音效预设和DSP参数。
上游队列不适合原删除语义，改为当前／下一项独立解码器；固定源码、两文件补丁与校验清单见
[AUDIO_OUTPUT_DECISION.md](AUDIO_OUTPUT_DECISION.md)。本节优先于下面的历史状态。

- `stereo-output-full.{log,xcresult}`：iPhone 17 Pro / iOS26.5 Simulator / Release，89项完整原生回归通过。
  包含WAV、AAC/M4A单声道的实际双声道音效，队列删除、相同URL不同播放项、快速切歌、静音、
  刷新／网络恢复、中断／暂停拖动、账户退出与既有DSP数值参考。未放宽原一致性阈值。
- `independent-preload-first`：本地及HTTP静默预加载、取消释放、保留当前播放通过；预加载输出帧数为0。
- `stereo-native-queue-closure`：5项通过；初次测试helper捕获非escaping闭包的编译错误已修复，
  失败记录`stereo-native-queue-first`保留。`stereo-recovery-first`新增2项通过。
- iPad Pro 11-inch (M5) / iOS26.5实际App播放验收音1后自动推进到4并结束；原音效面板可打开。
  截图`stereo-ipad-effects.png`、`stereo-ipad-queue-completed.png`。该次容器仍带旧前端版本标签，
  仅作为新后端的运行证据；新候选将从Xcode版本及当前Git身份生成标签。
- vendor原始59文件、当前哈希、两文件完整补丁校验通过；CI加入离线校验。
- `stereo-http-native-queue.{log,xcresult}`：3项通过。受控HTTP单声道实际音效、静默预载取消、
  完整PlaybackEngine删除缓冲曲目并独立切至下一首；没有WebView或真实平台参与。
  5,292,044字节音频在只读取部分字节时已播放，seek产生Range请求；测试服务结束后关闭。
- `mobile7-final-device-build.log`：clean Release构建通过；严格codesign校验、99个前端资源、
  两份完整许可证、随包版本／仓库／提交来源核对通过，最终包无测试插件。
  `mobile7-device-install.json`、`mobile7-device-launch.json`、`mobile7-device-app.json`确认安装启动及build 7。
- 最终源码的GitHub CI [38064957037](https://github.com/Kun686/folia-Player/actions/runs/38064957037)通过：
  vendor清单、依赖安装、TypeScript、移动逻辑和前端构建。
- `mobile7-device-native.{log,xcresult}`：iPhone XS Max / iOS18.7.10 / Release，6项真机原生测试全部通过。
  WAV／AAC真实Mono双声道PCM、低通衰减、左右噪声／混响差异、seek／暂停恢复、最终静音、
  中断恢复／账户退出、四曲自动推进及删除已缓冲下一首；16.498秒测试，不等于30分钟锁屏或听感验收。
- 首次包体核对发现Git常量被优化移除，补充随包`build-identity.json`后来源核对通过。
  首次远端CI `38064829732`失败：既有`models/`忽略规则漏掉4个已纳入本地校验的Swift文件；
  补充窄范围例外并提交原文件，校验器现在同时核对Git清单，避免本地未提交文件掩盖缺失。

真实QQ／网易App在线验收、真机锁屏／蓝牙／性能、歌词≤150ms、无缝间隔定量测量仍为NOT_RUN。
暂停时关闭效果分支的立即回收待测，Ogg不支持拖动；Automix及完整编辑工具仍未移植。

## mobile.6及其后续历史记录

mobile.5之后的附加音效开发单独记录在 [EFFECT_PARITY.md](EFFECT_PARITY.md)：32项相关原生测试通过，
包含固定WebKit过采样、压缩器、噪声／混响、组合链、线程交接及tap格式探测；Debug全部70项、Release相关8项回归通过。
随后实际tap接线9项、iPad Release内部链路14项通过；公开设置接入后的7项原生测试及6项界面测试通过。
当前mobile.6已开放立体声音效，Mono暂仅EQ并提示。

## 已批准的双声道流式输出首次验证（接入前历史）

AudioStreaming 1.4.5及Ogg／Vorbis 0.1.2已固定安装、校验并保留许可证。
新增AU音效适配复用现有DSP：本地／HTTP Mono实际双声道、可听滤波、左右噪声／混响差异、
拖动与暂停恢复通过；完整Release原生回归79项通过，见`streaming-native-standard-format`。
初轮AU交错格式测试失败，修正为SDK支持的标准格式及显式拒绝断言后通过，原记录保留。

上游队列另有真实复现的限制：初始化期间紧接入队可能丢项；删除已缓冲下一首无效。
能力探针确认缺陷不代表队列验收通过。因此实际播放器及已安装mobile.6未切换，Mono功能缺口尚未关闭。
详情、证据及复现命令见[AUDIO_OUTPUT_DECISION.md](AUDIO_OUTPUT_DECISION.md)。
新后端的完整App增量、真机和在线平台验收仍为NOT_RUN；本轮无界面变更，不重复跑UI套件。

## mobile.6之后的音效资源修复（仅源码）

- 噪声、混响与未改变的波形曲线复用；已准备但尚未播放的图同样复用素材。
- 分支淡出结束后由后续音频回调交接到控制线程释放，无需再次操作界面；
  失效分支会使借用旧素材的构造结果过期，避免重新启用旧卷积历史。
- iPhone 17 Pro / iOS 26.5 Simulator / Release：74项原生测试全部通过，
  证据effect-resource-final.{log,xcresult}。连续40次调参输出与独立参考图对照通过，
  噪声和混响各只构造一次；未播放图20次调参也只各构造一次。
- 首轮实际PCM测试把启动静音误当作音量基准而失败；加入播放时钟就绪条件和基准非静音断言后通过，
  原衰减／恢复断言未放宽。失败日志effect-resource-reuse保留，定向复测effect-resource-ready为8项通过。
- 后续测试确认当前模拟器的AVPlayer暂停后仍调用tap，关闭音效可完成淡出退役；
  中断／后台挂起时无回调的资源释放及真机性能仍为NOT_RUN。
- 此源码修复尚未打入交付IPA或安装至iPhone。BUILD_RECORD.json继续标识已交付的mobile.6，不代表修复后的源码。

## mobile.6 原音效与原生播放链

2026-10-10，0.7.16 / build 6，Release开发签名；源码身份见BUILD_RECORD.json。
复用原音效面板、六个音色预设、两个自定义栏位；非中性效果按需准备，原生EQ之后处理PCM，独立于WebView和FFT读取。
单声道附加音效尚未支持，继续EQ并明确提示。参数、主题和动效设计未更改，无新增生产依赖。

- TypeScript通过，移动逻辑38项通过；针对音效的三种尺寸WebKit界面6项通过。
- iPad模拟器Release全部71项原生测试通过，包含公开设置→实际PCM、预加载、持久化、Mono格式提示和既有队列／会话回归。
- 完整界面首轮20/21通过，iPad暂停检查失败；等待歌词加载完成以稳定控件布局后，失败单项复测通过。
  原始失败保留在mobile6-ui.log，复测与trace保存在mobile6-ui-retry.log及同名目录；没有提高断言容差。
- 原有Lumiere/Pixi滤镜诊断、Three弃用和React更新警告仍出现；模式可选择和挂载不等于所有动画已完整验收。
- mobile6-device-build.log构建通过，codesign严格校验通过；98个前端文件和完整DSP许可证与构建输入相同。
- iPhone XS Max / iOS 18.7.10安装、进程启动通过，设备回读为build 6。
  证据：mobile6-device-install.json、mobile6-device-launch.json、mobile6-device-app.json。
- 真机听感、30分钟锁屏、温升／内存、暂停资源释放、单声道立体声输出与App→网关真实在线验收仍未完成。

以下为mobile.5历史证据，其旧交付包与旁置元数据保持不变。

日期：2026-10-10。当前候选 **0.7.16-mobile.5 / build 5**，基于 mobile-main 的 4bfa668 继续移植。
当前源码指纹见 BUILD_RECORD.json。上游基线 d824c0b854e54d5411cb072092999823e9bd7071。
本轮校正原生频谱输入、恢复原版暂停呼吸，没有更改服务器、平台规则、主题／动效参数或生产依赖。
**本地工程验证通过，不代表真实在线账户／两台真机完整功能已验收。**

## mobile.5 原版音频动效输入

| 层级 | 结果 | 证据与边界 |
|---|---|---|
| TypeScript | PASS | spectrum-typecheck.log |
| 移动及声音逻辑 | PASS | 6文件49项，包含6项新增的原频段公式、Nyquist边界、暂停呼吸、并发请求、隐藏清理与错误恢复；npm run test:mobile -- test/unit/utils/audioEqualizer.test.ts |
| 原生完整回归 | PASS | 40项，spectrum-native-fixed.{log,xcresult}；含真实tap静音恢复及全部队列回归 |
| 频谱扩展对照 | PASS | 60组 × 3时间点 × 交错／分离格式；spectrum-native-layout-fixed.{log,xcresult} |
| 最终频谱格式UI回归 | PASS | WebKit手机／宽iPad／窄窗口共18项，spectrum-ui.log |

原生沿用原版2048点Blackman窗、0.6幅值平滑、−100至−30dB字节量程；
频谱按Web Audio规则下混，音量／静音只作用于分析副本，实际PCM不会被重复衰减。
FFT从音频回调移到按需快照：没有前台请求便没有FFT，400ms后停止采集。
音频回调只尝试锁；争用后重新建立完整窗口，不把不连续片段拼成伪频谱。
模式参数和动画组件未改变；原五频段响应及暂停呼吸提取为共同函数，
桌面保留原21.5Hz分箱边界，移动使用真实采样率；连续信号仍使用MotionValue。

独立参考由WebKit OfflineAudioContext生成，保存于SpectrumReference.json：
8／22.05／44.1／48／96kHz，单声道、右声道、反相抵消、四声道、5.1单独声道和离散布局；
音量1／0.25／0及信号转静音后的衰减。每个字节误差≤1（0–255），同一PCM重复读取不再次平滑。
此处验证的是分析算法和标准声道顺序，不代表所有文件编码或特殊声道布局已经实机通过。
重新生成：FOLIA_SPECTRUM_REFERENCE=1 npm run test:mobile:ui -- spectrum-reference.spec.ts --project=phone。

首轮完整回归39/40：静音并停止读取后，恢复第一帧残留99而非0；
原因是采集时间晚于上次请求，单独检查采集时间漏掉旧平滑历史。
恢复时按请求间隔清除旧窗口后，原断言和40项回归通过，未放宽静音断言。
扩展多声道测试首次因AVAudioFormat简便构造器不支持>2声道而退出；
按SDK要求传入显式声道布局后，60组对照全部通过。
扩展期间其余4个频谱／实际tap用例通过，证据在spectrum-native-multichannel.log；
该次整轮结果仍记FAILED，不能用部分成功替代完整结果。
最初一次测试命令用错target名NativeTests，纠正为scheme中的FoliaNativeTests后执行。
既有Pixi／Three弃用及React useInsertionEffect警告仍存在；没有把它们当作性能通过。

完整附加音效、Automix和桌面编辑功能仍未全部移植。
App到网易云／QQ网关真实账户、真机30分钟锁屏、网络／蓝牙切换、
全部模式性能及歌词≤150ms仍为NOT_RUN；历史平台记录不替代这些验收。

### mobile.5 安装与包校验

- 最终资源、Simulator及开发签名设备构建PASS：mobile5-resources.log、mobile5-sim-build.log、mobile5-device-build.log。
- codesign --verify --deep --strict PASS。两种App包各98个前端文件逐字节匹配dist-mobile，
  另有Capacitor自动生成的cordova.js／cordova_plugins.js两个空兼容文件，无XCTest或参考样本。
  首次校验把这两个生成文件当作差异；核对为空且没有其余额外文件后通过，未修改构建产物。
  结构化证据：mobile5-package-verification.json。
- build5已在iPhone XS Max／iOS18.7.10覆盖安装并启动，未卸载原App；
  mobile5-final-install.json与mobile5-final-launch.json的outcome均为success。
- 最终包在iPad Pro 11-inch (M5)／iPadOS26.5 Simulator启动，保留4个本地验收音频、
  队列外当前歌曲、暂停位置、27%音量及静音；展开Partita显示原有歌词。
  截图mobile5-ipad-paused-partita.png；此项仅证明安装／恢复和界面显示，不是性能或听感验收。
- 开发IPA、SHA256与私有构建记录在上级「移动端交付」，旧包保留。候选未完成全功能／真机验收。
- BUILD_RECORD.json的buildNumber同步为5；mobile.4旧记录误留3，不改变其实际App的build4身份。

## mobile.4 声音控制与均衡器

| 层级 | 结果 | 证据与边界 |
|---|---|---|
| TypeScript | PASS | mobile4-typecheck-final.log |
| 逻辑 | PASS | 43项；移动逻辑及原audioEqualizer设置；audio-unit.log |
| 原生 | PASS | 全部36项，audio-native.{log,xcresult}；追加实际tap测试单项PASS，audio-native-tap-signal.{log,xcresult}；共37个不同用例 |
| 原WebKit输出参考 | PASS | audio-webkit-reference.log；5种采样率×3组增益，保存原Web Audio图的冲激采样和能量供原生独立比较 |
| UI | PASS | 18项，手机／宽iPad／窄窗口各6项；audio-ui-final.log；平台和原生传输为fixture |

原生测试覆盖左右声道隔离、平面／交错浮点PCM、零增益精确旁路、关闭后的平滑回落、
流不连续时清除滤波历史、格式能力检测、无效与不支持参数原子拒绝、保存恢复、静音下调音量、
当前／预加载曲目接收新参数。追加测试播放合成1kHz WAV，在停止FFT轮询后设置−12dB，
恢复读取时观察到真实解码PCM的频谱下降；不涉及真实在线歌曲或设备锁屏。
稳态采样绝对误差阈值2e-5（单位幅度），能量相对阈值2e-4；动态15ms平滑按32帧更新，
不宣称与Web Audio自动化逐采样完全一致。

前端复用原设置store与对话框，桌面默认行为不变。移动桥串行合并连续编辑、保留最新意图，
原生拒绝后回填最后确认值。原版复合音色仍需移植额外音效，因此置灰并解释原因。
新增音量输出是单独的status区域，目录加载断言已限定在目录内。
首轮UI因新增测试选择器、歌词加载时序和对话框零尺寸语义容器失败，修正后通过；
测试时原生资源同步曾触发Vite重载，移动dev watcher现忽略ios／dist-mobile／证据目录。
实际tap测试首次抓到播放初始静音缓冲，改为等待合成信号后通过，没有放宽−12dB响应断言。
iPad实际容器随后复现触摸滑块数值变动但未保存：音量／静音可恢复，EQ仍为旧值。
新增事件顺序回归先失败（audio-touch-order-red.log，预期7实为0）；移动对话框改为从input事件提交，
桌面仍按原方式提交，3种窗口定向复测通过（audio-touch-order-green.log）。最终修改后没有重跑无关原生逻辑。
Pixi／Three弃用及既有React useInsertionEffect警告仍存在，不代表性能验收。

### mobile.4 安装与验收边界

- 最终资源同步、Simulator及开发签名设备构建PASS：mobile4-resources-touch.log、mobile4-sim-touch.log、mobile4-device-touch.log。
- codesign --verify --deep --strict PASS；设备包98个前端文件逐字节对应dist-mobile，无XCTest／参考音频样本；mobile4-package-verification.json。
- 最终build4已覆盖安装并成功启动于已连接iPhone XS Max／iOS18.7.10，未卸载用户App；mobile4-final-install.json、mobile4-final-launch.json为success。
- iPad Pro 11-inch (M5)／iPadOS26.5 Simulator实际触摸调节后，保存的原生设置及杀进程重启后的界面均为音量27%、静音、1kHz −8dB、EQ启用、自定义1。
  mobile4-ipad-audio-saved.json及mobile4-ipad-eq-restored.png记录此闭环；此前导入的4个合成音频仍保留。
- IPA、SHA256和构建记录存放于上级「移动端交付」。旧包保留；本版本仍是开发候选。
混响／饱和等附加效果、Automix、完整桌面编辑功能仍未完成。
App到网关网易云／QQ真实账户验证、两台真机30分钟锁屏、耳机／蓝牙／网络切换、
歌词≤150ms及温升／内存测试仍为 NOT_RUN。既有服务器记录是历史证据。

## mobile.3 队列与播放器回归

| 层级 | 结果 | 证据与边界 |
|---|---|---|
| TypeScript | PASS | npm run typecheck；queue-typecheck-fixed.log |
| 逻辑测试 | PASS | 移动逻辑及原 queueAddBehavior／queueBatchOperations，34 项；queue-unit.log |
| 原生 XCTest | PASS | 29 项，含全部21项既有回归；mobile3-native-final.{log,xcresult} |
| UI | PASS | 15 项，WebKit 手机／宽iPad／窄窗口各5项；queue-ui.log |

新增原生用例证明队列编辑保留实际 AVPlayerItem、位置与暂停状态；拒绝跨平台同ID替换当前项；
原生已自动前进但KVO回调未处理时，先校准再拒绝旧版本操作；清空后保持当前歌曲及暂停恢复；
注销清除队列外的当前歌曲；手动切歌、边界和脱离队列后的前后导航符合既定行为。
移动逻辑用例覆盖原工具函数复用、重复歌曲 occurrence、跨平台身份、仅身份式加入可有限重试。
UI新增触摸菜单、下一首、移除当前项、过期操作提示、打乱和清空后保留当前信息。

初次TypeScript检查发现nullable输入及联合类型收窄问题，修正后通过。首轮原生28项和UI15项均单次通过。随后在实际iPad容器发现恢复时长未加载导致进度条显示不准，
补上元数据时长与恢复状态拖动逻辑后，最终29项原生回归通过；没有更改前端代码。
iPad实际容器使用上轮导入的4个合成WAV，验证队列触摸菜单、下一首插入、选曲、暂停，
移除当前项／清空队列后保留当前曲目、歌词和播放位置。
截图：mobile3-ipad-detached-current.png、mobile3-ipad-empty-queue.png。

测试中的音频和平台响应为标注样本，不替代实际账户播放与真机长时间测试。
原有Pixi／Three弃用及React useInsertionEffect警告仍存在；没有新增未捕获pageerror证据。

### mobile.3 最终包与设备

- npm run ios:sync PASS；mobile3-resources.log。
- 最终 iOS 签名构建与 Simulator 构建 PASS；mobile3-device-final.log、mobile3-sim-final.log。
- codesign --verify --deep --strict PASS；设备包98个前端资源逐字节对应 dist-mobile；无测试插件。
- build3 最终包已覆盖安装并启动于已连接的 iPhone XS Max / iOS18.7.10；
  mobile3-final-install.json、mobile3-final-launch.json 均 success，未卸载用户App。
- 最终包在 iPad Pro 11-inch (M5) / iPadOS26.5 Simulator 重启后保持空队列及队列外当前歌曲；
  暂停时进度正确，拖动校准原 Partita 歌词，再从新位置播放／暂停；
  mobile3-ipad-restored-seek.png 为最终构建证据。
- 开发签名IPA、SHA256与构建记录存放于工作区上级「移动端交付」；文件名使用当前源码指纹前8位。
  旧mobile.1／mobile.2包保留。凭据、音频样本和测试代码不进入交付App。
- 真机实际音乐播放／30分钟锁屏与蓝牙／网络切换未在本轮执行；App在线真实账户验证仍为 NOT_RUN。

## mobile.2 历史验证（非本次重新执行的项目保留原边界）

| 层级 | 结果 | 证据与边界 |
|---|---|---|
| TypeScript | PASS | npm run typecheck；mobile2-typecheck-final.log |
| 移动逻辑 | PASS | npm run test:mobile，19 项；local-unit-tests.log |
| 原生 XCTest | PASS | 21 项；mobile2-native.{log,xcresult}；默认模拟器签名 |
| UI | PASS | npm run test:mobile:ui，12 项，WebKit；手机／宽 iPad／窄窗口各4项；mobile2-ui-import-stable.log |
| 系统文件导入 | PASS | iPad Pro 11-inch (M5) / iPadOS26.5 Simulator；真实 UIDocumentPicker 多选4个合成 WAV，无服务器 |
| 原生本地播放／LRC | PASS | iPad 模拟器实际播放、自动跨曲，系统选择器导入 LRC 并显示 Classic 动画；暂停、拖动、横竖屏 |
| 14 模式接入与外观配置 | PASS（接入） | 原注册表、参数和背景组件；UI fixture 挂载与短码回读；不是14种效果的完整视觉或性能验收 |
| 真实解码音频频谱 | PASS（本地 PCM） | 原生测试440Hz输入对应FFT峰值、停止读取后不再分析；在线流编码支持未全部验证 |
| iPhone 安装／启动 | PASS | build2 开发签名覆盖安装并启动，devicectl结构化结果success；未卸载用户App |
| App 内网易云／QQ完整在线流程 | NOT_RUN | 接口和账户历史证据在 SERVER_VALIDATION.md；本次没有重新扫码或App到网关端到端测试 |
| iPad实体设备、两机30分钟锁屏 | NOT_RUN | 模拟器不能替代真机长期验收 |
| 蓝牙／耳机／网络切换／歌词≤150ms／温升内存 | NOT_RUN | 没有对应的真机与仪器化证据 |

原生新增用例包括：导入后删除来源仍能播放、重建库后读取、拒绝路径遍历、歌词持久化、
损坏文件清理、断网下四首本地音频自动跨过三个边界且没有网关请求、退出在线平台保留本地播放、
恢复的暂停队列不会因预加载自行选曲，以及真实PCM频谱。21项包含全部15项既有回归。
这些测试不使用WebView，但只证明短时本地播放，不证明真机挂起时远程地址刷新。

UI使用专用原生桥fixture和平台样本；测试包含登录、歌单、搜索、播放控制、网络错误、本地导入／移除、
14模式挂载、外观短码和暂停时Partita切换／跳转。测试文件与样本没有进入App资源。
Partita暂停挂载时主歌词透明的问题先复现失败，再修正初始离散状态读取当前时钟；
保留原动画参数和视觉设计。证据为mobile2-partita-red.log和最终UI报告。
中间一次UI运行因初始歌词加载改变按钮位置，歌词导入点击未生效；修正测试等待初始加载完成并确认导入调用，
随后12项一次通过，没有放宽歌词内容断言。

开发环境仍有继承的Pixi／Three弃用警告和React useInsertionEffect警告；最终没有未捕获pageerror。
不能将Pixi打印的弃用调用栈当成已证实的渲染器崩溃，也不能将无pageerror当成性能合格。
原生频谱首轮测试读取到启动静音，改为等到实际非零信号后仍断言频率峰值；未改成虚假信号。

实际iPad截图：.mobile-test-results/mobile2-ipad-native-lyrics-{portrait,landscape}.png。
其中音乐和歌词明确标注为验收用合成内容，不是真实平台账户数据。最终资源及设备构建见文末更新。

## mobile.1 历史验证（非本次重新执行）

以下保留既有工程、服务器和设备证据；旧版启动服务器设置页的行为已经由mobile.2的本地曲库入口替换。

| 层级 | 结果 | 证据与边界 |
|---|---|---|
| TypeScript | PASS | npm run typecheck |
| 定向逻辑回归 | PASS | 36 个文件、477 项测试；provider、transport、歌词、扫码状态机、移动网关与安全存储 |
| 最近会话取消改动 | PASS | 扫码与移动专项 73 项；包含前台立即轮询、不过期复活、Keychain 写失败后仍能清除 |
| Web 构建 | PASS | npm run ios:sync，产物约 11 MiB，资源打包在 App 内 |
| UI | PASS | Playwright WebKit 26.6，6 项，390×844／1194×834／600×834 |
| 模拟器编译 | PASS | Xcode 26.6，iOS 26.5 Simulator，Bundle ID app.folia.personal，最低系统17 |
| 设备架构编译／开发签名 | PASS | generic iOS / iphoneos；有效开发证书，codesign strict校验与描述文件匹配 |
| 原生 XCTest | PASS | 15 项：原有11项及原生播放事件／地址恢复4项，见文末回归增量 |
| 加强自动换曲断言 | PASS | 单独复测，实际封闭的1秒静音WAV；要求下一首 readyToPlay、failures=0、时长正确，避免“失败跳歌”假阳性 |
| 实际模拟器启动 | PASS | 本地签名包安装并启动，原生 bootstrap／Keychain 读取后展示服务器设置页 |
| Compose 结构 | PASS | 实际服务器 compose config --quiet；默认3个服务，仅回环地址17863 |
| Docker构建与内部服务 | PASS | 三镜像已构建部署并固定不可变ID；HTTPS按用户选择暂缓 |
| QQ／网易真实账户 | PASS | 用户扫码后验证登录、个人歌单和带账户解析；CDN有限Range请求；详见服务器记录 |
| 酷狗账户 | NOT_RUN | 按最新范围延后 |
| iPhone安装与启动 | PASS | iOS18.7.10，devicectl安装成功；用户确认手动正常打开，随后devicectl启动亦成功 |
| iPad安装与两机30分钟锁屏 | NOT_RUN | 尚未进行iPad安装与后台验收 |
| 真实远程控制／蓝牙／网络切换 | NOT_RUN | 已实现系统通知／命令处理，但没有外设或真机证据 |
| WebView挂起时远程地址刷新 | NOT_RUN | 原生自动换曲与共享解析已有自动测试，未在真机挂起场景验证 |
| 歌词≤150ms／温升／长期内存 | NOT_RUN | 未做固定音频的仪器化测量或长期真机测试 |

## UI 检查

Browser插件未提供，使用已安装Playwright；测试地址 http://127.0.0.1:4179/mobile.html。
测试流程：启动 → 扫码确认 → 个人歌单 → 搜索 → 加入队列／播放 → 暂停 → 返回音乐库 → 退出；
另覆盖服务器设置和网络错误。响应和原生桥均为测试fixture，生产代码没有模拟音乐兜底。

三尺寸页面标题与首屏内容正常，无框架错误遮罩、无横向溢出，正常流程未发生pageerror。
故障注入场景有预期的“匿名Cookie请求失败”警告，界面展示错误，未将其当作真实服务结果。
截图均已人工查看，位于工作区上级“移动端验证”目录；名称含fixture的图片不是真实账号数据。

## 原生证据与修正

日志保存在本地忽略目录 .mobile-test-results：
native-final.log / native-final.xcresult、native-auto-advance.log、
simulator-build.log、device-build.log、mobile-build.log。不要把包含设备标识的完整Xcode日志直接公开。

初次未签名Keychain用例失败，改为模拟器本地签名后通过。
异步失败链最初使用固定短等待，随后改为观察明确停止状态；重复满足expectation的问题已修正。
短音频用例最初断言不足，最终关闭音频文件后再播放，并要求正常完成而非失败跳歌。
这些测试没有证明30分钟锁屏播放或线上URL有效性。

## 依赖审计

npm audit --omit=dev 返回6项High（包含传递依赖记录），0 Critical；
node-forge GHSA-86w9-cpqp-85rv、basic-ftp GHSA-c475-qrg2-pj4r，以及网易／酷狗和代理依赖链。
这些是继承的音源依赖风险，未执行不受控的audit fix。具体部署风险见 deploy/mobile/DEPLOYMENT.md。
Capacitor 8.5.3 未出现在本次production审计报告中；已核查的
GHSA-rvm3-566m-v7fv 不覆盖8.5.3，这不是全面安全认证。

## 交付条件

mobile.1交付了源码、Xcode工程、配置模板、构建说明与分层证据。QQ／网易内部服务与真实账户接口已验证，
开发签名包已安装iPhone，未做真机后台验收。当前mobile.2的本地使用无需HTTPS；在线网关连接与真机验收条件见ACCEPTANCE.md。

2026-10-10 部署阶段增量复测：TypeScript PASS，移动逻辑19项 PASS，三种窗口UI共6项 PASS，
ios:sync PASS，原生XCTest11项 PASS（native-deploy.xcresult）。当前部署锁审计见 SERVER_VALIDATION.md。
这些新增证据不把既往模拟器编译等同于真实设备安装。

## 真机安装增量

2026-10-10：开发签名包使用当前 a367f2266238191525f9babcb4a815ea4d225361 源码。
本地 codesign --verify --deep --strict 通过，开发证书在描述文件中，设备UDID也被覆盖，entitlements匹配。
首次远程启动被系统以签名／信任的合并错误拒绝，用户随后确认手动正常打开，再次远程启动成功。
不把首次错误未经证实归因于某个证书问题。legacy idevicescreenshot 服务不可用，因此没有此次真机截图证据。
签名IPA仅保存在用户本地“移动端交付”目录，未上传到公开仓库；SHA256为
021c414b16a82bf5c19efb7fbd1318ed85b46ccf13f30651208fcbe6bd085f7e。

## 原生播放事件回归增量

2026-10-10：补测移植新增的原生播放层，修复切歌／停止后旧 AVPlayerItem 通知仍被处理的问题。
修复前，上一首延迟结束通知会跳过新选曲目；停止后的旧失败／结束通知会清除认证错误并推进队列。
对应测试已分别复现失败。修复在切歌与停止时清除曲目监听归属，恢复播放时重新监听，
停顿与失败通知也必须属于当前仍被监听的曲目。未修改前端、provider、播放解析规则或服务器部署。

原生 XCTest **15 项 PASS**，包括全部既有用例和四个新增用例：旧结束通知隔离、停止状态保持、
恢复播放的监听重建、不可播放地址重新解析后实际播放。地址恢复测试使用缺失文件与一秒静音 WAV，
断言只解析两次且播放位置前进；没有 WebView 调用，也没有真实平台或远程 CDN。
它证明原生错误恢复路径，不能替代真机 WebView 挂起、远程 URL 过期或 30 分钟锁屏验收。

本地证据：.mobile-test-results/native-recovery-red.{log,xcresult}、native-stop-red.{log,xcresult}、
native-recovery-green.{log,xcresult}。执行命令为有时限的 xcodebuild test，使用同一 App scheme 和
iPhone 17 Pro / iOS 26.5 Simulator。服务器部署仍对应 a367f22；手机随后更新为下节所列修复包。

## 修复包设备更新

2026-10-10：基于源码提交 652be4593120a046d4e871457f0c8f4671dbe8d1 重新构建设备签名包，
源码与 BUILD_RECORD.json 的所有文件摘要一致。该提交的 GitHub Mobile checks 已通过：
https://github.com/Kun686/folia-Player/actions/runs/38041388838 。

generic iOS Debug 构建、codesign --verify --deep --strict、描述文件设备覆盖、Bundle ID 与
entitlements 一致性检查均通过。继续使用 app.folia.personal，在现有 iOS18.7.10 iPhone 上
执行覆盖安装，没有卸载 App；devicectl 安装和启动的结构化结果均为 success。
这仅证明修复包安装／启动，不证明账户恢复、在线播放或后台验收。

本地私有交付包：移动端交付/Folia-0.7.16-mobile.1-652be45-development.ipa，6,821,500 bytes；
SHA256：88b0eb4d6502b98c0143b139a877fce352b23acb85098966774ab3111eddc78a。
上一版 a367f22 安装包仍保留。IPA、设备标识与签名描述文件不上传仓库。
本地忽略目录 .mobile-test-results 中保存 device-recovery-build.log、device-recovery-install.{log,json}、
device-recovery-launch.{log,json}。此次未修改服务器、HTTPS 配置、平台规则或产品功能。

## mobile.2 最终设备更新

2026-10-10：npm run ios:sync、generic iOS开发签名构建、Simulator构建均通过，资源约11 MiB。
codesign --verify --deep --strict通过；设备包public下资源与本次dist-mobile逐字节一致。
最终构建证据：mobile2-resources-verified.log、mobile2-device-verified.log、mobile2-sim-verified.log。

已在连接的 iPhone XS Max / iOS18.7.10 上覆盖安装并启动 build2；
mobile2-verified-{install,launch}.json均为success。iPad模拟器也安装最终包，保留导入曲库、歌词和设置；
重新打开队列为暂停状态，Partita暂停后关闭／打开设置仍显示主歌词，
截图mobile2-ipad-native-paused-partita.png。该检查只验证状态恢复和显示，不证明长期性能。

本地交付文件：移动端交付/Folia-0.7.16-mobile.2-3b71ed27-development.ipa，6,938,977 bytes。
源码指纹：3b71ed2786ef7f4a89fa585e90562e7e6e4a5834f1c59a8f169b71f0ec18fb73。
IPA SHA256：5f6af233f15ebd067c3c7c6ff8f0a2a6554fd7f70158727f0a70605670d22d8d。
旧mobile.1包仍保留；IPA不含验收音频，也不上传仓库。只适用于开发描述文件允许的设备。
本次没有修改服务器部署、网关HTTPS规则、线上账号或生产依赖。
