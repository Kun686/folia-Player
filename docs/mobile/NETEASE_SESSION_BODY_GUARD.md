<!-- NETEASE_SESSION_BODY_GUARD.md — NetEase stale authentication responses, regression evidence, and acceptance limits. -->
# 网易云响应体读取后的登录保护

2026-10-15：修正移动端网易云旧扫码结果或旧账号验证覆盖新凭据的问题。
复用 [QQ 登录保护](QQ_SESSION_BODY_GUARD.md) 接入的可选会话校验器，未新增依赖、会话状态或平台请求。
没有修改播放器、动画、UI、音质或服务器。个人 iPhone 仍为 mobile.28。

## 触发条件与修复

原生桥已检查网络请求返回时的会话版本，但调用方之后仍要异步读取正文。
若在读取旧扫码803响应或账号验证响应时取消、退出或替换凭据，原 adapter 仍会保存旧 cookie。
原代码两条定向复现均失败：当前替换后的凭据被旧响应覆盖；失败证据保留在 `red.log`。

`src/services/onlineMusic/neteaseProvider.ts` 在扫码查询和账号验证开始前捕获已有移动会话版本：

- 扫码响应读取完成后、保存 cookie 或返回结果前检查。
- 账号验证分别在 `/login/status` 和 `/user/account` 返回后检查，第一阶段过期时不再发第二个请求。
- 失效结果抛出 `AbortError`，不覆盖凭据。更换其他平台账号或重复保存相同 cookie 不误取消。

检查复用 `captureProviderSession` 的代次和凭据版本，换出再换回相同值仍能识别旧请求。
Web／Electron 未安装移动 runtime 时保持原路径。没有在 Swift 中复制平台规则。

## 验证与证据

证据目录：`.mobile-test-results/netease-session-body/`。

| 层级 | 结果 | 边界 |
| --- | --- | --- |
| 原代码竞态复现 | RED，2 FAIL | 旧扫码及账号验证覆盖新凭据；`red.log` |
| 相关逻辑测试 | PASS，255项／5文件 | 新增16项：3个等待阶段×4种失效操作，以及4种正常并发；`green.log` |
| 类型检查 | PASS | `node node_modules/typescript/bin/tsc --noEmit`；`typecheck.log` |
| 移动构建／资源复制 | PASS | `npm run build:mobile`、`capacitor copy ios` |
| 原生 Release 构建 | PASS | 独立 validation 身份、禁自动解析依赖；`xcode-build.log` |
| 包／资源／签名 | PASS | 128个前端资源和2个空Cordova文件；dist、复制资源、已安装包逐项一致 |
| 已登录模拟器真实歌单 | PASS，实际界面观察 | QQ／网易云仍显示原账号，个人歌单各加载50首；无模拟歌曲 |
| 本包重新扫码、音频采样、后台长播 | NOT_RUN | 本批没有退出账号、播放或更换队列 |
| 真机、iPad、完整UI／性能验收 | NOT_RUN | iPad按用户要求暂缓，个人App未更新 |

逻辑命令为 `node node_modules/vitest/vitest.mjs run -c vitest.config.ts`，文件列表：
`test/unit/mobile/neteaseSession.test.ts`、`test/unit/mobile/runtime.test.ts`、
`test/unit/onlineMusic/neteaseProvider.test.ts`、`test/unit/onlineMusic/loginStatusFailure.test.ts`、
`test/unit/library/core/providerLoginSession.test.ts`。
受控延迟响应仅用于复现竞态，不作为真实平台或扫码验收。

实际设备为 iPhone 17 Pro / iOS 26.5 Simulator，UDID `9213032A-657A-40CD-BD2A-A3065ACCC8EC`。
Bundle ID `app.folia.validation.App`，application identifier `33GAKXJHL3.app.folia.validation.App`，
版本0.7.16/build28（独立QA身份，不是新的个人发行版本）。主二进制SHA256：
`33afcd48653e59242b425e2e4e3adba4e18a8b99cd8ea489b7744865e7fa07b8`。

`manifest.json`、`installed-manifest.json` 保存源码与资源摘要、包身份核对。
真实歌单截图为 `live-netease-playlist.jpg`、`live-qq-playlist.jpg`，分别包含《莫愁乡》《记忆回溯》与《Power》《我怀念的》。
最终回到原绘光播放器，《我怀念的》122.688秒暂停；原51首队列完整JSON、索引4和音效设置一致。
见 `baseline.json`、`installed-state.json`、`final-state.json`、`live-final-player.jpg`。

## QQ搜索与发布边界

本缺陷与QQ偶发空搜索无已证实因果关系。用户额外批准的一次60秒SSH只读检查到达密码提示，
但在提交输入前已超时退出124；未完成密码验证、未读到部署路径、未修改服务器，也未自动再连。
脱敏记录为 `ssh-readonly-result.json`；QQ问题继续见 [搜索状态记录](QQ_SEARCH_STATUS.md)。

本批未卸载应用、清除账号或更新物理iPhone。真实扫码竞态、真机长播、过期URL恢复、蓝牙／网络切换、
歌词误差和完整动画／设置UI仍待验收；此前后台测试只证明其对应候选包的边界。
临时预览页及镜像辅助进程已清理，正常模拟器App按授权保留暂停，见 `cleanup.json`。

回退仅撤回本批 adapter 中的移动会话检查，不覆盖其他网易云改动。
独立模拟器可原位安装 `.mobile-test-results/qq-session-body/VerifiedValidation.app` 回到上批包，
保留现有账号数据；不卸载或重置 Keychain。
