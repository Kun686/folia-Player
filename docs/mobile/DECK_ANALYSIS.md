# 原生逐曲实时分析移植

2026-10-11。开发阶段，尚未生成新安装包；已安装版本仍以 BUILD_RECORD.json 的 mobile.10 为准。
完整 Automix、真实平台与长时间锁屏验收尚未完成。

## 实现与复用

- 从原 `deckAnalyser.ts` 抽出 `deckMeasurements.ts`，保留原响度峰值、320 帧 onset 历史、
  节拍估计、0.5 秒刷新、连续性判断及 reset 语义。Web Audio 仍使用原滤波和 analyser 接线。
  抽取前在原实现上冻结 `deckMeasurementsReference.json`；之后不再生成该基线。
- Vite 将共享状态打包为 `native/deck.js`；每个原生播放源的 JavaScriptCore 状态相互隔离，
  不依赖 WKWebView、服务器或前台频谱请求。不新增依赖，也不扩大 WebKit 源码复用范围。
- `NativeDeckCapture` 接在解码 PCM 与淡化增益之间、整体音效之前，复用已有 biquad 公式及状态。
  K-weight 参数沿用原版：1681.974 Hz / +4 dB 高架，38.135 Hz / Q=0.5003 dB 高通。
  每路先滤波再立体声降混，音频回调不改写声音，不等待锁，不运行 FFT 或 JS。
- `NativeDeckAnalysis` 在独立串行队列以 25ms 周期读取窗口；复用 `AudioSpectrum` 的
  Blackman/Accelerate 计算，分析使用 1024 点、无平滑；可视化仍为原 2048 点 / 0.6 平滑。
  FFT 与 JS 在复制窗口、释放捕获锁后执行。关闭混音、暂停输出、释放最后一路时停止计时器。
- 预加载但尚未播放的解码器不取样、不消耗开头。拖动、输出配置改变和丢失 PCM 块会丢弃旧窗口；
  不再将这些部分播放记录标作完整历史。源身份及代次保护异步结果；队列字典在主线程读取。
  分析失败时退回无测量输入，不停止音乐。
- `NativeCrossfade` 执行原包络时现可读到实时响度、节拍与下一拍，而非固定空值。
  仍使用原 Crossfade 规划器；尚未切换至完整 Automix，也未加入其频带、回声、伸缩、平衡或动画事件。

## 验证

- TypeScript：PASS，`deck-typecheck-final.log`。
- 移动构建：PASS，`deck-mobile-build.log`，生成的 `deck.js` 约 2.98 kB（不是 App 体积增量）。
  固定 AudioStreaming 源码 59 文件及两处既有补丁校验通过；依赖和 vendor 未改。
- Vitest：34 文件 / 468 项 PASS，`deck-unit-final.log`。包括原 Automix 测试、
  Web Audio 与 native JSON 边界对冻结基线的重放、非法输入及 reset。
- WebKit：`deck-webkit-live-reference.log`，真实 OfflineAudioContext 调用原 tap。
  9 组 PCM/频谱（44.1/48/96kHz，普通／反相／单侧立体声）及两段各 10 秒实时测量。
- iPad Pro 11-inch (M5) / iOS 26.5 / Release：
  `deck-final-corrected.{log,xcresult}`，148 项 PASS，66.599 秒。
  原 DSP、队列、凭据、缓存及过渡回归通过；三个要求独立 HTTP fixture 服务的测试未在此命令运行。
- 最后增加异步读取前后代次校验后，`deck-epoch-final.{log,xcresult}` 的双路释放、真实解码暂停／seek、
  真实队列推进和快速取消四项再次 PASS，6.677 秒。
- K-weight PCM 在这些样本中逐样本一致；有效频谱最大差 0.000015258789 dB。
  两段完整链路中响度、tempo confidence 差值均为零；BPM、beat offset、next beat 的断言全部通过。
  这些是限定样本证据，不代表任意音乐或全部设备的数值等价。
- 实际解码器／AVAudioEngine：在没有 WebView 调用和频谱读取的情况下测得各路响度；
  最终静音、某路淡出至零不改变其自身分析；暂停不重复计数，恢复和 seek 不伪造完整历史，
  预加载静默，删除一路不影响另一路，停止后对象释放。

日志与 xcresult 位于本地 `.mobile-test-results/`。尚未进行本阶段的物理 iPhone/iPad、
30 分钟锁屏、耳机／蓝牙／网络切换及持续功耗测量：NOT_RUN。
完整 Automix 的档案网格与实时测量合并、响度平衡、频带交接、回声、伸缩、动画及模型分支仍待移植。

## 排错记录

首轮原生编译发现生成代码含字面换行转义，已修正；测试资源 JSON 末尾存在同类转义时主动停止构建、
校验 JSON 后重跑。后续新增释放测试又发现一处同类测试源码问题，修正后完整回归通过。
最初的频谱测试要求 WebKit 的零值频点在 Accelerate 中也必须精确为零，未通过。
差异位于本组样本的高频、低于约 -185 dB，均超出原 5kHz flux 频段；现验证该数值底噪低于
-150 dB，反相数字静音仍要求精确零，并补充完整 PCM→原始节拍规则的独立对照。
未为通过测试修改原算法或听得见的音频。原失败和取消日志保留。
