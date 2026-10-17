<!-- QQ_SESSION_BODY_GUARD.md — stale QQ response protection across asynchronous body parsing. -->
# QQ 响应体读取后的登录保护

2026-10-15：复现并修正移动端 QQ 旧响应清除或覆盖新登录的问题。
这是受控并发测试确认的独立缺陷，没有证据表明它是 [QQ 偶发搜索空结果](QQ_SEARCH_STATUS.md) 的根因。
本批不修改平台 API、界面、音效或播放器规则，不新增依赖。

## 问题与最简修复

原生网络桥在返回 `Response` 前检查会话代次与凭据版本，但调用方随后还要异步读取 JSON。
如果在这段等待期间更换账号、取消二维码或退出，原 QQ transport 会继续执行副作用：
旧 HTTP 401 删除新 cookie，旧扫码 803 将新 cookie 覆盖为旧会话。原代码的两条复现均失败，证据保留。

- `src/services/mobileRuntime.ts`：增加可选的 `captureSession` 注入接口；网页/Electron 无移动 runtime 时保持原路径。
- `src/mobile/runtime.ts`：注入已有 `captureProviderSession`，继续使用同一套代次和版本计数，不新增全局会话状态。
- `src/services/onlineMusic/qqTransport.ts`：在请求开始保存会话校验器，地址解析及正文读取后检查；
  过期响应抛 `AbortError`，不执行401清除、803保存或返回旧数据。传输层自身清除格式无效的旧cookie后重新捕获版本，保留匿名请求语义。
- `src/services/onlineMusic/qqProvider.ts`：移除扫码确认后的重复凭据写入，由transport完成唯一保存。
  原先provider在transport之后的异步续执行可能再次覆盖刚替换的登录；正常扫码状态仍按原协议映射。

## 自动验证

证据目录 `.mobile-test-results/qq-session-body/`。

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| 原代码定向复现 | RED，2 FAIL | 旧401将新cookie清为null；旧803将新cookie覆盖为旧响应的值 |
| 修复后的相关Vitest | PASS，168项 | runtime、QQ transport及provider三个文件；包含更换/取消/换出再换回/退出、有效401/803、另一平台独立性、adapter不得二次提交 |
| 类型检查 | PASS | `node node_modules/typescript/bin/tsc --noEmit` |
| 移动构建及Capacitor复制 | PASS | `npm run build:mobile`；`node node_modules/@capacitor/cli/bin/capacitor copy ios` |
| 独立原生构建 | PASS | Release，原validation Bundle ID与Keychain身份，禁自动解析包 |
| 包/资源/签名核对 | PASS | 128个前端资源、2个空Cordova文件；dist、原生资源及安装包一致 |

单元测试中的延迟响应只用于可重复控制竞态，不计为真实平台、真实扫码或播放验收。
未故意在用户真实账号上制造凭据覆盖。正常401仍提示重新登录，正常803仍保存到原有Keychain队列。

独立测试包为 `app.folia.validation.App`，应用标识 `33GAKXJHL3.app.folia.validation.App`，
版本0.7.16/build28；没有创建个人发行版本。宿主SHA-256：
`0d2c269a1324894e7a9eba86afc4543b44fe9b5ad372632269178926126932b1`。

`red.log` 保留原始失败；`green.log`、`typecheck.log`、`build.log`、`xcode-build.log`保存检查结果。
`manifest.json`、`installed-manifest.json`记录本批源码、资源、宿主摘要及签名核对。
`baseline.json`、`installed-state.json`记录原位更新前后的51首队列完整JSON和音效设置比较。

## 已登录模拟器实际观察

独立iPhone 17 Pro／iOS 26.5原位更新后，网易云及QQ均仍显示已登录账号，
分别打开个人喜欢歌单，均由加载状态进入50首真实歌曲列表：网易云包含《莫愁乡》《记忆回溯》，
QQ包含《Power》《我怀念的》。没有新扫码、退出、收藏写入、入队或音频播放。
已恢复网易云标签及原QQ《我怀念的》122.688秒暂停画面；51首队列完整JSON、音效设置和绘光模式核对一致。

界面证据为 `live-netease-playlist.jpg`、`live-qq-playlist.jpg`、`live-final-player.jpg`；
最终状态与辅助进程清理记录见 `final-state.json`、`cleanup.json`。
这些观察证明本包正常账号恢复与歌单读取，没有用模拟歌曲代替真实平台结果；
账号切换竞态本身仍属于上面的逻辑测试边界。

## 发布与回退边界

个人mobile.28与服务器本批未更新。真实扫码重登、真机、音频采样/长播及完整UI未在本批重测；
此前后台通过记录属于其对应的候选包，不升级为本包全量验收。

如需撤回本批，只撤回新增会话校验接口与对应调用、恢复adapter重复写入的原代码；
不要整文件覆盖QQ搜索及其他已有改动。独立模拟器可原位安装
`.mobile-test-results/song-menu-stability/VerifiedValidation.app`回到上批包，不卸载或清空账号数据。
