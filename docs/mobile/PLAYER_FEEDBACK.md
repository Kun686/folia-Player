<!-- PLAYER_FEEDBACK.md — command recovery and localized native errors; controlled UI evidence only. -->
# 播放器错误提示与恢复

2026-10-14；源码基线 `8163202e8d1c5f73d84a302c8ebc0bad7e0ead99`。
按 [当前范围](CURRENT_SCOPE.md) 继续 QQ／网易云核心功能，不扩展本地音乐或其他模块。

## 问题与修复

原 `PlayerPanel` 的暂停、播放、拖动与歌词点击跳转共用一个只置为 `true` 的错误标志。
命令失败后，即使下一次操作成功，错误提示仍在，控制器也一直被错误状态阻止隐藏。
手机 WebKit 在 QQ、网易云两个歌曲来源分别复现：第一次暂停被受控桥拒绝，第二次暂停成功且按钮变为“播放”，
页面仍有错误提示。两例修复前失败与截图保留在 `red.json`／`red-artifacts/`。

- `usePlaybackCommands` 沿用原 `native.command` 与参数；新操作开始清理旧命令提示，失败只归属于最新命令。
  旧命令迟到失败不能覆盖较新的操作；使用已有 `songEpoch` 隔离切换歌曲前后的错误，卸载后不再发布。
- `PlayerPanel` 的歌词点击和播放器控件接入同一个反馈流程。没有新增播放重试、自动跳歌或请求取消规则；
  原生队列、地址解析、缓存与系统播放状态仍由原有实现负责。
- `PlayerFeedback` 在原提示位置区分平台登录、服务访问凭据、网络、限流、歌曲不可用、音频输出和状态读取错误。
  平台名称经 Omni 获取；中文、英文、印尼语沿用现有语言配置。
- 原生 `state.error` 优先于命令错误，成功的 UI 命令不会将其抹掉，直到原生快照确认清除。
  未知错误显示通用恢复建议，不将原始错误码或响应细节插入界面。歌词／导入错误保留原处理。

复用 Capacitor 命令桥、React 生命周期与现有歌曲代次、Omni、i18n、控制器和提示样式。
无新依赖、配置项或自研播放机制；原版动效、全屏布局和半透明材质不变。

## 验证

证据目录 `.mobile-test-results/player-feedback/`。Browser plugin／browser skill 未列出，使用仓库 Playwright。
目标 `http://127.0.0.1:4179/mobile.html`，WebKit；390×844、1194×834、600×834，翻译用例另转置宽高。

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| 修复前 | 2 FAIL | 两平台重试成功后错误残留 |
| 新用例首轮 | 24 PASS | 两平台重试恢复、迟到失败、切换歌曲再返回、原生错误优先与提示 |
| 最终界面回归 | **84 PASS，0 FAIL／SKIPPED／重试** | 33 项新反馈／翻译窗口场景，51 项既有控制器、歌词校准与搜索点播回归 |
| 相关逻辑 | **16 PASS／2文件** | `searchPlayback.test.ts`、`nativeTransitionCue.test.ts` |
| 类型检查 | PASS | `typecheck.log` |
| 移动资源构建 | PASS | `build.log`；未构建或安装原生包 |

首轮24项已包含在最终84项内，不累计为108项。单测命令还带了一个不存在的 `lyricClock.test.ts` 过滤路径，
Vitest 实际仅运行上述两个文件；不据此声称额外歌词时钟单测覆盖。歌词校准与 Monet 点击跳转由界面回归验证。

新增用例使用完整 React 页面、实际按钮／触摸与歌曲搜索入口，验证页面 URL／标题、有效内容、
无 Vite 覆盖层、命令恢复后可手动隐藏控制器、旧操作不污染当前状态。
翻译用例记录 pageerror／控制台，检查提示无横向溢出、位于窗口内，播放按钮仍能命中；
手机、平板与窄窗口截图保存在 `regression-artifacts/`。已人工查看恢复提示、两平台认证提示及英／印尼语横屏截图。
既有 QRC `DecompressionStream warning (ignored)` 保留在日志，不属于本次命令反馈修复。
移动构建仍有既有大 chunk 提示，本次未为消除提示而改动原 renderer 或音频算法。

命令记录见 `red.log`、`regression.log`、`unit.log`、`typecheck.log`、`build.log`。
主要界面命令为：

```sh
npm run test:mobile:ui -- player-feedback.spec.ts chrome.spec.ts lyric-timing.spec.ts search-playback.spec.ts
```

## 验收边界与回滚

原生命令失败、平台返回和播放快照均为受控样本；本批不证明真实音频、登录失效、耳机／蓝牙／网络切换。
原生容器、物理 iPhone／iPad、真实账号、网易云30分钟锁屏、歌词精度与长期动效性能均 `NOT_RUN`。
既有 iPhone 连接恢复测试工具失败继续保留在 [原生补验记录](NATIVE_CONNECTION_RECOVERY.md)，本批未重跑。
个人 App 仍为 mobile.28，服务器未更新，整体交付未完成。

本地资源构建的内嵌基线与最终源码提交分别记录在 `delivery.json`，不视为新的个人安装包。
回退本批播放器反馈接线、组件／hook 和翻译即可；没有数据、凭据或缓存格式迁移。
