<!-- PLAYBACK_STATE_RECOVERY.md — foreground playback reads and native-event ordering; controlled UI evidence. -->
# 回前台播放状态恢复

2026-10-14；源码基线 `8aaebef8c6a9036f305401f189704ed695df0d70`。
继续 [当前范围](CURRENT_SCOPE.md) 中 QQ／网易云核心播放的状态同步，不扩展其他功能。

## 问题与修复

`usePlayback` 原先只对成功快照按原生 `revision` 过滤，读取失败则直接覆盖页面错误。
回前台发起的读取迟到失败时，即使期间已收到正确歌曲、进度或原生认证错误，仍会显示“无法读取播放状态”。
QQ／网易云各有两项手机 WebKit 复现：新状态后多出错误，以及“登录已失效”被读取错误替代，共 4 FAIL。

复用现有 hook、原生快照与 React 生命周期，不增加依赖、状态服务或播放机制。
最简修复集中在 `src/mobile/usePlayback.ts`：

- 每次前后台变更淘汰之前的读取；旧成功响应也不能覆盖较新读取，保留原生版本过滤。
- 读取开始之后若已接收有效原生快照，旧读取失败不再发布提示。
- 当前读取确实失败且没有较新状态时，仍显示原提示；已经存在的原生错误保留优先级。
  下一次成功读取或原生事件可恢复页面。

原生事件合并、歌曲代次、歌词时间插值、动画和队列行为保持原实现。
Swift 快照包含错误清除值，`publish()` 增加版本；同一发布间隔内读取位置可变化而版本不变。
测试因此也覆盖相同版本的读取响应乱序，不将版本号当作每次读取的唯一身份。

## 验证

证据：`.mobile-test-results/playback-restoration/`。
沿用项目 Playwright／WebKit 和受控平台、原生桥样本，入口 `http://127.0.0.1:4179/mobile.html`。
手机 390×844、平板 1194×834、窄窗口 600×834 各 44 项。

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| 修复前 | 4 FAIL | 两平台迟到失败覆盖新状态或原生认证提示，保留日志和截图 |
| 修复后界面回归 | **132 PASS，0 FAIL／SKIPPED／重试** | 42 项新窗口场景，90 项既有反馈、控制器和歌词校准 |
| 类型检查 | PASS | `npm run typecheck` |
| 移动资源构建 | PASS | `npm run build:mobile`；保留既有大资源块及混合导入警告 |
| 指定截图观察 | PASS | 三种窗口读取失败提示和底部控制器可见；自动断言同时检查恢复后提示清除 |
| 原生容器／真实平台／物理设备 | NOT_RUN | `visibilitychange`、延迟和拒绝均为受控注入，不证明 iOS 挂起或桥接故障的实际发生频率 |
| 长播／动画长期性能 | NOT_RUN | 不以界面测试替代 |

新增场景：读取期间收到正常状态／认证错误、新一轮读取成功后旧读取失败、当前失败后恢复、回后台取消旧读取、
相同原生版本的读取响应乱序、读取前已有原生错误。修复前的 4 项包含在最终矩阵中，不重复累计。
测试只放大读取响应乱序，未新增自动重试或改变后台音频逻辑。

执行命令（均通过 `codex-bounded` 限时）：

```sh
npm run test:mobile:ui -- playback-restoration.spec.ts --project=phone --output=.mobile-test-results/playback-restoration/red-artifacts
npm run test:mobile:ui -- playback-restoration.spec.ts player-feedback.spec.ts mini-player-feedback.spec.ts lyric-timing.spec.ts chrome.spec.ts --output=.mobile-test-results/playback-restoration/ui-artifacts
npm run typecheck
npm run build:mobile
```

UI 日志中既有 QRC 解压警告保留；类型检查和构建退出码均为 0。
本地资源身份仍为 `0.7.16-mobile.28`／基线 `8aaebef`，构建包含本次工作区改动；
源码、128 个资源哈希、最终提交和 CI 身份分别封存在 `delivery.json`，不等同于原 mobile.28 安装包。
未运行原生同步／安装，未连接账号或部署服务器；个人 App 和服务器未更新。
回退 `usePlayback.ts` 本批改动即可，无数据迁移。

后续证据：2026-10-14 [原生补验](NATIVE_PLAYBACK_RECOVERY.md)在两台模拟器验证真实原生发布后迟到读取失败
不闪出提示，以及实际文档重载后的队列／歌词恢复；仍非iOS实际挂起、真实平台或物理设备验收。
