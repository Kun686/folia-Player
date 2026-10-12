# 原版分轨窗口存储、缓存与媒体对齐

2026-10-12。**PASS（逻辑、原WebKit对照、原生模拟器自动测试）；完整Automix仍未接入用户队列。**
接续 [共同音频时钟](STEM_CLOCK.md)。本批保持原30秒窗口、四窗口预算与原采样率，不新增依赖或修改模型。
个人mobile.28、界面、账户与服务器没有更新。ORT工程接入仍见 [待批准方案](AUTOMIX_INTEGRATION_DECISION.md)。

## 实现与复用

- `NativeStemWindow` 用原版逐轨峰值缩放、左右声道首尾排列的Int16格式保存四轨。
  `other` 按原 `stems.ts` 从未量化的原曲减去drums、bass、vocals：先Double计算，再存Float32。
  量化保留JavaScript负数半值向正无穷舍入的行为。读取时才为实际播放片段还原Float32。
- `NativeStemCache` 是串行actor，最多保存四窗口。读取更新最近使用顺序；优先保护即将播放的一对。
  已完成但暂时不需要的结果，有空位就保留；满额时先丢弃该迟到结果，否则驱逐最早不需要的窗口。
  不在每次过渡结束时清空上一对，以保留原版“上一首／重放过渡”的缓存命中。
- 缓存键复用 `NativeProfileIdentity`，另含完整媒体内容版本、模型摘要及head／tail角色。
  临时播放URL、音频前缀或旧无模型分析结果不能作为该版本身份。媒体摘要取得与模型调用仍由后续接入负责。
  请求票据阻止重复准备及已失效任务写回；退出provider、删除本地来源、清空缓存后旧票据失效。
  这些是缓存接口，尚未宣称用户退出入口已经连接此缓存或能终止尚未接入的模型线程。
- 将原 `automixSession` 的覆盖检查与迟到补偿原式提取到 `stemWindow.ts`，桌面与原生JavaScriptCore共同调用。
  仍检查两端能否覆盖整个过渡，仍以两端剩余材料限制迟到补偿。注释、窗口长度及调度时机保留。
  只有小型时间元数据经过JSON桥，完整PCM不跨桥。
- `NativeStemWindowPair.prepare` 接受窗口打开时两首歌的实际媒体位置，按原补偿切片。
  WebKit的分数采样偏移不能改成整数切片：本实现对还原的Float32采样线性插值，
  最后一个采样以内采用WebKit实测的末两点外推，越过文件末尾输出零。
  原覆盖检查仍使用其原有四舍五入规则；浮点播放偏移和整数覆盖检查各自保持原语义。
- `StreamMixOutput.scheduleStems` 接受准备好的窗口对，校验其时长与手势一致后进入已有共享输出图。
  缓存和解码操作在控制侧执行，音频回调不构造窗口；原始PCM接口继续可用。

## 验证证据

证据目录：`.mobile-test-results/stem-storage/`。

| 验证 | 结果与边界 |
|---|---|
| 逻辑测试 | `unit.log`：**90项 / 5文件 PASS**，包括原会话、原缓存驱逐、已完成迟到结果、分轨手势和新增窗口桥边界 |
| 原WebKit参考 | `reference.log`：1项生成测试PASS；原 `peakOf`、`toPcm`、`pickStemVictim` 及真实 `connectStemDeck` 音频图 |
| 存储数值 | 静音、双声道超幅、同声道内容、正负半值共4组；**8,224个Int16值、8,224个还原Float32值逐项完全相同** |
| 媒体偏移 | 7组整数／分数偏移，包含不连续末两采样及越界静音，1,792个双声道采样与原WebKit对照，最大PCM差 **0**；预设1e-6门槛未修改 |
| 原生完整链路 | 16位窗口 → 原时间桥 → 片段还原 → 分轨混音 → 两个真实AudioStreaming解码器及共享音效／音量；生成WAV的0.8秒窗口逐采样最大差 **0**，最终静音为零 |
| 原生 XCTest | `native-final.xcresult`、`native-summary.json`：**35 PASS / 0失败 / 0跳过**；含上述链路与既有曲线、时钟、声部、回声及增益平衡回归 |
| 缓存与取消 | 原4种驱逐情形、读取刷新顺序、重复请求、空位保留迟到结果、provider隔离、媒体／模型版本隔离、退出／删除来源／旧票据写回、角色不符及窗口释放 |
| 窗口边界 | 实际构造完整30秒窗口，Int16数据字节数 **21,168,000**；非法长度、声道、NaN、差分溢出、媒体范围及已取消规划拒绝 |
| 环境 | iPad Pro 11-inch (M5) / iOS26.5 **模拟器**；Release、ENABLE_TESTABILITY=YES、独立 `app.folia.validation.App`、最低iOS17 |
| 构建与资源 | 类型检查、`npm run ios:sync`、plist和diff检查通过；模拟器签名通过，6个原生JS资源与构建源码字节一致，见 `package.json` |
| 实际音乐／真机 | **NOT_RUN**。未执行模型推理，没有真实账户或实际音乐输入，不能代替听感、实体iPad或后台跨曲验收 |

`StemStorageReference.json`为247,301字节，仅加入测试Bundle。差分参考保留原 `ensureStems` 中的Float32赋值式，
其余存储与驱逐参考直接调用原函数；音频偏移参考来自WebKit实际渲染。
测试使用既有开发依赖，没有安装生产依赖。

四个满长窗口的PCM理论合计84,672,000字节，**不是实测进程内存**；解码副本、数组开销和模型工作区另计。
实际资源峰值、CPU、能耗、温升及长期增长尚未测量。

### 保留的检查失败

- 首轮类型检查发现参考生成脚本的动态导入返回类型未约束，`Array.from` 回调参数被推断为unknown。
  只补充Int16Array类型声明；`typecheck-first.log`保留失败，最终检查通过。
- 首轮原生构建在测试夹具的嵌套数组表达式上发生Swift类型推断超时，尚未执行XCTest。
  仅拆分表达式、明确Float返回类型后重跑一次；`native.log`与`native.xcresult`保留，
  最终35项通过。没有调整生产实现、样本或误差门槛来掩盖失败。

## 复跑

```sh
"$HOME/.local/bin/codex-bounded" 600 -- npm run test:unit -- \
  test/unit/mobile/nativeStemWindow.test.ts test/unit/mobile/nativeStems.test.ts \
  test/unit/automix/stemEviction.test.ts test/unit/automix/stemLateResult.test.ts \
  test/unit/automix/automixSession.test.ts
```

只在审阅原存储／音频图变更后重新生成参考：

```sh
"$HOME/.local/bin/codex-bounded" 600 -- env FOLIA_STEM_STORAGE_REFERENCE=1 \
  npm run test:mobile:ui -- stem-storage-reference.spec.ts --project=phone
```

35项原生选择及完整命令保存在 `tests.json`、`command-final.json`，使用既有独立QA xcconfig。
清理检查保存在 `cleanup.json`；个人 `BUILD_RECORD.json` 哈希保持不变。

## 剩余接入与回退

`NativeCrossfade` 尚未调用此缓存或分轨计划。完整媒体读取／摘要、解码到模型采样率、推理与尾端人声测量、
将队列变化和系统中断接入缓存票据，以及实际播放位置的最终校准仍须完成。
表演模式的重触发／倒放与遮罩、连续过渡、推理＋播放＋动画争用和实体设备验收仍未交付。

回退撤销本批窗口／缓存、Xcode引用及共同时间函数提取，恢复原会话内联表达式；无持久数据迁移。
本批缓存仅在内存中，没有写入用户文件或更新个人安装包。
