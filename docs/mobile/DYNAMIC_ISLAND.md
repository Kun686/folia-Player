<!-- DYNAMIC_ISLAND.md — requested system media presentation, platform limits, and observed evidence. -->
# 系统灵动岛与顶部歌曲气泡

2026-10-15：用户明确希望使用真正的系统灵动岛展示歌名等信息；无岛机型在 App 内使用顶部气泡，
切到其他 App 后不显示额外气泡。用户确认当前个人 iPhone 没有灵动岛。

## 可实现范围

- 复用 `ios/App/App/PlaybackSystem.swift` 的 `MPNowPlayingInfoCenter` 和 `MPRemoteCommandCenter`，
  以及 `PlaybackEngine.swift` 中的 `.playback / .longFormAudio` 音频会话。
  现有代码提供歌名、歌手、封面、时长、进度、播放速率及播放／暂停／前后曲／拖动控制。
- 系统决定后台媒体信息是否显示在灵动岛，以及紧凑／展开的布局。无需增加机型名单或按安全区高度猜测硬件。
  紧凑媒体样式不保证常驻完整歌名；长按展开的具体显示仍需真机核验。
- Apple 的 Live Activities 指南明确说，自己的常规实时活动在 App 不使用时出现，App 打开时灵动岛可以显示其他内容。
  因此不能承诺前台顶部气泡直接变成系统灵动岛，也不应在系统没有接管标题时隐藏现有标题。
  本次保留 App 内现有气泡及点击隐藏／唤回；没有以网页仿制灵动岛代替用户要求。
- 无岛机型切出 App 后不添加悬浮气泡或通知横幅。原有锁屏／控制中心媒体控制保留。
  不添加 ActivityKit 扩展，不升级最低系统版本，不新增依赖，不改播放队列或视觉动画实现。

## 本轮证据

独立 iPhone 17 Pro／iOS 26.5 模拟器，`app.folia.validation.App`；沿用合并候选，主二进制 SHA256：
`bf8510575caad59d42054fe60c2ee25dc5170aa6518d2b75750127de268e0d88`。

| 项目 | 结果 |
| --- | --- |
| 代码检查 | 已核对现有系统媒体信息、远程控制与音频会话。静态存在不等于灵动岛已验收 |
| 真实歌曲界面 | 用当前真实 QQ《我不难过》开始播放并切回桌面；返回时已自然跨至《我想我不会爱你》，歌词和播放时钟可见。本批未采集 PCM，不记为音频质量／长播验收 |
| 模拟器系统媒体界面 | **INCONCLUSIVE**：桌面灵动岛未出现媒体内容，控制中心仅见背景／状态信息，未见媒体卡片。既不能判 PASS，也不能据此认定真机同样失败 |
| 前台替代气泡 | **受系统限制，未实现**。没有强制占用系统灵动岛的实现或连续变形效果 |
| 有岛／无岛真机分支 | **NOT_RUN**：个人手机无岛，有岛真机不可用于本次验收；无岛真机此次也未新增操作证据 |
| 数据与安装 | 未构建或安装新包，未修改个人手机／iPad／服务器。本轮基线已变为50首、index2、276.4506575963719秒，不能再沿用旧记录的51首／122.688秒 |

证据在 `.mobile-test-results/dynamic-island/`。测试后暂停，核对队列未被编辑并恢复本轮捕获的完整队列快照。
首次恢复错误写入模拟器全局 defaults 域，App 内未生效；一次修正改为精确 App 容器路径后生效，
同时移除误写的临时全局键。没有修改 Keychain 或平台会话。
最终状态／截图及镜像清理单独保存；不把这次有限检查称作灵动岛交付完成。

## 官方依据与后续验收

- [Apple Live Activities 设计指南](https://developer.apple.com/design/human-interface-guidelines/live-activities)：
  “Your Live Activity appears in the Dynamic Island while your app isn’t in use”。
- [Apple 灵动岛用户指南](https://support.apple.com/guide/iphone/view-live-activities-in-the-dynamic-island-iph28f50d10d/ios)：
  支持机型由系统显示活动，长按查看更多信息。
- [Apple Media Player](https://developer.apple.com/documentation/mediaplayer/)：现有系统正在播放信息与控制 API。

下一步需在有岛真机用真实 QQ 和网易云分别检查切出、长按歌名／封面、暂停／继续／切歌及回 App 状态同步；
同时核对无岛机型切出后没有额外气泡。当前不扩大到自定义实时活动、机型适配表或新的功能。
