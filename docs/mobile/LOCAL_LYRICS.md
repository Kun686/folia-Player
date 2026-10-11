# 原版本地歌词与原生衔接

2026-10-11，接续 [TRANSITION_ANIMATIONS.md](TRANSITION_ANIMATIONS.md)。这是开发源码阶段，
完整移植仍在进行；个人安装包未因本阶段升级。完整 Automix 的设置入口仍保持不可用。

后续源码修复系统选择器不能导入 GBK／加密 KRC 的缺口，复用原字节解码器并增加校验后保存；
实际模拟器选择器与重启证据见 [LOCAL_LYRIC_IMPORT.md](LOCAL_LYRIC_IMPORT.md)。该修复尚未更新个人 iPhone。

## 复用与修复

- 原 `LocalFileLyricAdapter` 的 FIA／AWLRC 优先级、合并时间轴拆分和格式选择提取到
  `localPreparation.ts`。前端继续交给原 Worker；原生 JavaScriptCore 调用原 `parserCore.ts`。
  没有增加 npm／SPM 依赖，没有重写歌词解析或衔接规则。
- 修复移动导入丢失扩展名的问题：YRC／QRC／KRC 需要原文件格式提示，旧 `lyrics.txt` 存储使它们
  回落到 LRC 并可能得到空时间轴。新导入将内容和文件名原子保存到 `lyrics.json`，前台与原生均使用
  原 `resolveExplicitFileTimedLyricFormat`。替换成 LRC 时不保留上一次的逐字格式。
- 已导入的 `lyrics.txt` 和内嵌歌词继续按旧内容读取。新记录优先；损坏的新记录不会静默回读旧歌词。
  不修改音频、歌曲身份或已有主题／动画。
- 原生解析 actor 接受最多 2MB UTF-8 歌词，仅传出原规划器使用的行开始、结束、正文和空 words 数组。
  前台仍保留完整逐字、翻译、注音等视觉数据。输出限制为 2000 行、每行正文 4096 字符、262144 字节。
  JSON 文件读取计入转义开销，导入同时检查转换前后字节数，拒绝符号链接记录。
- 独立 JavaScriptCore 上下文提供已安装的 `buffer`，供原 AWLRC／KRC Base64 解码使用。
  仅原生歌词 bundle 移除 console 调用，避免缺失浏览器控制台或输出原始歌词。
  新 `native/lyrics.js` 为 148.40kB（构建报告），这不是最终 App 安装增量。
- 当前与下一首最多缓存两份解析结果；任务由歌曲身份和 UUID 约束。取消、换队列、重新导入和删除
  会阻止旧任务回写。失败保持原规划器的无歌词行为，不中断播放。
- 歌词结束时间进入原 Automix 规划器；按原规则处理空白和间奏。显式导入使尚未开始的计划重新计算，
  已开始的可听衔接继续使用已选时间表。普通逐周期更新仍遵守原一秒准备窗口的固定计划行为。

## 验证记录

本机证据位于 `.mobile-test-results/`；合成音频和受控档案用于隔离规则，不能替代真实平台或听感验收。

- `local-lyrics-reference-fixed.log`：原本地适配器与原生边界的 12 种输入对照、规划结果对照和相邻
  适配器测试，21 项通过。输入包括 LRC、Enhanced LRC、YRC、QRC、KRC、VTT、TTML、合并轨、
  AWLRC、FIA、空内容和无时间歌词。后续参考包含 KRC 内嵌翻译和受控歌词约束样例。
- `local-lyrics-queue-reference.log`：参考生成通过；相同 30 秒档案，无歌词衔接点为 20 秒，
  最后一句唱到 26 秒的 YRC 衔接点为 26 秒。数值由原规划器计算，未改阈值。
- `local-lyrics-final-typecheck.log`：TypeScript 检查通过。
- `local-lyrics-logic.log`：移动端、Automix、歌词相关 1059 项通过，1 项原有跳过。
- `local-lyrics-sync.log`：移动资源构建和 Capacitor 同步通过。
- `local-lyrics-ui.log`：手机、宽屏 iPad、窄窗口 iPad 三项 WebKit 界面测试通过。
  原 Worker 正确显示 YRC，随后替换成 LRC 仍正常；桥接使用测试响应，没有操作真实文件选择器。
- `local-lyrics-native.log`／`.xcresult`：iPad Pro 11 (M5)／iOS 26.5 模拟器，187 项全部通过，
  执行 76.944 秒。新增五项覆盖 12 组 JavaScriptCore 格式重放、解析上限与取消恢复、
  UTF-16 导入转换／格式持久化／旧记录兼容／符号链接拒绝、待执行任务失效和真实解码队列。
  队列在原无歌词衔接点后继续播放，随后按歌词约束在 26 秒衔接；衔接中再次导入保持原 cue 和双路输出。
  使用合成 WAV 和受控分析档案，全程没有 WebView 或网关调用。其余队列、音效、变速、取消测试一起回归。
- `verify-audio-vendor.py`：固定 AudioStreaming 1.4.5 的 59 个文件校验通过，仍为已有三处补丁。
- `local-lyrics-device-build.log`：独立 QA 构建通过。`local-lyrics-device-identity.json` 核对签名、
  entitlement、测试宿主和插件均为 `app.folia.validation.*`，测试配置未包含个人 App 身份。
  使用核验后的 `.xctestrun` 执行 `test-without-building`。
- `local-lyrics-device.log`／`.xcresult`：iPhone XS Max／iOS 18.7.10，14 项全部通过，执行 10.553 秒。
  包含新增五项、本地导入／离线跨四首队列／频谱、原主混音调度与暂停回归。
  真实解码队列同样按 20→26 秒约束衔接，衔接中导入保持播放；不等于实际歌曲的分析精度验证。
- `local-lyrics-qa-uninstall.json`：QA 已卸载；`local-lyrics-personal-app.json`：个人 App 仍为 0.7.16／build 10。

失败和修正：原始无格式提示的 YRC 对照发现上述导入缺陷；之后的
`local-lyrics-reference.log` 显示 TTML 样本缺少当前原解析器要求的 `itunes:key`，
补齐合法行标识与命名空间后通过。没有放宽非空时间轴断言，也没有修改原 TTML 解析规则。

## 尚未覆盖

QQ／网易云在线歌词的后续原生接线及验证边界见 [ONLINE_LYRICS.md](ONLINE_LYRICS.md)；前台仍经 Omni 使用原实现。
模型分轨、表现手势、ReplayGain、封面／在线歌词持久缓存和完整 Automix 验收继续保留。
真实账户、iPad 真机、长时间锁屏跨曲、蓝牙／网络切换、歌词显示误差、温升和功耗仍须分别验收。
