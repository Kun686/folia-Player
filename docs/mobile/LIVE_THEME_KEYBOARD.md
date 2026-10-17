<!-- LIVE_THEME_KEYBOARD.md — actual iOS keyboard, theme save/relaunch, and scoped cleanup evidence. -->
# 主题编辑器：软件键盘与实际保存补验

2026-10-15：已登录的独立 iPhone 17 Pro／iOS 26.5 模拟器，沿用合并候选
`app.folia.validation.App`，主二进制 SHA256
`bf8510575caad59d42054fe60c2ee25dc5170aa6518d2b75750127de268e0d88`。
没有修改产品代码、构建、安装或部署；个人 mobile.28 与 iPad 未更新。

## 实际操作与结果

从真实 QQ《我不难过》的暂停播放器进入「歌词与动效 → Theme Park」，选择自定义主题。
复用原版编辑面板、名称校验、移动固定操作区及 `useSheetViewport`，没有新增依赖或自行实现键盘逻辑。

| 项目 | 结论与边界 |
| --- | --- |
| 完整 iOS 软件键盘／竖屏 | **PASS（手动观察）**：名称输入框、取消和保存可见；空名称提示变红且保存禁用。`portrait-keyboard.png` |
| 屏幕键盘输入 | **PASS（英文触摸）**：实际点击 Q、a，并确认候选 `Qa`；不是注入字段值 |
| 横屏键盘布局 | **PASS（手动观察）**：输入框可见，取消／保存收拢在同一行。`landscape-keyboard.png` |
| 横屏保存 | **PASS**：键盘显示时点击保存并应用，返回原设置页；只读存储确认亮色名称为 `Qa`，自定义主题选中、指针为 `custom`。`saved-theme.json` |
| App 重开后读回 | **PASS**：停止并重开独立 App，再经实际 UI 打开编辑器，信息页仍显示 `Qa`。`reopened-theme.png` |
| 中文输入 | **INCONCLUSIVE**：自动输入未形成有效中文文本；剪贴板路径未得到目标内容，已清空且未保存。不记中文输入 PASS |
| 真机、iPad、音频／长播 | **NOT_RUN**：本批歌曲始终暂停；原版主题预览中的示例歌词不作为真实歌曲音频证据 |

原生自动化的极短点击及滚轮未完成预期操作；改用 150ms 点按与既有镜像触摸拖动后操作成功，
没有把自动化输入失效归因为产品缺陷。编辑器真实歌曲主题保存、同步及中文输入法组合过程未在本批验证。

## 恢复与清理

本轮基线是50首队列、index 2、276.4506575963719秒暂停，动画为镜台；不是此前51首／绘光基线。
保存与重开证据采集后，停止独立 App，在事务中仅恢复本次修改涉及的五个外观键：
`custom_dual_theme`、`custom_theme_preferred`、`theme_auto_switch_enabled`、
`theme_auto_generate_enabled`、`last_applied_theme_pointer`。
恢复前断言保存值仍为本轮 `Qa`；其他 localStorage 条目逐值对照保持，未写入原生偏好或 Keychain。

`restoration.json` 确认10个采集外观键、完整原生队列／音效及二进制与基线一致；
`after-relaunch.json` 确认再次启动后外观和原生状态仍一致，`restored-player.png` 显示原QQ暂停播放器。
临时镜像页关闭、助手退出，3200／9222无监听，见 `cleanup.json`。
App保留打开供用户使用；无后台测试或构建任务遗留。

证据目录：`.mobile-test-results/live-theme-keyboard/current/`。
本批只有实际界面检查与记录，无产品代码变化，未重复执行构建或离线测试。
QQ偶发空搜索仍未解决；有岛真机、当前候选真机与长播、完整特效／设置 UI 仍待验收。
