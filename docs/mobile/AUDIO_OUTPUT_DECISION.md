# 原生双声道输出路线与已批准依赖

日期：2026-10-10。用户已明确批准固定依赖及验证后接入。
mobile.7已接入独立双声道流式输出并安装到iPhone；保留的mobile.6旧包仍是AVQueuePlayer路线。
实际安装包身份以BUILD_RECORD.json为准，不把后续源码测试当成旧包能力。

## 当前接入结果

mobile.8 已将原生队列接入共享混音／整体音效输出，并安装到 iPhone。使用 mobile.7 之后增加的
外部渲染接口；依赖本身仍默认关闭此选项，由 App 明确启用。固定版本未变，无新增依赖，仍只修改两个
vendor 文件。100 项完整原生回归、受控 HTTP 队列及 7 项真机关键测试通过；完整 Automix 未完成。
各阶段证据和失败记录见 [AUTOMIX_PORT.md](AUTOMIX_PORT.md)，当前包见 VALIDATION.md。

后续开发源码已定位 bypass TimePitch 的 4096 帧延迟，外部接口改为复用原始 PCM 读取路径。
原生 Crossfade 队列及原版开关／模式／时长设置已接线，默认仍关闭；分析、完整 Automix 与动画事件仍未接完。
这一变化尚未发布到 mobile.8，详见 AUTOMIX_PORT.md 的开发阶段记录。

复用已批准的AudioStreaming 1.4.5解码／网络实现、Apple音频图及现有Folia DSP，不新增依赖版本。
Folia持有歌曲身份和队列版本，每个播放项使用独立解码器，只保留当前与下一项。
删除待播项会释放其解码器，不经过存在缺陷的上游URL队列，也不会重启当前歌曲。

为支持不消耗歌曲开头的静默预加载，把固定提交`e28a74b7b8632fc14312b7a79dcd82fa302779af`
的59个源文件纳入`ios/Vendor/AudioStreaming`，原始总计291,190字节；仅两个文件有适配：
AudioPlayer添加延迟启动输出及缓冲／seek状态读取，Package.swift去除未复制的上游测试target。
原解码、网络和音效算法不变，Ogg／Vorbis继续精确锁定0.1.2；原版权和MIT／BSD声明保留。
`AUDIO_STREAMING_VENDOR.json`保存原始及当前逐文件SHA256，完整差异在同名`.patch`中。

```sh
python3 dev/mobile/verify-audio-vendor.py
# 本机保留原checkout时，可同时核对原始源码及完整补丁：
python3 dev/mobile/verify-audio-vendor.py --upstream-root ios/DerivedData/SourcePackages/checkouts/AudioStreaming
```

两种校验均已通过；CI执行离线校验。当前与下一首独立预加载、删除缓冲项、同URL不同身份、快速切歌、
地址刷新一次、三首失败停止、账户退出取消、暂停拖动、中断恢复均有真实解码的原生测试。
最终音量／静音在效果链之后应用，避免噪声／混响在静音后仍发声。
完整Release原生回归89项通过（`stereo-output-full`）；WAV和AAC/M4A Mono已验证真实双声道音效。
iPad实际App从验收音1自动推进到4并结束，原音效面板正常打开，截图保存在本地证据目录。
完整原生HTTP队列补测3项通过；iPhone XS Max / iOS18.7.10的6项关键原生测试也通过，
包含真实WAV／AAC Mono音效与连续四曲、取消已预载下一首，详细边界见VALIDATION.md。

Ogg拖动仍受上游限制；真机30分钟锁屏、蓝牙、温升、内存、歌词延迟和量化无缝切歌仍为NOT_RUN。
暂停／中断无音频回调时，已关闭效果分支可能保留到恢复或曲目释放，尚未作资源回收验收。
旧AVQueuePlayer路径保留，回退应使用上一版完整安装包；不在用户界面增加后端选择。

## 首次安装与能力探针（历史记录，实际App接入前）


- SwiftPM解析成功，版本及提交锁定在`Package.resolved`。两个下载文件逐字节SHA256校验通过；
  MIT／BSD完整声明进入`ios/App/App/AUDIO_STREAMING_LICENSES.txt`及App资源阶段。
- 初次Xcode下载120秒超时，直接curl也出现TLS握手超时。经本机已配置代理、GitHub资产API下载，
  校验后填入本机SwiftPM缓存，解析重试成功；未禁用证书校验、未改上游源码或下载地址。
  证据：`audio-streaming-resolve.log`、`audio-streaming-resolve-cached.log`。
- 新增`AudioEffectUnit.swift`：系统AUAudioUnit音效插入点，复用AudioMeter、EQ与已有DSP，
  保持EQ→原音效→分析顺序；预分配渲染缓冲，处理上游静音标志、错误、重置及时间不连续。
  AU总线使用标准分离声道Float32；AudioStreaming输出到此节点之前由系统音频图转换格式。
- iPhone 17 Pro / iOS 26.5 Simulator / Release，首轮4项通过：本地及限速HTTP单声道WAV
  实际解码成2声道，节点之后的PCM具有低通衰减及真实左右差异，拖动／暂停／恢复通过；
  现有AVPlayer暂停2秒后关闭音效，仍能完成淡出资源交接并恢复。证据`streaming-stereo-first.{log,xcresult}`。
- 完整Release回归79项通过：`streaming-native-standard-format.{log,xcresult}`。
  前一次78/79通过，失败项将交错格式设置到AU总线而收到-10868；按SDK标准格式约束修正，
  保留明确的拒绝断言以及分离缓冲／上游静音测试。原失败记录`streaming-native-regression`保留。
- 最终源码HTTP与能力探针4项通过：`streaming-http-and-capabilities-final.{log,xcresult}`。
  HTTP稳态RMS为0.02157915，500Hz低通处理2kHz输入后为0.00138894（原信号约6.4%），
  噪声／混响左右差值RMS为0.01649580；拖动、暂停／恢复通过。60秒文件5,292,044字节，
  首次连续请求仅传输1,212,416字节便发生seek，确认不是完整下载后播放。
  同轮复核远端AVAssetReader仍为-11838、composition音乐tap仍为1声道、已缓冲队列删除仍无效。
- 解压的iOS arm64动态库实测：Ogg 69,920字节，Vorbis 865,888字节，合计935,808字节；
  **这不是完整App增量**，不含AudioStreaming静态链接代码、签名及打包压缩。最终App／IPA增量
  必须在后端接入并生成新候选后测量；此处是接入前记录，最新整包测量见VALIDATION.md及旁置包体元数据。

### 必须解决的队列限制

实际两首合成WAV复现，源码位置均为固定1.4.5的`AudioPlayer.swift`：

1. `play()`紧接`queue()`：初始异步`processSource`调用`clearQueue()`，第二首可能被清除。
   等待`audioPlayerDidStartPlaying`再加入下一首后，连续播放与用新歌替换整队列通过。
2. `removeFromQueue(url:)`只搜索`.upcoming`；等待下一首完成缓冲后调用删除，下一首仍开始播放。
   这会破坏Folia队列删除／重排和退出账户时的取消语义，直接委托上游队列的方案不可交付。

证据：`streaming-queue-capability`初轮失败，`streaming-queue-after-start`两项诊断通过。
后者`FOLIA_BUFFERED_REMOVAL supported=false`明确表示**确认了缺陷**，不是队列验收通过。
该能力探针仅在`FOLIA_AUDIO_OUTPUT_PROBE`条件下编译，正常79项回归不包含“已删除歌仍播放”的断言。

接入时继续由Folia拥有歌曲身份及队列版本；待播缓冲必须能够独立取消，删除下一首不得重启当前歌，
并需验证同URL的不同队列项、快速切歌、URL刷新、账户退出与后台衔接后才切换播放器。
此次没有改变`PlaybackEngine`／`PlaybackQueue`／`PlaybackSystem`和前端，现有App仍使用AVQueuePlayer。
真实平台、真机锁屏、蓝牙、温升与新后端歌词延迟均为NOT_RUN。

### 复现方式

仓库根目录执行（模拟器ID使用本机实际设备，证据名必须未被使用）：

```sh
"$HOME/.local/bin/codex-bounded" 600 -- python3 dev/mobile/audio-output-probe.py \
  --simulator <UDID> --evidence streaming-check \
  --test testHTTPMonoStreamingHasAudibleStereoEffectsAndSeek \
  --test testBufferedRemovalCapabilityProbe
```

脚本仅提供127.0.0.1:18779的60秒合成单声道音频，支持Range并限速；打印PID、日志路径与健康状态，
结束后关闭服务并输出请求字节区间。无真实账户、网关凭据或用户歌曲参与。

## 为什么需要调整

原版音效需要能产生不同的左右输出，尤其是立体声噪声与混响。当前AVQueuePlayer的
MTAudioProcessingTap只提供解码轨道的格式：Mono歌曲得到1声道，不能在回调中擅自改成2声道。
把处理后的立体声重新下混为Mono会丢掉原版效果，不作为完成方案。

本轮在iPhone 17 Pro / iOS 26.5 Simulator / Release进行了三个探针：

| 实际操作 | 观察 | 对决策的影响 |
|---|---|---|
| 通过支持HTTP Range的本机服务读取60秒合成Mono WAV | AVFoundation能读取轨道；AVAssetReader初始化返回AVFoundationErrorDomain -11838（operationNotSupportedForAsset） | 不能用AssetReader直接取代当前远端解码链 |
| AVMutableComposition加入原Mono轨道及立体声静音轨道，保持总时长 | 可播放，原音乐轨道tap仍为1声道 | 合成层也不能把现有tap直接变为双声道处理入口 |
| 实际播放后暂停，等待2秒，再关闭噪声／混响 | 暂停期间仍有tap回调，约1.2秒后退役交接完成；恢复成功 | “暂停必然没有回调”不成立；仍需分别验证中断、后台挂起和真机，不能把模拟器行为当成所有设备保证 |

本地证据：`.mobile-test-results/audio-output-probe.log`、`audio-output-probe-composition-fixed.log`
及同名xcresult。初次composition探针有Swift异步autoclosure编译错误，修正后执行；失败日志保留。
这些是能力探针，测试进程成功不代表双声道在线播放已经实现。

依据：Xcode 26.6 SDK的`MTAudioProcessingTap.h`明确要求按processingFormat处理并转换回该格式，
该参数是const；`AVAudioMix.h`没有输出声道数设置。`AVCompositionTrack.h`的格式描述替换用于
声道布局等元数据修改，不能据此伪造单声道数据为立体声。

## 推荐方案

复用成熟流式播放库管理系统解码、网络分段读取、PCM缓冲与播放。
以AVAudioEngine的双声道音效节点承载已实现的EQ／WebKit DSP，原生队列、provider身份、
Keychain、锁屏控制、歌词时钟、原设置与界面继续复用。

候选是[AudioStreaming 1.4.5](https://github.com/dimitris-c/AudioStreaming/tree/1.4.5)，
固定提交`e28a74b7b8632fc14312b7a79dcd82fa302779af`。它的输出PCM显式为44.1kHz、Float32、
双声道，并提供`attach(node:)`接入自定义音效。`frameFiltering`只是主混音器的观察tap，
不能把观察回调当成可靠的可听音效插入点；需要系统AUAudioUnit适配已存在的DSP。
这是原生输出层调整，原歌曲身份、音效参数、主题与动效保持原有含义。

### 固定依赖与成本

| 包 | 固定版本 | 许可证 | 依据及成本 |
|---|---|---|---|
| AudioStreaming | 1.4.5 | MIT，保留Dimitris C.及Thong Nguyen声明 | 2026-09-14发布，仓库未归档，最近推送2026-09-30；Swift 5.10，iOS 15起。生产目录源码／资源合计287,941字节，非App增量 |
| ogg-binary-xcframework | 0.1.2 | Xiph BSD 3条款 | 候选Package.swift的必需依赖；全部平台压缩资产578,188字节 |
| vorbis-binary-xcframework | 0.1.2 | Xiph BSD 3条款 | 候选Package.swift的必需依赖；全部平台压缩资产5,075,242字节 |

两个二进制包由sbooth维护，固定包发布时间均为2024-11-15。上游Package.swift固定下载地址及SHA256：

- Ogg：`b6ab2dcf89076ca9488ef32d810d0343a2072fadd9eb94247f498b7b87070e2e`
- Vorbis：`063843e2bfd1e85e445e3d03d4263268118dfb91406f5e74c33ce68a02865247`

总下载资产5,653,430字节（约5.39MiB），含多个平台；不是iPhone安装包增量。
用户已批准安装；设备切片／链接后体积及运行性能尚未测量。不会声称它“零体积成本”。
此方案新增了Ogg/Vorbis解码依赖；用户的明确批准取代了原“不新增解码库”的这部分限制。

### 安全与限制

已核查固定tag的Package.swift、许可证、网络认证代理、日志配置、主播放器与节点接入实现；
2026-10-10查询该仓库公开security-advisories返回空，GitHub公开advisories按libogg/libvorbis
检索亦返回空。这是有限通告查询，**不代表没有漏洞**；没有完成二进制来源与所有传递源码的安全审计。
安装后须校验上述校验和、保留全部许可，并显式设置`enableLogs: false`。
平台Cookie／网关认证头仍不进入播放器CDN请求；不自定义放行不可信TLS证书。

上游已列明Ogg Vorbis暂不支持seek，不能据此宣称所有本地格式功能完整；
QQ／网易标准音源及常用本地格式需分别验证。44.1kHz固定输出、队列取消、URL失效、
暂停／中断与背景持续播放都要重新验收。尚未证明该库在本项目真机中满足这些要求。

### 备选及不选原因

- 保留现有AVQueuePlayer：继续作为已验证基线和回退路径，但目前不能交付Mono歌曲的完整立体声音效。
- 系统AudioFileStream／AudioConverter／AVAudioEngine全部自研：无第三方依赖，但需自行维护MP4重排、
  Range seek、压缩包队列、欠载、重连、取消与并发；成本及回归风险明显高于库适配。
- AudioStreaming 1.3.0：无外部依赖，但缺少后来发布的溢出、M4A误判、无缝播放、DispatchTimerSource
  析构崩溃修复；不为省去两个依赖回退到已知欠缺修复的版本。
- SFBAudioEngine 0.14.0：MIT主体、支持iOS 15，但带来大量外部编解码／工具库与部分LGPL组件，
  相对当前QQ／网易标准音质和本地文件需求过重。
- 先下载完整歌曲再播放：不满足正常流式播放体验，不作为替代完成方案。

## 批准后的实施和回退

先安装固定版本并在独立原生测试中验证Mono输入→真正双声道输出、实际音效、seek与短队列，
不直接替换已安装App。新增自研内容限于现有DSP的AU适配与现有队列的播放器接口适配，
网络解码／流式缓冲复用库，音效算法继续复用已有实现。
验证成功后再接入原功能、检查所有既有状态／安全边界、运行手机／平板回归并交付新候选。
任一关键项不满足时保持mobile.6可安装包与当前AVQueuePlayer基线可回退；整体功能完成标准不降低。
