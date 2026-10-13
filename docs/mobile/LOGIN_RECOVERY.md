<!-- LOGIN_RECOVERY.md — mobile QR retry error ownership; controlled UI evidence only. -->
# QQ／网易云扫码弹窗重试恢复

2026-10-14，生产源码父提交 `eb51175470df54b35d9a48d3635180fde71da109`。
按 [当前交付范围](CURRENT_SCOPE.md) 继续两平台核心链路，本批不扩展功能。

## 问题与改动

原 `LoginSheet.tsx` 的本地错误标记只会置为 true。取消请求或系统分享桥失败后，再次成功生成／分享
二维码，弹窗仍显示失败；旧分享的迟到拒绝也会把已经重新生成的二维码标为失败。
这是受控桥故障下复现的页面问题，不声称在真实平台账号上观察到该故障。

最小修复沿用现有组件状态、React `useRef`、Omni 和原 `createProviderLoginSession`：

- 开始新操作时清除旧的本地错误，只允许当前操作写回错误。
- 重新生成前停止旧会话；旧取消／分享回调不再污染新操作，关闭弹窗后也不能写回。
- 登录方式查询失败与成功结果一样检查组件生命周期。
- 原扫码、过期、轮询、前台恢复、凭据保存和平台错误状态保留，没有更改接口、布局、主题或依赖。

错误代次只管理弹窗提示，不替代共享扫码状态机的会话代次或移动 transport 的凭据隔离。
本轮仍然失败时显示原错误；共享会话自身的 `error` 状态继续独立显示。

## 受控证据

入口：`/mobile.html` → 选择 QQ／网易云 → 扫码登录 → 注入取消／分享失败 → 重试。
使用仓库既有 `test:mobile:ui`／Playwright WebKit；本会话未列出 Browser 技能，记录为
`Browser plugin not available`。测试只替换原生桥响应，实际执行 React、扫码状态机、Omni 与 provider adapter。
二维码图片沿用已有微型测试图片，只证明显示状态，不能据截图验收真实二维码内容或系统分享面板。

证据目录：`.mobile-test-results/login-recovery/`。

- 修复前 `red.log`：手机视口 6 FAIL，两平台 × 三种场景，全部在“旧错误应消失”处失败。
  `red-artifacts/` 保留截图与 DOM 错误上下文。
- 修复后 `ui.json`／`ui.log`：18 PASS，覆盖手机 390×844、iPad 1194×834、窄窗口 600×834；无失败、跳过或重试。
  分别验证取消失败后的重试并继续确认登录、分享失败后重试、旧分享迟到失败不覆盖新二维码。
  登录恢复场景检查页面标题、有实际账号内容、无 Vite 错误遮罩及无未捕获页面异常。
- `unit.log`：6 文件／349 PASS，覆盖移动 runtime／catalog、共享扫码会话和 QQ／网易云 provider／QQ transport。
- `typecheck.log`、`build.log`：类型检查与移动资源构建 PASS；未构建或安装原生 App。
- `regression.log`：63 PASS，既有歌单分页、在线目录、退出取消及凭据替换后的旧响应回归。
  CLI 文件模式也匹配了 `online-catalog.spec.ts`，按实际运行记录计数；`regression-summary.json` 来自列表日志。
- `smoke.json`：9 PASS，含上述分享重试的 6 次截图复核，以及 3 个视口的原有登录→歌单→队列→播放控制流程。
  本批共 **84 个唯一 WebKit 用例通过、90 次执行**，6 次重复复核不另算覆盖，无失败／跳过／重试。

已查看 QQ 手机的失败／恢复截图及网易云 iPad 恢复截图：旧提示消失，标题、关闭与扫码／分享控件仍可见。
这不是新的视觉设计验收，也不把测试图片当成真实二维码。

新增用例在 `test/mobile-ui/login-recovery.spec.ts`。需要前后截图时设置 `LOGIN_RECOVERY_SCREENSHOTS=1`，
图片写入 `/tmp/folia-login-recovery-<provider>-<viewport>-{failed,recovered}.png`，不进入生产资源。
执行命令均由 `codex-bounded` 限时，Playwright 管理测试服务器，结束后检查端口及子进程释放。

```sh
npm run test:mobile:ui -- login-recovery.spec.ts --project phone
npm run test:mobile:ui -- login-recovery.spec.ts --reporter=list,json
npm run test:mobile:ui -- catalog.spec.ts logout-cancellation.spec.ts session-response-revision.spec.ts
LOGIN_RECOVERY_SCREENSHOTS=1 npm run test:mobile:ui -- login-recovery.spec.ts mobile.spec.ts --grep 'retrying QR sharing|login, catalog' --reporter=list,json
npm run test:unit -- test/unit/mobile/runtime.test.ts test/unit/mobile/catalogSession.test.ts test/unit/library/core/providerLoginSession.test.ts test/unit/onlineMusic/qqProvider.test.ts test/unit/onlineMusic/neteaseProvider.test.ts test/unit/onlineMusic/qqTransport.test.ts
npm run typecheck
npm run build:mobile
```

首条命令是修复前复现，不应在修复后继续失败。JSON 报告通过 `PLAYWRIGHT_JSON_OUTPUT_NAME` 保存。
最终提交、CI、资源身份与报告 SHA-256 记录在本地 `delivery.json`。
移动资源在提交前生成，内嵌 SHA 为上述父提交并包含工作区修复；不声称内嵌 SHA 等同随后提交。

## 边界与回退

真实平台扫码、iOS 系统分享面板、Keychain、原生容器及物理设备本批 `NOT_RUN`。
前批退出清理的原生证据仍见 [NATIVE_LOGOUT_INTEGRATION.md](NATIVE_LOGOUT_INTEGRATION.md)，不能替代本批登录验收。
个人 App 仍为 mobile.28，服务器未更新；完整移植与两平台最新版本真机验收仍未完成。
无依赖、配置或存储迁移，回退本批提交即可。
