# Automix 内存排查与运行库遥测

2026-10-13。独立 iPad 模拟器 QA；个人 mobile.28、真实设备及服务器未操作。

**重复分析后的内存增长仍未解决。** 已将复现缩小到包含原拍点模型的独立路径，
不能据此直接认定 ONNX Runtime 泄漏，也不能把通过数值／播放断言等同内存验收通过。
本轮唯一生产改动是在创建模型会话前调用官方 `Ort::Env::DisableTelemetryEvents()`。
未改变模型、输入长度、原音乐算法、线程数、CPU arena／memory pattern 设置或界面。

## 为什么增加这些检查

[PREPLAY_CLOCK.md](PREPLAY_CLOCK.md) 的三轮交接虽然全部成功，恢复阶段的主进程 footprint
仍逐轮上升。先检查已存在的缓存上限、任务取消和 JS／原生 PCM 所有权，再添加以下测试观察：

- 原三轮联合用例记录清理后快照，并用弱引用检查上一轮的 crossfade、profiles、stems、profiler、trace。
  `StreamMixOutput` 由同一 PlaybackEngine 共用，不要求每轮释放。
- `testOriginalPreparationRepeatedMemory`：相同完整歌曲的原 mel 预处理及 gridless 特征，连续三次。
- `testOriginalBeatInferenceRepeatedMemory`：在相同流程加入完整原拍点批次及原后处理。
- `testORTRepeatedOriginalWindowsMeasureAllocations`：原 30 秒音乐分轨窗口，连续三次；
  每次只保留输出摘要，与原 stitching 参考比对。
- 使用系统 `TASK_VM_INFO`、malloc 统计及分配区名称；只在 XCTest 中采样。
  分轨诊断末尾调用一次系统 allocator pressure relief 作对照，生产代码不调用。

原生 PCM owner 的三个既有释放／类型回归一起通过。没有新增依赖，也没有用缩短窗口、
生成分轨或替代模型降低负载。

## 第一组证据

证据目录 `.mobile-test-results/automix-memory/`。以下单位为十进制 MB；
数值都是每轮结束后等待 2 秒的**主进程当前 footprint**，不含 WebContent，也不是峰值。

| 路径 | 第一轮 | 第二轮 | 第三轮 | 说明 |
|---|---:|---:|---:|---|
| 原三轮播放／心象／模型／交接 `sample` | 801.46 | 800.62 | 1475.78 | 前两轮的五类分析对象均已释放 |
| 仅原预处理与特征 `preparation` | 85.89 | 89.07 | 88.75 | 三轮结果摘要完全一致 |
| 原 30 秒分轨 `isolated-staged` | 170.81 | 253.99 | 253.99 | 三轮每路输出与原参考逐字节一致 |
| 加入原拍点批次 `beat` | 393.65 | 393.87 | 689.25 | 复现增长；测试结束后另有宿主崩溃 |
| 关闭遥测后同一拍点流程 `beat-no-telemetry` | 98.27 | 394.14 | 689.46 | 增长仍在，输出仍一致 |
| 最终包三轮联合交接 `joint-final` | 480.30 | 467.67 | 504.55 | 原分轨／扩展交接均完成，旧轮次对象释放 |
| 最终包原 30 秒分轨 `isolated-zones` | 164.81 | 168.46 | 168.45 | 三轮输出与原参考逐字节一致 |

`sample.xcresult`：4 PASS、0 FAIL、0 SKIP，含一个执行三轮的联合用例及三个 PCM 生命周期用例。
`preparation.xcresult`、`isolated-staged.xcresult`、`beat.xcresult`、`beat-no-telemetry.xcresult`
各有一个数值／流程用例通过；这些用例**没有内存上限断言**。
最初 `isolated.xcresult` 因缺少完整窗口参考而 SKIP，随后复用原 staging 脚本核对并复制 33 个固定素材后才重跑。
一次测试代码的 C `boolean_t` 参数编译错误已修复，失败日志保留。

`beat-no-telemetry-memory.json` 最后一轮：malloc in-use 为 647,363,744 字节，
其中 DefaultMallocZone 为主要占用区；这不是仅看 reserved 空间得到的结论。
`isolated-staged-memory.json` 的 allocator relief 回收量为 0，不证明所有运行库缓存都已释放。
分配区统计不能替代对象／分配调用栈归因。

最终包 `joint-final.xcresult` 为 **8 PASS、0 FAIL、0 SKIP**：三轮原模型联合交接、
三个 PCM 生命周期用例、原拍点／单段分轨参考、参数／排队取消、运行中取消恢复和整窗取消恢复。
联合交接均见到实际分轨、完成且没有停止采样；9 个 load／profile／handover JSON
与导出的 XCTest 附件逐字节相同，见 `attachment-parity.json`。
这次联合运行较低的 footprint 不能抵消独立拍点用例已复现的增长。
进程累计 footprint 峰值最终达 2,349,109,784 字节，仍排除 WebContent。
最终包另有独立拍点及分轨重复用例各 1 PASS；与上述 8 项合计 10 个不同用例，
不是将各轮次数或重复运行累加得到的覆盖数。

## 遥测线程崩溃及最小修正

`beat-host-exit.ips` 对应测试进程 PID 23599。XCTest 已记录断言通过后，进程发生 SIGABRT：

`recursive_mutex::lock` → `Microsoft::Applications::Events::DebugEventSource::DispatchEvent`
→ `LogManagerImpl::DispatchEvent` → `HttpResponseDecoder::handleDecode`
→ `HttpClientManager::onHttpResponse` → `PlatformAbstraction::WorkerThread::threadFunc`。

因此不能仅凭该次 xcodebuild 返回成功就说宿主稳定。固定 1.30.0 的官方头文件明确说明遥测默认启用，
并提供 `DisableTelemetryEvents`；C++ 封装通过 `ThrowOnError` 检查调用结果。
`FoliaORTJob.mm` 在 Env 创建后、Session 创建前关闭事件上报。模型推理不需要这项网络功能，
调用失败仍进入既有结构化错误路径。没有修改供应商二进制或许可证。

关闭后独立拍点、完整联合回归及分轨重复用例均未再记录该退出崩溃；
三个测试 PID 的本地崩溃报告检查保存在 `post-change-crash-check.json`，
这不是长期无崩溃或零网络流量证明。
内存增长仍在，因此不宣称遥测是其根因，也不宣称本轮已修复内存泄漏。

## 内存图工具限制与复现

两次 `leaks --outputGraph` 均在工具自己的 dyld／CoreSymbolication 共享缓存解析中 SIGBUS，
没有产生 memgraph。第二次仅对 QA 设置 `MallocNanoZone=0`，仍失败，已停止该路径；
正常采样未使用这个分配器覆盖。原工具日志分别保留在 `before/` 和 `before-no-nano/`。
不存在可引用的“泄漏类型消失”证据。

复用既有独立 QA build-for-testing、原素材 staging 及有时限的 test-without-building。
联合测试在 xctestrun 的 `FoliaNativeTests.EnvironmentVariables` 中设置
`FOLIA_MEMORY_CAPTURE=sample` 时，每轮向 QA Documents/MemoryCapture 写入 JSON。
未设置时不等待采样；设为 `1` 时最多等待 45 秒的同名 `.ack`，供支持的主机抓内存图，超时失败。
各次真实命令在同目录 `*-command.json`，不能对个人 Bundle ID 使用这些诊断。

下一步应沿拍点模型的 session／工作缓冲及延迟释放路径获取分配调用栈，并检查全流程合计内存。
当前证据不足以选择改变模型配置、驻留会话、缩短窗口或替换算法。
真机联合负载、长时间运行、WebContent 合计内存及在线 Automix 均 **NOT_RUN**。

回退本轮生产修正只需恢复遥测调用前的代码，无数据、凭据、曲库或配置迁移。
`BUILD_RECORD.json` 应保持原 SHA256
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。

最终包摘要在 `package-final.json`，221 项原生源／测试摘要在 `native-sources-final.json`。
123 个前端资源在 dist-mobile、Capacitor 拷贝、QA 包中逐项一致；其内嵌前端标签仍为
`b0a883d…/mobile.28`，不表示本轮 Swift／Objective-C++ 身份。模型、依赖及界面沿用原版本。
