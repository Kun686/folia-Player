<!-- PLAYER_QUEUE_TRANSITIONS.md — immersive chrome, queue sheet gestures, circular presentation and evidence boundaries. -->
# 播放队列抽屉与圆形转场

2026-10-16：已安装独立 iPhone 17 Pro 模拟器，Bundle ID `app.folia.validation.App`，版本 `0.7.16 / 28`。
个人 iPhone mobile.28、服务器及实际 iPad 未更新，无新增生产依赖。

## 行为与复用

- 拼贴覆盖整个视口，进入时隐藏系统时间／电量，退出后恢复。安全区仅用于可操作按钮定位。
- 右下工具栏暂停时也会在约3秒空闲后隐藏；点击唤回。隐藏后首次点击返回按钮可以直接返回。
  修正触摸合成 mousemove 吞 click，以及 WKWebView 程序化 focus-visible 将工具栏永久锁在可见状态的问题。
- 右下播放队列按钮打开覆盖在播放器上的抽屉，不再跳回音乐库。关闭抽屉仍停留在当前播放器。
- 抽屉默认约半屏，顶部44px把手拖动；顶部边界提供阻尼，松手以当前位置加速度投影选择展开、半屏或关闭锚点。
  弹簧承接松手速度；短横屏合并半屏与展开锚点，旋转后重新测量。列表滚动和把手拖动分开。
- 搜索、歌曲菜单、打乱／清空和播放选择复用 `QueueBrowser` 与既有原生队列接口。
  选曲调用 `selectQueue`，不把临时 URL 作为身份，不重建队列；搜索获得焦点时展开抽屉。
- 从迷你播放器到全屏的进入／退出共用封面中心的圆形裁切。退出动画完成前保留视觉场景，支持中途反向。
  使用项目原有 `uiMicroMotion` 减少动态设置；启用后圆形扫动改为短淡入淡出。
- 复用已安装 Framer Motion 的 MotionValue、拖拽约束和弹簧；没有逐帧 React state 更新、独立播放时钟或新缓存。

实现文件：`src/mobile/PlayerQueueSheet.tsx`、`queueSheetGeometry.ts`、`mobile-queue-sheet.css`、
`useCircularPlayer.ts`、`useImmersiveStatusBar.ts`、`PlayerPanel.tsx`、`MobileApp.tsx`、`MobileLattice.tsx`、
`usePlayerChrome.ts`、`src/hooks/usePlayerChromeActivity.ts` 及 `ios/App/App/FoliaNativePlugin.swift`。

## 自动化与构建

本批证据：`.mobile-test-results/lattice-immersive-20261015/queue-transitions/`。
WebKit 使用已验证的真实 QQ 歌曲元数据与受控 bridge；不代表 QQ／网易云音频或平台验收。

| 项目 | 结果与证据 |
| --- | --- |
| 速度投影、边界、低矮窗口 | **3 PASS**，`unit.log` |
| 首轮三个窗口的6类界面场景 | **12 PASS / 6 FAIL**，`ui.log`，1.5分钟 |
| 修正帧等待和减少动态开关后的6项 | **5 PASS / 1 FAIL**，`ui-corrected.log`，30.9秒 |
| 用户批准的手机单项追加 | **1 FAIL**，`ui-authorized.log`；捕获指针仍未解决测试输入问题 |
| 用户批准的逐帧输入诊断 | **1 PASS**，`ui-input-diagnostic.log`，13.5秒；保留 `queue-input.json` |
| 最终覆盖 | **18种场景分轮取得通过记录**；不宣称最终源码一次全量18项通过 |
| 类型检查 | 首轮React与Motion事件类型冲突，改为精确focus事件类型后通过；最终 `typecheck-final.log` **PASS** |
| 移动资源／Capacitor复制／原生构建 | **PASS**，`build.log`、`copy.log`、`native-build.log` |
| 包与安装核对 | **PASS**；145项构建资源及2个空Cordova文件、签名权限与安装资源一致 |

场景覆盖队列不退出播放器、搜索／选曲不重建队列、拖动与边界回弹、旋转／键盘锚点、圆形展开／收起与中途反向、
减少动态模式、空闲工具隐藏及首次返回。最初同步鼠标移动后立即取值早于 Motion 下一帧；
最终逐帧输入通过，但没有早先失败运行的完整事件轨迹，不能据此断言早先所有失败的唯一根因。

编译后仅调整测试输入与诊断采集，产品源码未改。`manifest.json` 保留构建当时的测试摘要，
`final-audit.json` 单独记录最终验证文件摘要，并逐项确认产品源码、安装资源、队列与外观。

## 原生模拟器观察与未覆盖项

已观察：真实51首跨平台队列及封面／当前歌词，拼贴全屏与状态栏隐藏、首次空闲隐藏、触摸唤回、
覆盖式队列、按钮切换半屏／展开、横竖屏布局，以及关闭队列仍在播放器。网易云账号与个人歌单入口保持。
更新后完整队列、音效、29.041337868480724秒暂停位置和45项外观与本批基线一致，见 `final-audit.json`。
本轮没有主动播放音频、退出账号、删除缓存或读取Keychain。用户在此前自行改成51首，旧50首快照未恢复。

原生自动拖拽 **INCONCLUSIVE**：`native-gesture.json` 显示按下与松开坐标改变，但中间没有 pointermove／touchmove，
工具在约17ms内结束手势，不能作为实际手指速度或阻尼验收。WebKit逐帧拖动的通过不替代真机。
原生展开／收起入口可操作；辅助录屏20秒到期后未形成有效文件，逐帧原生转场录像 **NOT_RUN**。

真机手势手感、长时间动画帧率／发热／内存、实际 iPad、真实平台音频回归均 **NOT_RUN**。
前一步的沉浸布局、触摸修正记录在证据根的 `ui*.log`、`touch-fix/` 和 `native-input-detailed.json` 中保留。

## 候选与回退

- 当前候选：`queue-transitions/VerifiedValidation.app`。
- 可执行文件SHA256：`3d56bd74cabf1ebb35c038404aef5e44a983e84806dd4b0e94e4d6e079b3571e`。
- 上一安装包：`../touch-fix/VerifiedValidation.app`，包含此前全屏及触摸修正；若需回退，使用同一独立Bundle原位安装。
- 保留签名身份 `33GAKXJHL3.app.folia.validation.App`；不卸载、不清理账号或用户数据。
