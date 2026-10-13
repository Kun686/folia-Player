<!-- LOGIN_INTENT.md — mobile QR capability readiness and latest-action ownership; controlled evidence only. -->
# 扫码通道查询与快速刷新

2026-10-14，源码父提交 `10e24468c3784ed91a5ee19b36c3be0908c25cbb`。
继续 [当前范围](CURRENT_SCOPE.md) 中的 QQ／网易云核心链路，未扩展平台或其他功能。

## 两处复现

1. QQ 通道查询尚未完成时，移动弹窗已经请求二维码。对于只声明微信通道的后端，
   UI 临时显示的 QQ 选项可能成为不受支持的请求。原 provider 已提供 `resolveQrLoginMethods`，
   但移动入口没有等待它；刷新时的取消还可能先撤销正在进行的通道查询。
2. 先选 QQ 并刷新，取消旧请求的桥调用被延迟；再选微信并刷新，新二维码生成后，
   第一轮取消才返回。原入口随后再次 `session.start`，实际要码顺序成为 `wechat`、`qq`，覆盖了最新操作。
   共享扫码状态机能隔离已开始的会话，但这些异步等待发生在调用 `start` 之前。

手机视口 `red.log` 为 **2 FAIL／3 PASS**，保留 `red-artifacts/` 的截图与错误上下文。
通过的三例是两平台关闭后不再要码、旧后端缺少通道路由仍可登录，不把它们说成新发现的问题。

## 最小修复与复用

`LoginSheet.tsx` 继续使用 Omni、原扫码状态机和原取消逻辑，只增加移动入口的准备状态与操作代次：

- 先等待通道查询，再取消旧 transport 请求；每次 await 后检查是否仍属于最新操作。
- 根据最新通道清单校验所选方式。已不支持的临时选择交回 provider 的既有默认规则，例如仅微信通道。
- 较早的取消完成不能启动另一轮扫码；关闭时撤销尚未完成的准备操作。
- 准备期间显示原“正在加载”文案，隐藏已停止的旧二维码与分享按钮；新码生成后恢复。
- 保留旧后端没有通道路由的原兼容回退、轮询／过期／凭据保存规则，以及前批错误重试保护。

没有新增依赖、平台协议或第二套扫码状态机。测试 fixture 从前批文件提取到 `login-fixture.ts`，
在既有受控桥中增加通道查询和取消延迟，两个 UI 测试文件共用，避免重复模拟接口。

## 测试范围

证据目录 `.mobile-test-results/login-intent/`。使用既有 Playwright／WebKit，入口为
`/mobile.html` → QQ／网易云 → 扫码登录；手机 390×844、宽 iPad 1194×834、窄窗口 600×834。
本会话没有 Browser 技能入口，沿用 [前批测试方式](LOGIN_RECOVERY.md)，不新增浏览器依赖。

- `ui.json`：33 PASS。新增五类通道／时序场景 × 三视口，加前批错误恢复 18 项。
- `preparation.json`：6 PASS。两平台 × 三视口，检查旧码与分享入口在等待时隐藏，
  状态显示加载，放行取消后新码与分享入口恢复，旧响应被拒绝，无未捕获页面异常或 Vite 错误遮罩。
- `unit.log`：7 文件／397 PASS。共享扫码／账户控制器、两平台 provider、QQ transport、移动 runtime／catalog。
- `typecheck.log`、`build.log`：类型检查和移动资源构建 PASS；未构建或安装原生 App。
- `regression.json`：12 PASS。原有登录→歌单→队列／播放控制，以及分页失败重试、账号／搜索并行、平台切换。

合计 **51 个唯一 WebKit 用例 PASS**，无失败、跳过或重试，不与前批重复用例累加。

截图保存在 `/tmp/folia-login-intent-<provider>-<viewport>-preparing.png`；已查看 QQ 手机与网易云 iPad：
旧二维码和分享入口消失，标题、关闭与刷新仍可操作。二维码本身沿用测试图片，不证明真实扫码可读性。

主要命令使用 `codex-bounded 600`：

```sh
npm run test:mobile:ui -- login-intent.spec.ts --project phone
npm run test:mobile:ui -- login-intent.spec.ts login-recovery.spec.ts --reporter=list,json
LOGIN_INTENT_SCREENSHOTS=1 npm run test:mobile:ui -- login-intent.spec.ts --grep 'preparing a fresh QR' --reporter=list,json
npm run test:mobile:ui -- mobile.spec.ts catalog.spec.ts --grep 'login, catalog|playlists after the first 100|search and account paging|switching providers discards' --reporter=list,json
npm run test:unit -- test/unit/library/core/providerLoginSession.test.ts test/unit/library/core/providerAccountController.test.ts test/unit/onlineMusic/qqProvider.test.ts test/unit/onlineMusic/qqTransport.test.ts test/unit/onlineMusic/neteaseProvider.test.ts test/unit/mobile/runtime.test.ts test/unit/mobile/catalogSession.test.ts
npm run typecheck
npm run build:mobile
```

第一条为修复前复现；JSON 用 `PLAYWRIGHT_JSON_OUTPUT_NAME` 保存。最终提交、CI、构建资源及报告摘要见本地
`delivery.json`；前端构建内嵌父提交并包含工作区修复，不把它当作最终提交身份。

## 尚未验收

本批为受控 HTTP／原生桥响应下的真实前端逻辑，**真实账号、实际微信／QQ 扫码、系统分享、
原生容器和物理设备均 NOT_RUN**。前批真机反馈不替代本批验收。
个人 App 仍为 mobile.28，服务器未更新；网易云长时间锁屏及长期动画性能等整体缺口继续保留。
没有数据迁移，回退本批提交即可；整体移植尚未完成。
