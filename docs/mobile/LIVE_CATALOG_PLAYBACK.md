<!-- LIVE_CATALOG_PLAYBACK.md — actual catalog queue playback and paused-prefetch revision regression. -->
# 真实目录入队播放与暂停预加载修复

2026-10-14，接续 [两平台目录浏览](LIVE_ONLINE_CATALOG.md) 和
[真实收藏回读](LIVE_ONLINE_LIKES.md)。在已登录的独立 iPhone 模拟器，用 QQ 专辑
《逆光》、网易云歌手热门歌曲《花骨朵》检查“下一首播放 → 队列选曲”。
发现暂停预加载后点歌被错误拒绝，修复后同一真实操作路径通过。
整体移植、完整设置／特效 UI 和物理设备验收仍未完成。

## 范围与候选身份

- iPhone 17 Pro／iOS 26.5 模拟器：`9213032A-657A-40CD-BD2A-A3065ACCC8EC`。
- 实际账号包：`app.folia.validation.App`；application identifier
  `33GAKXJHL3.app.folia.validation.App`；版本 `0.7.16`、build `28`。
- 修复后可执行文件 SHA-256：
  `42cdc701992b4beb26563f719d498244859d9d1f2255790d33e04baa18b8f434`。
- 修复前候选 SHA-256：
  `57cf365d78b431f5e5eeb7bb9d851936e4edce14fd5a4ea8df87c1a90d360fdc`。
- 安装包与源码记录匹配，128 个前端资源及两个空 Cordova 文件一致，strict codesign 通过。
- 原生回归使用另一独立离线身份 `app.folia.prefetchqa.App`，不连接真实账号。
- 本批不更新服务器或个人 iPhone mobile.28，不改前端、平台规则、音效算法或依赖。

## 真实操作、失败与修复

初始为 51 首原队列，index 0，《莫愁乡》暂停在 `19.498662131519275` 秒。

1. 从 QQ《我怀念的》菜单进入专辑《逆光》，把原队列中不存在的同名歌曲设为
   “下一首播放”。队列变为 52 首，index 1 为《逆光》。队列选曲后封面、歌词和
   进度正常显示，播放中横屏／竖屏恢复已观察，随后暂停于约 1:57。
2. 从网易云《莫愁乡》菜单进入亞細亞曠世奇才热门歌曲，将原队列不存在的
   《花骨朵》（洛天依Official／亞細亞曠世奇才）设为下一首。队列变为 53 首。
3. 在 QQ 暂停期间选择《花骨朵》，真实界面显示“播放队列已变化，请重新选择歌曲。”
   当前曲仍是 QQ《逆光》。保留失败截图，没有重复点击掩盖故障。

代码原因：`prefetchStream()` 的 `retainReplayGain` 会补充队列歌曲元数据，并推进
`queueRevision`。旧实现预加载完成后没有发布这个变更。立体声播放定时器在
`intentToPlay == false` 时不发布，因此暂停中的前端可能一直持有旧 revision，
下一次队列选择被判为 `queue-changed`。现场未抓取调试器中的 revision；原生定向
用例独立复现了相同错误，代码机制与实际症状一致。

最简修复复用原有 `queueDirty`、`persist()` 与 `publish()`：预加载成功完成后，
仅当队列有变更时持久化并发布。不放宽旧版本拒绝规则，不新增网络调用或依赖。

- 生产改动：`ios/App/App/PlaybackStreaming.swift`。
- 定向回归：`ios/App/NativeTests/StreamingQueueTests.swift` 中
  `testPausedPrefetchPublishesQueueRevisionBeforeSelectingBufferedSong`。

## 验证结果

| 层级 | 结果 | 证据与限制 |
| --- | --- | --- |
| 修复前原生复现 | RED | 1 用例、4 处断言失败：事件 revision 2／原生 3、事件缺少 ReplayGain、选择抛出 queue-changed、index 未切换 |
| 修复后原生回归 | PASS | 7 用例、0 失败，5.723 秒；覆盖暂停预加载、旧版本／错误平台、编辑保留暂停位置、移除已缓冲下一首、自动跨曲、快速切歌、认证与失败上限 |
| 原生构建及安装身份 | PASS | Release 构建、严格签名、128 个前端资源和源码清单匹配；实际安装包再次核对通过 |
| QQ 真实专辑入队与队列播放 | 已观察通过 | 修复前完整播放路径及横竖屏；修复后恢复同一真实 QQ 歌曲并暂停，供跨平台预加载复验 |
| 网易云真实歌手歌曲入队与播放 | 修复后已观察通过 | 重做暂停入队，选中前已持久化 ReplayGain，随后选曲成功；封面／歌词／绘光显示，进度至 00:31，未见 queue-changed |
| 原队列与账号恢复 | PASS | 两首临时歌曲均通过 UI 移除，原 51 首队列内容／顺序哈希一致；两平台账号及歌单可见，最终暂停 |
| 本批音频 PCM 测量 | NOT_RUN | 真实播放器 UI／进度观察不等同新的 PCM 或听感测量；历史证据见 REAL_ACCOUNT_PCM.md、REAL_ACCOUNT_VISUAL_PCM.md |
| 目录整组直接播放、完整 UI／其余动画 | NOT_RUN | 本批只覆盖单曲下一首入队与队列选择，不以此代表所有目录操作和全部设置验收 |
| 物理 iPhone／iPad、锁屏长播、温升 | NOT_RUN | 个人包未更新；iPad 真实账号测试按用户要求暂缓 |

修复后真实复验重新移除／加入《花骨朵》，而非仅冷启动后点已有歌曲：
QQ 恢复播放后暂停，进入同一歌手目录入队；选择前读取非敏感队列状态，
index 1 仍为 QQ《逆光》，《花骨朵》已具有 ReplayGain。随后单次选曲成功，
网易云封面、歌词、绘光和推进中的进度均已观察。

实际测试通过现有正常缓存路径，不声明全部音频从 CDN 重新下载。
没有改动任何收藏或在线歌单。最后恢复《莫愁乡》到 `19.7` 秒并暂停；
相对原位置约晚 0.20 秒，不能声称精确位置完全相同。
原队列 JSON SHA-256 前后一致：
`1f998b3011006ac3da86fe822a7e5fbd3897fb38fd48f029ed13f44fdbd4bbae`。

## 可复核证据与回滚

证据目录：`.mobile-test-results/live-catalog-playback/`（忽略产物，不含凭据）。

- `red-test.log`／`red.xcresult`：失败复现；`green-test.log`／`green.xcresult`：7 项通过。
- `red-command.json`／`green-command.json`：精确 xcodebuild 参数。
  运行入口为 `run-native.py red`／`run-native.py green`，外层 150 秒，内部测试进程
  120 秒、单项 45 秒上限；离线测试不冒充真实平台验证。
- `native-build.log`、`manifest.json`、`installed-manifest.json`：构建、源码与安装身份。
- `qq-playing.png`、`qq-playing-landscape.png`、`qq-paused-confirmed.png`：QQ 实际操作。
  `qq-paused.png` 仅是第一次唤回自动隐藏控件的截图，不作暂停证据。
- `netease-queue-changed.png`、`failure-persisted-state.json`：真实失败现场。
- `fixed-paused-insertion.png`、`fixed-paused-prefetch.json`：修复后暂停入队／元数据。
- `netease-fixed-playing.png`、`netease-fixed-paused.png`：修复后实际播放与暂停。
- `final-state.json`、`final-restored-queue.png`、`restored-position.png`、
  `final-qq-account.png`、`final-netease-account.png`：状态恢复。
- `process-check.txt`：无本批 xcodebuild／xctest 遗留进程，保留用户授权的已登录模拟器。

回滚可使用上一批 `.mobile-test-results/live-online-likes/freshness/VerifiedValidation.app`
原位覆盖独立模拟器身份；不卸载 App、不清除 Keychain 或队列。回滚会重新引入此暂停
预加载问题。个人包与服务器本批未变，无对应生产回滚操作。
