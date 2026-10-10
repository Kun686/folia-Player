# 原版 Automix 移植记录

2026-10-11。当前已安装版本仍为 mobile.7；本文件记录其后的源码开发，不修改
BUILD_RECORD.json 所指向的已交付安装包。完整 Automix 尚未接入移动播放器。

## 已验证：原规则独立于 WebView 执行

- `nativeRuntime.ts` 只增加 JSON 边界，直接调用既有 `planForMode`、`planBlendShape`、
  `shapeBlend`、`buildCrossfadeCurves`、`buildBandCurves`。原算法、常量和默认 64 点曲线不改。
- 已有 Vite 将这组纯计算模块打包为 `public/native/transitions.js`；系统 JavaScriptCore
  执行本地脚本，Swift actor 串行持有上下文。请求作为函数参数传入，不能变成脚本源码。
  没有新增 npm、SPM、模型或运行库依赖，不通过 WKWebView、服务器或网络执行。
- 输入限制大小、嵌套深度、节点数、有限数值、模式和数据结构；取消前后均检查，错误不带输入。
- TypeScript 检查、四个相关 Vitest 文件共 78 项测试通过，证据
  `.mobile-test-results/transition-boundary-json.log`。其中参考覆盖 80 组方案和 36 组曲线。
  首轮两项失败是 JSON 把负零序列化为零，统一序列化后通过；非零样本仍精确比较，原算法未改。
- iPad Pro 11-inch (M5) / iOS 26.5 / Release：四项原生测试通过（0.168 秒），
  在 JavaScriptCore 重放同一组 80 方案、36 曲线，另测错误恢复、缺失资源、取消与 16 个并发请求隔离。
  数值容差 1e-6。证据 `transition-native-first.{log,xcresult}`。
- `npm run ios:sync` 通过，证据 `transition-runtime-build.log`。规划资源首次构建为 99,630 字节，
  这只是脚本资源大小，不是 IPA 或安装体积增量。

这证明原规则可在原生运行时执行；不证明后台音频过渡已经发生。参考输入含受控 profile 和歌词，
不等于移动端已经能从真实歌曲测出这些输入。

## 待接入的完整播放行为

| 部分 | 状态 |
| --- | --- |
| 原规划与曲线计算 | PASS，尚未接入 PlaybackEngine |
| 两个解码器汇入同一混音与整体 DSP 输出 | NOT_IMPLEMENTED |
| 按采样时钟调度增益、频带交接、回声、伸缩 | NOT_IMPLEMENTED |
| profile 获取、分析缓存、Beat This! / htdemucs 模型与表演手势 | NOT_IMPLEMENTED |
| 原设置与队列、暂停、拖动、失败、后台状态接线 | NOT_IMPLEMENTED |
| 真机连续混音、听感、功耗与歌词时序验收 | NOT_RUN |

下一步复用固定 AudioStreaming 已有的 AVAudioEngine 手动渲染，把解码后的两路音频接入一个
系统混音图。当前 mobile.7 每个播放项独立处理音效并输出；仅调两路音量会重复噪声与非线性音效，
也没有原版共享限幅，所以不能据此宣称 Automix 等价。

解码、网络分段、缓冲与取消继续复用已批准依赖；任何 vendor 调整都同步完整补丁和文件哈希。
未经数值与实际输出验证，不启用新混音路径作为默认。旧包与旧播放路径保留回退。
