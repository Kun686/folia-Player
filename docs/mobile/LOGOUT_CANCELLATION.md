<!-- LOGOUT_CANCELLATION.md — local logout cleanup after a cancellation-bridge failure; controlled evidence only. -->
# 取消请求失败时仍清理登录凭据

2026-10-14，源码父提交 `c0713454c16e62854510fd6eeed6687546e2aca5`。
按 [CURRENT_SCOPE.md](CURRENT_SCOPE.md) 继续 QQ／网易云的退出、请求取消与账号隔离。

## 复现与修复

退出时 `catalogSession` 会分别尝试会话和账户缓存清理，但 `runtime.clearProvider()` 内部
先等待 `cancelProvider()`；若原生 `cancelRequests` 桥调用拒绝，后面的 `native.clearSession()` 不会执行。
此时界面已经移除账号并显示重试，而持久层仍可能保留登录，已排队的凭据保存也可能继续完成。
这是通过桥接故障注入确认的分支，不是声称已在真实用户设备观察到该故障。

最小修复复用既有清理、持久化队列与标准 `Promise.allSettled`：

1. 立即撤销旧请求代次、冻结该平台写入，记录取消请求结果。
2. 无论取消结果如何，等待已排队保存结束，再尝试原生凭据／播放缓存清理。
3. 清理成功后同步内存，取消失败仍返回原错误供现有重试入口显示。
4. 原生清理本身失败时，继续使用 bootstrap 恢复持久层权威状态并保留清理错误。

另一平台的会话与请求不变；原生队列移除、缓存清理语义没有修改。
没有新增依赖、配置项、存储格式或重试循环，也没有调整播放器、动画或设置样式。

## 测试证据

证据目录：`.mobile-test-results/logout-cancellation/`。

- `red-isolated.log`：修复前 2 FAIL／25 PASS。QQ、网易云分别证明原生凭据删除调用数为 0。
- `unit.log`：38 PASS，运行 runtime 与 catalogSession。
- `mobile-unit.log`：80 文件／772 PASS；包含上行，不累加为独立用例数。
- `ui.json`：12 PASS，无跳过／失败／重试。两平台 × 取消成功／失败 × 手机／平板／窄窗口。
  覆盖真实页面退出、错误提示与重试、迟到响应拒绝、模拟持久层重载后不恢复旧账号，以及另一平台登录保持。
- `regression.json`：54 PASS；既有账户目录、连接设置与凭据替换后的旧响应回归。
- `login.json`：3 PASS；既有网易云扫码、歌单、搜索／队列和播放控制，三个视口。
- `typecheck.log`、`build.log`：类型检查与移动资源构建 PASS。

合计 69 个唯一 WebKit 用例 PASS，没有跳过或不稳定重试。没有据此新增 QQ 正常扫码的验收结论。

单测还覆盖待保存凭据先完成、清理随后执行，避免清理后再写回；界面测试沿用真实 catalog／runtime／provider，
使用受控原生桥和合成会话。测试里的 sessionStorage 仅模拟原生持久层，不进入生产凭据存储。
这些测试不能代替 Keychain、真实平台注销或物理设备验收。

首轮 `red.log` 有额外测试污染：失败用例没有消费一次性 mock，原 `clearAllMocks` 只清调用记录，
使后续用例误用旧行为。测试初始化改为 `resetAllMocks` 后，修复前仅剩上述两项产品分支失败；
保留两次记录，不把首轮 6 FAIL／21 PASS 和未处理拒绝全部归因于产品。

执行命令均使用 `codex-bounded` 限时：

```sh
npm run test:unit -- test/unit/mobile/runtime.test.ts test/unit/mobile/catalogSession.test.ts
npm run test:mobile
npm run test:mobile:ui -- logout-cancellation.spec.ts
npm run test:mobile:ui -- gateway-settings.spec.ts session-response-revision.spec.ts account-library.spec.ts
npm run test:mobile:ui -- mobile.spec.ts --grep 'login, catalog'
npm run typecheck
npm run build:mobile
```

## 交付边界

本批原生容器、Keychain 故障注入、真实账号与物理设备 `NOT_RUN`。
个人 App 仍为 mobile.28，服务器未更新。网易云 30 分钟锁屏、耳机／蓝牙／网络切换、
歌词精度与长期动画性能等完整交付验收继续保留，不能由本次逻辑／界面回归替代。
移动资源在提交前构建，内嵌 SHA 为上述父提交，资源包含此次修复，不声称与随后源码提交身份相同。
最终源码提交、对应 CI、资源与本地报告摘要记录在 `delivery.json`；回退本次提交即可，无数据迁移。
