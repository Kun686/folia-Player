# 原版 AI／封面主题生成移植

2026-10-12。开发源码已接入，提交 `b99cc38`；触摸按钮补齐为 44pt 的后续源码为 `2939135`。个人安装仍是 mobile.28，未更新。本阶段不代表真实 AI 服务或真机验收。

## 已接入

- 「歌词与动效 → 歌曲主题生成」：原版 AI／封面来源、手动生成、取消、默认关闭的自动生成；自动生成等待歌词和主题缓存读取完成，每首歌本次运行只自动尝试一次（保留最近 256 首）。失败可手动重试。
- 「AI 服务设置」同时可从播放器及通用设置进入：Gemini 与 OpenAI Compatible、API URL、模型、temperature、流式响应。默认模型来自当前桌面源码，不表示已经确认线上可用性。
- 原提示词、Gemini schema、请求构造与 SSE 解析从 Electron 原样提取为 `shared/*.mjs`。CJS 入口通过项目要求的 Node 24 同步加载 ESM，无第二份算法；原 20 个函数／常量声明逐字对照基线 `6b91b73` 通过。
- 原版协议协商只重试明确的 400／422 参数拒绝；认证、限流和服务器错误不自动重试。没有密钥时使用原 `extractColors`／`buildBuiltinDualTheme` 回退，其他 AI 错误明确提示。
- 沿用原歌曲身份、缓存、主题注册表和偏好键。事务保存来源为 manual／auto／fallback，保留自定义主题优先级；自动生成与来源随原外观短码导入导出。
- 原生歌曲世代、手动选择世代、AbortController 和原生请求 ID 联合防止迟到覆盖。切歌、取消、配置变化、手动选择或进入后台时停止生成；后台播放不依赖 AI。歌词与封面原有显示逻辑仍复用原实现。

## 凭据与网络边界

`NativeAISettings`／`NativeAIClient`／`NativeAIBridge` 使用 Foundation、URLSession 和已有 SecureStore，无新生产依赖。

- 密钥仅在已有设备本地 Keychain 中持久化，独立于音乐服务会话；读取配置只返回是否有密钥。输入框留空保留、勾选清除；更换 OpenAI 服务域名或端口自动清除旧密钥，允许同时写入新密钥。
- 配置按 revision 原子写入；保存失败保留草稿和之前配置，保存成功取消已有请求。
- JS 不提供 URL、Cookie 或 HTTP header。原生只访问所配置的 HTTPS endpoint，拒绝 userinfo、query、fragment 和重定向；音乐网关凭据与平台 Cookie 不进入 AI 请求。
- 独立 ephemeral session、无共享 Cookie／HTTP 凭据缓存；请求 JSON ≤256 KiB、响应读取期间限 1 MiB、最多两个请求、120 秒资源期限。响应和密钥不记录日志，错误只暴露固定本地错误码；HTTP 错误体中的已保存密钥在返回 JS 前脱敏。
- 用户主动生成或开启自动生成后，歌词／纯音乐标题会发给配置的服务，界面明确说明费用与数据去向。测试未调用真实 AI 服务。
- 封面读取增加 15 秒期限、取消及异常收尾；取色算法不变。

## 验证

| 边界 | 结果与证据 |
| --- | --- |
| 类型检查 | PASS；`.mobile-test-results/ai-final-typecheck.log` |
| 相关逻辑／桌面原请求回归 | PASS；92 项，`.mobile-test-results/ai-logic-final.log` |
| WebKit 手机／宽 iPad／窄 iPad | PASS；27 项生成流程 + 21 项已有歌曲主题回归；`ai-ui-phone.log`、`ai-ui-ipads.log` |
| 原生独立 iPad XCTest | PASS；10 项 Keychain、设置校验、真实 URLSession+URLProtocol fixture、限额、取消和并发；`ai-transport-final.xcresult` |
| 重定向 | PASS，仅 delegate 回调拒绝测试；真实网络重定向 NOT_RUN |
| 源码复用 | PASS；20 个声明与基线完全相同，`ai-shared-parity.json`；Node 24.17.0 CJS→ESM 加载通过 |
| 打包及独立 QA UI | PASS（限定范围）；Release 构建、独立 iPad QA 启动、配置保存、离线主题生成和重启恢复，见下文 |
| 最终按钮触摸尺寸 | PASS；3 个窗口项目检查宽高均 ≥44 CSS px，并重跑配置流程，`ai-touch-ui.log` |
| 准确源码 CI | PASS；[`2939135` Mobile checks](https://github.com/Kun686/folia-Player/actions/runs/38185816869)，包含类型检查、移动逻辑与构建 |
| 真实 Gemini／OpenAI／兼容服务 | NOT_RUN；没有使用用户密钥，没有付费推理 |
| 个人 iPhone／物理 iPad | NOT_RUN；没有更新个人 App |
| Electron 实际启动 | NOT_RUN；本机未安装 Electron 二进制，已做共享逻辑回归与 Node 24 加载检查 |

首轮原生 Release 测试因未启用 testability 未执行，改用 Debug 后通过。首轮 WebKit 暴露 CJS 包装加载失败，改为单一 ESM 实现后通过；中间测试把“保存”定位为服务器原有的“保存连接”，已给 AI 设置独立文案并重跑。保留失败日志，不计入通过结果。

UI 测试中的 AI 输出与凭据均为生成样本。已有歌曲主题回归故意使用无服务器 QQ 歌曲身份，会打印 fixture 歌词读取错误；它们不代表在线平台验证。

独立 QA 使用 `app.folia.validation.App`／iPad Pro 11-inch M5／iPadOS 26.5。`b99cc38` 原生页面保存 OpenAI Compatible 配置（仅 QA 模型 `QA-local-only`、temperature 0.4、空密钥），在已有合成歌曲 First 上选择封面来源，生成并显示“主题已保存并应用”。终止后原位安装 `2939135` 并重开，配置数值、已生成歌曲主题、cover 来源和关闭的自动生成状态均保留。安装包 `public/build-identity.json` 回读准确为 `29391350152465f2194bb3470e4cac99c628a817`。

证据：`.mobile-test-results/ai-qa-evidence.json`、`ai-qa-settings-saved.png`、`ai-qa-generated.png`、`ai-qa-settings-restored.png`、`ai-qa-theme-restored.png`、`ai-touch-build.log`、`ai-touch-native-build.log`。构建仍显示 mobile.28 的开发版本号，**独立 QA Bundle ID 与个人安装不同**，未改个人 `BUILD_RECORD.json`。

旋转后布局能显示并能返回竖屏，但 CUA 的横屏滚动／拖动未观察到页面移动；不能据此判定是输入工具还是 App 滚动问题，完整横屏触摸验收保持 UNVERIFIED，后续需针对该点诊断。测试结束已关闭本次启动的模拟器，无测试服务器或日志采集器保留。

## 回退与剩余工作

关闭自动生成即可停止自动请求；封面来源完全复用已有本地能力。个人包没有变化。需要回退开发代码时以此改动前 `6b91b73` 为基线，保留 Keychain 和主题缓存，不能卸载个人 App。

真实 AI 模型兼容性、真机新入口、长期运行仍待验证。远端主题同步与完整 Automix 的生产接入不属于本阶段，仍未完成。
