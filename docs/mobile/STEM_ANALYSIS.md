# 原版分轨 PCM 测量与计划衔接

2026-10-12。**PASS（原算法数值对照、原生模拟器自动测试）；完整 Automix 仍未接入用户队列。**
接续 [表演模式输出](EXPANSION.md)。本批让原生计划读取分轨 PCM 的实际测量，
补齐此前需要调用方提供包络的边界。个人 mobile.28、界面、账户和服务器未更新。
没有新生产依赖；ORT 工程接入仍为 [PENDING_APPROVAL](AUTOMIX_INTEGRATION_DECISION.md)。

## 复用与行为

复用原 `envelopeOf`、`lastVocalMoment`、`singsInWindow`、`barGrid` 及已经验证的分轨计划与混音器。
沿用 JavaScriptCore、NSData typed array 桥和原 16 位缓存；自研部分只承担输入检查、生命周期与平台衔接。

- `NativeStemAnalysis.window` 在量化前用原始 vocals 和原曲 mix 计算尾端人声结束点，
  再调用现有 `NativeStemWindow` 保存。不是用四轨合成结果替代原曲参考，也不使用歌词猜测。
  head 不计算尾端结束点；无足够持续人声时保留原 null。
- 计划所需的包络则按原会话行为，从恢复后的 16 位窗口读取；`NativeStemWindow.mixed` 按
  vocals → drums → bass → other 的原顺序相加，每次相加都写回 Float32。
  一次只解码一条立体声声部，不为测量常驻四轨完整 Float32 副本。
- 分析片段沿用原覆盖检查的整数偏移，**在迟到补偿之前测量**。
  实际播放的分数偏移与表演素材的迟到整数切片，仍由已有 `NativeStemWindowPair` 负责。
  缺少完整覆盖时返回 nil，让调用方保持原主混音回退；不会用补零片段伪造有效观测。
- incoming vocals 只测当前过渡片段，参考音量取整个已分离的 head。
  只有声部未找到人声、且结构边界在过渡窗口之后，两项同时成立，才判定前奏无人声。
  结构信息未知或边界位于窗口内时仍保守地认为有人声。
- 从原 `automixSession` 提取 `stemDownbeats` 和 `incomingStemSings` 到 `stemObservation.ts`，
  桌面与原生共同调用原表达式。保留原注释；小节相位来自 downbeat，拍数来自原 profile，缺失相位不猜网格。
- 原生仅把最多 600 个单元的包络和时间元数据放入 JSON，维持原 262,144 字节上限。
  PCM 使用有界双声道 Float32 typed array，短生命周期 JSC VM 在请求结束后释放。
  检查取消、NaN／无穷、声道与长度、不可用运行时；网格输入有界，拒绝会导致 period 无穷的微小 BPM。
  JS 内部采样循环仍是有界同步工作，不宣称能在任意一个采样中间立即取消。

`NativeStemAnalysis.request` 的输出可直接交给 `NativeTransitionPlanner.stems`，再进入既有窗口对齐、
表演素材渲染和混音器。模型尚未提供这些实际分轨，生产 `NativeCrossfade` 也尚未调用这条链路。

## 验证证据

证据目录：`.mobile-test-results/stem-analysis/`。

| 检查 | 结果与边界 |
|---|---|
| 逻辑测试 | `unit.log`：**138 项 / 6 文件 PASS**；原会话、人声手势、现有桥接与新增测量 |
| 原始参考 | `StemAnalysisReference.json`：193,822 字节，8 组完整 30 秒生成 PCM；调用原峰值量化、包络、持续人声规则与手势；不含用户音乐 |
| 观测与曲线 | 原生恢复及 JSC 测量的 **2,088 个 outgoing 包络值逐值相同**，**64 条完整 Float32 增益曲线 SHA256 相同**；16 个恢复 mix 声道摘要相同 |
| 语义样本 | 安静前奏、未知结构、窗口内边界、实际有声部、奇数拍／分数媒体位置、越过前奏、静音无网格、反相声道；尾端结束点分别与原未量化参考一致 |
| 前奏负例 | quiet-intro：局部 mix 作参考会找到人声，整段 head 参考不找到；原生返回 incoming.sings=false。未知结构、窗口内边界或实际人声三组仍为 true |
| 计划到输出 | 测量 → 原规划 → 窗口对齐 → 原表演 PCM → 原生混音，输出 **289,737 帧**，全部有限，峰值 **0.3734601**；此项是生成 PCM 的连通验证，不是实际音乐听感 |
| 原生 XCTest | `native-final.xcresult`、`native-summary.json`：**46 PASS / 0 失败 / 0 跳过**。含 43 项既有表演、分轨缓存、共享解码器图、时钟、音效与曲目分析回归 |
| 取消与恢复 | 预取消、缺失运行时、无效 PCM、不覆盖窗口、非有限网格周期拒绝；后续合法请求成功，分析器不保留旧窗口引用 |
| 环境 | iPad Pro 11-inch (M5) / iOS26.5 **模拟器**，Release、ENABLE_TESTABILITY=YES、独立 `app.folia.validation.App`，最低 iOS17 |
| 构建与资源 | 类型检查、资源同步、plist／diff、模拟器签名通过；6 个 JS 资源与构建输出一致，参考与 XCTest Bundle 一致，见 `package.json` |
| 真机／真实平台 | **NOT_RUN**；无本次真实歌曲分轨、模型调用、真实账户操作或实体设备听感／长期性能验收 |

每个参考场景均保留原 30 秒 head／tail，不为通过测试缩短窗口。
数字声道完全相同仅适用于记录的生成样本；不能外推为全编码、全曲库或模型数值验收。
本批 JS 资源从 111,409 增到 113,633 字节；参考 JSON 仅加入测试 Bundle。
这不是个人安装包体积或实测进程内存结论，联合推理／播放／动画的内存及 CPU 仍待测。

### 保留的检查失败

- 初次类型检查因校验后的 unknown 数组没有被 TypeScript 收窄，无法构造 Float32Array；
  补上已验证的数组类型后通过。`typecheck-first.log` 保留，输入验证没有放宽。
- 初次逻辑套件为 137 PASS / 1 失败：8 组完整 30 秒参考构造约 7.3 秒，超过默认单测 5 秒时限。
  为这一项设定明确的 30 秒执行上限后重跑 138 项通过；`unit-first.log` 保留。
  未改变样本、数值阈值或摘要比较；该测试不作为速度验收。
- 初次原生构建仅在测试中给只读 `outAt` 赋值而失败，尚未执行 XCTest。
  测试改为新建上下文后重跑一次，46 项通过；`native.log`／`native.xcresult` 保留首次失败，
  生产上下文的只读约束没有改变。

## 复跑、剩余接入与回退

```sh
"$HOME/.local/bin/codex-bounded" 600 -- npm run test:unit -- \
  test/unit/mobile/nativeStemAnalysis.test.ts test/unit/mobile/nativeStems.test.ts \
  test/unit/mobile/nativeStemWindow.test.ts test/unit/mobile/nativeExpansion.test.ts \
  test/unit/automix/automixSession.test.ts test/unit/automix/stemGesture.test.ts
```

原生选择及完整命令在 `tests.json`、`command-final.json`。只有审阅原算法变化后，才用
`FOLIA_STEM_ANALYSIS_REFERENCE=1` 主动重建参考；正常单测只校验已提交参考。
清理记录在 `cleanup.json`；个人 `BUILD_RECORD.json` 摘要仍为
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。

完整媒体读取／摘要及首尾窗口接口随后已补齐，见 [STEM_MEDIA.md](STEM_MEDIA.md)。
模型调用、将尾端结束点反馈给主计划、队列意图与缓存生命周期、实际时钟和动画 cue
仍需接通；真实音乐和联合资源负载也尚未验收。此批没有启用完整 Automix。

回退撤销新增测量桥、窗口 mix 方法及 Xcode 引用，把两个小节／前奏表达式恢复到原会话；
没有持久数据迁移、模型改动或个人安装更新。
