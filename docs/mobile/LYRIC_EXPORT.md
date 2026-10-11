# 原版单曲歌词导出移植

2026-10-11，开发源码 `e11a083347294b1b1eef556b5c339669d66db2b5` 接入当前歌曲的 `.fia` 和增强型 LRC 导出。
该源码阶段个人 iPhone 仍运行 mobile.12，未安装或重启手机；播放器和动画参数不变。
随后功能汇入 mobile.13，已原位安装并启动，设备回读 build 13。新增 2 项 iPhone 原生输入检查通过；
用户反馈导出可用、升级后两平台会话与播放正常；在线歌曲回导时 `.fia`／`.lrc` 被置灰，
回导记为 FAIL_USER_REPORTED。mobile.14 取消移动在线导入的扩展名过滤，继续由原解析器和大小限制校验；
mobile.14 已原位安装、启动并确认 build 14；6 项 WebKit 用例覆盖导出后回导及无效文件保留已有歌词。
浏览器文件注入不验证系统选择器；用户随后确认「两种文件都能选择，导入后歌词正常」，
mobile.14 的在线 FIA／LRC 回导记为 PASS_USER_CONFIRMED，详见 [VALIDATION.md](VALIDATION.md)。
完整移植保持 IN_PROGRESS；后续批量导出见 [BATCH_LYRIC_EXPORT.md](BATCH_LYRIC_EXPORT.md)。

## 复用与行为

- 复用原 `LyricFileDialog` 的格式选项和说明、`buildCurrentSongExportEntry`、原文件命名、
  `.fia`／LRC 序列化、纯音乐判断及 `applyUserAdjustments`。没有新增依赖或另写歌词格式。
- 原导出服务增加可选的源读取函数；桌面默认行为保留。移动在线源从原生缓存的一次快照读取
  歌词及用户来源选择；本地源经原解析器读取导入、内嵌或在线匹配结果。导出不请求音乐平台。
- 导出保留原始制作人员和歌词行，不使用经过视觉过滤、重排或副歌效果处理的显示结果。
  `.fia` 保留已保存的分词和单曲 offset 元数据，时间戳不平移；全局设备校准不写入文件。
  LRC 继续按原规则保留逐字时间、翻译与罗马音，不支持的 Folia 专有字段不强行扩展。
- 移动校准读取 provider 前缀的播放身份；相同 ID 的 QQ 和网易云歌曲不会互相读取校准。
  本地文件优先沿用导入音频的文件名，旧记录没有文件名时按原标题／歌手规则命名。
- 原生缓存或分词读取失败会提示失败，不静默导出缺失的内容；纯音乐和空歌词没有导出文件。
  关闭或切歌后的迟到读取不再打开分享；并发点击只发起一次操作。
- Swift 使用 `UIActivityViewController` 交付临时 `.fia`／`.lrc` 文件，支持系统“存储到文件”等活动。
  文件名拒绝路径、控制字符和不支持的扩展名；UTF-8 正文限制 16MB，文件名限制 255 字节。
  私有临时目录在分享结束／取消后清理，下次启动清理上次意外退出的残留。
  iPad 指定 popover 锚点；其它系统弹窗占用时明确失败。用户取消不显示“导出成功”。
- UI 沿用原格式卡片，补移动视口滚动、安全区和至少 44px 的触摸目标。
  `LyricFileDialog` 可不显示尚未接入的批量入口；桌面调用仍提供原批量入口。

## 最初单曲导出源码阶段验证（历史）

- PASS：类型检查；32 项逻辑回归／4 文件，包含原导出测试及 7 项移动数据源测试。
  覆盖源选择、原始行、分词、平台隔离、文件命名、取消、迟到结果和存储／分享失败。
- PASS：3 个 WebKit 视口的实际组件检查，覆盖两种格式、取消、错误重试、不改变播放位置、
  切歌关闭和 390×400 低高度窗口关闭。桥接结果受控，不代表系统分享或真实平台测试。
- PASS：通用 iOS Release 编译，3,052 个冻结源码输入在资源同步及编译后保持一致；
  119 个资源与 `dist-mobile`、iOS 同步目录及编译后 App 逐字节一致。
- PASS：[对应准确源码 CI](https://github.com/Kun686/folia-Player/actions/runs/38126683098)。
- 日志及截图位于 `.mobile-test-results/export-logic-final.log`、`export-typecheck-final.log`、
  `export-ui-final.log`、`lyric-export-*.png`、`export-source-sync.log`、`export-device-build.log`。
  `export-build-record.json` 保存编译、资源及身份；`export-final-evidence.json` 保存证据摘要。
- 编译产物是未签名的 `app.folia.validation.export`，未生成 IPA、未安装或启动；
  没有启动模拟器、没有执行原生 XCTest，不能把编译通过当作原生交互通过。
  该源码编译阶段 `docs/mobile/BUILD_RECORD.json` 未变；后续 mobile.13 安装后已更新交付记录。
- NOT_RUN：原生分享界面、存储到文件、文件回导、临时文件实际生命周期与物理 iPad。
  手机上的真实平台反馈只覆盖已安装的 mobile.12，不覆盖此开发功能。

回退本阶段接线即可移除单曲导出；没有存储迁移，不删除原歌词、分词或账户会话。
