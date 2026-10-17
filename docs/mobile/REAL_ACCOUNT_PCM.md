<!-- REAL_ACCOUNT_PCM.md — approved real-account native output evidence and its acceptance limits. -->
# QQ／网易云真实歌曲短时音频验证

2026-10-14，**PASS（原生 iPhone 模拟器）**：1 个 XCTest 通过，0 失败、0 跳过。
使用已登录账号的原有混合队列，网易云、QQ 各采集 8 个一秒窗口，均有非零双声道 PCM，原生播放时钟持续推进。
这补上了真实歌曲的短时原生输出证据，不是听感、动效并行、真机或长时间播放验收。

## 执行范围与身份

- 用户明确批准此前两次测试入口失败之后额外执行一次。本批只执行这一次，命令退出码 0；
  XCTest 用时 20.260 秒，结果包总时段约 30.7 秒，外层上限 180 秒。
- 只操作独立包 `app.folia.validation.App`，iPhone 17 Pro／iOS 26.5 模拟器
  `9213032A-657A-40CD-BD2A-A3065ACCC8EC`。个人 iPhone mobile.28、服务器与平台歌单未修改。
- 源码基线 `7d51e6ee50868e45031e8c9222c5223f3413fa0b` 加现有工作区修改；
  沿用[播放工具入口固定](PLAYER_TOOLS_SHORTCUTS.md)候选，128 个前端资源一致。
  App 版本字段仍为 `0.7.16 / 28`，实际候选以资源清单及以下哈希为准。
- 复用 `NativeTests.testSignedInQueueProducesNativePCM`、生产 `GatewayClient`、原生播放器及 `OutputMeasurement`。
  不新增依赖，不生成歌曲或响应，不运行会替换账号／队列的离线样本。
- 修正执行配置以指向当前已签名 App 和测试 bundle，保留显式 opt-in 开关；
  `codesign --verify --deep --strict`、执行前后资源及二进制一致性检查通过。

| 内容 | SHA-256 |
| --- | --- |
| `ios/App/NativeTests/LivePlaybackAcceptanceTests.swift` | `06806a22167d3494ab1cac6c54e5c93283586b5862e65eaa2bf5dc1b8e50d73d` |
| 当前已签名 `App` | `1c66a20b41b36cb94f7ffe2bba1ad8175549ffe9f125c4121872e3ed4bc44a22` |
| 已编译 `FoliaNativeTests` | `a65ed834fc4206c5457b1c4ca064f47a011182138a29fd873308674019e933d2` |

## 实际结果

测试从原队列选择各平台第一首歌曲，在 30 秒位置开始测量，使用原生主混音节点采样。
没有将临时 URL 或 Cookie 写入报告。表中范围来自每个平台全部 8 个窗口，非全程平均值。

| 平台／真实歌曲 | 歌曲标识 | 窗口／声道 | 每窗口帧数 | RMS 范围 | 每窗口原生时钟推进 |
| --- | --- | --- | --- | --- | --- |
| 网易云《莫愁乡》 | `2711834126` | 8／2 | 43,200–48,000 | 0.196354–0.321571 | 0.992018–1.013333 秒 |
| QQ《我怀念的》 | `000BO3xy4fd8BJ` | 8／2 | 48,000 | 0.027608–0.056859 | 0.991995–1.013333 秒 |

- 各窗口当前歌曲不变、播放中、无结构化播放错误、输出帧数与有效 RMS 断言通过。
- 各曲暂停后的进度稳定断言通过。
- 测试前后队列内容、服务器配置、访问凭据和两平台会话相等断言通过；报告不包含秘密值。
- 退出测试后正常启动 App，两平台已登录界面及个人歌单可见，51 首队列保持。
  最终停在 QQ 曲库，《我怀念的》暂停；没有恢复到测试前的当前歌曲与位置，不将其称为完整播放状态恢复。

## 证据与清理

目录：`.mobile-test-results/live-pcm-rerun-preflight/`。

- `current.xctestrun`：只选择上述用例，使用当前 staged App；没有 fixture 注入。
- `preflight.json`：执行前准备记录，历史状态 `PREPARED_NOT_EXECUTED`；执行结果以之后的结果包为准。
- `iphone-approved.xcresult`、`test-summary.json`：1 PASS／0 FAIL／0 SKIP。
- `attachments/69F9D5AD-583C-4F92-8A7B-1B59404C858E.json`：16 个原始测量窗口。
- `validation.json`：从附件提取的范围及断言结果。
- `restored-netease.png`、`restored-qq.jpg`：正常启动后两平台登录和暂停状态。
- `exit-code.txt`、`cleanup.json`：退出码 0，无匹配的测试命令残留；正常 App 20693 有意保留运行且暂停。
  本批没有启动常驻镜像、日志捕获或开发服务器。

前两次执行因错误的 Capacitor 启动 URL／目录检查而未进入音频采样，原失败结果保留在
[真实播放界面与歌词重试](LIVE_PLAYBACK_FOLLOWUP.md)。本次成功不改写那两次失败，也不重复累计为三个通过用例。
本批没有产品功能改动，无需生产回滚；此前工作区修改保留，未提交或推送。

## 仍待验收

- **本批 NOT_RUN，后续已单独补验[绘光并行短时检查](REAL_ACCOUNT_VISUAL_PCM.md)。** 本文件对应所有采样窗口 `stageCanvases = 0`，播放器动效画布未挂载。
  [上一批播放中 UI 观察](LIVE_PLAYING_UI.md)与本次 PCM 是分开的证据，不能合并推导并行性能通过。
- **NOT_RUN：强制绕过缓存的网络播放。** 本次允许正常音频缓存，未证明每首歌曲都重新请求 CDN；
  不据此声称最新播放地址解析、地址过期刷新或实际网络切换通过。
- QQ 搜索间歇业务失败仍未解决；真实退出清理、整套 UI／所有动效设置、歌词误差 ≤150ms、
  耳机／蓝牙、最新真机包、网易云 30 分钟锁屏与长期温升／内存仍待验收。
- iPad 按用户选择暂缓；既有 iPad Diorama 音频断言失败仍保留，未由本次手机结果覆盖。
- 整体移植未完成，不把本次短时检查标为发布或完整功能等价验收。
