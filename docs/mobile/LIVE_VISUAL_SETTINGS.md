<!-- LIVE_VISUAL_SETTINGS.md — actual-account settings UI observations and scoped verification boundaries. -->
# 真实歌曲的主题与字体设置对齐

## 2026-10-15：时计与回环的实际页面补验

等待图片持久化追加回归许可期间，使用已安装的独立 iPhone 17 Pro／iOS 26.5 App，
在真实 QQ《我不难过》／孙燕姿、04:36暂停上下文检查原版时计和回环；没有导入歌曲或替换平台响应。
本批没有新增生产代码、构建、安装、平台请求或个人 iPhone 操作。

| 检查 | 结果与限制 |
| --- | --- |
| 时计设置 | **PASS（实际界面观察）**：从动画列表选择后，竖屏可滚动至轮盘／角度／咬合／缩放／齿轮／封面等参数；横屏固定关闭入口可见，可触摸滚动至设置底部 |
| 时计播放器 | **PASS（暂停界面观察）**：关闭设置后加载出轮盘与真实歌词；横屏与正常竖屏布局均显示，当前歌词竖屏自动换行，控制器仍可见 |
| 回环设置与播放器 | **PASS（竖屏暂停界面观察）**：设置中倍率／半径／倾斜／轴线／字距可见，关闭后原轨道歌词与控制器恢复；未改参数，未验证全部滑块输入或横屏 |
| 状态恢复 | **PASS**：通过 App 恢复镜台；25个采集外观键、完整50首队列、index／276.4506575963719秒暂停位置、音效与基线相同；没有数据库恢复写入 |
| 包与清理 | **PASS**：主二进制及128个应用资源＋2个空Cordova文件保持；临时镜像PID 41485及包装会话正常退出，页签关闭，3200／9222／4179无监听 |
| 音频、运动连续性／帧率／内存、长播、真机、实际iPad、完整模式矩阵 | **NOT_RUN**；本批全程暂停，不以静态画面替代动画性能或播放验收 |

时计第一次关闭设置的即时截图为黑底，之后已经正常绘制。未测量首帧时延，不认定为持续黑屏，
也不把这次观察当作冷加载性能通过。镜像旋转按钮按四个方向循环，经过倒置竖屏时 iPhone App
仍保持横屏；最终已回到正常竖屏，不将倒置画面归类为正常竖屏布局错误。

证据位于 `.mobile-test-results/live-remaining-visualizers/`：`baseline.json`、
`pendolo-settings-portrait.png`、`pendolo-settings-landscape-bottom.png`、`pendolo-player-landscape.png`、
`pendolo-player-portrait.png`、`claddagh-settings-portrait.png`、`claddagh-player-portrait.png`、
`final-restored.png`、`final-state.json` 及镜像日志。横屏以镜像截图为准；原生Simulator窗口方向
没有跟随镜像外壳旋转，`pendolo-settings-landscape.png` 保留设备内容侧转的原始截屏。

候选仍为 `.mobile-test-results/visual-reset/VerifiedValidation.app`，主二进制SHA256为
`00acd6d18d719962f6010db2c4512d63fd7d1cefb2500027ff66f8fa60161c6b`。
[图片存储补丁](VISUALIZER_IMAGE_STORAGE.md)仍未安装，最终45项存储单测及原六项WebKit没有重跑；
其重试次数已用完，等待已发出的追加许可。本批UI观察不绕过或替代这两组回归。
QQ偶发空搜索及完整特效／设置与当前候选真机验收仍未完成。

## 2026-10-14：主题与字体按钮对齐

2026-10-14，`mobile-main` 工作区。接续 [真实分页修复](LIVE_LIBRARY_PAGINATION.md)，
本批只修正实际设置界面里两处缺少按钮／分组外观的问题，不新增功能或依赖。

## 修正与复用

- `src/mobile/SongThemeControls.tsx:13`：歌曲主题区域增加现有 `settings-group`，复用卡片边框、背景和间距。
- `src/mobile/mobile-shell.css:10`：歌曲主题按钮及字体上传按钮纳入现有按钮规则，
  复用 44px 最小触摸尺寸、圆角、内边距、颜色和禁用状态。

本批生产改动只有上述两行。原有主题应用、字体存储、渲染器、播放器和 provider 逻辑保持。
优先复用已有组件／CSS，不需要新库或另一套配置系统。工作区其他修改属于此前增量，未回退。

## 检查结果

| 层次 | 结果 | 范围 |
| --- | --- | --- |
| 类型检查 | PASS | `npm run typecheck` |
| 既有 WebKit 回归 | 45 PASS、3 SKIP | `settings-layout.spec.ts`、`song-themes.spec.ts`、`typography.spec.ts`；手机、宽平板、窄平板三个视口，1.6 分钟 |
| 移动资源／原生构建 | PASS | `build:mobile`、Capacitor copy、Release iPhone 模拟器构建 |
| 包与源码核对 | PASS | 128 个构建资源、2 个空 Cordova 文件、源码摘要、Bundle ID、模拟 Keychain 身份及签名校验 |
| 实际模拟器界面 | 已观察 | 真实歌曲设置、新按钮外观、字号拖动、旋转、文件选择器打开／取消及回到歌词 |
| 本批音频／真机／长播 | NOT_RUN | 本批始终暂停，未把设置检查当作播放验收 |

三项跳过均为同一真实字体文件测试在三个视口的实例；未提供 `FOLIA_TEST_FONT`，
因此不宣称字体文件导入、加载或重启恢复已验证。上述 WebKit 使用受控响应，不能代替真实平台验收。
本批测试未重试；上一批获准的分页额外回归已执行，结果仍见上一批记录。

日志及截图目录：`.mobile-test-results/live-visual-settings/`。
`typecheck.log`、`ui.log`、`build.log`、`native-build.log` 保存原始结果；构建中的既有警告未当作已解决。

执行命令（检查和构建均用 `codex-bounded` 限时）：

```sh
npm run typecheck
node node_modules/@playwright/test/cli.js test -c playwright.mobile.config.ts \
  test/mobile-ui/settings-layout.spec.ts test/mobile-ui/song-themes.spec.ts test/mobile-ui/typography.spec.ts
npm run build:mobile
node node_modules/@capacitor/cli/bin/capacitor copy ios
xcodebuild build -project ios/App/App.xcodeproj -scheme App -configuration Release \
  ENABLE_TESTABILITY=YES ONLY_ACTIVE_ARCH=YES -xcconfig .mobile-test-results/qq-search-cover/validation.xcconfig \
  -destination 'platform=iOS Simulator,id=9213032A-657A-40CD-BD2A-A3065ACCC8EC' \
  -destination-timeout 30 -derivedDataPath ios/DerivedData -disableAutomaticPackageResolution
```

## 实际账号与设置操作

目标为 iPhone 17 Pro / iOS 26.5 Simulator，UUID `9213032A-657A-40CD-BD2A-A3065ACCC8EC`，
Bundle ID `app.folia.validation.App`。原位更新用户已登录的独立测试包，未卸载。
QQ／网易云账号及原 51 首队列在更新后仍可见；这些是实际界面观察，不是凭据字节级一致性断言。
没有新增入队、歌单写入或播放操作，结束仍暂停于网易云《莫愁乡》约 00:19。

- `song-theme-before.png`／`song-theme-after.png`：原主题动作缺少按钮表面，更新后已呈现卡片及按钮；后图上沿因当前滚动位置被裁切。
- `font-actions-after.png`：完整字体区和新的上传按钮，字号为 100%。
- `font-size-drag-125.png`／`font-landscape.png`：真实触摸调整为 125%，旋转后仍显示该值；随后恢复 100%。
- `font-file-picker.png`：通过“上传自定义字体 → Choose File”进入原生文件选择器，点击关闭可返回；未选择或上传文件。
- `netease-after.png`／`qq-after.png`：更新后实际账号和曲库状态。
- `final-paused-stage.png`：关闭设置后原绘光舞台、歌曲、歌词和暂停控件恢复。

临时切换过心象和云阶，结束已恢复初始绘光模式；字号恢复 100%。
检查中滚动回弹后一次点击可能落在绘光“关键词着色 → 关闭”。**未捕获这项操作前的初始值**，
因此不能声称全部偏好完全不变；收尾将该项设为源码默认的“开启”，见 `keyword-final-default.png`。
没有修改个人 iPhone 的设置。主题编辑器保存／取消与完整主题切换矩阵本批未补验。

原生桌面自动化的拖动曾无效，后改用已有本机模拟器镜像转发触摸；操作的仍是同一真实 App，
不是网页样本。镜像仅绑定 127.0.0.1，使用既有工具，未安装新依赖。
第一段镜像到 600 秒自动结束，收尾段另限时 180 秒并提前清理；未将工具超时记作 App 故障。
浏览器镜像页已关闭，服务按设备 ID 停止；最终进程检查记录见 `cleanup.json`。

## 安装身份、回滚与未覆盖项

`manifest.json`／`installed-manifest.json` 记录暂存包与实际安装包，`baseline.json` 记录更新前核对。
候选主二进制 SHA256：`4405b881525574805c5c10f04e8157de90a1a05d57761baa8216b847f5855303`。
模拟 Keychain 身份为 `33GAKXJHL3.app.folia.validation.App`。
候选版本字段仍为 0.7.16 / 28，必须以清单区分，不能称作新的个人 mobile.28 发布。
上一批 `.mobile-test-results/live-library-pagination/VerifiedValidation.app` 保留，可用同一 Bundle ID 原位回滚；
不覆盖账号和缓存，不改服务器会话。

个人 iPhone 仍为 mobile.28，本批服务器未改动。完整设置／动效 UI、当前物理设备、
网易云 30 分钟锁屏、蓝牙／网络切换、歌词误差和长期动画内存／温升仍待验收；iPad 真实账号按用户要求暂缓。
本批不补做本地音乐或其他功能，不将两处视觉修正计作整体验收完成。
