# 主题生成区域触摸滚动

2026-10-12，修复源码 `ffdd06a`。本记录区分独立 QA 的原生触摸对照与真实设备验收。
个人 iPhone 仍为 mobile.28，本次不更新个人 App。

## 复现与最小修复

独立 `app.folia.validation.App`，iPad Pro 11-inch M5／iPadOS 26.5，横屏。
基线资源源码 `2939135`，已保存的合成歌曲 First 暂停，歌词动画为流光。
打开「歌词与动效」，从歌曲主题生成标题右侧空白处向上拖动：
同一路径两次未滚动，面板边缘和标题下方可滚动，因此不是整个设置页不可滚动。

CUA 905×704 窗口的复现路径为 `drag([546,582],[546,274])`；
使用其他窗口尺寸时，应重新定位标题右侧空白区域，不能直接沿用坐标。
临时 QA 诊断记录该位置命中 `FIELDSET.mobile-theme-generation`。
加入被动触摸监听的诊断包可以滚动，因此诊断包本身不能作为原包通过证据。

最终仅在 `.mobile-theme-generation` 上指定 `touch-action: pan-y`，
使这一区域明确允许纵向手势。复用已有滚动面板、表单结构及 CSS 标准能力，
不新增依赖、触摸事件监听或自定义滚动算法。
这是对当前 WebKit 容器行为的局部修复，不声称已定位 WebKit 内部实现缺陷。

## 已排除的方案

| 对照 | 实际结果 | 决策 |
| --- | --- | --- |
| 原配置 `scrollEnabled: false`，未加诊断代码 | 主题生成空白处两次拖动未滚动；播放器进度从 5 秒拖到 8 秒成功 | 保留为失败基线 |
| 仅将 `scrollEnabled` 改为 true | 原失败位置能滚动，但播放器进度连续两次拖动无变化；点选进度可用 | 拒绝，全局配置已恢复 |
| 仅给主题生成 fieldset 指定 `pan-y` | 原失败位置可滚动 | 采用局部样式 |
| 给整个 `.sheet` 指定 `pan-y` | 原失败位置可滚动，但字幕折叠标题的拖动仍被识别为点按 | 不扩大样式范围 |

原生开关开启时还观察到：软键盘出现后旋转，焦点输入框可能被遮挡；
收起键盘可恢复页面。此项尚未与最终局部修复包完整对照，仍需独立验证。
不把它计入本次修复通过项，也不据此改动全局视口。

## 验证边界

- WebKit：12 项通过，覆盖 phone／ipad／ipad-narrow 的主题生成来源、
  配置保存／失败重试／凭据隔离，以及 Classic／心象字号触摸和拖动。
  命令：`npm run test:mobile:ui -- test/mobile-ui/ai-themes.spec.ts test/mobile-ui/font-size-touch.spec.ts --grep "manual missing-key|settings retain|lyric size responds"`。
- 移动资源构建：`npm run build:mobile`、`cap copy ios` 通过。
- 最终 Release 模拟器构建及安装通过，源码 `ffdd06afb9ad48e4a9b7376bad7a4ad274b21e8e`，
  125 项 public 资源与同步目录逐文件一致，原生 `scrollEnabled` 回读为 false。
  最终包实际手势通过：主题生成区域横／竖屏向上滚动、面板边缘返回顶部、
  进度条从 8 秒拖到 5 秒、空白点按隐藏和再次唤回控制器。
- 准确源码 [Mobile checks](https://github.com/Kun686/folia-Player/actions/runs/38187260394) 通过。
- 本次没有改 Swift、播放逻辑、Capacitor 配置或播放器外观。没有重跑并重复计入音频／网络测试数量。
- WebKit fixture 不能证明 Capacitor 原生手势。本次原生对照使用实际 CUA 手势，未通过脚本直接设置 scrollTop 或 input value。
- iPhone／物理 iPad、其他表单区域、完整键盘矩阵和长期使用仍未验收。

本地证据在 `.mobile-test-results/scroll-probe/`：`native-gesture.json`、
`fieldset-gesture.json`、`pristine-landscape-top.png`、`pristine-landscape-bottom.png`、
`enabled-landscape-bottom.png`、`enabled-portrait-bottom.png`、`ui-regression.log`、`build.log`。
`enabled-*` 是已拒绝的全局开关候选，不能当作最终代码的通过截图。

最终证据：`final-package.json`、`final-qa.json`、`native-build-signed.log`、
`final-landscape-bottom.png`、`final-portrait-bottom.png`、`final-seek.png`、`final-hidden.png`。
首轮构建使用 `CODE_SIGNING_ALLOWED=NO` 后虽然编译成功，但缺少模拟器 Mach-O 的
`__TEXT.__entitlements`，安全存储初始化拒绝；事后 ad-hoc 签名不能补上该段。
恢复上一轮的 Xcode 构建参数并重新构建后正常启动，保留首轮日志，不计为启动通过。
未通过清空 Keychain、删除曲库或卸载 QA 来绕过该失败。

诊断脚本仅留作 `scroll-diagnostic.debug.js`；临时对照 App 副本已清理，
模拟器保留的是最终无诊断代码的 QA 包，测试后终止并关闭模拟器。

回退只撤销 `mobile.css` 中这一条触摸策略，不需要存储迁移、修改原生配置或卸载 App。
