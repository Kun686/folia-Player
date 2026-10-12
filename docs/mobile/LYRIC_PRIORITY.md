# 本地歌曲歌词优先级

2026-10-13。恢复原版 `localLyricsPriority` 在移动端的行为，仅构建独立
`app.folia.validation.App`。个人 App、物理设备、真实账户和服务器未操作。

## 问题与修正

移动前台加载、来源选择提示、单曲／批量导出及原生后台解析此前均写死本地优先，
忽略原 `useLyricSettingsStore` 中的设置。本轮复用该 store、原
`selectLocalSongLyricsSource`、解析器、导出管线和串行 `connectNativeSettings`，
不新增依赖，不改播放器布局、动画或混音算法。

- 在已有「服务器与外观」中提供「本地歌曲歌词优先级」，沿用原版文案和 setter。
  默认本地优先；在线优先指本地歌曲已匹配的在线歌词，不会因修改偏好而请求新歌词。
  单曲明确选择本地／内嵌／在线来源时，继续由原选择器优先采用该选择。
- 新原生 `getLyricSettings`／`setLyricSettings` 经既有可信来源检查，保存到
  `folia.lyrics`。仅接受 `local`／`online`；无设置或存储损坏时使用本地默认值。
  前端在根组件恢复并订阅，关闭设置面板不会中断待保存修改。恢复失败时禁止编辑并提供重试；
  保存失败恢复已确认值，旧请求失败不能撤销较新的选择。
- 前台本地歌词请求身份包含优先级，旧来源结果不会覆盖新来源。在线歌曲身份不受此设置影响。
  原生偏好恢复先于过渡设置恢复；后台解析使用同一原选择器。修改时取消本地待处理任务并清除
  本地解析缓存，保留在线任务和缓存。正在发声的交接保留原计划，后续计划使用新来源。
- 单曲导出在开始时捕获一次优先级，异步读取和导出条目使用同一值。
  批量导出采用既有导出面板传入的优先级，保留原规则：本地歌曲仅导出当前选中的匹配在线歌词。

这是原功能的移动接入，不是新增外观参数，无视觉配置协议变更。桌面原命令
`settings-local-lyrics-priority` 已存在；移动端沿用现有触摸设置入口，不另建命令系统。

## 验证

本地证据目录：`.mobile-test-results/lyric-priority/`，临时产物不提交。

| 验证 | 结果 | 范围 |
|---|---|---|
| 修正前逻辑 | 8 FAIL / 22 PASS | `red.log`：优先级选择、导出和无效参数缺口 |
| 修正后逻辑 | 45 PASS / 6 文件 | `unit-final.log`：设置串行保存／回退、原生解析契约、手动来源、单曲与批量导出 |
| WebKit | 33 PASS | `ui-regression.log`：phone、ipad、ipad-narrow；含 6 项新优先级场景和 27 项原歌词回归 |
| 原生模拟器 | 8 PASS / 0 FAIL / 0 SKIP | `native.xcresult`／`native-summary.json`：保存恢复、实际 Capacitor 桥、无效值、快速修改、独立歌词来源和旧缓存迁移 |
| 构建与资源 | PASS | 移动前端、Capacitor copy、Release `build-for-testing`、Xcode 工程语法及 diff 检查 |
| 本地 TypeScript | 两次失败，测试样本已修正 | 首次缺 `title`／`titleOrigin`，重试缺 `artistNames`；补齐权威类型要求后未第三次运行本地命令，最终静态结果以本提交 CI 为准 |

逻辑命令：

```sh
npm run test:unit -- test/unit/mobile/lyricSettingsSync.test.ts test/unit/mobile/localLyricSources.test.ts test/unit/mobile/lyricExport.test.ts test/unit/mobile/batchLyricExport.test.ts test/unit/mobile/nativeLocalLyrics.test.ts test/unit/mobile/localMatch.test.ts
npm run test:mobile:ui -- lyric-priority.spec.ts lyricExport.spec.ts batch-lyrics.spec.ts lyric-display.spec.ts
```

WebKit 使用受控原生桥和歌曲缓存，覆盖保存后重载、错误回退、恢复失败后重试、旋转、
自动在线来源、手动本地来源以及原导入／导出／时间线。最初单独执行的 6 项新用例已包含在 33 项中，不重复计数。

原生环境是 iPad Pro 11-inch M5 / iPadOS 26.5 模拟器。使用实际本地文件、原 JavaScriptCore
解析器和已打包 Capacitor 桥。优先级用例向实际交接控制器注入 `NativeLyrics` 后驱动更新，
证明原生设置与解析失效逻辑；不代表完整 Automix 发声过程中切换优先级的听感或性能验收。

## 包身份与回退

`source.json` 保存基线 `58ff88d15c9a97cf33d223a85d4d10b939ad7209` 上 25 个源码／测试文件摘要；
`native-inputs.json` 保存 284 个原生目录输入；`package.json` 保存二进制、XCTest 和资源摘要。
125 项前端资源在 dist-mobile、Capacitor 同步目录和 QA 包一致，后两处另含两个相同的 Cordova shim。
内嵌版本仍是构建时的 `58ff88d… / 0.7.16-mobile.28`，实际改动以源码摘要标识，
**不表示个人 mobile.28 已更新**。构建后摘要复核通过，两个 QA 模拟器已关闭。

个人 `BUILD_RECORD.json` SHA256 保持
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。
真实平台、物理 iPhone／iPad、WebView 被系统挂起后的实际播放及完整 Automix 联合负载为 **NOT_RUN**；
公开分轨／完整 Automix 能力继续关闭。

回退本轮源码即可恢复此前硬编码的本地优先行为；旧 App 忽略新增 `folia.lyrics` 键。
不迁移凭据或曲库，不删除歌词或模型，不需要服务器变更。
