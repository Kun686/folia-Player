<!-- LIVE_PLAYBACK_FOLLOWUP.md — real-account UI observations, lyric recovery, and incomplete PCM measurement. -->
# 真实播放界面与歌词重试

2026-10-14，基线 `7d51e6ee50868e45031e8c9222c5223f3413fa0b` 加工作区修改。
承接 [网易云真实账号与曲库界面](NETEASE_LIVE_UI_ALIGNMENT.md)。只操作已登录的独立 iPhone 17 Pro／
iOS 26.5 模拟器 `app.folia.validation.App`；个人 mobile.28、服务器和平台歌单均未修改。
无新增依赖，没有向真实队列添加测试歌曲。

后续已定位并修复曲库生命周期误取消播放器资源，见 [启动资源生命周期](STARTUP_PLAYER_LIFETIME.md)。
下文保留本批原始观察与两次入口检查失败。用户随后批准额外执行一次，当前候选的
[真实账号短时 PCM 已通过](REAL_ACCOUNT_PCM.md)：1 项、两平台各 8 个窗口；动效并行、真机与长播仍待验收。
下文 NOT_RUN 仅描述当时批次，不是当前最新 PCM 状态。

## 真实界面观察

- 重开后两平台账号和 51 首混合队列仍在。网易云《陪我吃饭》出现歌词加载错误、缺少封面；
  继续播放时界面进度从 0:51 推进至 1:26，但仍有错误提示。未采集到 PCM，不能据此证明音频输出。
- 切换 QQ《我怀念的》后封面、歌词、绘光动画正常出现，进度推进；再返回同一首网易云歌曲，
  封面与歌词恢复，未重新登录。仅此现象不足以确认启动时序、缓存或平台请求中的哪一项是原因。
- 确认暂停后，直接拖动可见的滑块，网易云进度从 0:25 到 0:55，歌词重新定位。
  先前控制器隐藏期间的操作不作为拖动证据；本次补足前批点按之外的拖动观察。
- 播放选项面板用原生触摸滑动可到达底部。部分 Mac 鼠标拖动／滚轮没有移动内容，
  更换为 Xcode 的原生触摸手势后正常，不把工具输入差异认定为产品滚动错误。
- 「歌词与动效」沿用绘光／通用背景／跟随系统帧率，检查竖屏→横屏→正常竖屏：
  固定标题、关闭按钮与内部滚动区正常，未改变用户配置或原渲染器。
- 最终包原位更新后再次打开网易云《陪我吃饭》，出现新的明确歌词错误提示；
  点击「重试歌词」后歌词与绘光恢复，仍暂停在 0:55，没有切歌或重新登录。
  `real-lyric-error.jpg`／`real-lyric-recovered.jpg` 记录实际服务状态，没有注入错误。
  重开后的歌词失败在本批出现两次，原地恢复有效，但启动失败根因尚未定位。

## 本次修复

复用 `useMobileLyrics` 的现有 `refresh`、`PlayerFeedback`、公共按钮和本地化。
歌词请求失败单独显示「歌词加载失败，请重试。」和至少 44px 的「重试歌词」按钮，
不再把歌词失败笼统提示成重新登录；加载中／失败时不同时显示「暂无歌词」。
原生播放错误、播放命令错误仍优先显示。重试只刷新当前歌词，不改变队列或播放意图。
这改善错误恢复入口，没有宣称修复上述一次启动失败的根因。

涉及 `src/mobile/PlayerFeedback.tsx`、`PlayerPanel.tsx`、`mobile-player.css`、`locale.ts`。
回退仅撤销这些歌词反馈改动，无数据迁移；不要覆盖同文件中的此前 UI 对齐和搜索提示修复。

## 自动验证与未完成测量

| 检查 | 结果与范围 |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run test:mobile:ui -- test/mobile-ui/player-feedback.spec.ts` | 45 PASS；手机、iPad、窄窗口 WebKit，受控错误，只证明界面逻辑 |
| 新增歌词恢复检查 | 两平台均检查错误分类、按钮触达、旋转布局、播放错误优先、重试恢复、队列／当前歌／播放意图不变 |
| 第一轮 UI 检查 | 39 PASS／6 FAIL；失败均来自歌词文本断言误用同一平台样本、未考虑高亮 DOM 重复字。按已有 QRC／LRC 样本修正断言后只重跑一次，45 PASS |
| 移动生产构建／Capacitor copy | PASS |
| 最终 Xcode Release build-for-testing | PASS，包含修正后的原生测量源码；不等同于 XCTest 执行通过 |
| 最终资源一致性 | PASS，128 份 dist-mobile／Capacitor／原生资源一致，`manifest-final.json` |
| 独立模拟器安装 | PASS；两平台账号与 51 首队列保留，网易云真实歌词重试恢复，QQ 个人歌单重新加载，未更新个人包 |
| 真实账号 PCM | NOT_RUN：两次执行均被测试入口检查拦截，未进入歌曲测量 |

新增 opt-in `NativeTests.testSignedInQueueProducesNativePCM`，只允许独立模拟器、已登录的真实队列和生产
`GatewayClient`，显式环境变量 `FOLIA_LIVE_PLAYBACK_QA=1` 才执行。复用原播放器和 `OutputMeasurement`，
设计为每个平台八个一秒窗口；默认跳过，不生成歌曲、清除会话或修改平台歌单。

第一次错误地要求页面 URL 必须为 `/index.html`，第二次错误地要求 Capacitor 的 `appStartFileURL`
为文件。已核对已安装 Capacitor 8.5.3：默认根 URL 对应 `public` 目录，由资源处理器返回首页。
源码现改为验证根 origin、默认启动路径、包内目录与首页文件，仍验证生产 gateway。
本轮达到命令重试上限后没有第三次执行，因此该测试没有 PCM、队列保持或会话保持的成功断言证据。
前两次失败是测试入口错误，不是音频失败；也不能称播放通过。

## 仍待验收

QQ 真实失败状态下的歌词重试恢复、启动歌词失败根因、真实歌曲双声道 PCM、QQ 搜索稳定性、
完整 iPad UI／真实账号、两平台退出清理、当前版本真机、网易云 30 分钟锁屏、耳机／蓝牙／网络切换、
歌词误差和长期动画性能均未完成。

此前 iPad Diorama 压力测试继续保持 FAIL。重读原始记录确认网易云周期 11–13 有间断：
两个四秒窗口只推进约 2.21s／2.19s，另一个只推进约 1.01s，且一个 450ms 窗口 PCM 为零。
系统音频 overload 日志仅是线索，没有证明采样干扰、系统负载或播放器之间的因果。
未放宽断言或据此更改音频算法，未在已登录容器重跑旧离线样本。

证据目录：`.mobile-test-results/live-account-pcm/`，含构建／检查日志、两份失败 `.xcresult`、
资源哈希与 `visual-settings-portrait.jpg`、`visual-settings-landscape.jpg`。
真实账号与自动测试证据分开记录，未把模拟器界面观察升级为真机、听感或长播结论。
