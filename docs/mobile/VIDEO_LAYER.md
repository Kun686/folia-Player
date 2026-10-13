# 原版视频层移动接入

2026-10-13，开发源码／独立 QA 阶段。个人 mobile.28、真实账户、物理设备与服务器未操作。

## 原版行为与适配

移动播放器此前不挂载原视频层，且没有设置入口。原组件直接订阅桌面 `usePlaybackStore` 和 `currentTime`，
即使强行挂载也不能跟随原生播放器。

本批在「歌词与动效」提供原 `VideoLayerSettingsSection`：开关、本地视频、URL、透明度和铺满／完整显示。
保留原 `useVideoLayerSettingsStore` 存储键、文件选择与 URL 回退规则，视频默认关闭。
视频仍位于背景和歌词之间，静音、循环、内联播放；未改变全屏播放器、玻璃控制器或原歌词动画参数。

`VideoLayerPlayback` 只在移动播放画布内注入原生播放时间、播放状态和歌曲身份。
原 `VideoLayer` 沿用时间取模、1 秒跳变判定、2 秒漂移检查和 350 ms 对齐阈值；
使用原生音频时钟，不使用带有用户歌词校准偏移的歌词时钟。
桌面宿主没有该上下文时继续使用原桌面 store／MotionValue；OBS、远程控制页和预览不因此开放视频层。
视频时钟不进入逐帧 React state；快速拖动在 `seeked` 时按最新时钟再次对齐。
暂停停止视频；打开工具、收起播放器或页面不可见时，既有渲染生命周期卸载视频并移除来源、计时器和订阅。
原生音乐播放独立继续。

沿用既有触摸滑块，将 `TouchRange` 移到 `components/shared` 供字体和视频设置共用。
设置保存先写入持久存储，成功后再更新显示；失败保留已接受值并显示错误。
文件清除成功后才撤销旧 Blob URL；文件操作期间禁用重复操作与关闭按钮。
没有新增依赖、解码器或生产原生播放代码。

## 保留的边界

- 原版本地文件在支持 File System Access 的浏览器保存句柄；WKWebView 使用原 `<input type=file>` 回退，文件选择仅在本次会话有效。界面明确提示重启后重新选择。
- URL 和开关／显示偏好可以恢复；本地选择优先于 URL，清除后恢复 URL。
- 与原版一致，视频及本地文件不进入外观短码、同步或 OBS 配置。
- 编码支持由系统 WebKit 决定。本批使用自行生成的静音 H.264 MP4；不代表所有 MOV／WebM／HEVC、远程认证 URL 或大视频都已验证。
- 可见性事件的浏览器检查不等于 iOS 系统实际挂起；手机、iPad 真机、实际 Files 提供方、功耗／温升／长时间内存仍 NOT_RUN。

## 证据

目录：`.mobile-test-results/video-layer/`。

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| 类型检查 | PASS | `typecheck-final.log` |
| 移动与共享外观逻辑 | PASS，74 文件／687 项 | `unit-full.log`；7 项新增保存失败／清除／取消／范围用例 |
| WebKit | PASS，24 项；3 项旧字体用例 SKIPPED | `ui.log`、`ui/`；其中视频 9 项全部通过，覆盖 phone／ipad／ipad-narrow；另 15 项字体回归，缺少外部字体样本的 3 项不计通过 |
| 移动与原生 Release QA 构建 | PASS | `mobile-build.log`、`native-build.log` |
| 打包后 iOS 模拟器 | PASS，1 项，零跳过 | `native.xcresult`、`native-summary.json`、`native-tests.log`；独立 `app.folia.validation.App`，iPad Pro 11-inch M5 / iOS 26.5 |
| 桌面 Chromium UI | BLOCKED，未执行用例 | `desktop-ui.log`；所需 Chromium headless shell 1243 不在本机，没有新增下载 |
| 真机／真实远程视频／长期性能 | NOT_RUN | 不将自动测试或短测扩展为这些验收 |

WebKit 实际解码四秒 H.264 视频，验证静音／内联、原生快照时间对齐、歌词偏移不影响视频、快速拖动、
暂停、切歌时保留同一视频元素、隐藏后释放与恢复。本地文件真实选择／解码、取消保留与清除回退均通过。
设置在旋转窗口内无水平溢出，触摸目标至少 44px，滑块实际触摸改变值，保存失败／恢复和配置排除验证通过。
截图已人工查看。浏览器的音乐时钟使用受控 bridge，不能单凭这些结果证明原生音频与视频共存。

原生用例加载本次打包 React 资源和生成视频，使用真正 `PlaybackEngine` 与本地测试 WAV。
视频播放期间实际 PCM 输出 RMS 为 0.02158，输出帧数超过 4000、原生进度持续推进、Now Playing 标题正确；
随后真实原生暂停／跳到 10.5 秒／继续以及 React 收起播放器均通过，收起后视频来源释放、音乐继续。
该短测没有测试物理音频路由、后台持续播放或功耗。全部 128 个移动构建资源与 QA 包逐字节匹配；
QA 仅增加生成视频及空白启动页，确认音乐网关／会话为空后才导航到打包页面。

首次视频 WebKit 为 6 通过／3 失败：测试把原按钮“选择视频”误写为“选择本地视频”，修正定位后重跑通过。
首次原生用例因 QA 打包将移动页面改名为 index 而未保留诊断入口，报文件不存在；补齐 QA 页面后通过，无生产代码绕过。
桌面测试第一次缺少 npm PATH 中的 cross-env，使用项目 npm 脚本后发现上述 Chromium 运行文件缺失；按重试限制停止。
失败日志／产物保留在 `*.first`，没有把环境失败记为业务通过。

## 复现与回退

```sh
"$HOME/.local/bin/codex-bounded" 600 -- npm run typecheck
"$HOME/.local/bin/codex-bounded" 600 -- node_modules/.bin/vitest run -c vitest.config.ts test/unit/mobile test/unit/visualizer/visualSettingsImportExport.test.ts
"$HOME/.local/bin/codex-bounded" 600 -- npm run test:mobile:ui -- test/mobile-ui/video-layer.spec.ts test/mobile-ui/font-size-touch.spec.ts test/mobile-ui/typography.spec.ts
```

视频生成脚本 `dev/mobile/video-layer-fixture.swift` 使用系统 AVAssetWriter，输入只有自绘色块，无第三方媒体。
原生 QA 用例为 `NativeVideoLayerTests.swift`，需按证据目录的 `stage.py`／`native-command.json` 准备独立 QA 包。
撤回本批上下文与设置入口即可回退，原有视频存储键、曲库、音频和用户账户无需迁移。
`BUILD_RECORD.json` 保持不变；源码提交和 CI 不代表个人 App 已更新。完整移动移植与 Automix 真机验收仍未完成。
