<!-- NATIVE_PLAYBACK_RECOVERY.md — simulator integration evidence for command feedback, late reads and page reload. -->
# 播放恢复原生补验

2026-10-14；生产源码及打包前端基线 `2a254c1d9187b5e8b99106c6e077a6d96984f3de`。
按 [当前范围](CURRENT_SCOPE.md) 补验 QQ／网易云核心播放，衔接
[迷你播放器反馈](MINI_PLAYER_FEEDBACK.md) 和 [回前台状态恢复](PLAYBACK_STATE_RECOVERY.md)。
本批只新增原生 QA 与证据，没有新增生产功能或改变原版动效、全屏布局、半透明控制器。

## 复用与测试范围

复用现有 `checkPackagedVisualizers`、`AudioFixtureGateway`、`OutputMeasurement` 和原生歌词缓存。
新增 `NativeTests/testPackagedPlaybackFeedbackAndPageReload`，共一个唯一 XCTest，分别在手机、平板执行。
测试辅助函数向回调提供已有播放器和输出采样器，并把原诊断安装代码原样抽成可重装函数；
没有第二个音频 tap、播放器实现或新依赖。旧浮层测试只调整回调参数。

独立 QA 要求 Bundle ID 为 `app.folia.validation.App`、服务地址及平台会话为空。
两平台的受控在线歌曲身份通过已有网关样本解析到生成的 120 秒双声道音频，
使用真实 PlaybackEngine、AudioStreaming、Capacitor、NativeLyricCache 和 Classic 渲染器。
JS 包装器仅控制失败发生时机，成功命令与状态读取仍经过真实原生桥。

每个平台执行五个恢复检查点：

1. 迷你播放器暂停被拒绝一次，页面出现原有失败提示，原生音频继续播放。
2. 在展开播放器成功重试暂停，旧提示清除；等待原淡出及输出缓冲排空后，位置不前进、输出静音。
3. 真实恢复播放，取得双声道 PCM 和推进的位置。
4. 延迟一次真实 `getState` 返回，在原生新发布之后注入读取失败，确认没有旧错误闪现。
5. 实际执行 `WKWebView.reload()`，原生队列继续解码；页面恢复两首队列、当前歌名、控件和歌词画布。

## 最终结果

证据：`.mobile-test-results/native-playback-recovery/strict/`。
两端为 iOS Simulator 26.5（23F77）、arm64、Release；版本标签沿用 `0.7.16-mobile.28`。

| 检查 | iPhone 17 Pro | iPad Pro 11-inch (M5) |
| --- | --- | --- |
| 同一 XCTest | PASS，0 失败／跳过 | PASS，0 失败／跳过 |
| 恢复检查点 | 10（8 播放、2 暂停） | 10（8 播放、2 暂停） |
| 播放检查点最少 PCM 帧 | 19200，2 声道 | 19200，2 声道 |
| 最小播放 RMS | 0.1018486651 | 0.1018466757 |
| 450ms 检查窗最小位置推进 | 0.4479818594 秒 | 0.4480045351 秒 |
| 暂停位置推进／RMS | 0／0 | 0／0 |
| 迟到读取阶段捕获的错误提示 | 0 | 0 |
| 检查点页面异常／已挂载画布 GL 丢失 | 0／0 | 0／0 |

首次两端执行均通过。复核发现只断言“最终没有错误”可能漏掉短暂闪现，随后新增有上限的
`MutationObserver` 标量记录，覆盖迟到读取拒绝和检查窗；不持有 GL 对象，重载前断开观察。
加强断言后重新构建并在两端各执行一次，最终仍均通过。原始证据保留在上一级目录。
四次执行仍是一个唯一用例，最终计 20 个恢复检查点；共享辅助函数每端另有 8 个准备／设置检查点，
不把它们或重复执行叠加成唯一测试数。本批没有失败后重试。

资源构建、Capacitor 拷贝及原生 `build-for-testing` 均通过。128 个前端资源在构建目录、
Capacitor 拷贝、Xcode 产物和最终 QA 中哈希一致；QA 将生产首页映射为 `mobile.html`，
其 `index.html` 为离线测试入口。382 个 iOS 项目／测试等文件的哈希与封存清单一致，
不是 382 个 Swift 源文件。初版与加强版包的签名校验均通过；两包的前端资源相同。
具体命令保存在 `build-command.json`、`iphone-command.json`、`ipad-command.json`，均限时执行。

指定重载截图中，歌名、控件和 Classic 场景可见。原 3D 歌词的单帧超出视口不据此改版，
网页快照也不代表系统磨砂的完整合成效果。两台模拟器已恢复 Shutdown，跟踪的测试进程已退出。
包身份、源码／资源核对与清理分别见 `package.json`、上一级 `verification.json`、`cleanup.json`；
最终提交及对应 CI 结果另封存在上一级 `delivery.json`。

## 尚未覆盖

- **NOT_RUN**：本批真实平台接口、CDN、账号及物理 iPhone／iPad；受控在线身份不能替代这些验收。
- **NOT_RUN**：iOS 实际挂起、WebContent 被系统终止、后台重新解析失效地址、长播及精确音频断流测量。
  本批证明真实文档重载前后的播放与恢复，不声称量化了重载全程的无缝音频。
- **NOT_RUN**：物理触摸命中、VoiceOver、长期内存／温升、歌词误差 ≤150ms 和完整视觉验收。
  测试通过程序触发实际页面处理器；诊断在新文档准备后重装，不能覆盖整个早期加载窗口。
- 本批只使用 Classic；不算一次新的 14 模式回归，也不改写旧 WebKit 生命周期矩阵的失败／NOT_RUN 记录。

未安装或更新个人 mobile.28，未连接真实账号、物理设备或服务器，未变更依赖、模型及根 README。
回退仅涉及新增测试、共享测试回调／诊断提取及 Xcode 测试源注册，无生产行为或数据迁移。
