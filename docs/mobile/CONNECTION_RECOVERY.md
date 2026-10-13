<!-- CONNECTION_RECOVERY.md — launch capability recovery; controlled browser events are not physical network acceptance. -->
# 启动连接失败后的恢复

2026-10-14；源码基线 `c0be33ee862e26cb9f338bafdf244969f5f87c0a`。
按 [CURRENT_SCOPE.md](CURRENT_SCOPE.md) 继续 QQ／网易云核心链路，不扩展本地音乐或其他功能。

## 问题与最小修复

`useProviders` 之前只在服务器地址变化时检查服务能力。启动检查因临时网络故障失败后，
QQ／网易云登录和搜索保持禁用；回到前台也不会重试，页面只提供连接设置入口。
保存设置会重载页面，但用户不应为一次临时故障重新输入访问凭据。

受控 WebKit 手机用例已复现：已有连接和两个平台会话，令首次 `health` 失败，
实际页面显示错误、登录禁用且找不到“重试”。保留 `ui-red.json` 与失败截图，不将它称为真实网络复现。

- 沿用现有 `native.health()`、能力白名单、错误提示、设置入口与翻译，新增连接检查重试按钮。
- 检查期间显示“正在加载…”并禁用重试；失败后允许再次操作。
- 仅在前一次检查失败、没有检查进行中且页面可见时，响应 `online` 或回前台事件重新检查。
  成功后移除这些恢复监听，没有定时轮询，也不会在每次回前台重新加载已连接账号。
- 每轮 effect 沿用原有 `current` 清理保护，旧结果不能更新已结束的轮次；原生网关仍使用现有超时与配置 scope 校验。
- 恢复检查不调用配置保存、退出或清除会话；成功后由原来的 `useCatalog`／Omni 流程读取账号与歌单。
  服务器没有配置时继续显示设置指引，不发服务检查请求。

复用项目连接桥、React 生命周期和已有 Playwright／Vitest；无新依赖、接口、凭据格式或原生代码变更。
桌面 Web／Electron、原版歌词及动画算法没有修改。

## 验证与证据

证据目录 `.mobile-test-results/connection-recovery/`。
Browser plugin／browser skill 本会话未列出，沿用仓库 Playwright 回退。
目标页面 `http://127.0.0.1:4179/mobile.html`；WebKit，手机 390×844、iPad 1194×834、窄窗口 600×834。

| 检查 | 结果与范围 |
| --- | --- |
| 修复前 | 1 FAIL，实际页面缺少重试按钮；`ui-red.json` |
| 修复后界面 | 63 PASS，0 FAIL／SKIPPED／重试；15 个新增窗口场景及48个既有连接设置、扫码时序、搜索点播回归 |
| 新增场景 | 两平台网络错误→手动重试→不兼容协议→再次重试→账号／搜索／点播恢复；模拟前台／online 事件；隐藏与请求进行中不重复发送；未配置不发请求 |
| 页面与交互 | QQ／网易云恢复用例断言页面地址、实际账号、歌曲 provider 与播放状态、无 pageerror／Vite 覆盖层；手机／平板错误态截图已人工查看，重试与设置入口可见 |
| 会话／队列逻辑 | 74 PASS／4 文件；`unit.log` |
| 类型检查 | PASS；`typecheck.log` |
| 移动资源构建 | PASS；`build.log`；未构建或安装新的原生包 |
| 原生容器、真实服务／账号、真实网络切换、物理设备 | NOT_RUN；`online`／visibility 为浏览器合成事件，播放为受控原生桥状态，不证明真实音频输出或系统挂起 |
| 个人包／服务器更新 | NOT_RUN；个人 App 仍为 mobile.28 |

测试期间保留既有 QRC 解码 `DecompressionStream warning (ignored)` 和扫码取消夹具的
`qr-cancel:failed` 警告；本修复不涉及对应解码与取消路径，不能声称这些诊断已修复。

命令：

```sh
npm run test:mobile:ui -- connection-recovery.spec.ts gateway-settings.spec.ts login-intent.spec.ts search-playback.spec.ts
npm run test:unit -- test/unit/mobile/runtime.test.ts test/unit/mobile/catalogSession.test.ts test/unit/mobile/searchPlayback.test.ts test/unit/mobile/queueActions.test.ts
npm run typecheck
npm run build:mobile
```

资源内嵌构建身份与最终提交分别保存在本地 `delivery.json`；不将构建基线标签视为新个人安装包。
回滚只需回退本批两个移动前端文件，不涉及数据迁移；回滚后临时连接失败仍需重载或保存设置才能恢复。
最新源码真实账号、网易云30分钟锁屏、物理iPad、网络／蓝牙、歌词精度和长期动画性能仍待验收。

后续 [原生连接恢复补验](NATIVE_CONNECTION_RECOVERY.md) 已在独立 iPad QA 通过两平台共2项测试，
使用真实 Capacitor／Keychain／URLSession 与受控响应；iPhone 测试工具失败及最终版本未跑状态单独保留。
这不修改本页前批原生 NOT_RUN 的历史边界，也不代表真实平台或个人 App 更新。
