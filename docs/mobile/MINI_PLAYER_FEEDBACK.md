<!-- MINI_PLAYER_FEEDBACK.md — shared mini/expanded playback feedback; controlled WebKit evidence. -->
# 迷你播放器错误恢复

2026-10-14；源码基线 `f6d08278bcd40de9dae0d335ba4518a4c42b7361`。
本批按 [当前范围](CURRENT_SCOPE.md) 收敛 QQ／网易云核心链路。

## 问题与修复

在音乐库底部迷你播放器暂停失败后，第二次暂停即使成功，音乐库仍显示旧错误。
原因是该按钮直接把失败写入 `MobileApp` 的通用错误标志，没有命令恢复后的清除路径。
修复前在 QQ、网易云受控身份下各复现一次：按钮已变为“播放”，错误提示仍有一条。

复用已有 `usePlaybackCommands`、`PlayerFeedback`、歌曲代次与原生命令桥。
最简方案是在 `MobileApp` 持有同一份命令反馈，提供给迷你和展开播放器；不增加依赖或播放实现。
两个入口之间切换后可继续重试，较早命令的迟到失败不能覆盖较新命令，旧歌曲的错误也不能污染当前歌曲。
音乐库沿用普通错误段落，原生登录／网络等错误仍优先，只有原生快照确认恢复才清除。

生产改动限于 `MobileApp.tsx`、`PlayerPanel.tsx`、`PlayerFeedback.tsx` 的反馈接线。
未修改原生播放、队列、缓存格式、原版渲染器、全屏布局、半透明控制器、设置默认值或翻译文案。
原通用错误标志仍服务于其余已有处理；本批不扩展本地音乐或其他功能。

## 验证

证据目录：`.mobile-test-results/mini-player-feedback/`。
WebKit 通过仓库 Playwright 执行，目标为 `http://127.0.0.1:4179/mobile.html`，
三个窗口分别为手机 390×844、平板 1194×834、窄窗口 600×834。

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| 修复前复现 | 2 FAIL | 两平台迷你播放器成功重试后仍有错误；保留 `red.log` 与截图 |
| 修复后界面回归 | **108 PASS，0 FAIL／SKIPPED／重试** | 24 项新窗口场景及 84 项既有反馈、控制器、歌词校准、搜索播放回归 |
| 类型检查 | PASS | `npm run typecheck` |
| 移动资源构建 | PASS | `npm run build:mobile`；保留既有大资源块提示 |
| 截图检查 | PASS（指定截图） | 手机命令错误、平板和窄窗口登录失效提示可读，底部播放按钮可见 |
| 原生容器／真实账号／物理设备 | NOT_RUN | 本批使用受控桥和平台响应，没有真实音频或系统控制验收 |
| 真机长播／完整视觉性能 | NOT_RUN | 不以本批界面回归替代 |

新增场景覆盖同入口重试、两个入口双向重试、跨入口迟到失败、离开歌曲再返回，以及原生认证错误优先级。
两项修复前复现包含在最终 108 项中，不重复累计。原生与账号历史结果仍按各自版本记录。
UI 日志中的既有 QRC `DecompressionStream warning (ignored)` 为受控样本处理警告，保留原日志。

执行命令（均通过 `codex-bounded` 限时执行）：

```sh
npm run test:mobile:ui -- player-feedback.spec.ts --project=phone --grep "mini player clears" --output=.mobile-test-results/mini-player-feedback/red-artifacts
npm run test:mobile:ui -- player-feedback.spec.ts mini-player-feedback.spec.ts chrome.spec.ts lyric-timing.spec.ts search-playback.spec.ts --output=.mobile-test-results/mini-player-feedback/ui-artifacts
npm run typecheck
npm run build:mobile
```

构建内身份仍为 `0.7.16-mobile.28`、基线提交 `f6d0827`；本地构建包含本批未提交源码，
不能仅凭该身份将其等同于基线或个人安装包。源码与资源哈希、最终提交和对应 CI 结果分开记在 `delivery.json`。
未运行 `cap sync`、Xcode 安装或服务器部署，个人 App 仍是原 mobile.28。
回退上述三个生产文件的本批改动即可恢复原行为，没有数据迁移。

后续证据：2026-10-14 [原生补验](NATIVE_PLAYBACK_RECOVERY.md)在独立手机／平板模拟器中通过真实桥接和PCM
验证迷你播放器失败、展开重试、恢复播放及页面重载。该补验不改变上表当批边界，真实账号与物理设备仍待验收。
