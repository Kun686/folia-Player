<!-- REAL_ACCOUNT_VISUAL_PCM.md — actual signed-in songs, visible Lumiere stage, and native PCM measured together. -->
# 真实歌曲与绘光并行验收

2026-10-14：**PASS（原生 iPhone 模拟器短时并行检查）**。1 个 XCTest、0 失败、0 跳过。
原队列中的网易云《莫愁乡》和 QQ《我怀念的》各采样 8 个一秒窗口；全部窗口实际挂载 3 个画布，
有非零双声道音频和持续推进的原生时钟。两平台各两张实际舞台截图确认绘光背景、歌词在变化。
这补上[此前纯音频检查](REAL_ACCOUNT_PCM.md)画布数量为 0 的缺口；不代表真机、长时间稳定或全部动效验收。

## 实现与身份

- 只改测试代码：`LivePlaybackAcceptanceTests.swift` 将既有真实队列检查提取为共享方法，
  新增 `testSignedInQueueProducesPCMWithVisibleLumiere`；原单独音频用例保留。
- 复用 `OutputMeasurement`、生产 `GatewayClient`／播放器和既有 `jointFrameProbe`。
  `NativeJointLoadTests.swift` 只将帧采样 getter 开放给同一测试类扩展；没有运行其离线歌曲或模型用例。
- 新用例需显式 `FOLIA_LIVE_VISUAL_QA=1`，限定 simulator 和 `app.folia.validation.App`，
  检查打包生产页面、真实 GatewayClient、两平台已有会话与原有混合队列。
- 通过 Simulator 原有迷你播放条人工操作展开舞台，测试等待实际画布出现；没有注入假歌曲、响应、歌词，
  没有清理账号、队列、缓存、设置，也没有用 JS 点击或伪造页面。
- 每首从 30 秒位置开始采样，第 2、7 个窗口后截取实际舞台中央区域，排除浮动控制器。
  使用 Core Graphics 现有系统 API 缩为 96×96 像素比较，而非只比较 PNG 文件元数据。
- 测试构建和签名核对通过。128 个前端资源与旧候选、已安装 App 一致；
  主程序 UUID、46 个代码／数据节及签名区前的全部字节一致。新增测试 bundle 引起 App 重新签名，整体哈希变化有据。
- 设备：iPhone 17 Pro／iOS 26.5 Simulator，`9213032A-657A-40CD-BD2A-A3065ACCC8EC`。
  个人 iPhone mobile.28 未更新；未新增依赖或修改产品 UI／原动画算法。

| 对象 | SHA-256 |
| --- | --- |
| 当前签名 App 主程序 | `7c860fa3472e35ee07775b1a97dc94fa2cdf9cdaa469ef5f59742fe1519767f3` |
| FoliaNativeTests | `e441308c79ff008913296763b91a56b7c8c102c1cffef7de517aaa12412e5060` |
| LivePlaybackAcceptanceTests.swift | `488e04d40db42d30398aced6a3b2c4bc3d1dd33ab9eca3e2c63d999b9359600d` |

## 实测结果

| 项目 | 网易云《莫愁乡》 | QQ《我怀念的》 |
| --- | --- | --- |
| 歌曲标识 | `2711834126` | `000BO3xy4fd8BJ` |
| 一秒窗口／声道 | 8／2 | 8／2 |
| 每窗口输出帧数 | 48,000 | 48,000 |
| RMS 范围 | 0.210075–0.320840 | 0.027608–0.056859 |
| 每窗口时钟推进 | 1.002653–1.013333 秒 | 1.002653–1.002676 秒 |
| 每窗口画布数 | 3 | 3 |
| 两次舞台快照的变化通道比例 | 68.72% | 70.32% |
| rAF 回调数／后台次数 | 481／0 | 486／0 |
| 帧间隔中位数／95 分位 | 17／19 ms | 17／17 ms |
| 最大间隔／超过 50 ms 次数 | 66 ms／2 | 52 ms／2 |

帧统计是 WebContent 的 rAF 调度间隔，截图证明实际合成内容变化；它们不等于逐帧 GPU 呈现或歌词 ≤150ms 校准。
少量超过 50ms 的间隔仍存在，本批不将其表述为完全无卡顿。快照也会增加检查本身的开销。

原生当前曲、播放中、无结构化错误、音频非零、时钟推进、舞台持续挂载断言均通过。
各曲暂停后位置稳定、前后完整队列相等、服务器配置与两平台会话相等、绘光模式保持断言通过。
结束后正常启动并检查两平台登录和 51 首队列，最终 QQ 曲库、《我怀念的》暂停；不声称恢复测试前的精确进度。

## 证据与清理

目录：`.mobile-test-results/live-pcm-visuals/`。

- `build.log`：TEST BUILD SUCCEEDED；`current.xctestrun` 只选择新并行用例。
- `preflight.json`：签名、二进制和资源一致性；首次检查因整体签名哈希变化拦截，未运行音频。
  查明只有签名区变化后，修正校验并重试一次通过，没有放宽生产代码一致性检查。
- `iphone.xcresult`、`test-summary.json`：1 PASS／0 FAIL／0 SKIP，测试用时 78.487 秒，含等待 UI 展开。
  执行一次，外层上限 180 秒，没有重跑已通过的纯音频用例。
- `attachments/7BDB2515-35C4-4C15-8BB3-CF4BDE82445D.json`：16 个音频窗口、帧间隔及像素变化原始记录。
- `attachments/manifest.json`：四张实际舞台截图对应平台与采样时点；均已人工查看，确有背景和歌词。
- `validation.json`：汇总；`restored-netease.png`、`restored-qq.png`：正常重开后账号、队列与暂停界面。
- `cleanup.json`：测试和构建已退出，无临时诊断进程；正常 QA App 有意保留打开、暂停。

## 未完成边界

QQ 搜索仍为 [BLOCKED_UPSTREAM](QQ_SEARCH_DESKTOP_ADAPTER.md)，未部署未通过的服务器候选。
本次允许正常缓存，不证明绕过缓存的 CDN 请求、URL 过期续播或网络切换。
其余动效、整套设置 UI、真实退出清理、最新真机、网易云 30 分钟锁屏、耳机／蓝牙、
歌词误差及长期内存／温升仍待验收。iPad 按用户要求暂缓，既有 iPad 镜台音频断言失败不被本批覆盖。
整体移植未完成；本次无生产功能回滚项，回退测试只需移除新增并行检查并恢复共享 helper 可见性。
