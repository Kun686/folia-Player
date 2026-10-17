# 移动界面整理与实时设置 · 2026-10-16

> 最新检查点（2026-10-17，真实音频补验完成）：[独立iPhone联合补验](../../.mobile-test-results/live-settings-approved-20261017/REPORT.md) **PASS**，用户批准的一次已使用，147.743秒、1通过/0失败。真实QQ《太迟》与网易云《樱花再开》分别取得30/26个有效双声道音频窗口，切换莫奈/流光时设置面板与对应渲染器同时保持；原模式、账号会话和播放状态检查通过。独立iPhone已原位更新当前候选；最终原50首队列、精确暂停位置、音频设置、45项外观恢复，320项源码/145项资源一致，测试进程已清理。个人iPhone未更新。iPad真实账号、真机、全主题与长时性能等仍NOT_RUN；以下历史记录中的“待授权/音频NOT_RUN”仅描述当时状态，不覆盖本次结论。

> 最新检查点（2026-10-17，后台选择器）：见[修复与验收记录](../../.mobile-test-results/live-picker-lifecycle-20261017/REPORT.md)。已修复实时面板退后台仍保留原生下拉框焦点的路径；三窗口6项回归、类型/移动/原生构建通过。当前独立iPad直接从桌面返回原进程，设置保持、选择器未自动弹出且仍可主动打开。320项源码/145项Web资源一致，原队列及46项外观恢复。独立iPhone尚未更新本轮候选；真实音频联合测试仍待既有额外授权，个人iPhone不变。下文为历史检查点。

> 最新检查点（2026-10-17，iPad系统窗口）：见[原生窗口复核](../../.mobile-test-results/ipad-window-20261017/REPORT.md)。当前封存候选已原位安装独立iPad模拟器，完成竖屏、横屏、面板内镜台→莫奈、系统菜单半宽窗口、恢复全屏及转回竖屏；面板保持打开并按实际窗口调整。真实缓存QQ歌词为暂停样本，不代表iPad在线播放。320项源码/145项Web资源/可执行文件一致，原队列、临时歌词、46项外观及其余4项原生偏好已恢复，任务镜像已清理。当前候选双平台音频联合测试仍待既有额外授权；自由连续缩窗、真机、系统大字和长时性能仍NOT_RUN。个人iPhone未更新。下文为历史检查点。

> 最新检查点（2026-10-17，切换连续性）：见[本轮报告](../../.mobile-test-results/visualizer-loading-20261017/REPORT.md)。复现并修复移动端首次切换懒加载动效时旧画面被隐藏；复用React保持当前场景，原版入场节奏和音频不变。三种窗口的9项定向/构图场景最终通过，类型、移动和原生构建通过；当前独立iPhone真实暂停歌曲已完成镜台→莫奈→流光→镜台，50首队列/精确位置/45项外观恢复。当前候选双平台音频联合测试仍NOT_RUN，上一轮整项FAIL保留；已准备[补验步骤](LIVE_SETTINGS_RETRY.md)，需依用户重试规则取得额外授权。个人iPhone和iPad安装包未更新。下文为历史检查点。

> 最新检查点（2026-10-17，曲库与iPad原生）：见[本轮报告](../../.mobile-test-results/library-live-settings-20261017/REPORT.md)。歌单详情移除重复横栏、提供44px返回与明确队列标签；移动莫奈隐藏与歌名完全相同的专辑副标题。32项catalog单测、6项WebKit布局、类型与两端构建通过；当前包已在独立iPad观察右下小面板、镜台→莫奈、横竖屏及关闭，使用真实缓存歌词的暂停样本，不能算iPad在线播放。真实QQ/网易云分别取得31/45个非零双声道PCM窗口，但联合测试因未在时限内选中Classic及恢复原模式而FAIL；不记全绿。手机50首/精确位置/45项外观及iPad46项外观与原队列已恢复。个人iPhone未更新，系统多任务、真机和长时间性能仍NOT_RUN。下文为历史检查点。

> 最新检查点（2026-10-17，设置与封面）：见[QQ歌单封面与设置状态修整](../../.mobile-test-results/settings-artwork-20261017/REPORT.md)。真实QQ返回的3个HTTP封面经已知主机HTTPS规范化后全部显示，第4个上游为空，保留占位。“自动使用最佳歌词”已恢复正确的持续开关语义与样式；播放画面选中项标记明确。91项adapter单测、3项设置保存/恢复和3项实时面板旋转通过，真实QQ封面原生验收通过；队列50首、精确位置、音频设置与45项外观保持。最终独立包SHA以本轮manifest为准。当前候选真实音频、iPad原生与个人真机仍NOT_RUN。歌单详情密度仍待修。下文为历史记录。

> 最新检查点（2026-10-17）：见[当前五维视觉审查与歌词修整](../../.mobile-test-results/diorama-subtitle-20261017/REPORT.md)。已修镜台3D下一句与共享字幕重复，增强移动莫奈当前未唱文字及最近待唱行对比；已在独立iPhone真实暂停歌曲复核，队列50首、精确位置、音频设置和45项外观保持。浏览器6个字幕/模式场景及修正测试条件后的3个完整场景通过，相关单测42/42通过；不是首次9/9全绿。QQ四个歌单封面缺失、歌单顶部信息密度、控件状态和动作文案当时待修；其中“自动使用最佳歌词”原误判为一次操作，现已纠正为持续开关。当前候选真实音频、iPad原生/账号/多任务、真机与长时间性能仍为NOT_RUN。[上轮iPad焦点修复](../../.mobile-test-results/diorama-full-scene-20261017/REPORT.md)的原生证据独立保留。下文为历史记录，不替代当前验收边界。

当前完成基础界面整理、按窗口大小布局的实时动效设置，以及独立 iPhone 模拟器验证。没有把全部主题、真机/iPad 原生或长时间播放标为通过。

## 视觉判断与处理

| 用户关心的维度 | 发现的问题 | 本次处理 |
| --- | --- | --- |
| 完整产品感 | 播放器有明确风格，曲库与设置偏工具面板；暂缓功能挤占一级导航 | QQ/网易云作为主导航，缓存从设置进入，账户操作归入账户入口 |
| 字号与层级 | 歌手、时间过小；选中歌单不明确 | 播放器歌手13px、时间12px；歌单选中态、歌单标题和当前歌曲状态明确 |
| 控件风格 | 关闭入口、选择卡、危险操作的视觉权重不统一 | 主要设置统一圆形关闭；实时选择控件44px；队列清空/打乱归入更多，保留确认 |
| 间距 | 重复卡片嵌套、搜索筛选和队列管理占据大量首屏空间 | 设置分组去除多层容器；队列筛选按需展开，加载更多放到列表后 |
| 第一眼信任感 | 突出的退出登录、暂缓入口、工程文案和横屏异常 | 收起次级入口，说明用户可感知结果；修正打开设置后旋转导致快捷按钮拉高 |

保留已有全屏拼贴、玻璃控制器、圆形转场、队列手势和原版特效渲染。没有新增生产依赖，未开发本地音乐或其他平台功能。

## 实时动效设置

- 歌词播放器和拼贴工具栏都可直接打开设置。
- 打开时保留渲染器和原生时间/音频数据订阅，修改透明度、动画模式或背景无需先关闭面板。模式首次使用仍受资源初始化时间影响。
- 手机竖屏底部约55%可用高度；iPad宽窗口右下方宽度不超过48%、高度不超过48%；矮横屏使用右侧约半宽面板。按实际窗口而非设备名称判断。
- 不在播放画面上增加全屏暗色遮罩；弹层内滚动，处理安全区和可视窗口；保留原主题编辑的取消行为。
- 使用现有React、Framer Motion、标准CSS和系统选择器。没有增加动画框架、轮询渲染状态或每帧React更新。

## 验证证据

证据根目录：`.mobile-test-results/ui-refinement-20261016/`。
审查前截图和报告：`.mobile-test-results/visual-audit-20261016/REPORT.md`。

| 验证 | 结果 | 边界 |
| --- | --- | --- |
| 最终类型检查 | PASS | `typecheck-final.log` |
| 最终移动生产构建 | PASS | `build-rotation.log` |
| WebKit界面回归 | 24/24 PASS，约1.3分钟 | `final-regression/`；手机390×844、iPad1194×834、窄窗口600×834及旋转，含浅深色标签、主题校验、即时设置和队列操作 |
| 原生Release构建 | PASS | `native-build-rotation.log` |
| 包/安装资源一致性 | PASS | `rotation-final/manifest.json`、`installed-manifest.json`；143个构建资源及2个空Cordova文件，签名与应用身份核对 |
| 已登录真实平台页面 | PASS | 独立iPhone模拟器；QQ/网易云账号与歌单可读取，真实歌曲显示，不等于本轮音频验收 |
| 实时主题/旋转 | PASS | 原生同一首QQ《太迟》；设置保持打开，模式切换可见；修复后竖屏→横屏→竖屏快捷按钮正常 |
| 队列及设置保留 | PASS | `native-baseline.json`与`native-final.json`：50首队列、位置165.80267573696145秒、音频设置及45项外观一致 |

自动界面测试复用已确认的QQ歌曲元数据及受控桥接，不连接真实账号，不作为真实播放证据。原生截图来自用户已登录的独立测试App；本轮没有点击播放、切歌、退出或清空。

独立包：`app.folia.validation.App`，显示名“音乐”，版本`0.7.16 (28)`。本轮未提升版本号，须以资源manifest辨认候选。
最终可执行文件SHA-256：`b0b47a3e78c2d7eb9ece57d61cd1984e9b01ddf6bec0040d0905948005ff2f60`。
候选：`.mobile-test-results/ui-refinement-20261016/rotation-final/VerifiedValidation.app`。
原回退包保留于`.mobile-test-results/lattice-immersive-20261015/queue-transitions/VerifiedValidation.app`。回退仅原位安装同一独立身份，不能卸载清数据。

### 最终效果

原生iPhone横屏，设置保持打开后旋转：

![横屏实时设置](/Users/yichen/Desktop/App/音乐播放器/folia-major/.mobile-test-results/ui-refinement-20261016/08-native-final-landscape.png)

iPad宽窗口浏览器布局（受控桥接，非真实iPad验收）：

![iPad窗口布局](/Users/yichen/Desktop/App/音乐播放器/folia-major/.mobile-test-results/ui-refinement-20261016/final-regression/live-settings-layout-top-s-77e12-ompact-size-across-rotation-ipad/top-1194.png)

## 失败与修正记录

- 首次实时设置回归的“关闭”选择器匹配了其他选项，改为面板header内精确关闭按钮后9/9通过；后续44px选择控件与遮挡调整后9/9通过。
- 原生发现保持设置打开再旋转时，两个播放画面按钮从约44px撑高到约130px；关闭重开可恢复。浏览器同路径未复现，因此不能断言是所有WebKit版本的共同问题。
- 为快捷区网格明确内容尺寸行与起点对齐，新增顶部旋转检查，最终24/24通过；安装后原生同路径未再撑高。没有通过缩小触摸目标解决。
- `06-native-live-landscape.png`是修复前异常证据；最终效果看`07-native-final-portrait.png`、`08-native-final-landscape.png`、`09-native-final-queue.png`。

## 尚未完成的视觉项与验收

- 镜台主题在当前亮背景配置下的歌词对比与长句出画：观察到风险，尚未完成动态逐帧诊断；本次未改原版3D镜头或歌词材质，不能宣称已解决。
- 曲库首屏仍约两首完整歌曲，内容密度还有优化空间；QQ歌单封面在本轮为回退图标，不能标记QQ歌单封面验证通过。
- NOT_RUN：实际iPad原生/多任务窗口、个人iPhone安装、真实音频回归、真机触感、长时间特效性能、系统大字与VoiceOver。iPad尺寸浏览器测试不替代这些项目。
- 个人iPhone、服务器与账号凭据未改动；没有读取或导出平台凭据。测试后恢复原镜台/拼贴选择，保持暂停，关闭本轮测试进程。

## 主要实现位置

- `src/mobile/LiveSettingsSheet.tsx`、`VisualSettings.tsx`、`MobileSelect.tsx`、`mobile-live-settings.css`：实时小半屏设置。
- `PlayerPanel.tsx`、`PlayerChrome.tsx`、`MobileLattice.tsx`：直接入口、保持渲染、遮挡控制。
- `MobileApp.tsx`、`LibraryAccount.tsx`、`OnlineCollections.tsx`、`SettingsSheet.tsx`：曲库和设置层级。
- `QueueBrowser.tsx`、`PlayerQueueSheet.tsx`、`mobile-queue-sheet.css`：队列紧凑操作。
- `mobile-shell.css`、`mobile-player.css`、`interfaceCopy.ts`、`PlaybackViewPreference.tsx`、`SongThumbnail.tsx`：字级、间距、说明和复用。
- `test/mobile-ui/live-settings-layout.spec.ts`、`settings-contrast.spec.ts`：定向界面回归。

工作区还有本任务前已存在的修改；上述文件列表不代表整个git差异都由本轮产生。
