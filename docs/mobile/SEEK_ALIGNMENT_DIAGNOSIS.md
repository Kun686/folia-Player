<!-- SEEK_ALIGNMENT_DIAGNOSIS.md — observed seek evidence and physical-device limits. -->
# 真机拖动后歌词错位诊断 · 2026-10-17

**最新状态：mobile.33 的 QQ／网易云真机前拖、回拖及连续拖动同步均 PASS_USER_CONFIRMED；本次“拖动后歌词持续落后声音”问题完成用户验收。**

2026-10-17 用户在已更新的 iPhone XS Max 上反馈：QQ《我怀念的》按 30 → 90 → 15 秒及连续拖动的检查要求，回答“拖动后声音和歌词都同步”；网易云回答“登录保留，拖动后同步”。网易云曲名未提供，不补造曲目或音质。此为用户实听实看确认，独立于下述原生音频自动测量；未测得手机声音到歌词的毫秒级误差。

## 2026-10-17 真机配置对应的复现

- 用户确认：正常播放同步，拖动后歌词比声音晚。只读查询手机为 iPhone XS Max、`app.folia.personal`、0.7.16／build 32。
- 当前真实歌曲为 QQ《我怀念的》`000BO3xy4fd8BJ`；手机设为 `hires`，实际解析返回 44.1kHz FLAC。此前通过的测试用标准音质和另一首歌，不覆盖这个条件。
- 手机动画为流光；全局／单曲偏移均未设置。自动歌词开启，该曲缓存选择网易云匹配歌词。未更改手机任何设置；正常起播同步也不能归因于固定歌词偏移。
- 用已登录独立模拟器、同曲和同音质，经过 `StreamOccurrence` → `StreamMixOutput` 与真实顺序解码参考比较，原代码 **FAIL：8 个跳转窗口**，文件与网络均复现。

| 请求跳转 | 测量窗口时钟 | 实际声音对应时间 | 声音超前 |
| --- | --- | --- | --- |
| 30 秒 | 31 秒 | 44.37 秒 | 13.37 秒 |
| 90 秒 | 91 秒 | 114.03 秒 | 23.03 秒 |
| 15 秒 | 16 秒 | 23.38 秒 | 7.38 秒 |
| 连续拖动，最后 75 秒 | 76 秒 | 96.76 秒 | 20.76 秒 |

文件／网络两组结果一致；相关系数 0.9757–0.9993。起播基线为零偏差。这是无需 WebView 或歌词动画就能重现的音频定位错误。

## 候选与当前验收边界

`AudioFileStreamProcessor.processSeek` 对 FLAC 按文件字节比例估算位置，却把请求秒数保存为实际起点。变码率 FLAC 的字节位置与时间不成比例，导致声音已到更后面的片段、歌词仍按请求时间显示。

最小修正复用现有 AudioToolbox 解码器和 PCM 缓冲：从文件起点重建 FLAC 解析器／转换器，丢弃目标时间之前的解码帧，之后才交给播放缓冲。新请求、停止和切歌继续走现有取消路径。没有新依赖或歌词偏移补偿；MP3／AAC 跳转保持原路径。

- 首个候选复测：文件全部 5 个窗口及网络前三个窗口，在 10ms 测量分辨率内零新增偏差；网络回拖到 15 秒出现 `FRAME_CRC_MISMATCH`，整体仍 **FAIL**。未安装个人 App。
- 用户批准追加一次后，“重新打开 FLAC 解析器与转换器”候选完成原完整回归：文件 5 个窗口、网络起播／30／90／15 秒共 9 个窗口，在 10ms 测量分辨率内零新增偏差。本次日志未出现 CRC 错误；网络连续快速拖动最终到 75 秒时 `entry.hasFailed`，未取得第 10 个窗口，整体 **FAIL**（1 项 XCTest、2 条失败、4.487 秒）。没有追加重跑真实歌曲测试。
- `RemoteAudioSource.initialRequest` 没有保存头部探测请求，`close()` 因此无法取消它；多个旧探测响应仍可能启动媒体请求。独立单测 `testRemoteHeaderProbeIsCancelledBySeekAndClose` 已确定复现：连续打开三次后保留 3 个而非 1 个请求，关闭后注册表仍非空（0.195 秒，2 条断言失败）。该单测只用既有 URLProtocol，不访问音乐平台，不作为歌曲验收。
- 后续候选保存并取消头部探测请求，在现有 sourceQueue 上处理网络回调，以请求代次隔离旧响应、数据／结束事件、重试及 MP4 重整回调；真实音频测试增加仅含错误类别／代码的代理，保留全部原 delegate 行为，不输出临时 URL 或网络错误 userInfo。该阶段先修正生命周期缺口，再以下述真实歌曲回归确认结果，没有新增依赖。
- 请求生命周期补丁原生构建 **PASS**；新增单测修正后 **PASS**（0.007 秒），另有 4 项既有 AAC 音效／跳转、请求版本与并发快照、HTTP 重定向／EOF 重建及凭据隔离回归 **PASS**（5.880 秒）。这些是本地或受控 HTTP 检查，不计真实平台验收。59 文件／8 个补丁文件的供应源码校验 **PASS**。
- 用户再次批准后，最新候选 App 二进制 SHA-256 前缀 `6e0b44e224383af5` 完成 `run-hires.py --label hires-lifetime`：**PASS**（1 项 XCTest、0 失败、8.454 秒）。文件与网络各自起播、30／90／15 秒及连续拖动最终 75 秒，共 10 窗口在 10ms 分辨率内零新增偏差；未出现 CRC 或解码错误。源码／测试包完整摘要在 `lifetime-candidate-manifest.json`。这证明该曲原生音频内容与时钟对齐，不等于真机声音与歌词端到端验收。个人 App 未更新。
- 首次诊断构建缺少 `ENABLE_TESTABILITY=YES` 而失败；补齐后一次重建通过。后续第一个修正候选原生构建通过。
- 独立诊断阶段，真实测试前后的模拟器原包、完整 50 首队列、151.617346 秒位置和音效核对保持。当时个人手机只读、版本为 32；后续获准更新与验收见下节。
- 回退式精确解码可能增加远距离跳转的读取量与等待时间；沿用现有准备超时和取消保护，不把慢网络失败伪装成成功跳转。
- **已获用户确认**：mobile.33 手机 QQ／网易云前拖、回拖及连续拖动后声音与歌词同步，网易云登录保留。
- **未补验**：手机端毫秒级误差量化、不同音质／更多曲目矩阵、远距离跳转等待时间量化，以及本版长播、蓝牙和 iPad 场景。既有 AAC／HTTP 回归已通过；顺序音频相关测量不等于真机声音到歌词端到端误差测量。

证据：`.mobile-test-results/device-lyric-alignment-20261017/` 中 `device-song.json`、`device-lyric-preferences.json`、`hires.log`／`.xcresult`、`hires-fixed.log`／`.xcresult`、`hires-fresh.log`／`.xcresult` 和对应模拟器恢复报告。`hires-fresh-simulator-preserved.json` 中原二进制、队列、音效均为 true。来源 URL、会话和访问凭据不写入报告。
复现入口：`run-hires.py` 调用既有 `testSignedInQQMixedOutputSeekMatchesClock`，通过仅测试环境变量指定真实歌曲和音质；默认测试仍不访问平台。

请求生命周期与兼容回归证据同目录：`header-red.log`／`.xcresult`、`header-fixed.log`／`.xcresult`、`transport-regression.log`／`.xcresult`；后两次的 `*-simulator-preserved.json` 均确认原二进制、完整队列和音效保持。所有测试进程已结束。

最终真实歌曲证据：`hires-lifetime.log`／`.xcresult`、`hires-lifetime-simulator-preserved.json`。恢复报告确认原二进制、完整 50 首队列及 151.617346 秒暂停位置、音效均与测试前一致。

## mobile.33 真机包（已安装，拖动同步获用户确认）

- 以已核验的 mobile.32 冻结源码为基线，仅更新 `AudioFileStreamProcessor.swift` 与 `RemoteAudioSource.swift` 两个生产文件；另记录测试、供应补丁及诊断文档。3873 份源码清单及摘要保存到交付目录 `Folia-mobile33-source.json`。
- 沿用 `app.folia.personal`、原签名团队及 iOS／iPadOS 17 最低版本；仅构建号改为 33。原生 Release、签名／证书与 profile 匹配、压缩包逐文件及权限一致性均 **PASS**。
- 复用 mobile.32 的前端构建，145 份前端资源加 2 份 Cordova 兼容文件均核对；只有 `build-identity.json` 版本标识变化，UI／功能资源未改动。未声称本次重新执行类型检查或前端构建。
- 安装包：`../移动端交付/Folia-0.7.16-mobile.33-dd4dfcb0-development.ipa`，20,658,631 bytes；SHA-256 `5c17efcaf86e3d59c871b306aed1166a20fc54987a8ca9bef2729faaa7876cfe`。
- 原始 mobile.32 包保留。用户另行明确批准原位更新后，iPhone XS Max 的 `app.folia.personal` 已从 build 32 更新至 33，安装、版本回读与启动均 **PASS**，未卸载或清空数据。
- 更新前后原生音效摘要一致。最初队列整体摘要不同，定向复核证明唯一变化是播放进度从 20.544013 秒推进至 61.781338 秒；将这一进度字段还原用于比较后完整队列摘要一致，索引仍为 26。50 首曲目的内容／顺序、当前歌曲、循环及个人 FM 状态保持。保留首次差异和复核证据，没有把进度原样保持写成通过；原始偏好临时副本已删除。
- 手机 QQ《我怀念的》与网易云的前拖／回拖／连续拖动同步均 **PASS_USER_CONFIRMED**，网易云登录保持 **PASS_USER_CONFIRMED**。反馈来自本对话两个测试问题的用户回答；保存于 `device/user-acceptance.json`，安装回执及交付记录已同步。未将远距离跳转等待时间、长播或精确误差量化一并标为通过。本次记录反馈未操作或重启 App。
- 打包证据：`.mobile-test-results/ipa-mobile33-20261017/package-check.json`、`source-record.json`、`native-build.log`；交付目录 `Folia-mobile33-交付记录.json` 同步保存核验结论。
- 安装与保留证据：同目录 `device/receipt.json`、`before-install.json`／`after-install.json`、`install.json`、`launch.json`、`preservation-detail.json`。打包时的 `package-check.json` 保留当时尚未安装的记录；交付记录新增后续安装回执。

以下为此前标准音质诊断的历史记录；当前修复与验收结论以上述 mobile.33 记录为准，早期失败证据保留。

用户此前报告个人 iPhone 的两平台歌曲拖动后持续错位，并补充模拟器实际使用暂未发现问题。没有用模拟歌曲替代真实平台音频。

## 已获得的证据

| 检查 | 结果与范围 |
| --- | --- |
| 真机版本只读查询 | iPhone XS Max，`app.folia.personal`，0.7.16／build 31；未启动、重装或修改该 App |
| 与 mobile.31 打包源码比较 | 207 个原生播放／流处理、移动模块及歌词时钟文件，仅 `MobileApp.tsx`、`SettingsSheet.tsx` 的恢复入口改动不同。模拟器 build 标签仍为 28，不能用标签代替源码对比；未对真机安装二进制逐字节核对 |
| 真实 QQ 解码层 | 从已有队列取真实 QQ 歌曲并用已登录会话解析；文件和网络输入、跳到 30／90／15 秒、连续跳转最终到 75 秒，均取得有效音频相关性 |
| 真实 QQ 完整输出链 | `StreamOccurrence(allowsTempo: true)` → `StreamMixOutput`，手工渲染实际原生输出链；1 项 XCTest PASS，2.998 秒，文件／网络共 10 个窗口 |
| QQ 音频内容与原生时钟 | 与顺序解码参考音频做能量包络相关匹配，相关性 0.9500–0.9995；相对起播基线的新增偏差 10–20ms，未复现持续错位 |
| 网易云音频诊断 | 使用此前真实测试歌曲《樱花再开》；媒体下载抛出 `cache-network`，整项 XCTest FAIL／35.082 秒。没有获得网易云跳转测量结果 |

QQ 测量采用 44.1kHz 手工渲染，跳过起播／跳转后第一秒，再分析三秒窗口。它能检验该歌曲的解码／混音内容与原生时钟，**不能证明真实扬声器、蓝牙、WebView 桥接、歌词渲染或真机跳转瞬间正确**，也不是歌词误差 ≤150ms 的验收。

## 失败与修改记录

- 第一轮解码诊断使用未经平滑的能量窗口，起播相关性不足，且现有队列没有网易云曲目；调整为平滑包络、跳过起播一秒，并加入此前实际测试的网易云歌曲身份。一次重测中 QQ 窗口有效，网易云下载失败；保留两轮结果，没有继续重跑该项。
- 一次原生构建在 Swift 长表达式类型检查处失败，拆成显式类型循环后一次重测通过。
- 完整输出链第一次命令在候选包摘要断言处停止，测试清单未生成，没有执行测试；修正候选摘要核对后一次重试通过。
- 这些改动都在独立诊断测试内，没有生产播放修复或新增依赖。

## 下一步排查顺序

1. 真机用同一首真实歌、相同起点／目标点，记录原生位置、前端接收时间和歌词时间；优先确认声音内容和界面时钟究竟哪一侧偏移。当前缺少能稳定重现的具体歌曲和时间段。
2. 对比真机的音频输出路线、歌词全局／单曲偏移、音效及过渡设置。以上是待验证假设，不能直接当成根因或通过重置用户设置掩盖问题。
3. 若原生内容与位置一致，沿桥接快照、拖动期间请求顺序、歌词时钟及渲染延迟定位；若原生侧已错位，再对缓存／网络和实际设备输出时序做定向检查。

本轮未更新个人 App；最新用户补充后停止操作其正在使用的模拟器。真实设备修复与回归、网易云有效音频测量、系统输出延迟及完整歌词同步验收均待完成。

## 证据

目录：`.mobile-test-results/seek-feature-20261017/`。

- `seek-red.*`、`seek-refined.*`：诊断失败和部分有效测量，不计整体通过。
- `mix-red.log`、`mix-retry.log`、`mix-retry.xcresult`：输出链测试首次未执行、随后通过。
- `personal-app-version.json`、`source-comparison-mobile31.json`：设备版本与发布源码比较。
- `manifest-mix.json`、`preservation-current.json`：当前独立候选摘要和状态对比。

测试入口：`ios/App/NativeTests/LiveSeekAlignmentTests.swift`。显式环境开关及独立模拟器 Bundle ID 限制生效；默认测试不会发起这些真实平台请求。报告不记录会话、鉴权头或临时签名音频 URL。
