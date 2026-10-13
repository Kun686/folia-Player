<!-- NATIVE_CONNECTION_RECOVERY.md — packaged connection recovery with isolated native fixtures; not live-platform acceptance. -->
# 启动连接恢复的原生补验

2026-10-14；生产前端基线 `145a8680e727641dadf93fc179b09f56a103e7da`。
补验 [启动连接恢复](CONNECTION_RECOVERY.md)，遵循 [当前范围](CURRENT_SCOPE.md)。
本批只新增 `ConnectionRecoveryTests.swift`、测试目标注册与证据文档；生产代码、依赖和个人安装包未改。

## 实际路径与隔离

独立 `app.folia.validation.App`，Release／arm64，内嵌版本标签 `0.7.16-mobile.28`。
该标签不代表已更新个人 App。生产 `index.html` 在 QA 副本中保存为 `mobile.html`，首页换成离线测试入口；
全部 128 个前端资源与该基线的 `dist-mobile` 一致（首页按上述映射核对），副本重新签名并通过校验。

两个用例分别从完整 React 页面点击 QQ／网易云与“重试”，经真实 Capacitor、原生 URLSession 和模拟器 Keychain：

1. 首次服务检查返回受控断网错误，页面提示失败、登录禁用。
2. 点击重试后服务检查成功，原 Omni／provider 流程读取受控账号与个人歌单，并显示正确平台的名称。
3. 断言错误消失、服务检查恰好两次；新建 `NativeGatewayStore` 后确认两平台会话、服务器、访问凭据和 scope 保留。
4. 等待两帧及 WebKit 绘制完成，再用 `WKWebView.takeSnapshot` 保存页面；结束时恢复原空凭据与队列，回到离线首页。

测试拒绝物理设备、非 QA Bundle ID、已有服务器或非空平台会话。使用生成的临时访问凭据和合成会话，
只有 `.invalid` 主机与预期账号／歌单路由可返回样本。测试目标临时交换
`URLSessionConfiguration.ephemeral` getter，为真实会话配置测试 URLProtocol；结束时恢复。
这使生产 `GatewayClient` 无需为测试开放接口。该类须单独运行、关闭并行测试；拦截代码不进入 App 生产目标。
网络错误及平台响应仍是注入样本，不能称为真实断网、扫码或音乐平台成功。

## 结果与失败记录

两种模拟器均为 iOS 26.5（23F77）。证据目录 `.mobile-test-results/native-connection-recovery/`。

| 执行 | 结果 | 说明 |
| --- | --- | --- |
| iPhone 17 Pro 初次 | 0 PASS／2 FAIL | 全局 URLProtocol 注册未接管网关会话，另有旧页面读取竞争；属于测试装配失败，不能判作产品缺陷 |
| iPhone 修正后的一次重试 | 0 PASS／2 FAIL | 原生恢复与凭据断言执行后，`XCUIScreen` 截图被拒绝：`Not authorized for performing UI testing actions`；以结果包为准，不采信日志尾部的零测试通过信息 |
| iPad Pro 11-inch M5，改用 WebView 截图 | 2 PASS／0 FAIL／0 SKIPPED | 首张网易云截图抓取过早，仍为恢复前画面；不作为恢复后的视觉证据 |
| iPad 补绘制等待后的最终复核 | **2 PASS／0 FAIL／0 SKIPPED** | 两张最终截图均已人工查看，与账号／歌单断言一致；同两例重复执行，不累计为四项新覆盖 |
| 最终测试版本在 iPhone | **NOT_RUN** | 遵守失败命令至多重试一次的限制，本批未第三次运行 iPhone 套件 |

最终有效测试产物为 `QA-painted.app`、`package-painted.json`、`native-painted.xctestrun`、
`ipad-painted.xcresult` 与 `ipad-painted-summary.json`。历史命名 `QA-final.app` 早于绘制等待修正，
不能当作最终产物。早期失败、旧截图与日志全部保留。

最终图片位于 `ipad-painted-attachments/`：

- 网易云：`82D080E4-1993-4F54-96AC-09FE8A1F48AC.png`
- QQ：`33274937-3CB4-4CC6-9B9C-A0E5D9F2A009.png`

均为竖屏 1668×2420；不据此声明横屏或多任务通过。相邻 `manifest.json` 保存测试／设备身份。
`package-painted.json` 保存前端资源、原生源码、应用和测试二进制的 SHA-256；
`delivery.json` 记录最终提交、CI、证据散列和清理状态。

## 复现与边界

沿用已安装 Capacitor 与 Xcode 工具；`npm run build:mobile` 后执行 Capacitor copy，使用已有隔离 xcconfig
和 `ENABLE_TESTABILITY=YES` 进行 Release `build-for-testing`。QA 副本的首页映射、签名与 `.xctestrun`
TestHostPath／TestBundlePath／DependentProductPaths 必须同步。
各 `*-command.json` 保留精确 `test-without-building` 命令：只选 `FoliaNativeTests/ConnectionRecoveryTests`，
关闭并行测试，每例最多45秒，构建／测试外层 `codex-bounded 600`。

本批没有播放音频，不证明解码、后台跨曲或真实网络切换；未重跑之前的 WebKit／逻辑测试，沿用其独立证据。
真实账号、物理 iPhone／iPad、网易云30分钟锁屏、耳机／蓝牙、歌词精度和长期动画性能仍为 `NOT_RUN`。
个人 App 保持 mobile.28，服务器未更新，整体交付未完成。回退本批只需移除测试及工程注册，无数据迁移。
