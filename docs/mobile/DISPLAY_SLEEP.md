# 原版播放时阻止休眠的 iOS 适配

2026-10-13，源码与独立模拟器 QA；个人 mobile.28、物理设备、真实账户和服务器未操作。

## 原行为与复用

原桌面 `useElectronDisplaySleepBlocker` 在偏好开启且正在播放时调用 Electron 的显示器休眠阻止器。
移动端此前没有入口，也没有对应原生实现，看全屏歌词时仍可能自动锁屏。

本批在既有设置面板加入「播放时阻止休眠」，沿用 `useDesktopSettingsStore` 的偏好、动作、标题与
`prevent_display_sleep_during_playback` 存储键，默认仍为关闭。移动说明明确前台播放、暂停／离开后释放及可手动锁屏。
通过已有 `connectNativeSettings` 串行合并快速修改，首次读取以原生保存值为准，失败回到最后确认值并允许重试。
关闭面板不清除偏好，不停止播放；重开面板重新读取原生值。未新增依赖、外观参数或播放器布局。

原生 `NativeDisplaySleep` 复用 UIKit `UIApplication.isIdleTimerDisabled` 和系统生命周期通知，API 核对自本机 iOS 26.5 SDK 的 `UIApplication.h`。
原生 UserDefaults 保存非敏感偏好；`FoliaNativePlugin` 的可信来源桥提供读取与修改，布尔参数缺失会拒绝。
是否保持唤醒由原生判断：**偏好开启、App 活跃、未收到离开前台通知、实际播放意图与输出均在播放**。
不接受 WebView 上报的播放布尔值，不用 Web 定时器或 wake lock。

- 暂停、停止、播放中断或禁用设置后释放；加载／没有实际输出时不强行保持常亮。
- `willResignActive` 即刻释放，并锁住前台条件，防止稍后的播放快照在系统状态尚未更新时重新启用。
- 回前台读取最新原生播放状态；后台暂停后回前台不会被旧状态唤醒。
- 偏好随 App 重启恢复，但恢复为暂停的播放器不保持常亮。
- 只有状态需要改变时才写 UIKit 属性；停止／析构释放通知和 timer 所有权，旧桥延后的清理不会关闭替代桥的新持有状态。

移动端使用原触摸设置入口；原桌面 `desktop-toggle-prevent-display-sleep` 命令保持桌面平台限定。
这是系统播放行为，不进入视觉配置导入导出，不移植桌面托盘／壁纸／窗口行为。

## 修复的线程问题

打包测试发现 `refreshLocalLibrary()` 的异步恢复没有主线程隔离，`localLibraryChanged` 可能在后台线程
调用 `publish`，本批加入的 UIKit 操作因此触发 Main Thread Checker。
现在该曲库刷新方法标记 `@MainActor`，异步文件／索引工作仍由原 actor 完成，回到主线程再改播放元数据和发布。
常亮订阅另显式切到主 actor，读取最新播放状态，避免依赖事件发布线程或迟到的快照。
原曲库编辑保留当前歌曲实例／进度的回归一起执行，未改变匹配、排序或播放规则。

## 验证

证据目录 `.mobile-test-results/display-sleep/`，准确输入／产物哈希见 `completion.json`、`resource-parity.json`。

| 层级 | 最终结果 | 范围 |
| --- | --- | --- |
| TypeScript、移动资源、Release 原生 QA 构建 | PASS | 原生新增文件最终编译无主线程隔离警告 |
| Vitest | 14 PASS，3 文件 | 新同步桥 5 项与原音频设置／Electron blocker 回归 |
| Playwright WebKit | 15 PASS／0 skip | 新开关 9 场景、原队列偏好 6 场景，手机／平板／窄窗口 |
| iPad Pro 11-inch (M5)，iOS 26.5 模拟器 | 17 PASS／0 skip | 3 个新增原生用例、音频路由／中断、睡眠定时和曲库回归 |
| iPhone 17 Pro，iOS 26.5 模拟器 | 17 PASS／0 skip | 同一组 17 个用例，不计为 34 个不同用例 |
| QA 资源一致性 | PASS | 128 个移动构建文件逐字节核对 |
| 真机自动锁屏／手动锁屏／温升／长期播放 | NOT_RUN | 模拟器不能代替这些验收 |

WebKit 测试实际触摸、默认关闭、保存／重载恢复、读写失败重试、旋转无溢出和至少 44px 的整行点击区，
确认操作不改变队列、播放状态或播放指令；截图已查看。原生桥在此层为受控样本。

原生 policy 用独立 UserDefaults 和通知中心驱动真实 UIKit 属性，覆盖状态组合、析构、所有权替代和订阅释放。
打包集成用例加载实际 React 移动页面与真实 Capacitor 插件，设置开关后播放本地生成 WAV，PCM tap 检测真实双声道输出；
再关闭面板、暂停／继续、注入离开与返回通知、重载整个 WebView，并在新页面关掉开关。
全过程检查原生 timer 与声音输出，且对播放状态发布加入主线程断言。两台模拟器最终均无 Main Thread Checker 报告。
生命周期通知是测试注入，未将其描述成真实系统挂起、物理屏幕保持点亮或手动锁屏测试。

首轮逻辑 4 项失败于 Node 环境缺少原 store 需要的 `window`；补充隔离的浏览器存储样本后重跑通过。
首轮 WebKit 定位 `.sheet` 命中了多个面板；限定到实际设置对话框后重跑通过。
首轮原生为 15 PASS／1 FAIL，打包用例超时并报告上述真实线程问题。
除修复线程问题外，QA 重载等待增加文档标记，禁止旧页面满足新页面的就绪条件；初次超时没有阶段标记，
不能把重载竞态认定为唯一根因。修正后增加原曲库回归，两台模拟器最终各 17 PASS。
第一次失败及修正前的构建记录保留在 `*.first`，没有覆盖为通过。

## 复现与回退

```sh
"$HOME/.local/bin/codex-bounded" 600 -- npm run typecheck
"$HOME/.local/bin/codex-bounded" 600 -- node_modules/.bin/vitest run -c vitest.config.ts test/unit/mobile/displaySleepSettingsSync.test.ts test/unit/mobile/audioSettingsSync.test.ts test/unit/electron/displaySleepBlocker.test.ts
"$HOME/.local/bin/codex-bounded" 600 -- node_modules/.bin/playwright test -c playwright.mobile.config.ts test/mobile-ui/display-sleep.spec.ts test/mobile-ui/queue-preference.spec.ts
```

原生使用独立 `app.folia.validation.App`、`transition-validation.xcconfig`，按证据目录的 `stage.py`／
`native-command.json`／`native-iphone-command.json` 复现；启动前检查网关和平台会话均为空。
生产资源原字节放在 QA 的 `mobile.html`，另设空白启动页，确保测试准备完成后才载入实际 App。
回退移除本批常亮入口、桥接和生命周期控制即可，已保存的布尔值可保留；无需清理曲库、登录或队列。
`BUILD_RECORD.json` 保持不变。源码／CI 通过不代表个人 App 已更新，完整移动移植和 Automix 真机验收仍未完成。
