# 原版睡眠定时移动适配

2026-10-11 开发源码接入并通过独立 iPhone QA 自动测试；2026-10-12 汇入 mobile.21，
已原位安装、启动并回读 build21。
未将受控测试标成真实平台锁屏定时验收。没有新增生产依赖。
后续用户在 mobile.21 按 1 分钟锁屏步骤操作，反馈“到期暂停，手动继续正常”，
记为 PASS_USER_CONFIRMED；未区分具体音源、未独立测量误差，不外推为两平台全部时长通过。

## 复用与行为

- 设置入口复用原 `SleepTimerControl`、主题和 `commandPalette.sleepTimer*` 翻译。
  原桌面 `useSleepTimerStore`、`useSleepTimer`、`sleepTimerExpiry` 与命令面板保持原实现。
- 移动端不依赖 WebView 计时：`NativeSleepTimer` 持有截止时间，使用系统 DispatchSourceTimer；
  只在开启时检查期限，并在前台恢复、用户命令、网络恢复及音频中断结束时校准。
- 与原版一致：小时 0–999、分钟 0–59；零时长不能开启；显式开启重新计时，
  开启后改变时长重新计时，相同时长不重置；清零关闭。手动暂停不取消计时。
- 到期沿原版非 Electron 行为暂停，不退出 App；复用原生 pause，保留队列、当前歌曲与进度，
  清除中断／网络自动恢复意图并停止共享音频输出。到期后可以由用户主动恢复播放。
- UserDefaults 仅保存偏好时长，进程重启不恢复已开启状态；关闭设置页不影响原生期限。
  播放期间后台期限由原生处理；暂停后被系统挂起时，在下次执行／回前台先检查期限。

## 数据与竞态

- 独立 `getSleepTimer`／`setSleepTimer` 接口及 `sleepTimer` 事件，快照包含递增 revision。
  `setSleepTimer` 仅接受 hours、minutes、enabled 的部分变更，原生检查类型与范围。
- 前端串行合并快速编辑；期限到期后的时长请求不携带旧 enabled=true，因此不会误重新开启。
  旧事件／旧回包不能覆盖新 revision；失败撤回乐观显示，后续取消仍会发送。
- 监听器随 App 挂载，关闭设置不会丢失排队动作；卸载清理监听，忽略延迟回包。
  订阅失败时保持控件不可用，重试重新创建订阅；仅在订阅成功后做前台快照校准。
- 倒计时显示沿原组件每秒更新，独立于原生播放快照和高频歌词渲染。

## 本轮证据

| 层级 | 结果与范围 |
|---|---|
| TypeScript | `npm run typecheck` PASS |
| 逻辑 | `sleepTimerSync.test.ts` + 原 `sleepTimerExpiry.test.ts`：2 文件 / 7 项 PASS |
| WebKit | `sleep-timer.spec.ts`：手机、iPad、iPad 窄窗共 6 项 PASS；手机另覆盖 320×568 和 844×390；零时长、编辑、开启／关闭、到期事件、设置页重开、失败回退、旋转后操作与无横向溢出 |
| 原生构建 | Release / arm64 build-for-testing PASS；签名及独立 QA 身份核对通过 |
| iPhone 自动测试 | iPhone XS Max / iOS 18.7.10：8 项睡眠定时 + 2 项既有暂停／中断／Crossfade 回归，10 项 PASS，0 跳过 |
| 实际音频输出 | QA 使用现有 WAV 测试音，真实解码／共享立体声输出；原生定时触发后暂停、音频时钟停止、保留当前项；中断结束不误恢复 |
| 清理 | 功能阶段 QA `app.folia.validation.App` 已移除；当时个人 App 恢复前台并回读 build20；后续统一交付 mobile.21，始终未卸载个人 App |
| mobile.21 容器操作 | iPad Pro 11-inch (M5) / iPadOS26.5 Simulator，编辑为 1 分钟、开启显示 0:01:00、关闭通过；原生保存时长回读一致，未等待完整期限 |
| mobile.21 用户真机 | PASS_USER_CONFIRMED：1 分钟锁屏到期暂停，回 App 手动继续正常；具体音源未说明 |
| NOT_RUN | 逐平台和其他时长锁屏定时矩阵、物理 iPad、长时间温升／内存、系统时钟人为调整 |

原生到期用注入时钟推进，DispatchSource 自行触发；不是等候完整一分钟或真实锁屏计时。
网络／中断恢复的通知为受控注入，不等同于实际切换 Wi-Fi／蜂窝或真实来电。
WebKit 使用现有桥接 fixture，不证明 iOS 桥接端到端界面验收。

可复核产物（忽略目录，不提交二进制）：

- `.mobile-test-results/sleep-timer-device-build.log`
- `.mobile-test-results/sleep-timer-device-test.log`
- `.mobile-test-results/sleep-timer-device.xcresult`
- `.mobile-test-results/sleep-timer-device-summary.json`
- `.mobile-test-results/sleep-timer-device-apps.json`
- `.mobile-test-results/sleep-timer-{phone,ipad,ipad-narrow}.png` 及 `sleep-timer-rotated-*.png`

## 验证入口与回退

```sh
npm run typecheck
node node_modules/vitest/vitest.mjs run -c vitest.config.ts test/unit/mobile/sleepTimerSync.test.ts test/unit/hooks/sleepTimerExpiry.test.ts
node node_modules/@playwright/test/cli.js test -c playwright.mobile.config.ts test/mobile-ui/sleep-timer.spec.ts
```

原生执行 `NativeTests/testSleepTimer*`，加
`testStereoPausedSeekInterruptionAndProviderRemoval` 和
`testNativeCrossfadePauseResumeSeekAndSkipCancelPreviousIntents`。
按既有 QA 流程构建独立 Bundle ID；执行前核查 App／测试签名、Info.plist 及 xctestrun 的
TestHostBundleIdentifier，禁止使用个人身份运行测试或清理。

回退仅撤销移动入口、桥接和原生期限模块；原桌面组件、已有播放命令及媒体不迁移。
尚未发布新个人安装包，无个人数据迁移或回滚步骤。
