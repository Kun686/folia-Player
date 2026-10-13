<!-- SESSION_RESPONSE_REVISION.md — reject mobile network replies from replaced provider sessions. -->
# 新登录后的旧请求响应隔离

2026-10-14，源码基线 `f41187b94758338358403c174213256a4c3cd698`。
按 [CURRENT_SCOPE.md](CURRENT_SCOPE.md) 继续收敛 QQ／网易云核心登录与歌单读取。

## 问题与最小修复

移动网络桥原先只在响应返回时检查请求取消代次。凭据被新登录替换时，内存中的会话版本已变化，
但取消代次未必变化，Keychain 保存也可能还在排队。因此，旧请求仍可能进入 provider 的响应处理：

- QQ 旧登录状态请求返回 401，清除刚保存的新登录。
- QQ 旧扫码确认返回 803，用旧响应中的凭据覆盖新登录。
- QQ／网易云旧歌单请求返回后，继续展示旧请求的曲目。

`red.log` 记录修复前 4 项失败、18 项通过，包含旧 401 清空新凭据和旧 803 覆盖新凭据的实际断言差异。
这里的实际响应处理指运行仓库真实 transport 代码，上游和原生桥响应仍为测试样本。

`src/mobile/runtime.ts` 的 `request()` 复用已有 `captureProviderSession()`，同时捕获取消代次和会话版本。
原生响应返回时，若会话已经变化，抛出原 `AbortError`，不把旧响应交给 provider。
同值保存和另一平台凭据变化继续允许原请求完成；凭据 A→B→A 仍使旧请求失效。

这是移动网络响应边界的修复，不声称覆盖响应已交付之后的所有异步竞态。
沿用现有 Omni/provider、歌单失败重试和凭据持久化队列；没有新增依赖、存储格式、原生日志或账号体系。

## 验证

证据目录：`.mobile-test-results/session-response-revision/`。

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| 修复前最小复现 | 4 FAIL、18 PASS | `red.log`；两平台旧响应及 QQ 401／803 凭据副作用 |
| 定向逻辑回归 | PASS，128 项／4 文件 | `unit.log`；移动 runtime、catalogSession、原登录状态机、QQ transport |
| 移动逻辑回归 | PASS，770 项／80 文件 | `mobile-unit.log`；与上行存在重叠，不累加为唯一覆盖数 |
| 新增三视口界面场景 | PASS，24 项 | `ui.json`；两平台 × 替换／换回／同值／另一平台变化 × 手机／iPad／窄窗口 |
| 既有核心界面回归 | PASS，69 项 | `regression.json`；连接设置、等待会话保存时点歌、搜索播放 |
| 正常登录与播放回归 | PASS，3 项 | `login.json`；现有网易云扫码、歌单、搜索、队列与控制流程，三视口 |
| 类型检查、移动资源构建 | PASS | `typecheck.log`、`build.log` |

合计 96 个唯一 WebKit 用例通过，无失败、跳过或不稳定重试。
新增场景使用真实页面和 Omni/provider，控制原生请求时序：替换会话后旧歌单不出现，已有重试入口能加载新请求的歌曲，
且只提交一次对应平台的播放队列；同值和另一平台变化不误拦截。
QQ 803 的负向副作用由真实 QQ transport 单测覆盖；本批没有新增 QQ 正常扫码的界面验收。

执行命令（均由 `codex-bounded` 限时）：

```sh
npm run test:unit -- test/unit/mobile/runtime.test.ts test/unit/mobile/catalogSession.test.ts test/unit/library/core/providerLoginSession.test.ts test/unit/onlineMusic/qqTransport.test.ts
npm run test:mobile
npm run test:mobile:ui -- session-response-revision.spec.ts
npm run test:mobile:ui -- gateway-settings.spec.ts collection-playback-session.spec.ts search-playback.spec.ts
npm run test:mobile:ui -- mobile.spec.ts --grep 'login, catalog'
npm run typecheck
npm run build:mobile
```

本地构建在提交前完成，资源内嵌身份为上述父提交，不冒充修复提交；资源内容包含此次修复。
准确源码提交、文件与资源哈希、报告摘要及对应提交的 CI 结果保存到本地 `delivery.json`。

## 仍待验收与回退

本批原生容器、真实服务／账号、物理 iPhone／iPad、锁屏长播均 `NOT_RUN`。
此前 [原生整合检查](NATIVE_CORE_INTEGRATION.md) 属于较早基线，不能自动算作本修复的原生验收。
个人安装包仍为 mobile.28，服务器未更新；两平台完整真机矩阵、网易云 30 分钟锁屏和长期动画性能继续待验收。
回退本次源码提交即可，没有数据迁移。
