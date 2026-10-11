# 原版歌词显示规则与时间线移植

2026-10-11，源码 `593615f7f4ccba43a183f0c746303eaffb997223`。
移动端此前把解析结果直接交给 visualizer，遗漏原播放器的显示处理。
本阶段复用原歌词过滤、开头制作人员策略、纯音乐识别和副歌效果，并接入原过滤编辑器与时间线。
完整移植仍为 **IN_PROGRESS**；该源码阶段个人 iPhone 保持 mobile.12，没有新 IPA，BUILD_RECORD 未改变。
后续已随 mobile.13 原位安装到个人 iPhone；本功能的真机交互仍待验证，见 VALIDATION.md。

## 复用与实现范围

- 从 `createLyricsSetter.ts` 提取 `createLyricsProcessor`，桌面原 setter 仍包装同一处理过程。
  保留过滤顺序、制作人员策略、纯音乐归一化、副歌区间缓存、分词及渲染提示；不复制解析器。
- `useLyricDisplay.ts` 仅在原始歌词、歌曲身份或有关设置变化时派生显示结果，
  不按音频时钟重复处理、不增加逐帧 React state。`useMobileLyrics.ts` 按身份隔离原始来源。
- `LyricDisplaySettings.tsx` 复用 `LyricFilterSettingsModal` 和原 `useLyricSettingsStore`。
  打开时固定预览来源与初始草稿，避免迟到加载抹掉编辑；切歌关闭旧草稿。
  只保存原显示设置，不重写原生歌词缓存。原有命令注册继续使用，不引入第二套设置模型。
- 原时间线接收校准后的歌词时钟；点击继续使用既有反向偏移映射跳转原生播放器。
  修正暂停打开时没有当前行的问题，并复用 `findLatestActiveLineIndex`，避免恰好落在下一句起点时选中上一句。
  滚动定时器在关闭／卸载时清理；移动样式使绝对定位的歌词内容撑开行高度。
- 原过滤弹窗增加预览／保存异常反馈；非法正则仍按原规则阻止保存，失败后可重试。
  移动宿主只补安全区、滚动、触摸尺寸和字号，保留原布局风格及动效参数。

可复用项为原处理器、弹窗、Zustand store 和歌词时序 helper；最简方案是提取共用入口并接线。
没有新增依赖，没有修改 Swift 音频、服务器、凭据或歌词持久层；无需自行实现新的解析或过滤算法。
分词记录的处理能力随共用过程保留，但本阶段没有移植精细分词编辑／导出工具。

## 自动验证

本地证据目录 `.mobile-test-results/`；摘要清单为 `lyric-display-final-evidence.json`。

| 检查 | 结果 | 范围与记录 |
|---|---|---|
| 类型检查 | PASS | `lyric-display-sync.log`，`tsc --noEmit` |
| 原逻辑及移动逻辑 | PASS | `lyric-display-logic.log`：29 文件、186 项；移动测试及原 setter、过滤、制作人员策略、过滤保存器 |
| 最终移动 WebKit | PASS | `lyric-display-final-ui.log`：39 项，2.2 分钟；15 项新显示流程＋12 项校准＋12 项 Partita；390×844、1194×834、600×834 |
| 原桌面组件回归 | PASS | `lyric-display-desktop-chrome.log`：原制作人员／过滤设置 9 项，14.8 秒；使用已安装 Google Chrome |
| 固定源码资源同步 | PASS | `lyric-display-source-sync.log`；提交后的 build identity 为本页源码，2,938 个源码输入与冻结哈希一致 |
| Release 模拟器构建 | PASS | `lyric-display-simulator-build.log`，独立 `app.folia.validation.lyricdisplay`；安装前核对 bundle、身份及全部 dist-mobile 资源 |
| 固定 vendor 校验 | PASS | 现有 AudioStreaming 1.4.5、59 个文件、4 个既有补丁；本阶段未改 vendor |
| GitHub Mobile checks | PASS | [run 38121956388](https://github.com/Kun686/folia-Player/actions/runs/38121956388)，准确源码 `593615f` |

新 UI 用例覆盖预览／取消／保存、停用规则后恢复正文、非法正则、存储失败及重试、
切歌关闭旧草稿、暂停初始高亮和 500ms 偏移下点击 10 秒歌词映射到 10.5 秒音频。
QQ／网易云使用受控缓存样本验证离线显示与原始缓存不变，不发真实 provider 请求。
测试使用原 parser／Worker／渲染器，但桥接与平台数据受控，不能算真实平台验收。

## iPad 实际容器短测

iPad Pro 11-inch (M5)／iOS 26.5 Simulator，独立 QA App，使用明确标注的合成 30 秒 WAV 与五行 YRC。
样本直接预置原生存储，不计作系统文件选择器导入测试；启动恢复在第 5 秒并保持暂停。

1. 打开原时间线，第一句正文高亮，两条开头制作人员信息按默认智能策略隐藏。
2. 点击第二句，第二句高亮；原生队列持久状态回读位置为 10 秒，保持暂停。
3. 打开过滤编辑器，将制作人员策略改为「始终显示」，预览从过滤 2／5 行变成 0／5 行。
4. 保存后时间线出现全部五行；终止并重启 App，再打开编辑器，策略与完整预览仍保持。
5. 原始歌词正文与预置记录一致，音频 SHA256 不变。

截图：`lyric-display-simulator-timeline-{initial,seek,saved}.png`、
`lyric-display-simulator-filter-{preview,restored}.png`。
`lyric-display-simulator-seed.json` 保存样本身份，`lyric-display-simulator-record.json` 保存核对结果。
Xcode 界面快照未暴露 WebView 操作目标，改用 CUA 连接 Simulator 窗口并实际点击；未以启动成功替代交互验收。
本阶段不计入原生 XCTest 数量，也没有重新验证音频输出或测量动画性能。

QA App 及合成样本已卸载；个人模拟器 App 保留，个人 iPhone 未操作。
App、工具自动创建的日志辅助进程与本阶段启动的模拟器均停止，见 `lyric-display-cleanup.json`。

## 失败记录与边界

- 初次 UI 测试误用「歌词时间轴」定位，原翻译是「时间线」；修正 locator 后继续。
- 修正定位后的测试暴露移动行容器零高度、精确句首选中前一句；对应生产修复后最终 39 项通过。
  原失败日志 `lyric-display-ui-phone-corrected.log` 保留，未删除失败记录。
- 桌面测试初次因缺少 Playwright 内置 Chromium 无法启动，改用本机 Chrome 后 9 项通过，没有安装依赖。
- 清理证据首次以 XML/binary plist 读取 simctl 的 OpenStep 输出失败，改由系统 plutil 转 JSON 后通过。
- 既有 npm 配置、Vite 大块及 QQ DecompressionStream 警告仍有记录，未将警告视为平台验收结果。

**NOT_RUN**：本阶段实体 iPhone／iPad 交互、真实 QQ／网易云 App 端到端、30 分钟锁屏、
耳机／蓝牙／网络切换、≤150ms 视觉同步误差及持续温升／内存。
真实 App 在线链路仍受未配置的音乐 API 网关连接限制；本地显示与操作无需服务器。
完整 Automix、其余原版编辑工具、内嵌多标签采集和长期真机验收仍待完成。

回退源码提交即可撤销本阶段接线；不迁移或删除曲库／原始歌词数据。
该源码阶段保留 mobile.12 安装包与记录；后续 mobile.13 安装已包含本阶段功能，交互验收仍独立记录。
