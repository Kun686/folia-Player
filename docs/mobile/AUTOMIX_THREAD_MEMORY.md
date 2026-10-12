# Automix 推理工作线程的内存生命周期

2026-10-13，继续不依赖真机的工作。独立 QA Bundle 为 `app.folia.validation.App`；
个人 mobile.28、真实设备及服务器未操作，界面、原模型、音乐算法和已批准依赖均保持原样。

## 定位与最小修正

[前阶段诊断](AUTOMIX_MEMORY.md) 已把增长缩小到包含拍点模型的路径。
本轮先等待最后一次推理结束后 70 秒，跨过 Swift worker 的 60 秒取消定时项生命周期：
footprint 仍约 690MB，malloc in-use 约 647MB，因此不能把增长归因于仅需等待定时项释放。
`idle.xcresult` 为 1 PASS，但它只验证输出／流程，不代表内存达标。

Mac 诊断直接编译生产 `FoliaORTJob.mm`，链接已经批准的 ORT 1.30.0 macOS slice。
不复制平台推理逻辑，不安装依赖。复用原 30 秒歌曲的两个拍点输入及 Node 参考输出；
其文件／模型摘要全部核对，五项参考源码摘要与生成时的 `fd030ef` 一致。
当前 mel 的零权重优化发生在该参考之后，不能将这份历史源码摘要声称为当前源码摘要。

以下为每轮会话返回后的 **malloc in-use，十进制 MB**，不是 RSS 或 footprint：

| Mac 调用方式 | 第一轮 | 第二轮 | 第三轮 | 调用线程退出后 |
|---|---:|---:|---:|---:|
| 一个线程顺序调用三次 | 314.51 | 314.51 | 314.51 | 7.27 |
| 三个不同线程顺序调用，旧线程保留 | 314.51 | 627.89 | 941.27 | 7.27 |
| 每次调用后退出该线程 | 7.27 | 7.27 | 7.27 | 7.27 |
| 修正后，三个调用线程继续保留 | 7.28 | 7.29 | 7.29 | 7.27 |

各组输出与固定原参考逐字节一致。Mac 的 footprint 在 allocator 回收后仍可能保持较高，
不能把 malloc 下降量说成操作系统立即回收同等物理内存。

iOS 模拟器回归刻意保留三个调用线程，逐个执行实际模型：修正前已用分配增加
**891,158,048 字节**，超过测试允许的 64MiB 噪声，`caller-red.xcresult` 明确失败。
释放这三个调用线程后占用回落。修正后同一对照仅增加 **76,080 字节**。
最后版本还断言测量时三个调用线程仍存活，避免线程提前结束造成假通过。

生产改动只在原 Objective-C++ 边界增加一个有明确结束点的 `std::thread`：

- 原 Swift 串行队列仍负责排队、完整模型摘要、不可变快照、60 秒期限和取消；
- 推理在线程中执行，继承调用优先级，原线程数、Session 配置、分段和计算保持不变；
- 返回前 `join`，使工作线程的局部存储析构完成；输出由强引用保留，模型快照仍有效；
- 原子取消标记及受锁保护的 RunOptions 继续允许外部线程终止推理；
- 主线程调用仍被拒绝，启动／运行异常仍返回结构化错误。

这是对**随调用线程生命周期保留的工作分配**的修正。尚无可用分配调用栈，
不能进一步断言是哪一个运行库内部缓存，也不称为已证明的 ORT 泄漏。
没有通过驻留整个模型、缩短窗口、改变算子或关闭原功能降低负载。

## 数值与原流程验证

第一组修正后 `worker-regression.xcresult` 为 **9 PASS、0 FAIL、0 SKIP**，覆盖：
调用线程内存回归、原完整歌曲拍点分析重复三次、原 mel／拍点／后处理、
版本／参数／排队取消、未批准模型拒绝、原拍点和单段分轨输出、运行中取消恢复、
整窗取消恢复、原 30 秒完整分轨重复三次。

| iOS 模拟器路径 | 第一轮 footprint MB | 第二轮 | 第三轮 |
|---|---:|---:|---:|
| 修正前完整歌曲拍点分析（本轮 idle 基线） | 99.6 | 395.3 | 690.7 |
| 修正后完整歌曲拍点分析 | 96.21 | 96.41 | 96.47 |
| 修正后原 30 秒完整分轨 | 83.07 | 83.05 | 83.05 |

原拍点／单段分轨输出逐字节相同；三次整窗分轨每一路摘要均与原 stitching 参考相同。
这些数值来自主进程，不含 WebContent；模型推理中的峰值与结束后占用必须分开评估。

最终包 `final.xcresult` 为 **13 PASS、0 FAIL、0 SKIP**：上述九项，加上三轮连续
原模型／心象／播放交接及三个既有 PCM 生命周期用例。三轮是一个用例，不累加为三个测试。
各轮确实进入原分轨／扩展混音，交接完成且 `notPlayingSamples=0`；前轮分析对象释放。
三轮清理后 footprint 分别为 **97.91、88.15、90.87MB**，malloc in-use 分别为
23.76、23.75、23.58MB。随后同进程三次拍点结束后约 114.40–114.43MB，
三次原 30 秒分轨结束后约 101.13MB，没有看到此前每轮数百 MB 的累积。

最终进程累计 footprint 峰值仍为 **1,411,387,184 字节**，排除 WebContent。
任务结束后能释放工作内存，不等于推理峰值已适合所有 iPhone；这仍需真机实测。
Mac 上线程退出后 footprint 可能不回落的现象也未用 malloc 统计掩盖。

## 证据与复现边界

本轮本地证据目录 `.mobile-test-results/beat-allocations/`，不提交模型／音频／临时产物：

- `idle-*`：70 秒释放观察；`caller-red-*`：修正前失败及原始 XCTest 附件；
- `mac*-command.json`、`mac*-identity.json`、`mac*-memory.json`：命令、二进制／源码／素材身份与样本；
- `worker-regression-*`：第一组通过记录和导出的三个内存附件；
- `final-command.json`、`package-final.json`、`native-sources-final.json`：最终独立 QA 的命令与身份。

11 个沙盒 JSON（九个联合负载／profile／handover 加两个独立内存报告）与 XCTest 附件
逐字节相同，见 `attachment-parity.json`；调用线程报告仅从 XCTest 附件导出。
最终身份清单包含 265 个 tracked 原生目录文件，其中 222 项为原生源／测试代码。
123 项前端资源在 dist-mobile、Capacitor 拷贝和 QA 包中一致；后两者另有两个相同的生成 Cordova shim。
内嵌前端标签仍为 `b0a883d…/mobile.28`，与本轮原生改动的源码身份分开记录。

Mac 独立入口为 `dev/mobile/ort-session-memory-probe.mm`，参数依次是已核验素材目录、模型、
新的输出 JSON 路径，以及 `shared`／`retained`／`joined`；只用于有时限的诊断，不链接进 App。
通过系统 clang++、Foundation、Network 与已批准的 ORT framework 编译，完整命令保存在证据目录。
iOS 回归复用现有 `build-for-testing`／`test-without-building`，限定 QA Bundle 和模拟器。

此前 `leaks --outputGraph` 两次在工具自己的共享缓存解析中崩溃，本轮未重试。
本轮 Simulator Allocations 停在 attach，60 秒无输出后终止；移除 simulator 目标的唯一重试
返回找不到该 PID。另一次针对普通 Mac 命令行程序的 launch 也停在录制启动阶段并超时，
已明确停止 recorder 和其子进程。没有可用的 Allocations／memgraph，空 trace 不能作为分配栈证据。

真机联合负载、WebContent 合计内存、长时间稳定性、热状态、在线 Automix 和人工听感仍 **NOT_RUN**。
回退仅需恢复 `FoliaORTJob.mm` 的线程封装，保留此前关闭遥测的修正；没有用户数据迁移。
个人 `BUILD_RECORD.json` SHA256 仍为
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。
