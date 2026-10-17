<!-- LIVE_BACKGROUND_PLAYBACK.md — real-network native background acceptance preparation, with failed attempts retained. -->
# 真实网络后台切歌验收

2026-10-15 记录更新：**独立 iPhone 模拟器的短时真实网络后台用例 PASS**。
用户批准额外一次执行后，2026-10-14 23:57 完成，XCTest 用时 62.821 秒，1 PASS／0 FAIL／0 SKIP。
两平台均在 UIKit 确认后台后解析地址，真实 EOF 完成网易云→QQ→网易云两次自动切歌，六个双声道 PCM 窗口通过。
已恢复正常模拟器包、两平台登录、原 51 首队列及 QQ《我怀念的》122.688 秒暂停状态。
此前两次失败保留如下；本批没有修改产品播放代码、新增依赖或更新个人 mobile.28。

## 范围与复用

- 用例：`NativeTests.testSignedInSongsResolveAndAdvanceInBackgroundWithoutWebBridge`，
  位于 `ios/App/NativeTests/LivePlaybackAcceptanceTests.swift`。
- 仅允许独立iPhone模拟器 `app.folia.validation.App`，且必须显式设置 `FOLIA_LIVE_BACKGROUND_QA=1`。
- 从用户已登录的51首队列取网易云《莫愁乡》及QQ《我怀念的》，临时顺序为网易云→QQ→网易云。
  不生成歌曲、播放URL或平台响应，不更改平台收藏、原播放队列或偏好。
- 复用生产 `PlaybackEngine`、`GatewayClient.resolve`、`StreamMixOutput` 和已有 `OutputMeasurement`。
  测试网关只延后第二次及之后的请求，直到UIKit确认后台；实际请求和响应均走生产网关。
- 临时引擎使用随机UserDefaults域和空音频缓存目录，不接WebView事件回调；自动混音及听歌上报关闭。
  当前歌先前台播放，后台用拖到曲尾缩短等待，再由真实EOF回调自动跨曲；不调用next/select制造切歌成功。
- 目标是每次跨曲后采样三个一秒窗口的双声道PCM，并检查两平台后台解析、播放时钟及原队列/会话保持。

## 已执行与失败边界

| 项目 | 结果 | 证据边界 |
| --- | --- | --- |
| 首次编译 | PASS | 原生测试target编译成功 |
| 首次实际执行 | FAIL，8.552秒 | 网易云真实地址解析成功；前台跳到30秒等待5秒超时，没有进入后台或采样 |
| 修正网络等待后重测 | FAIL，60.857秒 | 等待增至25秒后跳转成功；随后40秒切后台窗口超时，末态为index0、位置70.267秒、playing=true、error为空 |
| 手动Home时序 | 窗口边缘 | Home截图文件时间22:54:59.081，测试结束22:54:59.600；截图仍在系统过渡动画，最终UIKit未确认background |
| 最新测试协调修正 | 编译PASS，获准执行PASS | 切后台窗口60秒、每10秒进度、就绪时间戳、状态枚举及elapsed；请求放行等待90秒，整体执行上限180秒 |
| 前两次实际后台解析/跨曲/PCM | NOT_RUN | 两份失败报告的advances和measurements均为空，不能视为后台失败或通过 |
| 获准后的后台解析/跨曲/PCM | PASS，62.821秒 | 正确设备Home后UIKit状态为background；QQ及网易云地址请求开始、完成均在后台，2次EOF跨曲、6个PCM窗口均通过 |
| 本次正常模拟器恢复 | PASS | 菜单修复包二进制/130个资源/签名一致；两账号可见，原51首队列完整JSON与音效设置相同，index4/122.688秒/暂停，绘光保留 |

第二次结果说明前台网络跳转确实可完成，但不证明首次超时只有等待配置这一种原因，
也不排除真实网络速度变化。不把此前测试协调失败归咎于播放器；最后通过仅覆盖下面的短时模拟器范围。

## 最后一次实际结果

- 现有真实歌曲：网易云《莫愁乡》→QQ《我怀念的》→网易云《莫愁乡》。
- 前台首曲 seek 完成后 15.418 秒发出就绪信号；通过指定模拟器的 Home 控件进入后台。
  报告记录 `applicationState=2`、`background=true`，不是仅凭主屏幕截图推断。
- 两次跨曲均在后台。为限制执行时间，在后台拖到曲尾前 1.5 秒，再等待真实 EOF，未调用 next/select 代替自动跨曲。
- QQ 三窗口分别 43200／52800／48000 帧，RMS 0.0408–0.0598；网易云三窗口均 48000 帧，RMS 0.2155–0.3082。
  全部双声道，每秒媒体时钟推进 0.914–1.013 秒，无播放错误。
- 原生用例确认真实服务器配置与两平台会话在测试前后完全相同，原引擎队列、索引与暂停位置不变。
  临时引擎使用全新媒体缓存，无 WebView 回调，测试完成清理临时引擎、存储与缓存。
- 恢复正常包后，两平台账号与个人歌单再次在实际界面可见；原队列完整 JSON、音效设置及绘光模式核对通过。
  原位安装后系统的数据容器路径发生变化，首次“路径必须相同”检查失败；改为比较实际数据后通过，未卸载或清空 App。

## 执行准备与完整性

证据目录 `.mobile-test-results/live-background-playback/`：

- `first.xcresult`、`test.log`、`first-attachments/`：首次失败。
- `retry.xcresult`、`retry-test.log`、`retry-attachments/`：第二次失败及原生末态。
- `background-home.png`：Home切换过渡截图，不是后台状态证据。
- `final-build.log`：最终测试协调修正编译PASS。
- `approved.xctestrun`、`ApprovedQA.app`、`approved-preflight.json`：此前候选准备记录，保留当时待授权状态。
- `approved-current-baseline.json`：本次获准后的源码/包摘要、签名/资源核对与原队列基线。
- `approved-test.log`、`approved.xcresult`、`approved-result-summary.json`：本次唯一执行、1项通过与原始测试结果。
- `approved-attachments/live-native-background-playback.json`：后台解析、两次跨曲、六个PCM窗口原始报告。
  `export attachments` 遇到XCResult数据库读取错误，改用已核对的legacy object导出成功；manifest保留导出方式与payload引用。
- `approved-home.jpg`、`approved-restored-netease.jpg`、`approved-restored-qq.jpg`、`approved-final-player.jpg`：后台与恢复界面。
- `approved-restored-state.json`、`approved-cleanup.json`：恢复后的数据/包核对及辅助进程清理。
- `restored-state.json`、`restored-qq.png`、`restored-netease.png`：恢复正常包及原用户状态。

准备时两次把重新构建的宿主误要求为旧可执行文件哈希相等，均在安装/执行前被拦截；
改为核对当前构建的应用身份、签名、前端资源并记录独立二进制哈希。
此前菜单批次资源及其记录的源码摘要均核对不变，不把不同测试宿主混为同一二进制。

最终候选：

- 测试源码SHA-256：`f4f7ba1fd5ac06ded85bda2cc84518e1f9e396d6bc2f20d7491d42bd8f0defa1`。
- 宿主SHA-256：`40874c743be27588f0894206c09bb69bb3a65abdcbfd4e49b43f722086178c02`。
- 测试bundle可执行文件SHA-256：`5fe76d9ba8f895a48ac164af0aca128c8eae8a1469bfa72a09c7710afe6cb527`。
- 正常模拟器已恢复宿主SHA-256：`77e16508514b817670a3e574c3dabd80968d519205e9bece5f2611e9285eacd0`。

本次获准后只运行上述一个用例一次，外层 `codex-bounded 180`，未再追加重跑。
结束后原位恢复 `.mobile-test-results/song-menu-stability/VerifiedValidation.app` 并核对账户/队列。

## 未覆盖

本用例通过只能证明独立原生引擎在模拟器后台的短时真实网络行为。
它不证明物理WebView已挂起、真机锁屏30分钟、地址过期恢复、耳机/蓝牙/网络切换、
完整动画设置UI或长期温升/内存。个人mobile.28、服务器、平台歌单本批均未改动；整体移植仍未完成。
