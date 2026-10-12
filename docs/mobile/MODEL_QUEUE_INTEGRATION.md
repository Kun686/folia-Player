# 模型设置与原生分析队列接入

2026-10-12。状态：**PASS_QA_COMPONENTS / FULL_AUTOMIX_IN_PROGRESS**。
延续用户已批准的固定 Apple ONNX Runtime 1.30.0 与原始模型接入；没有新依赖、模型转换或量化。
本轮只构建、安装和测试 `app.folia.validation.App`，个人 `app.folia.personal` 仍为 mobile.28。

## 行为与复用

- 从原 `AutomixModelsSection` 提取 `AutomixModelRows`，桌面与移动端共用原列表、进度、模型名称和作用标签。
  桌面的目录选择、扫描、手动下载入口与原 IPC 保持原行为。移动端使用系统文件选择器导入、下载取消与删除确认。
- `PlaybackModels` 持有原生模型存储与能力快照；`NativeModelBridge` 仅允许固定模型名，复用可信
  `capacitor://localhost` 检查，不接受任意模型 URL、文件路径或清单。模型文件仍按原清单大小和 SHA256 校验。
- 页面打开时先订阅再读取，按 revision 丢弃旧快照，回前台重新读取。关闭面板移除监听，模型工作继续由原生层持有。
  原生 getter 不产生事件，避免“事件→读取→新事件”循环；导入失败不会被进度事件清掉。
  主动取消下载正常返回当前状态，不误报网络失败。模型恢复完成并应用到队列后才发布 ready。
- `NativeTrackProfiles` 将已验证模型传入现有本地、完整缓存、前缀分析入口，继续复用原拍点预处理、
  原推理及后处理。模型变化取消旧任务并清除内存结果，既有磁盘命名空间区分无模型与模型结果。
  请求标记与歌曲身份共同阻止旧分析覆盖新队列。
- **只有启用 Automix 时才使用拍点模型**。关闭 Automix、切回普通 Crossfade 或删除模型会取消对应分析，
  普通 Crossfade 继续使用原来的静音边缘分析。已发声的转场保留当前曲线，后续计划采用新的能力。
- 删除前暂停模型能力，完成后按真实磁盘状态恢复；冲突操作沿用 model-busy 保护。
  WebView 不负责模型生命周期、队列分析或后台计时。
- 设置入口沿用已有 `settings-transition` 命令与播放设置区域。下载涉及模型选择、导入涉及系统选取、
  删除要求确认，本轮没有新增直接执行的危险快捷键，也没有新增视觉配置字段。

已安装模型与已接通完整引擎是两个状态。当前 `stems/full/desktop` 仍为 false，表现模式保持禁用；
移动端使用符合实际能力的提示，避免误显示“浏览器限制”或未经测量的效果百分比。
HTDemucs 可以准备和保存，但本轮尚未把它接入实际分轨转场。

## 可复验结果

证据目录：`.mobile-test-results/model-queue-integration/`。

| 范围 | 结果与证据 |
|---|---|
| TypeScript | PASS，`typecheck-native-text.log` |
| 相关状态逻辑 | 2 文件／6 项通过，`unit-final.log`；含快照乱序、迟到错误、监听延迟注册与销毁 |
| 移动逻辑回归 | 55 文件／380 项通过，`mobile-unit.log`；上述 6 项已包括在内，不重复累计 |
| WebKit 界面 | 手机、iPad、窄窗口共 6 项通过，`ui-native-text.log`；下载、进度、取消、失败导入、恢复、删除、旋转和触摸目标 |
| 原生模拟器 | iPad Pro 11-inch (M5)／iOS26.5，最终 `simulator-mode.xcresult`：22 通过、0 失败、0 跳过 |
| 原生真机 | iPhone XS Max／iOS18.7.10，最终 `device-mode.xcresult`：22 通过、0 失败、0 跳过 |
| 原模型资产 | 模拟器 staging 校验 33 个固定文件；手机沿用上一阶段已校验的 DeviceFixtures，模型大小与摘要由测试再次验证 |
| 包与源码 | `source-final.json`、`packages.json`：最终已测源码未变，123 份前端资源在构建目录、同步目录与两个 QA App 中逐文件一致 |

22 项原生测试包含 4 项新队列／桥接用例、7 项模型存储用例、5 项原分析队列用例与 6 项 Crossfade 用例。
测试选择以保存的 `test-*-mode-command.json` 为准。新用例实际运行原始 Beat This! 模型，
覆盖无模型→模型→无模型、模式切换、删除和旧请求取消；并通过真实打包 WKWebView 的 Capacitor
桥接读取状态、拒绝未知模型名、连续读取不产生反馈循环。它不是纯 JS 桩测试。
原队列与 Crossfade 用生成音频验证身份、切歌、暂停、拖动、退出与尾轨释放，不冒充真实平台播放验收。
存储的同机原文件／安装文件推理仍逐字节一致；手机与 Mac Node 参考沿用已有误差标准，
不将它说成跨设备位级一致，详情见 [MODEL_STORE_INTEGRATION.md](MODEL_STORE_INTEGRATION.md)。

初轮 `simulator.xcresult` 与 `device.xcresult` 各 22 项通过；随后增加普通 Crossfade 不运行模型的限制，
重新构建并运行同一组测试，最终证据使用 `*-mode`。这些重跑不累计成更多独立测试。

## 发现并修正的问题

- 初次 WebKit 的 3 个模型界面用例在删除确认处失败：测试误用“确认”，实际为“确定”；原确认弹窗
  缺少命名语义。本轮在移动调用处添加 dialog 语义并修正选择器，保留原确认组件与动画。
  原失败证据在 `ui-first-failure/` 与 `ui.log`；修正后 3 个模型用例与 3 个设置回归均通过。
- 最初提取列表遗漏原面板还在使用的 Check 图标导入，随后新增监听测试的 remove 返回类型与 Capacitor
  Promise 合同不符；均在 TypeScript 检查阶段修正。最终检查通过，没有忽略类型错误。
- 截图检查发现原共享面板会显示浏览器专用能力说明，新增可选文案注入，桌面默认说明保持原样。
- 复核发现仅安装模型也会给普通 Crossfade 增加推理，改为按启用状态与 Automix 模式选择模型；
  在模拟器和手机上均追加模式切换断言并重跑。
- 构建仍有既有 NativeDeckAnalysis／NativeDeckCapture Sendable 警告，未宣称零警告。

## 包体、边界与回退

最终手机 QA 可执行文件 **41,727,456 字节**，含测试插件的 App **132,679,445 字节**；
模拟器分别为 41,828,480 与 138,276,579 字节。两个包均 **0 个内置模型**。
这些数字包含 QA 测试成本，不能作为个人 App／IPA 的净增量；本轮没有生成个人安装候选。

**NOT_RUN / IN_PROGRESS**：公网镜像下载、移动端网盘手动链接入口、真机系统文件选取手动验收、
锁屏模型读取、真实 QQ／网易云模型分析、完整分轨调度与手势、播放和动画同时运行的资源／温升测试、
物理 iPad。下一阶段沿原版完整缓存与窗口规则接通分轨，不能以本轮拍点／模型管理通过替代完整 Automix。

回退本阶段提交可恢复此前模型存储与独立拍点 API，保留原媒体、歌词、模型清单及依赖版本。
独立 QA 卸载清除其模型和测试数据；个人 App 未参与迁移。

本轮已卸载手机与模拟器的 QA、关闭模拟器；`cleanup.json` 确认无构建／测试进程残留，
个人 App 前后完整安装元数据相同，`BUILD_RECORD.json` SHA256 仍为
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。
