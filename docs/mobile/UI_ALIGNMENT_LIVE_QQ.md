<!-- UI_ALIGNMENT_LIVE_QQ.md — shared mobile chrome and actual QQ observations, separated from device acceptance. -->
# 移动界面视觉对齐与真实 QQ 检查

2026-10-14，基线 `7d51e6ee50868e45031e8c9222c5223f3413fa0b` 加工作区修改。
用户本人完成 QQ 登录，并授权操作 Mac 模拟器；本批使用生产首页、真实服务和真实歌曲，未注入样本歌曲。
个人 iPhone 仍为 mobile.28，本批只原位更新独立模拟器包，没有更新个人 App 或服务器。

## 实现范围

复用原移动端 sheet、settings-group、主题颜色、原生选择器及原歌词／音效组件，按 apple-design 对齐界面。
最简方案是集中公共尺寸并修改移动外层样式，无新增依赖、无新增配置体系。

- 曲库、通用设置、歌词与动效、播放工具采用共同边距、卡片圆角、标题／标签／说明文字层级。
- 复选框不再继承文本框的 padding 和 44px 高度；44px 触摸区域由整行标签提供。
- 音效与歌词时间线沿用原组件，移动外层标题、内边距和圆角与其他弹层对齐。
- 窄屏调整公共留白；宽窗口底部播放条居中并限制宽度。保留全屏播放器及半透明控制器。
- QQ、网易云移至平台导航前部；旧入口仍保留。搜索结果标题显示查询词，避免误标为“我的歌单”。
- 浅色错误文本使用更深颜色。原视觉渲染器、歌词算法和音频规则未因这批 UI 修改而改变。

生产修改：`src/mobile/MobileApp.tsx`、`VisualSettings.tsx`、`mobile-shell.css`、`mobile-settings.css`、`mobile.css`。
工作区另有此前的 [R3F 帧引用修复](VISUALIZER_FRAME_LIFETIME.md)，它的未解决问题继续保留。

## 证据与结果

本地证据：`.mobile-test-results/ui-alignment-live/`；`validation.json` 记录边界，`bundle.json` 记录源码及资源 SHA256。
设备为 iPhone 17 Pro / iOS 26.5 Simulator，Bundle ID `app.folia.validation.App`，入口为生产 `index.html`。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | PASS，`typecheck-final.log` |
| `npm run build:mobile`、`cap copy ios`、Xcode Release build | PASS，分别见 `mobile-build-final.log`、`cap-copy-final.log`、`native-build-final.log` |
| 前端产物 → Capacitor → 原生 App | 128 个构建资源逐项相同；后两者额外含 Capacitor 生成的两个空 Cordova 文件 |
| QQ 登录／歌单 | 用户确认登录；UI 观察到真实歌单，两次模拟器原位更新后登录与 51 首队列保留 |
| 真实歌曲播放界面 | 观察到陈粒《小半》与 G-DRAGON《POWER》的播放时间、歌词推进、上一首、点击进度跳转与自然跨曲；搜索点播只追加一首，队列 50→51 |
| 搜索 | MIXED：首轮失败，独立诊断成功后 UI 重试显示真实结果；最终构建再次搜索及一次重试失败，不能标为稳定通过 |
| iPhone UI | 已检查深浅主题、曲库、搜索成功／错误、队列、歌曲菜单、全屏播放器、播放工具、动效设置、歌词工具、音效和时间线；首次 UI 构建观察竖→横→竖恢复 |
| 音频采样／真机声音 | 本批未捕获 PCM，UI 播放观察不等于音频测量或物理设备通过 |
| 网易云真实账号、iPad 本批 UI、物理设备新版 UI | NOT_RUN；模拟器网易云尚未登录，不能沿用历史手机反馈作为本包结果 |
| 全部子页／主题、iPad 多任务、辅助功能、真机触摸与长期性能 | NOT_RUN／未完成全面覆盖；本批不是整套 UI 最终验收 |

截图包括 `visual-settings-portrait.jpg`、`visual-settings-landscape.jpg`、`real-qq-player-landscape.jpg`、
`settings-light.jpg`、`audio-effects-light.jpg`、`lyric-timeline-light.jpg` 及搜索失败／恢复对照。
最终构建已核对修正后的搜索标题、音效与歌词时间线；浅色设置在重新安装后保持，检查完恢复午夜墨染。

## 搜索失败的事实边界

`qq-search.json`：同一 HTTPS 网关、原版匿名 QQ 搜索协议，HTTP 200、QQ 业务码 0／0、50 条结果。
`qq-search-final-diagnostic.json`：稍后同样查询 HTTP 200，但 `request.code=2001`，歌曲数组为空。
后者是业务失败，不能当作“没有匹配歌曲”。两次诊断仅保存状态／条数，没有平台会话或网关凭据。

独立请求说明服务存在成功与失败两种结果；没有捕获失败 UI 请求的原始响应，因此不能断言每次 UI 失败均为同一原因。
本批没有据此修改 QQ 参数、自动重试、登录态或服务部署。2001 的具体上游原因尚未知。
已有歌单与已加载歌曲仍可用于 UI 检查，搜索稳定性保持未通过状态。

## 后续验收

按当前范围先定位真实搜索失败，再验证网易云真实账号；继续补齐两平台页面、iPad 全套 UI 与原版动效的实际使用覆盖。
此前 iPad R3F QA 的 6 条音频断言失败及 WebContent 内存增长仍未解决，本次短时真实 QQ 观察不能覆盖它们。
网易云 30 分钟锁屏、耳机／蓝牙／网络切换、歌词误差和长期温升继续待真机证据。

本批不新增功能、不部署服务器、不更新个人 App。UI 回退仅涉及上述五个源文件的本批改动，无数据迁移。
