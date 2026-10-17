<!-- LIVE_AUDIO_CHROME.md — real-account audio settings and light player material observations. -->
# 音频设置与浅色控制器可读性

2026-10-15：在已登录的独立 iPhone 模拟器、真实 QQ《我怀念的》画面上确认并修正两处 UI 问题。
本批只改移动端 CSS，复用现有文字色、字号、玻璃材质和 ReplayGain 组件；无新依赖、设置项或音频算法。
继续保持全屏原版歌词、轻点空白隐藏／唤回控制器，不扩展其他功能。

## 实际问题与修正

1. **音频增益文字过暗、偏小**：共享桌面组件的标题使用40%透明度，状态文字为11px、60%透明度。
   `src/mobile/mobile.css` 的移动端作用域改用已有辅助文字色和13px字号，取消二次透明度，允许长说明换行。
   44px按钮、模式选择、失败回退、原生保存和桌面组件保持原行为。
2. **浅色控制器覆盖深色动效时难以辨认**：深浅界面原来都只用18%的底色，绘光的深色背景透出后，
   黑色歌名、时间及图标对比不足，白色阴影又使小文字边缘发虚。
   `src/mobile/mobile-player.css` 为浅色控制器使用60%底色，保留40%背景透出及原有模糊，辅助文字使用实色并移除浅色阴影。
   深色控制器仍为原18%底色；歌词渲染器、主题、布局、隐藏与唤回逻辑保持。

这些是实际画面观察，不是全量WCAG测量或所有动效背景的视觉验收。

## 自动检查与构建

证据目录为 `.mobile-test-results/live-audio-settings/`，最终安装包与清单在其 `final/` 子目录。

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| 原有ReplayGain界面回归 | 3 PASS，13.8秒 | 手机、宽平板、窄平板视口；模式恢复、触摸选择、失败回退、44px按钮与无横向溢出；`ui.log` |
| 原有控制器／材质回归 | 12 PASS、3 SKIP，29.4秒 | 旋转、空白点击、背景变化及高对比设置；`chrome-ui.log` |
| 移动资源与原生构建 | PASS | 两处CSS最终版本均进入包；`final/build.log`、`final/capacitor-copy.log`、`final/native-build.log` |
| 资源／签名／应用身份 | PASS | 128个应用资源、2个空Cordova文件逐项一致；`final/manifest.json`、`final/installed-manifest.json` |
| 最终源码差异空白检查 | PASS | 仅本批涉及的CSS与文档；不代表整个脏工作区的代码审查 |

三个SKIP均是浏览器独立磨砂合成探针未显示有效模糊，因此不计为磨砂通过；原生实际画面另行观察。
自动回归复用已有受控样本，只证明控件行为；真实平台证据来自下述已登录App，没有新增虚构歌曲冒充验收。
本批只改CSS，未新增测试或重复执行无关逻辑测试。

执行命令均有 `codex-bounded` 限时，未重试失败测试：

```sh
node node_modules/@playwright/test/cli.js test -c playwright.mobile.config.ts \
  test/mobile-ui/mobile.spec.ts --grep 'original ReplayGain control'
node node_modules/@playwright/test/cli.js test -c playwright.mobile.config.ts \
  test/mobile-ui/material.spec.ts test/mobile-ui/chrome.spec.ts \
  --grep 'frosted controls|increased contrast|visible glass|rotation does|blank taps'
npm run build:mobile
node node_modules/@capacitor/cli/bin/capacitor copy ios
xcodebuild build -project ios/App/App.xcodeproj -scheme App -configuration Release \
  ENABLE_TESTABILITY=YES ONLY_ACTIVE_ARCH=YES -xcconfig .mobile-test-results/qq-search-cover/validation.xcconfig \
  -destination 'platform=iOS Simulator,id=9213032A-657A-40CD-BD2A-A3065ACCC8EC' \
  -destination-timeout 30 -derivedDataPath ios/DerivedData -disableAutomaticPackageResolution
```

## 已登录模拟器实际观察

目标：iPhone 17 Pro / iOS 26.5，UDID `9213032A-657A-40CD-BD2A-A3065ACCC8EC`。
Bundle ID `app.folia.validation.App`，应用标识 `33GAKXJHL3.app.folia.validation.App`，版本0.7.16/build28。
最终主二进制SHA256：`5b16d5f670bf205e873d96293d395ee0045f2c38fe05c4c180a0cbc39d907311`。
原位安装，未卸载。中间只含增益文字修正的包也保留，最终包以 `final/` 清单为准。

- 音频面板深浅主题、折叠／展开、横屏滚动已观察；“关闭→单曲→专辑→关闭”触摸反馈正确。
  该真实歌曲没有ReplayGain元数据，且本批始终暂停，不据此宣称增益听感验证。
  证据：`replay-gain-portrait.jpg`（修正前）、`replay-gain-dark-after.jpg`、`replay-gain-light-after.jpg`、
  `replay-gain-track.jpg`、`replay-gain-landscape-after.jpg`。
- 最终浅色控制器的歌名、时间、图标在绘光深色背景上更清楚，仍可透出背景；竖屏／横屏均已观察。
  轻点空白隐藏、再次轻点显示、关闭设置返回原播放器通过。
  证据：`light-chrome-before.jpg`、`final/light-chrome-after.jpg`、`final/light-chrome-hidden.jpg`、`final/light-chrome-landscape.jpg`。
- 最终包两平台显示原账号及个人歌单入口；本批未重新扫码、退出、收藏写入或增加歌曲。
  见 `final/qq-account.jpg`、`final/netease-account.jpg`，不将入口可见等同于本批完整歌单或搜索验收。
- 最终恢复深色、绘光、QQ《我怀念的》122.688秒暂停；完整51首队列JSON、索引4及音效设置与批前一致。
  见 `baseline.json`、`final/installed-state.json`、`final/final-state.json`、`final/restored-player.jpg`。

仅调整界面主题及临时模式选择，未更改服务器配置或凭据。临时预览页、镜像、测试Vite服务均清理，
正常App按授权保留暂停；清理记录为 `final/cleanup.json`。

## 待验收与回退

个人 iPhone mobile.28、服务器和iPad均未更新。物理设备观感、VoiceOver、完整动画／设置矩阵、
长期内存／温升、网易云30分钟锁屏、蓝牙／网络切换和歌词精度本批 **NOT_RUN**。
QQ偶发空搜索继续见 [搜索状态记录](QQ_SEARCH_STATUS.md)，本轮没有SSH重连或新的根因结论。

回退只撤回本批两处CSS，保留工作区已有改动。独立模拟器可原位安装
`.mobile-test-results/netease-session-body/VerifiedValidation.app` 回到上批候选；不卸载或清空用户数据。
