# 原版分轨手势的原生计算接口

2026-10-12。**PASS（逻辑／原生 JavaScriptCore 自动对照）；完整 Automix 尚未接通。**
此批只补齐分轨过渡的计划与曲线接口，不更新个人 mobile.28、不改变界面、不调用真实平台或部署服务器。
ORT 工程接入仍遵循 [接入评估](AUTOMIX_INTEGRATION_DECISION.md) 的 PENDING_APPROVAL 状态。

## 复用与边界

- `nativeStemRuntime.ts` 直接调用原 `planStemHandover`、`outgoingCurves`、`incomingCurves`，
  保留人声 rest／recede／release、调性冲突、无人声截止、6ms 换手及原非互补下降曲线。
  没有改 `stemGesture.ts`，没有重新实现手势算法或增加生产依赖。
- 输入为一段 0.8–30 秒窗口、原 50ms RMS 包络、上下首小节长度、下拍及原会话得出的 `sings`／`keysClash`。
  `sings` 必须来自原会话的分轨与段落证据组合；该接口不猜测实际人声起点，也不代替包络生成。
- 原 `other` 高通扫频端点与时长一同返回。实际滤波、四轨调度、8ms 元素／分轨交接、
  ReplayGain、扩展表演手势、总线限幅与原音频时钟的接入仍待完成。
- `NativeTransitionPlanner.stems` 在既有串行 actor 中准备不可变输出，不运行于音频渲染线程。
  每条曲线独立传输，保留 200Hz、Float32 和两端采样点。30 秒仍有每轨 6,000 点；
  未降低精度、扩大单次 262,144 字节上限或引入共享“上次计划”。
- JSON 边界校验抽到 `nativeTransitionInput.ts`，既有主混音／平衡／回声／ReplayGain 共用原协议与限额。
  输入检查覆盖非有限数、Float32 溢出、包络长度、下拍顺序及非法方向／分轨；每次原生桥调用检查取消，
  失败或取消不交付半成品。JS 数据以参数传入，不作为源码求值。

## 验证

证据目录：`.mobile-test-results/stem-gesture/`（本地忽略产物）。提交的 `StemGestureReference.json`
只含生成的包络和原函数输出；曲线以 little-endian Float32 base64 存储，没有真实音频或账户信息。
这份约995KB的对照文件仅属于测试 Bundle，不加入个人 App 资源。

| 项目 | 结果与证据 |
|---|---|
| 逻辑回归 | **93 / 7 文件 PASS**，`unit-final.log`；涵盖新分轨边界、原手势以及现有主混音、平衡、回声、ReplayGain。最初70项为子集，不累加 |
| 静态检查 | `npm run typecheck` PASS，`typecheck.log`；`git diff --check`、Xcode project plist检查通过 |
| 移动打包 | `npm run ios:sync` PASS，`sync.log`；没有安装新依赖 |
| 原生 XCTest | **7 PASS，0失败／跳过**，`native.xcresult`、`native-summary.json`；iPad Pro 11-inch M5 模拟器／iOS26.5，独立 `app.folia.validation.App` |
| 原输出对照 | 9场景、72条曲线、182,096个采样点：TS逐点相等；Swift／JavaScriptCore阈值绝对误差≤1e-6。覆盖0.8秒、30秒、静音、休止、长音、调性冲突、无人声及无节拍 |
| 生命周期 | 原生取消、并发请求隔离、非法输入后恢复、缺少运行资源明确失败；既有80种计划／36种包络对照同时回归 |
| 包一致性 | `package.json`：打包 `transitions.js` 与本地生成资源字节相等；107,157字节，SHA256 `33030b6d736840b3eb26662b827d3e618dfb819703e654f31ead261ce9590002`；minOS17，模拟器签名验证通过 |
| 真机／实际音频 | **NOT_RUN**。本批不包含模型推理、PCM混音、听感、后台切曲或播放与动画争用验证 |

复跑逻辑：

```sh
"$HOME/.local/bin/codex-bounded" 600 -- npm run test:unit -- \
  test/unit/mobile/nativeStems.test.ts test/unit/mobile/nativeTransitions.test.ts \
  test/unit/mobile/nativeMasterHandover.test.ts test/unit/mobile/nativeBalance.test.ts \
  test/unit/mobile/nativeReplayGain.test.ts test/unit/mobile/nativeEcho.test.ts \
  test/unit/automix/stemGesture.test.ts
```

更新原函数对照文件时，显式设置 `FOLIA_STEM_REFERENCE=1`，再不带该变量复跑。
原生测试在现有 `FoliaNativeTests/NativeTests` 中新增 `testOriginalStemGesturesInJavaScriptCore`、
`testStemRuntimeRejectsInvalidInputAndRecovers`、`testStemCancellationAndConcurrentRequests`；
与既有4项 `NativeTransitionTests.swift` 用例一起执行，Release、`ENABLE_TESTABILITY=YES`、独立QA Bundle ID。
原生构建／测试完整命令保存在 `native.log` 首部。

## 交付与回退

源码提交 `ba803046b2dbe89f5068a85eec853b08361b0d75` 已推送至 `Kun686/folia-Player` 的 main。
该准确提交的 [Mobile checks](https://github.com/Kun686/folia-Player/actions/runs/38194847733) 为 **completed / success**；
首次完整SHA查询遇到TLS超时，关闭HTTP/2后的一次重试取得最终结果，见本地 `ci.json`。
清理确认没有运行中的构建／测试／QA进程或已启动模拟器，见 `cleanup.json`。

本批是待接入播放器的计算模块，没有开启分轨播放，也不改变现有主混音回退。
个人构建记录 SHA256 仍为 `ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。
可按独立提交撤回新增桥接、测试与共享校验提取；不涉及用户数据迁移。
进一步启用仍须完成模型依赖授权、原分轨调度／扩展手势、实际PCM对照以及播放／动画联合资源检查。
