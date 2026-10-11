# FLAC 与 SYLT 内嵌歌词移植

2026-10-11 后续开发源码。个人 iPhone 保持 mobile.19；没有生成或安装新个人 IPA，
`BUILD_RECORD.json` 不变。当前外观按用户“先这样吧”保留，完整移植仍为 **IN_PROGRESS**。

## 实现与复用

复用项目已安装、锁定的 `music-metadata 11.16.1`（MIT）、原桌面标签选择器和已有 JavaScriptCore。
没有新增 npm／SPM 依赖，没有另写 FLAC／ID3 二进制解码器，也没有修改原音频文件。

- `nativeMetadataDecoding.ts` 使用原 `FrameParser` 解码系统提供的 SYLT 帧，使用原 `parseLyrics`
  归一化 Vorbis／iTunes 字符串；原有语言、descriptor、正文／翻译及时间单位选择规则保留。
- `nativeFlacRuntime.ts` 使用原 `FlacParser`、`MetadataCollector` 和 `VorbisDecoder`，
  以现有 `AbstractTokenizer` 接入受限文件读取。`NativeMetadataFile.swift` 仅提供所需文件区间，
  跳过 padding 和音频，不把整个文件转成桥接数据，不依赖 WebView、网络或定时器。
- 所有本地 FLAC 均走原文件解析器：iOS 18 的系统标签路径没有返回本次普通 Vorbis 歌词；
  iOS 26.5 可暴露普通 Vorbis，但带前置 ID3 时隐藏 Vorbis。统一文件路径保留桌面的格式优先级。
  即使系统歌词标签为空、前置 ID3 只有标题，仍可从文件恢复 Vorbis 歌词。
- 系统标签适配也识别 Vorbis `LYRICS`／`UNSYNCEDLYRICS` 和原生备用歌词字段。
  common 优先级保持 Vorbis > ID3 > iTunes；common 已选出正文时，不擅自追加 native 翻译。
- 扫描版本从 2 升为 3。旧记录按需重扫保留的音频，保留用户导入、显式来源、匹配和旧正文来源判断。
  读取失败不隐藏已保存歌词、不阻止用户重新导入；异步取消、删除和编辑令牌规则不变。

这里的 Vorbis 指 **FLAC 容器中的 Vorbis comment 标签**，不代表新增 Ogg/Vorbis 音频导入能力。
本地导入扩展名白名单未改。

## 依赖与资源

部分复用入口属于 `music-metadata` 内部模块；构建显式校验精确版本 11.16.1，升级须先复核。
JavaScriptCore 没有 Web 的 TextDecoder／TextEncoder；构建只消除未使用的全局构造器，
实际文本解码使用该依赖已有的回退实现，没有注入全局兼容层。
Vite 自动生成 `public/native/metadata-licenses.md`，随前端资源复制进 App，保留所含源码的许可证。

本次歌词运行时 297,047 字节，许可证 49,842 字节。这是生成资源大小，**不是 IPA 安装体积增量**。
合成音频参考 JSON 仅打入 XCTest 插件，不进入个人发布包。

## 输入与资源边界

继承每个标签 2,000,000 UTF-8 字节、总计 4,000,000 字节、64 标签及各元数据字段 1024 字节上限。
SYLT 原始帧最多 262,144 字节，解码同步项最多 2000；独立 backing buffer 避免内存池掩盖截断帧。
FLAC 每次读取／token 分配最多 4,000,000 字节，总读取最多 8,000,000 字节、512 次；
单块 Vorbis comment 数先经原解码器校验，最多 4096，并须符合块长度可容纳的数量。
文件必须为普通非符号链接文件，每次原生读取检查取消及自开始后 5 秒预算；文件句柄始终关闭。
该时间预算在读取回调检查，不宣称可抢占任意 JavaScript 指令。
原生仅接受同次调用完成的结果；解析失败丢弃 JS context，避免后续调用继承未完成任务。
最终正文／翻译各最多 2,000,000 UTF-8 字节，歌词规划原有行数和输出上限不变。

## 验证与失败记录

本地证据索引：`.mobile-test-results/metadata-formats-evidence.json`。

| 检查 | 结果与范围 |
|---|---|
| 类型检查 | PASS，`metadata-formats-file-typecheck-fixed.log` |
| 逻辑回归 | PASS，`metadata-formats-final-unit.log`，4 文件／43 项 |
| 移动资源构建／同步 | PASS，`metadata-formats-file-sync.log` |
| iOS 26.5 Release 原生 | PASS，`metadata-formats-native-file.{log,xcresult}`，临时 iPhone 17 Pro Simulator，41 项／0 失败，12.315 秒；发生在随后 iOS 18 兼容修正之前 |
| iPhone iOS 18.7.10 最终专项 | PASS，`metadata-formats-device-portable.{log,xcresult}`，iPhone XS Max 独立 QA App，10 项／0 失败，1.252 秒；包含兼容修正和系统标签为空的回归 |

同一套 10 个实际音频样本在桌面公共 `parseBlob`、移动适配和 AVFoundation／原文件解析器中核对：
FLAC canonical／unsynced／native fallback、前置 ID3 优先级、前置 ID3 无歌词；
ID3v2.3／2.4 SYLT 的 UTF-8、UTF-16LE、UTF-16BE、Latin-1 和帧时间单位降级。
合成静音 FLAC 由系统 afconvert 编码；测试专用 MP3 帧与标签不进入生产实现。
额外测试覆盖截断、大小／数量限制、取消、解析恢复、来源保存、版本 2 升级和翻译导出。
虚拟 200MB 文件含约 16MB padding 的逻辑测试读取不足 1000 字节，没有复制 padding 或音频。

- 初次逻辑测试发现池化 Buffer 可掩盖截断时间戳；隔离帧 backing buffer 后通过。
- 初次模拟器测试发现前置 ID3 隐藏 Vorbis；接入原文件解析器后上述 41 项通过。
- 真机普通 `xcodebuild test` 未加载 XCTest 插件，未执行测试。改用 `build-for-testing`、核验
  QA 宿主／插件 Bundle ID 与签名，再用生成的 `.xctestrun` 执行；本轮生成清单身份已正确，无需改字段。
- 首次真正执行的真机 10 项有 2 项失败（8 个断言／异常），普通 FLAC 三种样本无歌词。
  将 FLAC 文件解析从“带 ID3 时使用”改为“一律使用”后，最终专项 10 项全部通过。
  失败日志分别保留在 `metadata-formats-device.log`、`metadata-formats-device-qa.log`。

测试后卸载本轮独立 `app.folia.validation.App`；个人 `app.folia.personal` 未卸载或更新，回读仍为 build 19。
临时模拟器已删除；本阶段不运行 UI 回归，界面未改；原 3 项 WebKit 证据属于上一阶段。

**NOT_RUN**：个人安装包更新、本阶段物理设备文件选择器／歌词 UI、物理 iPad、其余编码／容器矩阵、
真实平台长时间播放、耳机／蓝牙／网络切换、150ms 歌词误差和长期功耗／内存。
以上受控真实文件测试不能替代这些手工验收。

## 回退

回退源码可撤销新采集路径，不删除音频或已有歌词。版本 3 记录仍带兼容正文，
但旧 App 再次编辑可能丢失不认识的字段；回退前保留数据备份，不承诺旧版无损往返编辑。
