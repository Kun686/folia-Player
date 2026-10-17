# 播放器单入口与开关样式 · 2026-10-17

用户要求：合并播放界面顶部设置和三个点按钮，改善开关外观；保留已有功能。

## 实现

- 复用 `PlayerChrome` 原有“更多播放选项”面板，顶部只留一个三个点入口；歌词与动效、音效、音质、输出、队列拼贴、过渡与歌词工具仍可访问。仅撤掉重复快捷入口。
- 复用现有开关组件及状态保存逻辑，以 `data-ui-switch` 和移动端 CSS 统一外观。可见轨道 51×31px，白色滑块 27×27px，触摸区域 51×44px。关闭为灰色，开启为绿色，适配深浅色及减少动态效果。
- 原来移动端最小触摸高度直接放大轨道；现在触摸区域与可见轨道分开。覆盖 Tailwind 的独立 `translate`，避免与新 `transform` 叠加使滑块越界。
- 没有新依赖；没有修改播放、歌词时间或账户逻辑；桌面开关保持原样。AI、本地曲库、Navidrome 等已有入口保留。

## 验证与安装

| 项目 | 结果 |
| --- | --- |
| TypeScript、移动资源构建、Capacitor 复制 | PASS |
| WebKit 手机／宽平板／窄平板，单入口、深浅色开关、旋转、状态保存、减少动态效果 | 9 PASS，42.4 秒 |
| 首轮记录 | 3 PASS、6 FAIL；滑块叠加 Tailwind 位移。修正后执行一次重测，以上为最终结果 |
| 原生 Release 构建、签名、安装包资源 | PASS；145 份移动资源与 2 份生成的 Cordova 兼容文件，共 147 份一致 |
| 独立 iPhone 17 Pro 模拟器安装与启动 | PASS，`app.folia.validation.App`，iOS 26.5 |
| 原生界面观察 | 单个顶部入口、原工具菜单、歌词与动效面板、细长开关和已有网易云歌单已观察 |
| 个人 iPhone／实际 iPad、长播、真机拖动后歌词同步 | NOT_RUN；个人 iPhone 错位仍未解决 |

WebKit 为暂停的受控界面测试，复用已有真实 QQ 元数据，不代表真实平台音频验收。原生检查使用已登录的独立模拟器，没有启动新的音频播放。此次没有更新个人 App 或服务器。

安装沿用独立验证包 build 28，不能仅凭版本号辨认候选；原生可执行文件 SHA-256 为 `55cfbf72cc8aa3518dfe85af792902d2a55d8604c0155b4720d35d597b8cf374`，完整资源摘要见本批 `manifest.json`。

## 状态与证据

- 更新后完整 50 首队列、当前《表白》、15.684671 秒暂停位置、循环模式和音效与本批安装前快照一致。
- 本批采集 8 项持久化外观／歌词偏好。收尾 7 项保持，唯一差异是通过 UI 将上轮误触开启的“自动使用最佳歌词”关回，持久化读回为 `false`；没有恢复用户此前改变过的动画模式。
- 模拟器与暂停的 App 留给用户继续使用；临时镜像服务、浏览器页及构建／测试进程收尾清理。
- 证据目录：`.mobile-test-results/player-menu-switch-20261017/`。保留首轮与修正后日志、WebKit 截图、`manifest.json`、`installed-verification.json`、`final-preservation.json`。
- 实际模拟器截图：`mirror-unified-top.png`、`mirror-preference-restored.png`、`native-settings-restored.png`。早期 `native-switches.png` 和 `mirror-switches.png` 因滚动惯性捕获到面板下方，不能作为开关截图证据。

回滚只撤销本批 `PlayerChrome` 的重复入口合并、`PlayerPanel` 对应参数、四处开关标记和 `mobile-switch.css` 导入／样式；不要整体回退已有工作区改动或用户数据。
