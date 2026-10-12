# 静音预播与可撤销接管

2026-10-12，接续 [精确媒体时钟](MEDIA_CLOCK.md)。
**PASS_DEVICE_PREPLAY / SIMULATOR_REGRESSION_UNRESOLVED / FULL_AUTOMIX_IN_PROGRESS**。
仅独立 QA；个人 App 保持 mobile.28，未修改界面、设置、模型或依赖。

后续进展见 [四轨实际队列接管](LIVE_STEM_HANDOVER.md)：最终同一份源码在真机与模拟器
各通过 64 项生成音频回归。以下保留本阶段历史结果，原模拟器超时仍未独立确认根因。

## 实现与复用

复用 `TransitionGainCurve` 的常量端点：当前歌曲保持 1，下一首保持 0。
原实现把“提交增益命令”当作“命令已生效”，随后立即释放下一首 PCM。
如果命令到达时该音频块已经开始，两路回调必须沿用旧命令，下一首有漏声风险。

- `NativeMutedPreplay` 持有待播 occurrence；先连接未启动解码器，等待音频线程发布
  相同 generation 且非空 `curveStart`，才启动静音播放。等待上限 1 秒，取消与队列意图每次重查。
- 静音门控使用常量曲线，控制侧准备迟到不会自动放开下一首。没有新增 DSP、线程或依赖。
- 正式曲线通过 `TransitionGain.replace` 原子替换门控，同时分配新 generation。
  不能先 cancel 再 schedule，否则中间音频块会恢复双路音量；新 generation 也避免把门控时钟
  误报为正式转场已开始。原有曲线、音色、回声和响度补偿沿用原实现。
- `NativeCrossfade` 在 await 前保存预播所有权。取消时先从共享图移除下一首，随后仅取消
  自己仍有效的增益 generation；旧任务无法撤销新计划，也不能回收已转交当前队列的音轨。
- 暂停、seek、跳歌、队列修改、关闭转场、资源压力沿用现有失效入口。
  撤销静音预播时清除对应 prepared 引用，正常队列按歌曲身份重新准备。

本轮把安全门控接入现有主音轨切换。四轨分支接入后会在原版观测之前开启静音预播；
目前没有将 `NativeStemHandover` 的 PCM 输出连接到实际队列接管，公开 `stems/full` 仍未开启。
不能将这次门控修复描述为完整 Automix 已交付。

## 验证记录

证据：`.mobile-test-results/muted-preplay/`，命令保存为 `test-*-command.json`，
实际执行数已用 xcresult 摘要核对。所有音源为生成 WAV，没有真实平台请求或模型推理。

| 批次 | 结果 |
|---|---|
| iPad M5 / iOS26.5 模拟器首轮 `simulator.xcresult` | 47 项：46 通过、1 失败 |
| 模拟器一次修正复测 `simulator-final.xcresult` | 47 项：45 通过、2 失败，合计 3 条失败断言 |
| iPhone XS Max / iOS18.7.10，最终源码 `device-final.xcresult` | **47 通过、0 失败、0 跳过** |

首轮失败来自新增测试把暂停中的 AVAudioEngine 切换到手动渲染，错误 -80801；
SDK 的 `AVAudioEngineManualRenderingErrorInitialized` 要求先 stop。
修正测试后，六种真实 PlaybackEngine 取消路径全部通过。

第二轮有一项新增断言错误：dispose 后 AudioStreaming 异步 stop 会把 progress 归零，
停止并不承诺保留进度。已改为检查音轨断开、不可再播且当前音轨 PCM 不变，真机通过。
另一项是原有 `testNativeCrossfadeAdvancesIdentityQueueAndReleasesTail` 的 5 秒超时
（超时和重新抛出产生两条断言）。首轮该项通过；本轮已增加仅含队列状态的失败诊断，
最终真机通过，但**没有确认模拟器超时根因，也没有再次重跑整个模拟器批次来覆盖失败**。
最终测试源码的模拟器验证仍未完成；不得把两次模拟器结果拼成一次全绿批次。

新增用例验证：门控未获确认时 PCM 不推进；获确认后下一首推进而混音输出仍只有当前歌曲；
两路精确时钟一致；正式曲线替换与回调顺序；旧 generation 清理；等待超时、取消、暂停；
以及真实队列的六种撤销场景。原有曲线 WebKit 对照、主音轨 Automix、分轨图、变速与时钟回归
也包含在 47 项中。测试中有真实系统输出和手动 PCM 渲染；不是人工听感、在线或长期后台验收。

## 包与未完成项

`source-current.json` 对应最终真机源码；模拟器包早于最后两处测试断言／诊断调整，
生产 Swift 实现相同。`packages.json` 记录两个 QA 包，Bundle ID 均为
`app.folia.validation.App`，无内置模型；123 项前端资源及两个空 Capacitor 文件与同步目录一致。
最终设备可执行文件 41,971,840 字节，含测试插件的 App 134,561,400 字节。
这些数值不是个人 IPA 净增量。已有 Sendable 与测试 weak 变量警告保留。

尚未完成：模拟器切歌超时根因、四轨实际接管时的最终 PCM 对齐、扩展渲染源对齐、
原模型推理与播放／动画联合负载、真实热保护、锁屏模型访问、物理 iPad。
下一步应使用精确媒体锚点绑定四轨读位置并验证迟到与欠载，不能按墙钟猜测偏移。

回退本提交即可恢复此前切换路径，无持久数据迁移。测试后两端 QA 已卸载、模拟器关闭；
个人完整安装元数据前后一致，`BUILD_RECORD.json` SHA256 保持
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。
