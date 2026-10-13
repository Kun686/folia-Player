<!-- SETTINGS_LAYOUT.md — focused mobile settings layout; automated evidence is separate from device acceptance. -->
# 设置页滚动与布局

2026-10-13—14。按 [CURRENT_SCOPE.md](CURRENT_SCOPE.md) 继续 QQ／网易云、原版动效、设置 UI。
本批整理已有界面，不新增生产依赖、配置状态或命令；原生播放和平台请求逻辑没有修改。

## 已实现

- 主设置按外观与语言、播放、在线歌词、音乐服务连接、播放缓存分组，既有其他入口放在末尾。
  所有开关、默认值、保存／错误恢复继续使用原组件和 store；本地音乐、同步、AI 等没有扩展。
- 设置页、歌词与动效页、更多播放选项固定标题和关闭按钮；内容在独立区域滚动。
  用普通 flex 布局分开标题和内容，不引入叠加模糊层或持续测量布局的动画循环。
- 从睡眠定时／主题编辑等子页面返回时，恢复父页滚动位置；仅在当前设置会话内保留，不写入持久配置。
- 键盘避让以实际内容滚动区计算，防止聚焦字段被固定标题遮挡；短窗口减小标题上下留白。
- 中文、英文、印尼语分组标题复用原 i18n 装配；深浅色使用现有移动端主题变量。

源码入口：`src/mobile/SettingsSheet.tsx`、`VisualSettings.tsx`、`PlayerChrome.tsx`、
`mobile-settings.css`、`useSheetScroll.ts`、`useSheetViewport.ts`、`locale.ts`。
全屏歌词舞台、控制器材质与自动／点击隐藏逻辑、14 个原版 renderer 和音频算法保持原实现。

## 复现与证据

证据目录 `.mobile-test-results/settings-layout/` 不提交仓库。

- `before/`：原界面滚动到底部后，关闭按钮中心无法通过 `elementFromPoint` 命中，真实 WebKit 断言失败；保留原截图。
- `targeted/`：固定标题、旋转、既有字号触摸与键盘用例 15 PASS；3 个新增动效页用例因标题关闭与某设置的“关闭”同名而失败。
  限定到直接标题后修正；没有改动原设置按钮行为。
- `final-targeted.json`：新增键盘用例及既有键盘用例 9 PASS，3 个动效／播放工具标题用例 PASS。
  新增截图／返回用例中的精确标签、主题编辑“取消”文案和初始已可见按钮的滚动假设随后修正。
- `corrected-layout.json`：12 个布局用例全部 PASS，覆盖三个窗口尺寸、深浅色、旋转、两个父页的返回位置和标题触摸命中。
- `final-targeted.log` 和 `corrected-layout.log` 保留失败与修正记录，重复运行不累计为唯一测试数。
- `regression.json`：140 PASS、7 SKIPPED。覆盖原版 14 种歌词模式切换、暂停／拖动、全屏舞台、控制器隐藏／唤回、减弱动效、背景变化、字号触摸，
  以及连接保存／失败、语言、队列、在线歌词、睡眠、启动续播设置。包含上述 12 个布局用例，不重复计数。
- `compact.json`：3 PASS，三个项目分别循环 320×568、568×320 和原窗口尺寸，检查三种原语言的内容区无横向滚动、标题可点击。
- 合并最终布局、键盘和回归证据：**152 个唯一 WebKit 用例 PASS，7 SKIPPED**。
  跳过项为 4 个已由 phone 项目执行的重复尺寸矩阵，以及 3 个独立模糊探针不被当前 WebKit 合成器渲染的实例；后者不是磨砂效果通过。

主要运行命令：`npm run test:mobile:ui -- settings-layout.spec.ts sheet-viewport.spec.ts`，以及
`chrome.spec.ts layout.spec.ts material.spec.ts motion-preferences.spec.ts visualizerRuntime.spec.ts font-size-touch.spec.ts`
和 `gateway-settings.spec.ts language-preference.spec.ts queue-preference.spec.ts online-lyric-preference.spec.ts display-sleep.spec.ts sleep-timer.spec.ts launch-playback.spec.ts` 回归。
完整参数、原始结果与源文件摘要保存在证据目录。

`npm run typecheck`、`npm run build:mobile` 均 PASS，日志分别为 `typecheck.log`、`build.log`。
移动构建保留既有大 chunk 提示，未据此改动原 renderer 或拆分算法。构建是未安装的前端资源验证；
提交前的 `build-identity.json` 与随后提交 SHA 分别记录在 `delivery.json`，不宣称两者字节相同。

测试数据使用既有受控传输；回归中的本地短音频仅作原渲染器材料，不代表继续开发本地曲库。
模拟 `visualViewport` 事件用于验证键盘布局逻辑，不是 iOS 软件键盘或物理设备证据。

## 交付边界

- 本批原生模拟器、物理 iPhone／iPad、真实账号、最新包安装、真实软件键盘／VoiceOver：`NOT_RUN`。
- 网易云 30 分钟锁屏、耳机／蓝牙／网络切换、歌词误差 ≤150ms、长期帧率／内存／温升：仍待独立验收。
- 界面截图已人工检查，最终触摸手感和视觉偏好仍需用户在实际 App 验收。
- 个人 App 仍是 mobile.28；服务器、签名身份、凭据和已确认的个人安装记录未改变。
- 如需回退，仅回退本批布局提交；无数据迁移、缓存格式或依赖回滚步骤。
