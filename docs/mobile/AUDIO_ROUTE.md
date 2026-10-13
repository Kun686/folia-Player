# 原版播放设备选择的 iOS 适配

2026-10-13，开发源码／独立 QA 阶段；个人 mobile.28、物理设备、真实账户和服务器未操作。

## 复用与行为

原桌面入口位于 `src/components/modal/settings/PlaybackSettingsSubview.tsx` 的 `audioOutputSettings`，
命令为 `settings-audio-output`。移动原生播放不能使用浏览器的 `selectAudioOutput`／设备 ID。
本批在既有移动音频设置内补充「播放设备」，沿用原标题、默认设备文案、主题和 lucide 图标。
移动宿主没有桌面命令面板，通过原触摸工具面板提供同一功能；桌面命令和实现保持原样。

最简适配为 `AudioRouteControl.tsx` → 已有可信来源 Capacitor bridge → `NativeAudioRoutePicker.swift`。
原生 sheet 显示当前输出名称和 Apple `AVRoutePickerView`，用户再轻点真实的系统 AirPlay 控件选择设备。
蓝牙先在系统设置配对。只使用 UIKit／AVKit／AVAudioSession 的公开 API，没有新增依赖、私有按钮调用或自建设备列表。
应用不保存设备 ID、不改变音频会话类别／模式、不改播放队列、解码或 DSP；实际路由由系统管理，
现有播放引擎处理路由变化。此动作不属于外观配置，因此不进入视觉设置导入导出。

桥接请求持续到面板关闭，防止重复展示；展示失败允许重试。关闭仅表示面板已关闭，不报告“设备切换成功”。
原生校验文案长度、展示宿主和并发面板，观察路由更新当前名称；关闭与系统移除只完成一次回调并释放订阅。
安全区、可滚动内容、动态字体及至少 44pt 操作区支持不同窗口。

实际 iPhone 模拟器发现 iOS 26 sheet 材质未跟随内容的深色设置，导致白字落在浅背景。
已同时设置展示控制器的 `traitOverrides.userInterfaceStyle`；该公开 API 在最低支持的 iOS 17 可用。
深色竖屏／横屏与浅色竖屏截图复核通过，沿用既有全屏和玻璃控制器布局。

## 验证证据

证据目录：`.mobile-test-results/audio-route/`；完整构建命令、选择的测试、源码哈希见其中的日志及 `completion.json`。

| 层级 | 结果 | 范围 |
| --- | --- | --- |
| 类型检查、移动构建、Release 原生 QA 构建 | PASS | 已批准依赖，独立 Bundle ID `app.folia.validation.App` |
| Vitest | 26 PASS | 2 文件：音频设置同步与移动 runtime 回归 |
| Playwright WebKit | 9 PASS／0 skip | 6 个输出选择场景、3 个音质回归；手机、平板、平板窄窗口 |
| iPhone 17 Pro 模拟器，iOS 26.5 | 5 PASS／0 skip | 3 个新增原生用例与 2 个已有音频路由／中断回归 |
| iPad Pro 11-inch (M5) 模拟器，iOS 26.5 | 5 PASS／0 skip | 同一组 5 个用例，不计作 10 个不同用例 |
| 打包资源一致性 | PASS | 128 个移动资源逐字节匹配独立 QA 包 |
| 真机蓝牙／AirPlay、系统设备切换、长期播放 | NOT_RUN | 不以模拟器、合成通知或 PCM 短测代替 |

WebKit 用受控 bridge 验证等待关闭、失败重试、旋转无横向溢出和不改变队列／播放指令。
原生使用真实本地 WAV 解码与 PCM tap，检查面板显示期间仍有输出、进度推进、流身份和音频会话保持；
还验证当前路由名称刷新、重复展示拒绝、明暗主题、关闭仅回调一次、弱引用释放，以及真实 Capacitor 调用后重开。
原生用例启动在隔离的空白 QA 页，先确认网关与会话为空；它与前端 WebKit 测试分开，未声称完整 React 真机链路通过。

人工检查使用相同原生实现的独立桥接诊断页，截图为 `iphone-dark-portrait.jpg`、
`iphone-dark-landscape.jpg`、`iphone-light-portrait.jpg`。关闭按钮和系统背景关闭区域均能恢复桥接状态。
模拟器点击系统 AirPlay 控件后未显示可选设备列表，原因未确定，不能据此确认真实设备选择可用。
一次拖动 grabber 未完成关闭，因此不将手势关闭记为通过。

初次人工安装时模拟器已被 XCTest 恢复为关机；显式启动后才重新安装成功。
首次 native 编译的 actor 诊断已通过主队列 `MainActor.assumeIsolated` 修正；最终构建和两台模拟器测试均通过。
`*.before-theme` 保留修正 sheet 主题前的测试产物，最终结果使用无该后缀的文件。

## 复现与回退

```sh
"$HOME/.local/bin/codex-bounded" 600 -- npm run typecheck
"$HOME/.local/bin/codex-bounded" 600 -- node_modules/.bin/vitest run -c vitest.config.ts test/unit/mobile/audioSettingsSync.test.ts test/unit/mobile/runtime.test.ts
"$HOME/.local/bin/codex-bounded" 600 -- node_modules/.bin/playwright test -c playwright.mobile.config.ts test/mobile-ui/audio-route.spec.ts test/mobile-ui/audio-quality.spec.ts
```

原生复现使用 `NativeAudioRouteTests.swift`，按证据目录 `stage.py` 及 `native-command.json` 准备独立 QA 包；
`native-iphone-command.json` 选择 iPhone。QA 只替换启动页，生产移动页面仍按原字节保存为 `mobile.html`。
回退移除本批触摸入口和 bridge／原生面板注册即可，无数据迁移。
`BUILD_RECORD.json` 未改变；源码和 CI 通过不代表个人 App 已更新。完整移动移植与 Automix 真机验收仍未完成。
