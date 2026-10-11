# 移动端导入／内嵌歌词来源

2026-10-11，开发源码 `49ef998c299a6ba3c36d0e7ad24550c880b92a75`。
本阶段补齐本地文件歌词与音频内嵌歌词的独立保存、切换及恢复，沿用原版选择和解析语义。
个人 iPhone 仍为 mobile.11；没有新 IPA，`BUILD_RECORD.json` 未改变。

## 实现与复用

- 原 `LocalTab` 来源控件提取为共享 `LocalLyricSourceSelector`，保留单来源／多来源行为、文案与主题样式。
  移动端提供触摸尺寸和明确的选中轮廓；不修改现有动画参数。前台复用原 `resolveLocalSongLyrics`。
- 原 `selectLocalSongLyricsSource` 原样提取为纯函数；原 `EmbeddedLyricAdapter` 的正文、翻译、注音、
  AWLRC 容器优先级提取到 `embeddedPreparation.ts`。Web Worker 与原生 JavaScriptCore 使用同一准备规则、
  原解析器。无新增生产依赖或自研歌词解析算法。
- 原生 `lyrics.json` 一次原子写入导入正文／文件名、内嵌正文、扫描状态和显式来源。
  新导入选中「本地」，保留内嵌正文；来源切换不删除任一份内容，不重建队列或移动播放位置。
  前台与无 WebView 的原生歌词规划都读取同一选择。
- 旧 `lyrics.txt` 没有来源信息，首次读取时检查保留的音频标签：只有正文完全一致才归为内嵌。
  不能确认的正文继续作为导入内容保留。旧 `lyrics.json` 的导入内容也保留。
  迁移保留旧版本能读取的兼容正文，并用 `contentIsEmbedded` 防止新版本把兼容副本展示成第二个来源。
- 标准 AVFoundation `.id3MetadataUnsynchronizedLyric`／`.iTunesMetadataLyrics` 读取第一个非空标签。
  标签超限或读取失败不隐藏已有导入内容、不阻止再次导入；失败扫描保持待重试。
  取消、歌曲删除和编辑令牌变更仍在异步读取后检查，不能因此接受过期写入。
- 读取／切换／导入共用每首歌曲的可撤销编辑令牌；成功提交旋转令牌。并发两次保存仅一次成功，
  删除不重建目录，写盘失败保留旧数据。新写入使用首次解锁后可访问的本机文件保护。
- 每份原始正文最多 2,000,000 UTF-8 字节，文件名最多 1024 字节；两份正文加 JSON 转义的文件上限
  为 24,300,000 字节。原生规划结果仍受 2000 行、每行 4096 字符、262144 字节限制。

## 验证

证据清单与 SHA256：`.mobile-test-results/local-sources-final-evidence.json`。
下列运行分开记录，后一次专项复测不冒充重新执行整组。

| 检查 | 结果 | 范围与本地证据 |
|---|---|---|
| 类型检查、逻辑回归、构建／同步 | PASS | `local-sources-sync.log`：146 项／26 文件；原来源选择、内嵌准备、导入及相邻移动逻辑。最终前端复核 `local-sources-final-sync.log`：类型检查、15 项／2 文件及构建／同步通过 |
| WebKit 界面 | PASS | `local-sources-ui.log`：21 项，54.6 秒；手机／宽 iPad／窄窗口，来源切换、导入及歌词校准。真实 Worker／解析器，原生桥接为受控响应 |
| 选中状态视觉复核 | PASS | `local-sources-ui-selected.log`：3 项，7.4 秒；补齐选中轮廓后三视口重跑来源完整流程。截图 `local-sources-{phone,ipad,ipad-narrow}.png` |
| Release 原生基线回归 | PASS（所选范围） | `local-sources-native.{log,xcresult}`：218 项，89.314 秒。发生在兼容正文和异常标签隔离最终复核之前 |
| 兼容正文复核 | PASS | `local-sources-native-reviewed.{log,xcresult}`：11 项，6.059 秒；真实带标签 M4A、旧文件迁移、导入、独立原生规划和队列回归 |
| 最终异常标签复核 | PASS | `local-sources-native-tag-failure.{log,xcresult}`：12 项，4.851 秒；上述专项加真实 2,000,001 字节标签，验证已有歌词可读、可替换、重开可读且原生可解析 |
| iPad 实际容器短测 | PASS | iPad Pro 11-inch (M5)／iOS26.5 Simulator；系统选择器导入 20 秒合成 M4A 和 LRC，切回内嵌、终止／重启恢复，原生文件逐字核对。发生在异常标签隔离补丁之前，最后该补丁由上述 12 项专项覆盖 |
| GitHub Mobile checks | PASS | [run 38115822415](https://github.com/Kun686/folia-Player/actions/runs/38115822415)，源码 `49ef998`；供应源码、固定依赖安装、类型检查、移动逻辑和构建 |

原生基线沿用既有三个独立 HTTP 样本服务器用例的排除范围，本阶段 **NOT_RUN**：
`testIndependentHTTPPreloadIsSilentAndCancellable`、
`testHTTPMonoStreamingHasAudibleStereoEffectsAndSeek`、
`testHTTPNativeQueueCancelsBufferedSongAndAdvancesWithoutWebView`。

实际容器合成歌曲为「Folia 来源验收」。内嵌内容为「内嵌来源／标签验收」，导入内容为「导入来源／文件验收」。
选择后 `lyricsSource=embedded`，两份正文和原文件名均保持；重启仍暂停在原位置，来源控件仍选中内嵌。
截图为 `local-sources-native-{imported,embedded,restored,selected}.png`，文件核对见
`local-sources-native-record.json`。原 Partita 对短句有实际显示，本阶段没有修改其动画实现或宣称全部动效验收。

清理仅删除本轮合成歌曲及两个 Documents 样本，原四首合成歌身份保持，恢复测试前偏好设置并关闭模拟器。
最后 XCTest 重装使容器 UUID 改变；按 bundle metadata 定位新容器并核对歌曲集合后恢复，见 `local-sources-cleanup.json`。
个人手机曲库未接触。原有 Swift 并发、依赖配置和 QQ 解压警告仍存在，未声称无警告构建。

## 边界与回退

该阶段尚未接入的本地歌曲在线匹配来源、原完整匹配弹窗的元数据／封面选择，
已在后续源码 `375f50a` 接入，见 [LOCAL_MATCH.md](LOCAL_MATCH.md)；真实平台链路仍未验收。
本阶段测试只覆盖实际存在的导入／内嵌来源，不能当作后续匹配功能的验证。
**NOT_IMPLEMENTED**：全部桌面歌词工具和完整 Automix。
原解析器支持的多语言／翻译语义已复用，但移动音频标签采集尚未完整移植多 USLT／多标签／Vorbis 矩阵。

**NOT_RUN**：本阶段 iPhone 安装、物理 iPhone／iPad 手动操作、真实平台 App 在线链路、30 分钟锁屏、
耳机／蓝牙／网络切换、≤150ms 歌词显示误差、持续温升与内存。既有 Partita 长词裁切问题仍单独待查。

回退本次源码提交可撤销新入口与读取逻辑。旧版本忽略新增字段但仍可读兼容正文或导入正文；
两份内容同时存在时，旧版不会遵从新增的内嵌来源选择。旧版再次编辑也可能丢弃它不认识的字段，
需要保留 App 数据备份；不能把可读取旧格式等同于无损往返编辑。完整移植保持进行中。
