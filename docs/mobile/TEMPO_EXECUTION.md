# 原生保音高变速执行验证

2026-10-11。开发源码验证记录；未生成新 IPA，iPhone 日常安装仍为 `app.folia.personal` / mobile.10。
完整 Automix 尚未启用，本阶段不改变界面、主题、动画、原规划规则或默认设置。

后续输入观察、媒体时间估计、尾部排空及暂停 seek 修复见 [TEMPO_STREAM_CLOCK.md](TEMPO_STREAM_CLOCK.md)。
共享输出的可选预热交接及真机系统参考验证见 [TEMPO_HANDOVER.md](TEMPO_HANDOVER.md)。

## 复用与实现范围

原版 `musicalTime.ts` 的 `tempoMatch` 使用 ±12% 范围，`automixSession.ts` 按规划设置出场曲速率，
按实际速率换算过渡时长；beatCut、short、stems 分支仍使用 1。沿用这些规则，不另写节奏算法。

`NativeTempoProcessor.swift` 复用系统 `AVAudioUnitTimePitch` 与项目已有的 AVAudioEngine 手动实时渲染模式，
解码仍由已批准的 AudioStreaming 1.4.5 完成。没有新增依赖、复制新 DSP 或启用额外硬件输出。
按当前 Xcode SDK 的 AVAudioUnitTimePitch.h、AUAudioUnit.h、AudioUnitParameters.h 核对接口。

- 接受 Float32 双声道交错／分离输入，由 AVAudioSourceNode 完成系统格式转换，输出为分离双声道。
- 只接受 0.88…1.12 的有限速率，pitch 固定为零；保留系统默认平滑、相干性及瞬态处理。
- 控制侧最新速率请求覆盖旧请求；渲染侧不等待控制锁，使用缓存的系统参数调度入口。
- 单次输出最多 4096 帧，输入上限 8192 帧；先校验再消耗输入，处理静音标志及输入错误，错误输出清零。
- 保留全部启动与尾部 PCM，不通过丢弃固定 4096 帧来掩盖延迟。提供本地输出时钟与系统 latency／tailTime。
- 宿主必须串行执行 render／reset／close，并在重置、关闭前停止拉取；reset 清除旧音频和待执行速率，
  close 清除输入闭包，使解码器不必等处理器析构才释放。

**本执行器阶段尚未接入共享输出或队列；后续共享输出接线见上述交接记录。** 普通播放继续使用原始 PCM 路径，
避免给不需要变速的歌曲加入系统 TimePitch 的启动延迟。

## 同时修复：解码器 EOF 丢失末尾

真实两秒双声道 Float32 WAV 含 88,200 帧，原依赖仅输出 85,504 帧，遗漏 2,696 帧（约 61ms）。
AVAudioFile 与 AudioFileStream 均读到完整文件；独立系统 AudioConverter 探针复现：发出真实 EOF 前为
85,504 帧，排空后为 88,200 帧。该问题在速率 1 时也存在。

AudioConverter.h 的回调约定区分临时缺少输入与实际结束：零输入包并返回错误表示暂时不足；
零输入包且返回成功才声明真正 EOF。此前 `flushRemainingPackets()` 只排空文件解析器，
转换器仍保留末尾 PCM。

`AudioFileStreamProcessor.swift` 现在先沿用原文件解析器排空，再使用成功的零包回调排空转换器。
提取原环形缓冲解码循环复用其容量、等待和取消逻辑；真实 EOF 的零帧成功结果终止循环，避免无限读取。
普通暂时缺少输入仍返回原状态 100，Ogg 分支不变；没有重写解码算法。

固定上游提交仍为 `e28a74b7b8632fc14312b7a79dcd82fa302779af`，59 文件中当前共 3 个有适配。
完整补丁、逐文件哈希和校验脚本同步更新。补丁保留上游上下文原始空白，不能为消除 whitespace 提示修改该上下文。

## 验证结果

所有日志、xcresult 与设备清理记录位于本机 `.mobile-test-results/`；未提交设备标识或测试包。

| 层次 | 结果与证据 |
| --- | --- |
| 系统能力探针 | `tempo-system-first`：1 项 PASS；五种速率下两声道音高误差均小于 1Hz |
| 最终模拟器回归 | iPad Pro 11-inch (M5) / iOS 26.5 / Release；`tempo-full`：166 项 PASS，69.731 秒 |
| 独立 HTTP 测试 | `tempo-http`：3 项 PASS，8.101 秒；本机真实 HTTP Range 服务，含预加载取消、Mono 音效／seek、WebView 外队列推进 |
| 真机测试构建 | `tempo-device-build.log`：独立 QA 签名构建 PASS；测试前核对包、插件与 xctestrun 身份 |
| 真机专项回归 | iPhone XS Max / iOS 18.7.10 / Release；`tempo-device`：12 项 PASS，11.283 秒 |
| vendor 完整性 | `verify-audio-vendor.py --upstream-root ios/DerivedData/SourcePackages/checkouts/AudioStreaming`：59 文件及完整补丁 PASS，3 文件适配 |

166 项回归不包含上述 3 项需要 HTTP 服务的测试，三项另行运行。真机覆盖全部 7 项新增测试，并回归
原始 PCM 启动、AAC Mono 音效／seek、四曲自动切换、图与解码器释放、解码器移除后的回声保留。

适配器与独立系统图比较正弦及 DC 阶跃输入，共 20 组；覆盖五种速率、途中改速与恢复 1、
128／512／1024／257 的可变块长及 EOF 后输出。模拟器和 iPhone 的最大 PCM 误差均为 **0**。
真实解码器精确输出两声道全部 88,200 帧，后续为零；速率 0.88／1／1.12 的正弦有效时长误差小于 40ms，
其中 1.12 使用 4096 帧输出块。输入错误、非法速率／缓冲、reset、close 及引用释放均有断言。

实测系统 latency 随速率变化约为 87.90～99.21ms，速率 1 为 92.88ms。
系统 tailTime 返回 0，但解码器缓冲耗尽之后仍有可听输出，不能用这个属性或解码器 EOF 直接结束音轨。

| iPhone 速率 | 输出块长 | 首个／最后一个有效样本 | 观察到解码器空缓冲的输出块末端 | 其后输出峰值 |
| --- | --- | --- | --- | --- |
| 0.88 | 512 | 4260 / 104617 | 100352 | 0.20082659 |
| 1 | 512 | 4097 / 92295 | 88576 | 0.19999495 |
| 1.12 | 4096 | 3798 / 82769 | 81920 | 0.200773 |

样本序号从零开始，有效阈值为绝对幅度大于 0.01；空缓冲时间只精确到观察所在输出块，
不是采样级的解码器 EOF 时间，也不是扬声器实际发声时间。

## 失败记录与修正

- `tempo-adapter-first`：独立 AU 包装无法拉取输入，27 条断言出现 -10876；改用项目已经验证的手动系统图，
  `tempo-adapter-engine` 两项通过。保留原失败日志。
- `tempo-streaming`：真实解码器测试暴露上述 2696 帧遗漏；修复系统转换器 EOF 协议后，
  `tempo-streaming-eof` 的原始 88,200 帧精确测试通过。
- 同轮两条 DC 时长断言失败。系统对 DC 阶跃本身有约 75ms 响应尾部，不能用阶跃的阈值长度推算音乐时长。
  DC 保留为与独立系统图的逐样本比较；时长使用真实正弦，维持 40ms 容差，`tempo-tone-and-step` 两项通过。
  未重生成、放宽或删除既有基线。

## 待完成与清理

下一步接可听媒体时钟映射、原始路径与变速路径的预热交接、EOF 后排空及原队列生命周期，
再接原模式与动画事件。不能以执行器数值对照宣称完整 Automix 已交付。
实际 QQ／网易云／CDN、连续锁屏混音、听感、功耗和歌词 150ms 目标均未由本阶段测试证明。

测试 HTTP 服务已关闭，模拟器已关闭；独立 QA `app.folia.validation.App` 已卸载，
设备回读确认个人 App 仍为 0.7.16 / build 10。证据：`tempo-qa-uninstall.json`、`tempo-personal-app.json`。
`BUILD_RECORD.json` 和已交付 IPA 不变。
