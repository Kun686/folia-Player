# 本地 Ogg / Vorbis 导入

2026-10-13，离线代码与独立模拟器验证完成；个人 mobile.28、真实账户、服务器和物理设备未操作。

## 行为与复用

原版本地文件规则接受 `.ogg`，移动导入此前只接受系统可解码的格式。
现在复用已批准并链接的 AudioStreaming 1.4.5 / Vorbis 0.1.2 中的官方 `libvorbisfile`：
导入时保留原始 `audio.ogg`，逐块解码为 Float32 `audio.caf`，再使用已有本地播放、拖动、DSP 和分析入口。
这一步不再做有损编码，不增加生产依赖，不修改第三方源码，也不上传音频。

曲名、多艺术家、专辑、碟号、曲号、ReplayGain、封面与歌词使用已经安装的
`music-metadata@11.16.1` Vorbis 标签映射和原版 `selectEmbeddedLyrics`。
原生层只提供原始注释；JavaScriptCore 使用同库的图片解析器和现有 Buffer，避免依赖浏览器 `atob`。
曲库保持原来的歌曲 UUID；`media.json.file` 指向 CAF，附加的 `original` 字段用于后续标签重扫。
手动歌词与内嵌歌词独立保存。即使原 Ogg 缺失，可播放 CAF 和手动歌词仍可读取；文件夹提交则拒绝缺失或非法的原文件引用。

实现入口：`NativeVorbisFile.swift`、`LocalVorbisImport.swift`、`nativeVorbisMetadata.ts`。
现有 `LocalMediaLibrary`、文件夹事务、原生歌词运行时与系统导入器只增加适配分支。
全屏播放器、控制器、动画与 Automix 算法没有改动。

## 成本与限制

- 当前接受单逻辑流的 Vorbis，单／双声道，8–192 kHz；不包含 Ogg Opus 或 chained Ogg。
- 额外保存 PCM 占用空间。44.1 kHz 双声道约 352,800 字节／秒；三分钟约 60.6 MiB，另加原文件。
- 单份解码副本上限 1 GiB，包含 4096 字节 CAF 头部余量；转换期限 120 秒，在每块解码间检查取消和期限。
- 4096 帧缓冲复用，不把整首 PCM 放入内存。失败、取消、损坏页或时长不完整时删除临时副本，导入失败清理该新歌曲目录。
- 最多 4096 个注释、合计 8 MB UTF-8；歌词单项不超过 2 MB，艺术家不超过 128 个。
  损坏／超限输入明确失败，不写入不完整曲库；没有修改桌面标签选择规则。
- 系统文件选择器增加 Ogg 类型；真实 Files 提供方是否允许选中仍需实际设备验证。
- 本批不解决在线 Ogg 流的拖动，不代表完整 Automix 或真机后台性能验收完成。

## 验证证据

证据目录：`.mobile-test-results/vorbis/`。测试音频由 `dev/mobile/vorbis-fixture.c`
使用已有 Xiph 编码库生成，不来自用户曲库或在线音乐平台。

| 检查 | 结果 | 证据范围 |
| --- | --- | --- |
| TypeScript | PASS | `npm run typecheck`，`typecheck-final.log` |
| 移动／本地库逻辑 | PASS，129 文件／1380 项 | `unit-full.log`；含 4 项新 Vorbis 标签用例 |
| 移动资源构建 | PASS | `npm run build:mobile`，`mobile-build.log` |
| 原生 Release QA 构建 | PASS | `native-build.log` |
| 原生模拟器 | PASS，25 项 | `native.xcresult`、`native-summary.json`、`native-tests.log`；5 项新用例及 20 项既有回归 |
| 浏览器布局 | NOT_RUN | 本批没有 Web UI 布局改动 |
| 实际文件提供方、物理设备、真实平台 | NOT_RUN | 未操作个人 App、账户、手机或服务器 |
| 大文件耗时、真机存储／功耗、持续 Automix | NOT_RUN | 小型离线样本不代表这些验收 |

模拟器为 iPad Pro 11-inch M5 / iOS 26.5，独立 `app.folia.validation.App`，使用空白离线 WebView。
8 秒样本实际解码为 352,800 帧，保持两路独立声道的频率与振幅，原压缩文件 31,141 字节未变，
CAF 为 2,826,496 字节。播放用例通过真实解码输出前后拖动、暂停／继续、自动跨到 WAV 以及队列结束，播放地址解析调用为零。
重启读取、原 Ogg 重扫、手动歌词保留、缺失原文件容错、损坏导入清理、文件夹重扫复用和替换时身份保留均通过。
取消测试覆盖已取消任务；损坏中间页覆盖转换失败清理。未宣称用户在转换中点取消的真机行为已经验证。

初次独立解码测试 1 项失败：测试错误地要求 CAF 头部严格小于 4096 字节，实际正好 4096；修正为包含边界。
初次逻辑测试中 malformed／超限输入未被完整拒绝；已补图片固定头部长度／非空数据检查，同时对原始歌词值加限，避免未被选择的标签绕过限制。
首次失败证据保留于 `first-probe/` 与 `unit.first.log`；以上结果来自修正后的最终运行。

## 复现与回退

逻辑检查：

```sh
"$HOME/.local/bin/codex-bounded" 600 -- node_modules/.bin/vitest run -c vitest.config.ts test/unit/mobile test/unit/utils/localSongSorting.test.ts test/unit/library
"$HOME/.local/bin/codex-bounded" 600 -- npm run typecheck
"$HOME/.local/bin/codex-bounded" 600 -- npm run build:mobile
```

原生用例在 `ios/App/NativeTests/NativeVorbisTests.swift`；输入为随测试打包的 `VorbisFixture.ogg`。
QA 构建与执行参数保存在证据目录的 `stage.py`、`native-command.json`；测试超时 45 秒、关闭并行，不启动个人 Bundle ID。
依赖与锁文件保持原样。可撤回本批适配代码；旧版本忽略 `original` 字段仍能播放 CAF，不迁移或删除原曲库。
`BUILD_RECORD.json` 保持原值；提交与 CI 通过不代表个人 App 已安装此功能。
