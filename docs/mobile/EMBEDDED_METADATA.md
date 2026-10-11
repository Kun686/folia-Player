# 移动音频多标签与独立翻译

2026-10-11 后续开发源码；个人 iPhone 保留 mobile.19，本阶段没有生成或安装新 IPA，
`BUILD_RECORD.json` 仍绑定已交付的 mobile.19。完整移植保持 IN_PROGRESS。
本文记录 USLT／iTunes 阶段；后续 FLAC、SYLT、扫描版本 3 及 iOS 18 真机修正见
[EMBEDDED_FORMATS.md](EMBEDDED_FORMATS.md)。
上述源码已随后汇入 mobile.20 并原位安装；本文测试仍保持各阶段范围，安装记录见 [VALIDATION.md](VALIDATION.md)。

## 实现与复用

原移动采集只取首个非空 USLT／iTunes 歌词标签，可能先取到无时间文本，遗漏后续逐字歌词或翻译。
本阶段将原 `metadataParser.worker.ts` 的选择规则原样提取为 `embeddedMetadataSelection.ts`，
桌面 worker 和现有原生 JavaScriptCore 共用：归一化去重、带时间文本优先、逐字时间优先、
原有语言／descriptor 翻译提示和 common 标签优先级均保持。没有新生产依赖或生产二进制标签解析器。

- `LocalEmbeddedLyrics.swift` 使用 AVFoundation 收集全部非空 USLT／iTunes 歌词；语言通过 Foundation
  转为桌面使用的 ISO-639-2 代码，descriptor 使用系统暴露的 extraAttributes.info。
  首个原始文本单独保留作旧 `lyrics.txt` 来源判断，不能拿新选出的更好歌词反推旧文件来源。
- `lyrics.json` 独立保存主歌词和翻译，扫描版本升级为 2。旧扫描按需重读保留的音频；
  导入正文、原文件名、显式来源及在线匹配记录保留。当前或更高版本不降级重扫。
  异步扫描继续校验取消、文件存在和编辑令牌；失败保留已存来源并允许下次重试。
- 前台映射到已有 `embeddedTranslationLyricsContent`，使用原准备、解析、显示和导出流程。
  原生独立歌词规划读取相同快照；规划只返回既有时间和正文，翻译不改变队列调度。

## 边界

每个标签正文最多 2,000,000 UTF-8 字节，全部非空标签合计最多 4,000,000 字节，最多 64 项，
语言／descriptor／标识各最多 1024 字节。桥接请求另有 24,300,000 字节 JSON 上限。
存储每份正文／翻译最多 2,000,000 字节，整个歌词记录继续使用 37,000,000 字节上限；
各字段最大值不能保证同时满足整个记录上限。原生规划的行数及输出限制不变。

已验证 ID3v2.4 UTF-8 多 USLT 的语言／descriptor 及多个 iTunes 歌词标签。
实际 M4A 导出样本没有保留语言信息，因此只证明择优正文，不能证明能识别缺失提示的独立翻译。
本阶段当时未接入的 FLAC／Vorbis comment 与 SYLT 原生采集已在后续源码接入，见上述格式专项记录。
其余编码与文件格式矩阵、物理设备文件选择器及长期性能为 NOT_RUN。

## 验证

本地证据目录 `.mobile-test-results/`；索引 `embedded-multitag-evidence.json`。

| 检查 | 结果 | 证据与范围 |
|---|---|---|
| 类型检查 | PASS | `embedded-multitag-typecheck.log`，`npm run typecheck` |
| 逻辑回归 | PASS | `embedded-multitag-unit.log`，4 文件／28 项；标签选择、实际 music-metadata 解析 MP3 的结果对照、来源、单曲／批量导出 |
| 翻译导出复核 | PASS | `embedded-multitag-export.log`，7 项；加强既有单曲测试后复跑，FIA／LRC 保留独立内嵌翻译；不重复计入上述 28 项 |
| WebKit | PASS | `embedded-multitag-ui.log`，手机／宽 iPad／窄 iPad 共 3 项；独立翻译显示、来源切换、导入及播放进度保持。原生桥为受控响应 |
| 移动资源构建与同步 | PASS | `embedded-multitag-sync.log`；原歌词运行时新增共享选择入口，无新增运行库 |
| Release 原生专项 | PASS | `embedded-multitag-native-testable.{log,xcresult}`，iPhone 17 Pro／iOS26.5 临时模拟器，23 项／0 失败，测试用例 6.640 秒 |

原生专项包括 6 项新增测试，以及原来源、导入、解析、匹配、歌词规划与播放保持回归。
系统实际读取合成但合法的 MP3／M4A 文件；测试内的标签样本构造不进入生产程序。
首次原生命令遗漏 `ENABLE_TESTABILITY=YES`，Release 模块不能被 XCTest 导入，构建失败、未执行测试；
保留 `embedded-multitag-native.log`。仅为第二次测试传入 `ENABLE_TESTABILITY=YES ONLY_ACTIVE_ARCH=YES` 后通过，
没有更改项目的发布构建配置。原有 Swift 并发／弃用 API、npm 配置和 Vite 警告未计为验收通过。

本阶段没有重新连接真实音乐平台或更新个人 App。模拟器与自动测试不能替代物理设备验收。

## 回退

回退此源码变更可恢复旧采集规则；无音频删除或曲库格式重建。
旧版本仍可读兼容正文和导入文本，但再次编辑可能丢弃其不认识的翻译／扫描版本字段；
回退前保留 App 数据备份，不能将可读取误记为无损往返编辑。
