# Automix 预播与共享输出时钟

2026-10-13。不依赖真机的独立 QA，身份 `app.folia.validation.App`，
iPad Pro 11-inch (M5)／iOS26.5／arm64 模拟器。基线 `3a60b8b7b719c546e662d5012325f117f202448c`。
个人 mobile.28、服务器、界面、原模型与混音算法未更新；没有新增依赖。
本页接续 [DISTINCT_HANDOVER.md](DISTINCT_HANDOVER.md)。**PASS_OFFLINE_NATIVE / PASS_THREE_ROUND_SIMULATOR**；
本次已复现的时钟配对回退完成修复，完整产品／真机／内存稳定性验收仍未完成。

## 已复现的缺陷

在同一 QA 进程依次运行“不同歌曲、同一歌曲的两个独立队列项”时，第二轮模型准备完成，
但退回普通主音轨淡化。歌曲仍能播放与切换，严格的 `sawStem` 断言失败，不能算完整 Automix 通过。

保留的 `source-observed` 记录显示：250ms 内44次读取都缺少有效的 incoming 时钟；
outgoing／共享输出的帧末尾为 **4298878**，incoming 为 **4298877**。
两路均为原速 raw PCM，incoming 正在播放、未 seek／结束，缓冲约9.744秒。
不是通过延长等待或接受旧快照解决：原先把源节点的局部样本时间直接当作共享输出时间，
两者在晚接入的真实图中可以相差1帧。另一轮停在原始 outgoing 锚点缺失，记录也保留。

短测试、开启原生分析／音频 tap、手动快速推进至较大时间后再 seek 均未单独复现。
因此保留完整两轮联合场景作为能检出该问题的回归，而不以短测试通过代替它。
仅替换声道布局转换的候选也未解决问题：42次读取仍差1帧；该结果未被隐藏。

## 最小实现与复用

- `StreamRenderSource` 用现有 Accelerate 将解码器的交错 Float32 等值拆成输出节点需要的双声道平面格式。
  缓冲在控制线程预分配，每个源最多8192帧／64KiB；回调不新增分配、解码、重采样或模型工作。
- `NativeTempoHandover` 在源回调只记录本次拉取的实际位置、帧数和完整性。
  `TransitionDeckProcessor` 拉取完成后，以它自己的共享输出时间调用 `bindMediaClock`，
  复用 `NativeMediaClockTracker` 发布准确锚点。只有一次完整且帧数相同的拉取可以映射。
- 未发生新拉取、重复消费、分批／多次拉取、帧数不同、缺帧、暂停、重置和关闭都不能沿用旧投影。
  原来源身份、epoch、严格帧末尾相等、250ms 等待上限与普通淡化回退保持有效。
- clock owner 由控制线程持有／释放，在移除或关闭图时清除；渲染侧只在已有 `try` 锁内使用，
  不等待控制线程，也不接管对象寿命。分轨总线实现保持原样。
- `NativeAnalysisTrace` 可选记录源／配对失败的标量；正常实例默认不启用，不记录歌曲身份、URL或凭据。

独立的无下游节点 `NativeTempoHandover` 用例继续使用原时钟方式。原规划器、模型、DSP曲线、
拍点、歌词与动效均未改变。源码修复不自动开放个人安装包的完整 Automix 能力。

## 测试与证据边界

证据保存在 `.mobile-test-results/preplay-clock/`；每个命令有 JSON 参数、有限日志和最终 xcresult。
以下批次有重复用例，不累加成独立覆盖数。

| 批次 | 通过 | 失败 | 跳过 | 含义 |
|---|---:|---:|---:|---|
| `probe` | 1 | 0 | 0 | 最初16轮短预播／seek；后续测试 helper 有调整 |
| `analysis` | 2 | 0 | 0 | 原生分析及原音乐的32轮短检查 |
| `measured` | 1 | 0 | 0 | 含实际输出 tap 的16轮短检查 |
| `long-clock`／`long-seek-clock` | 各1 | 0 | 0 | 快速推进实际48k输出图，后者增加正常 seek |
| `consecutive`／`observed`／`source-observed` | 0 | 各1 | 0 | 第一轮通过、第二轮回退；失败后不运行第三轮 |
| `planar-focused` | 9 | 1 | 0 | 同时替换分轨源的候选破坏重置检查，已撤回该部分 |
| `decoder-planar-focused` | 16 | 0 | 0 | 只替换解码源的短回归通过 |
| `decoder-planar-joint` | 0 | 1 | 0 | 仅改布局仍不能通过完整第二轮 |
| `host-clock-focused` | 17 | 0 | 0 | 精确消费映射、64轮短配对、双声道／音效／重置／混音回归 |
| `host-clock-joint` | 1 | 0 | 0 | 一个严格用例连续执行三轮原模型联合交接 |
| `final-lifecycle` | 4 | 0 | 0 | 最终测试缓冲初始化后，消费映射、对象释放、重启与双曲偏移 |

`host-clock-focused` 的真实音频图混音最大PCM差为 `2.9802322e-8`；
重置前后恢复当前解码器的最大PCM差为0。新的消费映射用例验证相差1帧的局部时间，
并明确拒绝重复、缺失、多次、帧数不等、部分拉取及关闭后的读数；宿主重置更换epoch。
这些生成素材检查不能替代真实模型、在线平台、设备性能或听感验收。

三轮均使用原 `beat_this`／`htdemucs`、完整音乐、生产规划器、真实队列和心象 renderer，
通过正常 seek 移到原交接点；没有替换为生成分轨、假计划或缩短窗口。

| 轮次 | 音乐 | 模型准备 | 交接观察 | 观察到分轨的采样数 | 结果 |
|---|---|---:|---:|---:|---|
| 0 | Fishin' → Vibe Ace | 28.86秒 | 10.07秒 | 84／99 | ready-expansion，完整结束 |
| 1 | 两个独立 Fishin' 队列项 | 30.87秒 | 23.54秒 | 217／232 | ready-expansion，完整结束 |
| 2 | 两个独立 Fishin' 队列项 | 30.82秒 | 23.64秒 | 218／233 | ready-expansion，完整结束 |

每轮配对均在第2次读取成功，帧末尾分别为1695726、4276340、7446365，两路与共享输出严格相等。
三轮没有停止采样、分轨失败或时钟失效，结束后只保留一个解码器且继续播放。
报告、附件和统计分别在 `host-clock-joint-reports`、`host-clock-attachments`、
`analysis-host-clock.json`；9个原始JSON报告与XCTest附件逐字节一致。

模型阶段 rAF 平均约59.87—59.94Hz、P95间隔17ms，100ms主线程轮询最大间隔约108ms。
这不是GPU呈现帧率或手机性能。主进程footprint采样峰值依次约1.70／1.93／2.29GB，
恢复阶段采样峰值约0.57／0.64／0.77GB；均排除WebContent。0次内存警告、thermal采样均为0，
**不能据此认定内存稳定或真机可用**。重复轮次内存增长尚需独立分析，不能解释成已证明泄漏或无泄漏。

## 包身份、未执行项与回退

各候选的源文件、可执行文件与测试包摘要分别记录在 `package-*.json`，不可混用。
`package-host-clock.json` 对应 `native-sources-host-clock.json` 的完整原生源／测试清单。
随后仅将消费映射用例的测试缓冲显式清零，并补跑对象释放／暂停恢复边界；生产代码未再变化。
最终包对应 `package-final.json`／`native-sources-final.json`，Release构建、模拟器签名及依赖源码校验通过。
前端沿用已有产物，123项资源在 `dist-mobile`、Capacitor拷贝与QA包中逐项核对；
其内嵌标签仍为 `b0a883d…/mobile.28`，不能当作本轮Swift源码身份。

手机联合负载／温升、物理iPad、真实QQ／网易云在线Automix、长期后台、
WebContent与主进程合计内存、人工听感及150ms歌词同步均 **NOT_RUN**。
本轮只处理可在离线源码与模拟器验证的内容，不把模拟器通过提升为真机验收。

回退本轮提交即可恢复旧音频源／时钟发布方式，无曲库、凭据、配置或模型迁移。
个人 `BUILD_RECORD.json` SHA256须保持
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。

结束时停止独立QA，将模拟器恢复为起始Shutdown状态；构建／测试进程均已退出，见 `cleanup.json`。
未执行设备、个人App或服务器操作。原模型／参考素材的身份及部署方法沿用前文链接。
