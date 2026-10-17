<!-- QQ_SEARCH_LIVE_DIAGNOSIS.md — real anonymous QQ search evidence and scoped error presentation repair. -->
# 真实 QQ 搜索诊断与错误提示

2026-10-14，基线 `7d51e6ee50868e45031e8c9222c5223f3413fa0b` 加工作区修改。
承接 [移动 UI 对齐](UI_ALIGNMENT_LIVE_QQ.md)。用户已完成独立模拟器 QQ 登录并授权实际使用测试。
本批没有修改服务器、个人 mobile.28、QQ 搜索参数、重试策略或原歌词／动画算法，也没有新增依赖。

## 结论

最新：[QQ 认证搜索](QQ_AUTHENTICATED_SEARCH.md) 复用库内会话与设备参数，已通过候选与正式 HTTPS 分页检查并上线，
独立模拟器真实搜索及搜索后播放器也已观察。下文匿名 Lite／Desktop／旧 CGI 均是历史诊断，不是当前方案。

后续新增[移动网关 Desktop 搜索适配](QQ_SEARCH_DESKTOP_ADAPTER.md)：独立协议和本机生产网关连接真实 QQ 的
中文／英文分页检查已通过。随后 SSH 已恢复，但服务器候选真实请求仍返回 2001，因此未切换生产或做修复后的 App 验收。
下文保留原 Lite／旧 CGI 诊断；没有把替代协议成功当作 Lite 2001 的根因证明。

QQ 搜索存在间歇业务失败，具体上游原因仍未确认。新包实际搜索 `Power` 已显示真实结果，
QQ 登录和 51 首队列保留；这一次成功不构成搜索稳定性通过。
本批修复的是错误含义：匿名搜索被拒绝不再笼统提示检查登录，按平台不可用、登录要求、响应损坏或网络失败分别提示。

## 实际请求证据

证据目录：`.mobile-test-results/qq-search-live-diagnosis/`。诊断只保存状态码、结果条数、耗时与请求体摘要，
没有写出 gateway token、平台会话或完整响应。使用原协议查询真实歌曲名称，没有注入样本歌曲。

| 检查 | 观察与边界 |
| --- | --- |
| 原版匿名 Lite 搜索，经个人 HTTPS 网关及 Mac 直连 | `baseline.json`：两路均 HTTP 200，顶层 code 0，request.code 2001，无歌曲；命令以失败退出 |
| 仅改 search_id 的一次对照 | `fixed-id.json`：网关返回 50 条，Mac 直连仍 2001；命令仍失败，不能说明固定 search_id 可修复问题 |
| 已安装 QQ API 3.1.4 的旧搜索接口 | `legacy-direct.json`、`legacy-library.json`：原协议及其自带 transport 都返回 code 0、空列表，没有形成可用替代方案 |
| 原项目当前源码对照 | 保存的 `upstream-qqLyricProvider.ts` 使用相同 Lite 搜索协议；没有发现可直接复用的上游修复 |
| 当前独立 iPhone 模拟器生产页面 | `qq-search-current-success.jpg`：实际查询 Power 成功，显示 G-DRAGON、Little Mix／Stormzy 等结果，登录保留 |

旧 UI 失败请求没有逐次捕获原响应，不能认定所有失败均为 2001。SSH 只读检查因认证失败未执行，
未据此推断服务器运行状况，也没有远程部署。诊断失败的一次条件变更重试已用完，没有循环探测。

## 最小修复与验证

复用 `OnlineProviderError`、既有 catalog 请求代次和 i18n。provider 保留结构化失败，catalog 传递错误分类，
移动界面只展示本地化提示，不渲染上游原文；新请求／退出清理分类，旧失败不能覆盖新查询。
匿名业务失败不清除账号。生产数据仍经过 Omni，Web／桌面的原有回退行为保留。

| 验证 | 结果 |
| --- | --- |
| 修复前逻辑复现 | 4 FAIL／27 PASS，`unit-red.log` |
| QQ lyric provider、QQ provider、catalog session | 116 PASS，`unit.log`；包含实际 2001 响应形状、账号保留、恢复及迟到失败隔离 |
| 类型检查、移动构建、Capacitor copy、Xcode Release build | PASS，`typecheck.log`、`build.log`、`copy.log`、`native-build.log` |
| 当前包资源 | `bundle.json`：128 个资源在 dist-mobile、Capacitor、原生 App 中一致；额外两个空 Cordova 文件为 Capacitor 产物 |
| 新错误提示的真实失败页面 | NOT_RUN：安装后这次真实搜索成功，没有人为制造平台失败；逻辑通过不能替代实际错误界面观察 |

设备：iPhone 17 Pro / iOS 26.5 Simulator，`app.folia.validation.App`，版本字段 0.7.16 / 28。
版本字段沿用 QA 配置，不能凭版本号认定与个人 mobile.28 是同一源码；当前源码与资源哈希见本批 `bundle.json`。
本批未采集 PCM，没有新增真机播放证据。该阶段网易云模拟器二维码已生成、账号验收尚待扫码；
用户随后完成登录，真实歌单／搜索／双向队列观察及最终界面包见 [后续记录](NETEASE_LIVE_UI_ALIGNMENT.md)。
本文件的 `bundle.json` 保留分组前包身份；最终分组包使用 `bundle-layout-final.json`，不要混用。

## 2026-10-14 缺失列表的错误分类补修

`normalizeQQLyricSearch` 原先对缺失／非数组的 `item_song` 抛出普通 Error，经过 catalog 后
丢失错误类别，界面落入“请检查连接”的提示。改为复用 `OnlineProviderError('invalid-response')`，
使用已有“音乐平台返回的数据不完整”翻译。显式空数组仍是正常空结果；Web／桌面的回退保留。
没有修改搜索请求、登录态、自动重试或接口选择，也不将这项修复当作 2001 原因的修复。

证据 `.mobile-test-results/qq-search-response/`：修复前 11 FAIL／21 PASS，修复后 QQ 歌词 provider、
QQ provider、catalog 三组共 117 PASS；类型检查 PASS。测试为协议边界回归，不是真实平台验收。
随后已随 [动效设置文字修复](VISUAL_SETTINGS_CONTRAST.md) 安装到独立模拟器；真实失败页面仍 NOT_RUN。

同时通过官方 QQ 网页实际查询 Power，页面要求登录，关闭登录弹窗后未得到可用的匿名搜索结果。
没有登录官方网页、添加依赖或修改服务器；该观察仅排除本次已验证的匿名网页替代路径，
不能说明 Lite 2001 的根因。临时网页已关闭，先前失败诊断不再循环重试。

## 未完成项

搜索稳定性、网易云真实账号完整流程、iPad 新版全套 UI、物理设备、网易云 30 分钟锁屏、
耳机／蓝牙／网络切换、歌词误差及长期动画性能仍待验收。
此前 R3F 检查的 iPad 音频断言失败及 WebContent 增长继续保留，不被本批 QQ 观察覆盖。

回退范围为 QQ provider 错误类型、catalog 错误字段、`CatalogTrackFeedback` 及相关本地化和装配；
无需数据迁移或服务重启。此前 UI 与 R3F 工作区改动应分别保留，不整文件回退。
