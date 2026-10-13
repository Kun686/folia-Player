<!-- LAUNCH_PLAYBACK.md — original opt-in launch setting and native restoration evidence. -->
# 启动后自动播放

2026-10-13。复用原 `useAudioSettingsStore.autoPlayOnLaunch`、设置文案和
`settings-toggle-auto-play-on-launch` 命令。入口位于播放器「更多播放选项」，默认关闭，无新依赖。

## 行为

- 设置经既有 `connectAudioSettings` 单一写入链存入原生 `folia.audio`；旧文档没有字段时默认关闭。
  原生为恢复时的权威状态，陈旧的 Web 存储不会反向覆盖。失败回退到最后确认值。
- App 的原生宿主完成服务装配后准备一次启动意图，等待原生初始曲库协调完成且 App 活跃才执行。
  原队列、当前歌曲和位置先按原规则恢复为暂停，再调用既有 `command("play")` 完成续播。
  空队列中的独立当前歌曲也沿用原恢复规则，不重建队列或保存临时 URL。
- 用户播放操作、选曲、停止、关闭该设置、退出当前平台、系统中断或旧音频输出断开，会取消待执行的启动意图。
  睡眠定时到期优先处理，不能被延后的自动续播反转。
- 当前运行中开启开关不会立即播放；WebView 重载或再次回前台不会重复起播。
  自动恢复后的解析／播放失败继续使用原重试与登录失效规则，不循环重新发起启动任务。
- 这是原版功能的移动接线，不新增本地曲库能力，不修改歌词动画、全屏布局或音乐算法。

## 本批验证

证据目录：`.mobile-test-results/launch-playback/`。独立 QA Bundle ID 为 `app.folia.validation.App`，
运行在 iPad Pro 11-inch M5／iOS 26.5 模拟器，真实账号、个人 App 和服务器未操作。

| 检查 | 结果 | 证据范围 |
| --- | --- | --- |
| TypeScript | PASS | `typecheck.log` |
| 移动逻辑回归 | 763 PASS／80 文件 | `mobile-unit.log`；包含本批的 10 项声音同步测试，不重复相加 |
| 启动设置 WebKit | 3 PASS | `ui-corrected.log`；手机、宽屏和平板窄窗口，触摸／旋转／失败回退，未发出播放命令 |
| 声音设置／搜索回归 | 24 PASS | `ui.log` 中的既有用例；同一首轮的启动设置 3 项失败另列于下文 |
| 两平台核心界面与相关回归 | 144 个唯一场景 PASS | `online-core-ui.log` 首轮 134 PASS／10 FAIL，修正测试准备后 `core-corrected-ui.log` 12 PASS（含 2 个已通过实例）；不把两轮重复数相加 |
| 原生 Release 构建与回归 | 41 PASS | `native-build-corrected.log`、`native-corrected.xcresult`；9 项本批测试和 32 项队列、流式、睡眠、淡入淡出回归 |
| 实际解码输出 | PASS（模拟器） | 恢复 index=1／位置≥6秒，采样 RMS 约 0.021539；暂停后多次前台通知不再播放；队列外当前歌曲也恢复 |
| 打包页面桥接 | PASS（模拟器） | 真实 React／Capacitor 写原生设置，陈旧 Web 值及重载后恢复，未启动音频 |
| 移动生产资源 | PASS | `web-build.log`；构建警告保留，后续提交产物摘要见 `delivery.json` |
| 真实 QQ／网易云冷启动续播、真机后台／长期性能 | NOT_RUN | 上述受控测试不能替代真实账号和物理设备验收 |
| 个人安装包／服务器更新 | NOT_RUN | 个人版本仍为 mobile.28 |

## 保留的首轮失败与修正

1. `ui.log` 的启动设置测试漏掉从底部播放条展开播放器，三种窗口都等不到工具按钮。
   补上实际 `.mini-title` 触摸路径后 3 项通过；生产 UI 与超时未放宽。
2. `native.xcresult` 为 40 PASS／1 FAIL：打包样本直接塞入不完整歌曲字典，缺少标准元数据导致页面无法装配。
   改用生产 `sanitizedSong` 生成合法快照后，完整 41 项重跑通过。
3. 初始选择器另列了 `FOLIA_AUDIO_OUTPUT_PROBE` 条件编译下的 HTTP 诊断，此 Release 未编入，
   实际只运行 41 项。最终选择列表移除该诊断，未把未执行项计入通过。
4. 核心界面回归暴露三处历史测试准备问题：ReplayGain 定位器同时匹配听歌打卡、成功保存网关的模拟响应
   缺少 scope／sessions、离线歌词测试只修改已不再权威的 Web 偏好。分别收窄定位器、补齐受控网关保存／恢复、
   在原生偏好开启刷新后验证一次离线请求和缓存正文保留。另一次 iPad 设置入口定位同时命中错误提示入口，
   改为明确点击曲库标题栏。原行为断言保留，12 项复测均通过，没有放宽生产校验。

本批共 171 个唯一 WebKit 场景（3 + 24 + 144），涵盖三种窗口；部分既有回归使用本地合成音频或
Navidrome 受控样本来检查共享代码，不构成本阶段新增本地／其他平台功能。界面美化和长期动画性能尚未完成验收。

回退本批源码即可恢复原移动启动行为（暂停）。新增原生可选字段兼容旧文档；不涉及 Keychain、队列或账户迁移。
后续范围以 [CURRENT_SCOPE.md](CURRENT_SCOPE.md) 为准。
