# 原版 Automix 表演模式的原生输出

2026-10-12。**PASS（逻辑、原 WebKit 数值对照、原生模拟器自动测试）；尚未接入用户队列。**
接续 [分轨存储与媒体对齐](STEM_STORAGE.md)。个人 mobile.28、已接受的界面、账户及服务器未更新。
未增加生产依赖，未链接 ORT；模型工程接入仍见 [待批准方案](AUTOMIX_INTEGRATION_DECISION.md)。

## 复用与实现

最简方案是直接调用原 `expansionGesture.ts` 的规划、遮罩和采样渲染函数，
复用已有 JavaScriptCore 与原生分轨总线，不在 Swift 中重写重触发／倒放算法。

- 保留 25%、50%、75%、100% 四档强度、按节拍逐级细分的重复、渐进升速、2ms 循环边缘及倒放衰减。
  仅高两档加入 other，bass／vocals 不参与重触发，结束点仍是原鼓点交接时刻。
  空间不足仍返回原版 null；强度自动选择与该原因的用户队列诊断尚未接入。
- `nativeStemRuntime` 调用原规划与 `expansionMask`，只遮罩指定 outgoing 轨道，顺序仍在 ReplayGain 之前。
  `NativeTransitionPlanner` 返回可选计划；混音器拒绝有遮罩却缺少对应渲染 PCM 的请求。
- `NativeExpansionRenderer` 在控制侧的 actor 中逐声道调用原 `renderExpansion`，按原顺序先 drums 后 other
  求和，每次写入保持 Float32 舍入。短生命周期 JavaScriptCore VM 及 autoreleasepool 在准备完成后释放。
  复用从曲目分析器抽出的 `NativeFloat32Bridge`，NSData 持有输入，JSC 读取 typed array，输出立即复制。
  完整 PCM 不经过 JSON；JSON 上限保持 262,144 字节。
- 保留两种不同的源读取语义：普通分轨读取分数媒体偏移；表演素材读取
  `round(offset) + round(late * rate)` 的原整数切片。
  表演输出的开始时间仍可落在分数采样位置，采用原 WebKit 实测插值及末两点外推行为。
- 表演 PCM 进入 outgoing 交接节点，按原顺序应用 ReplayGain、8ms 拼接、共同限幅及后续效果／总音量。
  不经过 outgoing other 的高通扫频。共享时钟、旧意图隔离与取消复用已有分轨实现。
- 输入限定为双声道 44.1kHz、最多 30 秒、256 个重复项，检查时长、数值、越界与峰值溢出。
  0.35 秒最小跨度的元数据校验容许 1e-8 的浮点相减误差；原规划器的门槛没有改动。
  取消在声道调用前后检查，10 秒累计期限在每次 JS 返回后检查；**不是运行中的 JS 强制中断保证**。
  实时音频回调仅读取已准备 PCM，不运行 JSC 或构造音频数组。

## 验证

证据目录：`.mobile-test-results/expansion/`。

| 验证 | 结果与边界 |
|---|---|
| 逻辑测试 | `unit.log`：**99 项 / 5 文件 PASS**；四档计划与全部曲线、关闭／空间不足、最小跨度、输入限制，以及原会话／窗口回归 |
| WebKit 参考生成 | `reference.log`、`reference-final.log`：两次各 1 项 PASS；直接使用原计划、渲染、遮罩及真实原音频图 |
| 完整渲染 PCM | 6 个有效计划、**12 个完整声道 SHA256 与原版完全相同**；涵盖四档、奇数拍与非整数开始时间、静音；第 7 组空间不足无表演 PCM |
| 最终混音 | **184,624 个参考采样**，分别用 128／257／8192 帧块长比较；最大差 **4.8428774e-7**，低于事先设定的 1e-5；涵盖 ReplayGain、限幅和交接点邻域 |
| 原生音频图 | 生成 WAV → 两个真实 AudioStreaming 解码器 → 共享分轨／表演输出，最大差 **0**（原门槛 5e-6）；取消恢复原始两路，最终静音逐采样为零 |
| 素材与资源 | 整数素材切片与分数普通分轨的区别、缺失运行时、预取消、非法 PCM、typed array 类型／长度及持有者释放通过 |
| 原生 XCTest | `native.xcresult`、`native-summary.json`：**43 PASS / 0 失败 / 0 跳过**；含 35 项既有分轨／时钟／主混音测试和 4 项曲目分析回归 |
| 环境 | iPad Pro 11-inch (M5) / iOS26.5 **模拟器**，Release、ENABLE_TESTABILITY=YES；独立 `app.folia.validation.App`，最低 iOS17 |
| 构建与资源 | 类型检查、`npm run ios:sync`、plist／diff 及模拟器签名通过；6 个原生 JS 与构建资源一致，参考文件与测试包一致，见 `package.json` |
| 实际音乐／设备 | **NOT_RUN**；没有模型调用、真实账户输入、真机听感、联合播放／动画负载、内存峰值或长期性能结论 |

`ExpansionReference.json` 为 4,077,352 字节，仅属于 XCTest 资源，不加入普通 App 的生产资源。
`transitions.js` 从 108,246 增至 111,409 字节，增加 3,163 字节；这不是安装包或运行内存增量。
现有包管理文件与锁文件未变，个人 `BUILD_RECORD.json` 的 SHA256 保持
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。

### 保留的检查差异

- 首次类型检查失败于参考脚本的 WebCrypto 输入类型：`Uint8Array<ArrayBufferLike>` 不满足 BufferSource。
  改为复制精确 byteOffset／byteLength 到明确 ArrayBuffer 的字节数组后通过，
  `typecheck-first.log` 保留；生产算法及 PCM 误差门槛没有修改。
- 修正类型后复跑参考生成，整文件 SHA256 比较失败：两次真实 WebKit 音频图有 **161 个采样**不同，
  最大差 **5.364418029785156e-7**；全部计划、12 个渲染声道摘要和 5 组独立开始时刻参考相同。
  这说明音频图输出不能要求跨次字节相同；本次没有进一步定位这项浮点波动的内部来源。
  两份原始参考及逐组差异保存在 `reference-initial.json`、`reference-repeat.json`、
  `reference-repeat-comparison.json`，原比较失败记录保留在 `reference.json`。
  提交的参考恢复为实际 43 项原生测试使用的首份，摘要与测试 Bundle 一致；没有挑换门槛或修改样本求通过。

## 复跑与剩余工作

```sh
"$HOME/.local/bin/codex-bounded" 600 -- npm run test:unit -- \
  test/unit/mobile/nativeExpansion.test.ts test/unit/mobile/nativeStems.test.ts \
  test/unit/mobile/nativeStemWindow.test.ts test/unit/automix/expansionGesture.test.ts \
  test/unit/automix/automixSession.test.ts
```

仅在审阅原算法／音频图后主动重建参考；重建会覆盖文件，并非日常测试：

```sh
"$HOME/.local/bin/codex-bounded" 600 -- env FOLIA_EXPANSION_REFERENCE=1 \
  npm run test:mobile:ui -- expansion-reference.spec.ts --project=phone
```

原生完整选择与命令保存在 `tests.json`、`command.json`；清理检查见 `cleanup.json`。
后续从分轨 PCM 直接生成包络、前奏判断及计划的衔接已通过独立对照，见 [STEM_ANALYSIS.md](STEM_ANALYSIS.md)。
`NativeCrossfade` 的生产请求仍为 `performance: false`，还没有调用分轨缓存／表演渲染接口。
模型、完整媒体读取、真实播放位置、强度选择／空间不足诊断、连续过渡与资源争用必须接通并验证后，
才可声称完整 Automix 可供用户使用。

回退撤销本批表演桥接、混音可选参数和 Xcode 引用，恢复曲目分析器原 typed array helper；
无持久存储迁移，未变更模型或用户安装。
