<!-- LOGOUT_CONNECTION_GUARD.md — logout ownership across connection changes; controlled verification only. -->
# 退出登录与连接切换保护

2026-10-15：修正 QQ／网易云旧退出操作误清当前账号的并发路径。只改移动会话保护与退出编排，不改界面、平台协议、播放或特效，无新依赖。
本次完成逻辑、WebKit 和移动资源构建；未安装 App、调用真实平台或连接服务器。

后续补验：2026-10-15布局门槛通过后，本修复已随[合并包](COMBINED_UI_VERIFICATION.md)原位安装到独立模拟器；
两平台原账号、歌单及原队列保持。真实退出重登／并发切换验收仍 **NOT_RUN**，下方为初次修复阶段记录。

## 触发条件与影响

1. 曲库退出先等待取消请求，再调用远端退出，最后清除当前 runtime 的会话及账号缓存。
   如果任一等待期间更换服务器连接，原流程仍会向新连接发退出请求，或在旧响应结束后清掉新连接的数据。
2. QQ transport 已能识别过期响应，但 provider 的退出方法吞掉请求异常后仍无条件清 cookie。
   因此旧退出成功、失败或被取消都可能删除更晚保存的账号。
3. 网易云网络层会包装取消异常，且正文读取另有异步等待。没有 adapter 级检查时，曲库可能把失效退出当普通失败后继续本地清理。

原代码定向复现为 **7 FAIL**：两平台分别覆盖取消等待和远端响应等待时连接被替换，另有 QQ 三种迟到退出结果。
这些是受控时序证据，不是用户真实账号发生数据丢失的报告，也与 QQ 偶发空搜索无已证实因果关系。

## 最小修复与复用

- `src/mobile/runtime.ts` 增加连接检查闭包，复用既有 `scope` 和 `configuring`；不增加全局会话计数器。
- `src/mobile/useCatalog.ts` 将该检查注入现有 `CatalogPort`，在线操作继续经过 Omni。
- `src/mobile/catalogSession.ts` 在取消、远端退出和本地清理之间检查原连接；失效退出不再清理当前会话／账号缓存，保留退出失败状态供重试。
  普通网络失败、取消桥失败时仍尝试原账号的本地清理，某个清理失败不跳过另一项。
- `src/services/onlineMusic/qqProvider.ts` 复用已有移动会话版本检查，旧退出不能清新 cookie。
  若当前401已由 transport 删除 cookie，则正常收尾，不把正常凭据失效当成新账号冲突。
- `src/services/onlineMusic/neteaseProvider.ts` 在退出结束时检查会话归属，包含被包装的网络异常和正文读取等待。
  没有移动 runtime 的 Web／Electron 仍走原退出行为。

## 验证

证据目录：`.mobile-test-results/logout-connection-guard/`。

| 检查 | 结果 | 证据与边界 |
| --- | --- | --- |
| 原代码定向复现 | **7 FAIL** | `red.log`；旧代码错误地调用退出或清除当前会话 |
| 首轮相关逻辑 | **217 PASS／5文件** | `green.log`；随后补充了网易云包装异常和跨层覆盖 |
| 最终相关逻辑 | **357 PASS／7文件** | `final-unit.log`；包括6个真实catalog／adapter／runtime组合，仅替换native IO；覆盖两平台新账号、新网关、正文等待 |
| 兼容行为 | **PASS，包含于上述357项** | QQ当前200／401／502仍清本地账号；连接检查不因正常provider取消而失效；普通退出失败仍清理；过期退出可重试 |
| 现有WebKit退出回归 | **4 PASS／13.7秒** | `webkit.log`；两平台各覆盖取消桥成功／失败、迟到请求、刷新后退出保持、另一平台会话保留。受控浏览器，不是Keychain或平台验收 |
| 类型检查 | **PASS** | `final-typecheck.log`；`tsc --noEmit` |
| 移动生产资源构建 | **PASS** | `build.log`；`npm run build:mobile` |
| 原生构建／资源复制／安装 | 后续补验 **PASS** | 独立模拟器合并包，128资源及签名一致；个人App未更新 |
| 真实扫码、真实退出重登、音频、真机／长播 | **NOT_RUN** | 未操作已登录账号，不把受控并发检查替代平台验收 |

逻辑命令使用 `node node_modules/vitest/vitest.mjs run -c vitest.config.ts`，覆盖：
`test/unit/mobile/{logoutSession,catalogSession,runtime,neteaseSession}.test.ts` 与
`test/unit/onlineMusic/{qqProvider,qqTransport,neteaseProvider}.test.ts`。
WebKit 复用 `test/mobile-ui/logout-cancellation.spec.ts --project=phone`，没有新建产品测试入口。
另在本机 WebKit 验证 `DOMException('Canceled', 'AbortError')` 可被现有 Error 类型判断识别。

## 安装与剩余边界

追加授权后的曲库最终回归2项通过；本修复与主题编辑器已重新复制资源、原生构建、核对签名／资源并合并安装。
独立模拟器两平台账号保留，未实际退出；真实并发退出／重登验证仍待完成。
个人 mobile.28及服务器未更新；QQ空搜索及完整UI／特效／真机验收仍未完成。

回退时只撤回本批连接检查和退出保护，保留此前已验证的登录正文保护与其他工作区改动。
本批未启动持久服务；测试WebKit与Vite子进程随用例退出，收尾见 `cleanup.json`。
