# 原版四轨总线的原生 PCM 对照

2026-10-12。**PASS（离线 PCM 与原生音频图自动验证）；尚未接入用户播放队列。**
这是完整 Automix 的音频输出实现步骤，接续 [手势接口](STEM_GESTURE.md)，不是完整 Automix 交付声明。
后续共同音频时钟、三路输出图与取消调度已经补充验证，见 [STEM_CLOCK.md](STEM_CLOCK.md)；下文保留本批边界。
个人 mobile.28、界面、在线账户和服务器均未更新；没有新增生产依赖。
ORT 工程接入仍待 [原审批](AUTOMIX_INTEGRATION_DECISION.md)，本批不加载模型。

## 实现与复用

- 将原 `crossfadeGraph.ts` 的软限幅公式、曲线生成和交接常量提取到纯模块 `stemBus.ts`。
  原注释保留并移动，原 `softLimit` 导出兼容；桌面与原生共用8192点Float32表、1/4前置增益、
  8ms交接和原扫频Q。没有改原公式、阈值或调度选择。
- 既有 JavaScriptCore 桥新增 `stemBus()`，完整返回曲线与参数，沿用262144字节响应上限。
- `NativeStemPCM` 验证四轨、立体声、44100Hz约定、最长30秒、同长与有限采样，控制侧持有不可变窗口。
- `NativeStemMixer` 逐块生成两首歌的四轨总线PCM：原200Hz增益曲线、按原位置折入ReplayGain、
  **仅离开歌曲的other轨**高通扫频、两端分轨交接增益、两首歌相加后统一软限幅。
  复用 `TransitionGainCurve.interpolate`、`AudioEffectBiquadCoefficients/State` 和已批准的 `WebAudioWaveShaper`。
  混音循环无网络、推理、JavaScript或等待锁；状态由渲染线程独占。
- 非法输出缓冲区不推进窗口，不越界写入；窗口结束及超出窗口的同一块尾部输出严格零。
  不对日常单曲播放应用这条分轨总线或限幅。

## 独立验证

证据目录：`.mobile-test-results/stem-mix/`。所有音频输入均由测试生成，没有真实账户或音乐文件。

| 验证 | 结果 |
|---|---|
| 原 WebKit 音频图 | `reference.log`：1项生成测试 PASS，实际调用 `connectStemBus`、`connectStemDeck`、`scheduleStemWindow`，不是手写参考DSP |
| 对照场景 | 常规、超满刻度限幅、两首不同ReplayGain、仅离开other、仅进入other、静音、双通道相同的单声道内容，共7组 |
| PCM精度 | 52,340个双声道参考采样点，128／257／8192帧三种分块逐一对照，最大绝对误差 **9.536743e-7**；预先设定门槛 **1e-5** 未放宽 |
| 原生图 | 真实 `AVAudioSourceNode → AudioEffectUnit → mainMixer` 离线渲染；有非零立体声输出，总音量静音后严格为零 |
| 原生 XCTest | 最终 **6 PASS / 0失败 / 0跳过**，`native-final.xcresult`；iPad Pro 11-inch M5 / iOS26.5模拟器，独立 `app.folia.validation.App` |
| 输入与状态 | 非有限PCM、错误声道／长度、过短窗口、非法增益、缓冲区不足均拒绝；拒绝后位置保持不变；块尾及窗口后静音、既有规划取消／隔离回归 |
| 逻辑／构建 | **90项 / 4文件 PASS**，`unit.log`；`npm run typecheck`、`npm run ios:sync`、Xcode project plist检查通过 |
| 包与清理 | `package.json`确认QA Bundle、minOS17及原生JS资源字节一致，模拟器签名校验通过；`cleanup.json`无运行中测试／构建／QA进程或已启动模拟器 |
| 真机／实际歌曲 | **NOT_RUN**。原生图为自动离线渲染，不代表实体iPad／iPhone已试听或实际后台队列已通过 |

`StemMixReference.json`约1.08MB，仅加入测试Bundle。它保存原WebKit的选定PCM采样和生成参数，
覆盖每个128帧量子、交接区间、曲线节点及6ms换轨位置；不是全量音频文件，也不是全采样误差证明。
独立测试同时检查静音、左右声道以及超限输入的软限幅上界。

### 保留的首次失败

首轮 `native.xcresult` 为5通过／1失败。失败是静音测试在写入系统混音器 `outputVolume=0`
后仅等待2块，就断言每个样本为零，未留出系统渐变时间。PCM数值对照从首轮就已通过。
只修正测试：沿用已有 `SharedStreamOutputTests` 的8块等待长度，静音只设置一次，最终仍严格断言零。
最终峰值记录（块6请求静音）为：块6 `0.22214526`，块7 `0.110938005`，块8 `0.017936965`，
块9及之后为零；完整记录在 `native-final.log`。未更改生产混音代码或放宽PCM误差门槛。

## 复跑

```sh
"$HOME/.local/bin/codex-bounded" 600 -- npm run test:unit -- \
  test/unit/mobile/nativeStems.test.ts test/unit/mobile/nativeMasterHandover.test.ts \
  test/unit/automix/crossfadeGraph.test.ts test/unit/automix/stemGesture.test.ts
```

仅在审阅原音频图变化后重新生成参考：

```sh
"$HOME/.local/bin/codex-bounded" 600 -- env FOLIA_STEM_MIX_REFERENCE=1 \
  npm run test:mobile:ui -- stem-mix-reference.spec.ts --project=phone
```

三个新增原生用例位于 `NativeStemMixTests.swift`，与上批三个分轨规划用例一起运行。
Release、`ENABLE_TESTABILITY=YES`、独立QA Bundle ID；完整Xcode命令保存在 `native-final.log` 首部。

## 剩余接入与回退

混音器目前消费已经对齐的Float32窗口，并顺序输出分轨总线。还需接通原16位分轨缓存、
两首歌媒体位置与共同音频时钟、迟到补偿、元素侧交接增益、取消／切歌／中断的原生调度，
以及原版表演模式的采样重触发／倒放与遮罩。用户播放器尚不调用此混音器。
本批没有修改 `StreamMixOutput` 或 `PlaybackEngine`，没有将无模型回退冒充完整分轨。

模型接入后仍须测完整歌曲／30秒窗口、连续过渡、真实音乐听感及推理＋播放＋动画的内存、温升和音频连续性。
内存峰值、实时分配／CPU及实体设备结果 **NOT_RUN**。
回退可撤销本批代码与引用，原桌面总线提取同步还原；无用户数据迁移，也不需要卸载个人App。
