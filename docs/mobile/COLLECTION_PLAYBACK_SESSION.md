<!-- COLLECTION_PLAYBACK_SESSION.md — online collection playback cancellation; controlled evidence only. -->
# 歌单播放与账号会话变更

2026-10-14，源码基线 `4855a1c15ca78f63a2c63192eeaebe72f0407a4a`。
按 [CURRENT_SCOPE.md](CURRENT_SCOPE.md) 优先核对 QQ／网易云核心播放，不扩展本地音乐或其他功能。

## 已复现的问题

凭据正在等待原生保存时，从在线歌单点选歌曲，随后退出登录；保存返回后，旧点歌操作仍向原生发送
`setQueue`，用退出前的歌单替换队列。浏览器中的实际 `MobileApp`、Omni/provider 和会话代次代码参与复现，
原生保存与上游数据由测试桥控制。`red.json` 的手机网易云用例记录了错误提交的歌曲及所选序号。
这证明前端确实发送了过期命令，不等同于真机音频已恢复或真实 Keychain 已被写入。

原因为 `play` 先等待 `flushSessions()`，再进入没有账号校验的 `startCollection`；已有搜索与批量加入队列
路径的校验没有覆盖这里。仅在等待之后捕获账号状态也不能修复，因为此时退出已经发生。

## 最小修复与复用

- 从既有 `enqueueMobileSongs` 提取 `captureMobileQueueSessions`，复用 `captureProviderSession` 的账号代次／凭据版本。
  对每个歌曲来源平台各捕获一次；混合来源任一会话失效即拒绝，其他平台变更不误取消当前单平台操作。
- `startCollection` 在任何等待之前捕获，替代歌曲检查后、凭据保存后再次校验；过期时沿用 `queue-changed`
  提示并释放操作锁，不提交队列。原生回执返回后也校验，避免过期回执再展开播放页。
- 主列表仅在搜索分支等待凭据保存，歌单分支的等待留在已有 `startCollection` 中，避免先等待再捕获。
  现有队列选曲保留原凭据等待和原生 `queueRevision` 校验。
- 原歌单曲序、所选歌曲序号、搜索单曲语义、替代歌曲确认、Omni 分层及已接受界面保持原实现。
  无新增依赖、存储格式、网关路由或 Swift 修改；既有本地路径仅参加共享入口回归。

## 验证

证据目录：`.mobile-test-results/collection-playback-session/`。

| 检查 | 状态 | 范围 |
| --- | --- | --- |
| 修复前复现 | RED，1 项 | `red.json`，退出后仍发送 `setQueue` |
| 手机定向复测 | PASS，8 项 | `targeted.json`，两平台退出／切换／替换凭据／正常播放；最终矩阵包含它们 |
| 最终 WebKit 矩阵 | PASS，135 项 | `final.json`；新增手机／iPad／窄窗口用例及目录、搜索、入队、替代歌曲回归 |
| 移动逻辑 | PASS，763 项，80 文件 | `npm run test:mobile`，`unit.log` |
| 类型检查 | PASS | `npm run typecheck`，`typecheck.log` |
| 移动资源构建 | PASS | `npm run build:mobile`，`build.log`；未安装 |

新增 42 项窗口用例覆盖两平台退出／切换／替换凭据、保存失败、其他平台账号变更、正常歌单播放，
以及现有队列选曲仍等待凭据写入；与 93 项既有回归合计 135 项。
提交前复核收窄了凭据等待调整，保留旧队列选曲语义；该调整前的 129 项通过记录在 `before-final-review.json`，
最终源码重新执行完整矩阵。重复运行不累加为新增覆盖。
本地 `delivery.json` 分别记录准确提交、报告摘要、构建资源摘要及 CI；
提交前构建的内嵌 SHA 仍为基线，不表示个人 App 已安装对应源码。

## 验收边界与回退

本批真实平台请求、原生容器、物理 iPhone／iPad、实际 Keychain 延迟、系统挂起与音频行为：`NOT_RUN`。
校验能阻止尚未发送的过期命令；已经交给原生执行的操作仍依赖原生现有退出清理与播放意图处理，
不能把 WebKit 桥验证当作原生原子性证明。网易云 30 分钟锁屏、耳机／蓝牙／网络切换、歌词误差与长期性能继续待验收。

个人 App 仍为 mobile.28，服务器、依赖锁及签名记录未更新。回退本次源码提交即可，无数据迁移。
