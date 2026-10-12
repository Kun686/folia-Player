# 原版分轨与解码器的共同音频时钟

2026-10-12。**PASS（原WebKit数值对照与原生模拟器自动测试）；完整Automix仍未接入用户队列。**
接续 [四轨PCM总线](STEM_MIX.md)。本批没有新增依赖、修改模型、更新个人mobile.28或改动界面。
后续16位窗口、四窗口缓存及原媒体对齐接口已补充验证，见 [STEM_STORAGE.md](STEM_STORAGE.md)；下文保留本批边界。
ORT工程接入仍见 [待批准方案](AUTOMIX_INTEGRATION_DECISION.md)。

## 实现与复用

- 复用现有 `TransitionGain` 的代次、非等待式命令交换和共同时间戳，增加一次性分轨计划。
  两路原曲增益和分轨总线在同一音频块采用命令，块中途取消在下一块统一生效。
  旧异步结果和已消费的计划不能重放，移除旧解码器不能撤销较新的待执行计划。
- `NativeStemTransition` 保留原 `scheduleStemWindow` 的8ms原曲交接、原曲当前音量、
  进入原曲恢复，以及取消时原 `rampGain` 的30ms恢复。
  原曲增益与分轨起点共同向上取整到PCM采样，误差小于1/44100秒；参考测试采用同一取整规则。
- `NativeStemSource` 作为第三路常驻源接入 `StreamMixOutput`，无计划时输出零。
  它与两路解码器共用44100Hz时钟，进入既有总音效与最终音量。分轨不重复经过原曲淡化处理器。
  `scheduleStems` 只接收已对齐的窗口，沿用当前ReplayGain；推理和媒体位置选择不在渲染回调内。
- 时钟不连续时停止旧分轨并由进入歌曲原曲接管，提供 `stemFailed` 状态。
  目前这是内部状态，尚未接入队列提示或重试策略。
- 音频回调不创建PCM窗口，替换后的窗口保留到控制侧调用再释放；停机关闭时清理剩余窗口。
  非法缓冲区或时间戳在修改状态前拒绝。

## 验证证据

证据目录：`.mobile-test-results/stem-clock/`。

| 验证 | 结果与边界 |
|---|---|
| 原WebKit参考 | `reference.log`：1项PASS；直接执行原 `scheduleStemWindow` 与 `rampGain`，16种延迟、初始音量、取消时间组合 |
| 原曲增益数值 | 46,752个参考值；128帧与不规则分块、三路6种拉取顺序对照，最大绝对误差 **8.34465e-7**，预设门槛8e-6未修改 |
| 三路共享图 | 两个真实AudioStreaming解码器读取测试生成的单声道／立体声WAV，与分轨源进入同一个 `AVAudioEngine`；0.8秒窗口及其前后逐采样对照，最大差 **0**；最终静音后严格零 |
| 原生回归 | `native.xcresult`、`native-summary.json`：**24 PASS / 0失败 / 0跳过**，包括新增6项及原分轨PCM、淡化、声部交接、回声、增益平衡、取消回归 |
| 原分轨PCM复查 | 原WebKit总线最大误差 **9.536743e-7**，沿用1e-5门槛 |
| 环境 | iPad Pro 11-inch (M5) / iOS26.5 **模拟器**，Release、ENABLE_TESTABILITY=YES、独立 `app.folia.validation.App`，最低iOS17 |
| 静态与构建 | `typecheck.log`、`sync.log`：`npm run typecheck`、`npm run ios:sync`通过；Xcode工程plist、diff检查通过 |
| 包与清理 | `package.json`保存QA身份、签名、资源比对与个人构建记录哈希；`cleanup.json`保存测试进程、监听端口与模拟器结束状态 |
| 真机／实际歌曲 | **NOT_RUN**。共享图采用手动渲染与生成的WAV，不是实际音乐听感、真实账户跨曲或实体设备验收 |

`StemClockReference.json`为256,848字节，仅加入测试Bundle；记录选定采样位置，不是全量音频。
原WebKit增益对照与共享图测试分别验证原语义和实际原生接线；共享图的分轨预期取自已独立对照的混音器。

## 复跑

仅在原调度规则变更并审阅后重新生成参考：

```sh
"$HOME/.local/bin/codex-bounded" 600 -- env FOLIA_STEM_CLOCK_REFERENCE=1 \
  npm run test:mobile:ui -- stem-clock-reference.spec.ts --project=phone
```

原生测试完整参数保存在 `command.json`，24项选择保存在 `tests.json`；
使用独立 `.mobile-test-results/transition-validation.xcconfig`，不可替换为个人安装身份。
此次没有重跑与改动无关的全部平台账户验收。

## 尚未交付与回退

`NativeCrossfade` 尚未选择或调用分轨计划；模型推理、原16位窗口缓存、媒体位置／迟到对齐、
表演模式重触发／倒放与遮罩，以及队列生命周期接入仍待完成。
独立推理验证不能代替上述接入，也不能代替推理＋播放＋歌词动画的资源竞争验证。
常驻第三音源的真实设备CPU、耗电和温升尚未测量。

回退可撤销本批共同调度、第三音源及Xcode引用，保留上一批独立PCM混音器；没有数据迁移。
个人App继续使用原安装包，不需要卸载或重新登录。
