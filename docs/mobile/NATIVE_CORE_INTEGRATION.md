<!-- NATIVE_CORE_INTEGRATION.md — current bundled-source integration; simulator evidence is not device acceptance. -->
# 两平台原生容器整合检查

2026-10-14。按 [CURRENT_SCOPE.md](CURRENT_SCOPE.md) 收敛 QQ／网易云、原版动效与设置 UI。
生产源码基线 `d00c04403b78cfc0019bcce68f41700b408f048a`，已包含近期歌单响应、点歌会话、
Tilt／Tempera 旋转及设置布局修复。本批只调整一个原生测试的暂停时序断言，没有修改生产功能或新增依赖。

## 包与验证范围

- 独立身份 `app.folia.validation.App`，Release／arm64，iOS 26.5（23F77）模拟器。
- 执行 `npm run build:mobile`、`cap copy ios`，再用既有隔离 xcconfig 执行 `xcodebuild build-for-testing`。
  128 个资源在 `dist-mobile`、Capacitor 拷贝和 QA 包逐项核对一致；构建身份明确为上述基线及 `mobile.28` 标签。
  此标签不表示更新了个人 mobile.28 安装包，也不把后续测试／文档提交当成资源内嵌 SHA。
- XCTest 延用离线首页；完整生产页面放在 `mobile.html`，由原有打包桥接测试显式加载。
  随后两台模拟器安装具有原生产 `index.html` 的同次构建包，均启动成功并保存截图。
- 复用真实原生播放器、Capacitor、原生缓存与隔离 Keychain；网络响应和音乐来自已有受控样本。
  本地短音频只是解码素材，不代表扩展本地音乐功能。没有连接真实平台账号或操作服务器。

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| 移动资源、原生 Release 构建、签名与音频 vendor 校验 | PASS | 现有依赖；保留构建警告 |
| iPhone 17 Pro 原生回归 | 88 PASS，0 FAIL，0 SKIPPED | 队列、快速选曲、暂停／拖动、地址刷新、登录失效、失败上限、睡眠、歌词／封面／音频缓存、网关与账号隔离 |
| iPad Pro 11-inch M5 关键回归 | 16 PASS，0 FAIL，0 SKIPPED | 上述 88 项的子集，不累计为 104 个唯一用例 |
| 打包页面设置接线 | PASS（两种模拟器） | React／Capacitor 写原生设置、WebView 重载恢复、启动续播默认与取消优先、保持屏幕开启策略 |
| 实际 PCM 输出 | PASS（两种模拟器） | 启动恢复 index=1、位置≥6秒，输出 RMS 约0.021539；不依赖 WebView 轮询的原生队列回归 |
| 完整生产首页启动 | PASS（两种模拟器） | 独立 QA 包启动截图；样本歌曲属于 QA 数据 |
| 手动设置触摸巡检 | BLOCKED（工具） | 语义快照未暴露 WKWebView 控件，坐标输入两次返回 `windowNotFoundAtPosition`；没有据截图声称触摸通过 |
| 最新源码真实平台／物理设备／服务器发布 | NOT_RUN | 没有更新个人 App；不替代历史真实账号结果或新版本验收 |

本批打包桥接通过不等于 14 个 renderer 全部通过原生动效测试；原动效验证继续引用
[VISUALIZER_ROTATION.md](VISUALIZER_ROTATION.md) 的 WebKit／逻辑证据。实际软件键盘、原生旋转交互、
多任务、VoiceOver、磨砂合成观感及长期性能仍待验收。

## 首轮失败与修正

首轮 iPhone 为 **87 PASS／1 FAIL**，失败用例包含两处断言：
`testAudioQualityRepreparesOnlineNextWithoutRestartingPlayingOrPausedAudio` 假设暂停命令立即停止解码，
但生产 `pauseWithFade` 按原版先完成淡出；首轮位置从约0.0747秒正常推进到0.4054秒。

仅修正 `ios/App/NativeTests/AudioQualityTests.swift`：在淡出期间改音质，先检查播放意图仍为暂停，
沿用原有有界等待，等预加载及暂停完成后，再观察200ms，检查当前解码器、代次、暂停位置和播放意图不变。
没有关闭淡出、扩大等待上限或修改生产播放逻辑。随后原88项整批复测、iPad16项均通过。

## 证据与未完成项

本地证据目录 `.mobile-test-results/native-core-integration/`：`iphone.xcresult` 保留首轮失败，
`iphone-corrected.xcresult`／`ipad.xcresult` 和对应 summary JSON 是最终结果；
`package.json`／`package-corrected.json` 保存源文件、资源、可执行文件和测试包摘要，
`delivery.json` 汇总交付与清理记录。完整命令保存在 `*-command.json`。

网易云30分钟锁屏、物理iPad、耳机／蓝牙／网络切换、歌词误差≤150ms和长期温升／内存仍为 NOT_RUN。
结束时停止 QA 与本次日志助手，将两个模拟器恢复为 Shutdown；个人 App、凭据、依赖锁文件和服务器未变。
本批无数据迁移；回退测试断言与文档即可回退源码改动。整体交付仍未完成。
