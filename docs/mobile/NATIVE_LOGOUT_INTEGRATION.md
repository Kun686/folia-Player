<!-- NATIVE_LOGOUT_INTEGRATION.md — production session runtime and real native cleanup; isolated simulator evidence. -->
# QQ／网易云退出的原生整合验证

2026-10-14，生产源码基线 `6b5fe22bee9f02a54b9986a73c87c84aefb5dd64`。
继续验证 [取消桥失败时的退出修复](LOGOUT_CANCELLATION.md)，遵循 [当前范围](CURRENT_SCOPE.md)。
本批只增加 QA 打包入口、原生测试及工程注册；生产行为、界面、依赖和默认值没有改变。

## 实际执行路径

`dev/mobile/build-online-session-qa.mjs` 使用已安装 Vite，将原 `runtime.ts` 与 `mobileRuntime.ts`
打包为独立 IIFE。`OnlineLogoutIntegrationTests.swift` 在 WKWebView 中运行该产物，通过真实
Capacitor 调用 `bootstrap`、`saveSession`、`clearSession`，读写模拟器 Keychain，并使用原生播放器、
音频／封面／歌词缓存实现。

独立包为 `app.folia.validation.App`，Release／arm64；离线首页不加载完整 React 页面。
测试只允许模拟器和该 Bundle ID，发现已配置服务器或非空平台凭据即拒绝运行。
使用合成 QQ／网易云会话、已有 URLProtocol 样本和临时缓存；结束时恢复原空凭据并移除测试缓存。
没有连接真实音乐平台、访问用户账号或更新个人 App。

两平台分别覆盖正常取消、取消桥拒绝，共四个场景：

1. 同时建立两个平台的原生凭据与三类缓存，在暂停队列中放入两平台同 ID 歌曲。
2. 留住一个旧请求响应和一次已排队保存，再触发退出。保存原值以避免 `saveSession` 提前清理歌词。
3. 验证执行顺序为取消、保存完成、清理；取消失败仍完成后续清理，并向调用者返回原取消错误。
4. 放行旧响应，验证前端收到 `AbortError`；重新 bootstrap 和新建凭据存储实例，验证该平台不会恢复。
5. 验证当前歌曲被移除、播放意图停止、该平台音频／封面／歌词缓存清空，而另一平台账号、队列歌曲与缓存保留。

请求响应、取消失败和保存延迟是受控注入；凭据读写、清理及缓存操作没有被替换为 mock。
正常取消会调用原生 `cancelRequests`，但旧请求本身由 JS 持有，因此不声称此用例单独证明 URLSession 任务取消。

## 结果

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| QA JS、原生 Release 构建、签名校验 | PASS | 原有依赖；QA JS 为 13,206 字节，不进入生产前端 |
| iPhone 17 Pro／iOS 26.5（23F77） | 4 PASS，0 FAIL，0 SKIPPED | 两平台正常退出及取消桥失败 |
| iPhone 相关原生回归 | 6 PASS，0 FAIL，0 SKIPPED | 实际 Keychain 迁移／重开、存储故障注入、URLSession 旧响应、离队当前曲退出、串行缓存账号隔离、流式暂停／拖动／中断／平台移除 |
| iPad Pro 11-inch M5／iOS 26.5（23F77） | 4 PASS，0 FAIL，0 SKIPPED | 与首行 iPhone 四例相同，不重复计为新覆盖 |

共 10 个唯一原生用例通过，跨两种模拟器执行 14 次，无失败或重试。
本批没有重新运行前端全量逻辑／WebKit；对应结果保留前批身份，不叠加计数。

## 证据与复现

证据位于 `.mobile-test-results/native-logout/`，包括 QA 构建、原生构建、签名产物、命令 JSON、
XCTest 结果包与摘要。`package.json` 保存生产源文件、QA JS、原生与 XCTest 可执行文件的 SHA-256；
`delivery.json` 记录最终提交、CI 与清理状态。

先用 `node dev/mobile/build-online-session-qa.mjs` 生成 QA JS，再执行既有隔离 xcconfig 的
`xcodebuild build-for-testing`。复制构建包，在副本的 `public/` 放入 QA JS 和离线首页，重新签名，
将生成的 `.xctestrun` 的 TestHostPath／TestBundlePath 指向副本；不改生产资源。
`*-command.json` 保存完整 `test-without-building` 选择器，关闭并行测试、每例最多 45 秒，
外层构建／测试使用 `codex-bounded 600`。测试类要求 `ENABLE_TESTABILITY=YES`。

## 验收边界

这是生产会话运行时到真实原生存储／清理的整合验证，不是完整 React 退出界面、真实平台注销或物理设备验收。
新增四例的队列处于暂停状态，不单凭它们声称音频输出通过。前端页面证据另见前批 69 项 WebKit 记录。
操作系统 Keychain 写入故障仍由既有存储故障注入用例覆盖；未在系统 Keychain 人为制造写入故障。

个人 App 仍为 mobile.28，服务器未更新。最新源码真实账号、物理 iPhone／iPad、网易云 30 分钟锁屏、
耳机／蓝牙／网络切换、歌词精度与长期动效性能仍为 `NOT_RUN`，整体交付未完成。
本批无数据迁移；回退新增 QA 入口、测试注册与文档即可。
