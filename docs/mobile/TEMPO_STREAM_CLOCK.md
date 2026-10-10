# 变速媒体时钟与输入结束后的输出

2026-10-11。接续 [TEMPO_EXECUTION.md](TEMPO_EXECUTION.md)；开发源码验证，尚未生成新安装包。
本阶段尚未接入共享输出或原生队列；后续共享图的可选预热交接与真机系统对照见
[TEMPO_HANDOVER.md](TEMPO_HANDOVER.md)。原生队列与完整 Automix 仍待接入。

## 复用与实现

继续复用已批准的 AudioStreaming 1.4.5 解码器、系统 AVAudioUnitTimePitch 和既有手动音频图。
原版规划、曲线、主题、动画及依赖版本不改。新增代码只处理移动端输入／输出时钟和生命周期边界；
Web 版的 `deckClock.ts` 读媒体元素的播放时间，不能直接替代这里对解码器预读的校正。

- `AudioPlayer.renderExternalAudio` 增加可选 `ExternalAudioRead`。保留拉取前的歌曲对象，
  在同次拉取结束时记录实际媒体帧数、媒体位置、EOF 和时间不连续状态，不依赖主线程 delegate。
  无须观察时维持现有调用方式；补零不计入媒体帧数，最后一次读取后歌曲已从队列移除也不丢失 EOF。
- `TempoInputTimeline` 使用固定 64 段存储记录实际媒体与补零区间，连续区间合并。
  暂停／缓冲不足的补零使媒体位置保持不变；拒绝未重置的跳转，历史被淘汰时返回不可用。
- `NativeTempoProcessor.appliedRate` 记录音频回调已采用的速率，不能把仍在控制侧等待的请求当作当前速率。
- `NativeTempoStream` 用实际输入历史、系统初始 latency 与已采用速率估算媒体位置，快照使用不阻塞渲染的发布方式。
  途中变速可能改变系统 latency，当前估计并非精确的扬声器时间戳；误差由实际音频标记测量。
- 确认解码器 EOF 后继续输入零并保留系统变速器的全部输出。使用整整一秒的**精确零输出**确认资源可回收，
  不使用幅度阈值，因此不会把极低音量片段截断；两秒内仍未排空则报错，不无限占用输出。
  该一秒是保守的资源释放条件，**不能用作下一首的启动时机**；原过渡必须继续按媒体位置和曲线启动。
- 暂停应停外部输出拉取。拖动时先停止拉取，等待解码器完成 seek 后重置变速器和历史；未完成 seek 会被拒绝。
  close 释放输入闭包和解码器引用，保留外层包装对象也不会继续持有解码器。

本阶段还没有完成预热交接、共享采样时钟接线、队列事件和原模式动画联动；前两项后续进展见交接记录。
不能将这个组件的测量结果当成 App 歌词 150ms、无缝切歌或完整 Automix 的验收。

## 同时修复暂停后的 seek 挂起

已完整缓冲的歌曲暂停后执行 seek，原 `processSource()` 会因 paused 状态返回。
`resume()` 只恢复读取／输出；若文件已经读完，没有后续文件回调重新处理该请求，seek 可能始终挂起。
本次专项测试在恢复后仍观察到 `isSeeking`，变速器正确拒绝使用旧位置重置。

修复在 `AudioPlayer.resume()` 中检测待执行 seek，唤醒缓冲等待并重新提交原 `processSource()`。
未重写 seek 或解码算法。回归故意在暂停请求之后等待 30ms，再恢复解码器，等待新 PCM 并重置变速器，
验证进度从 0.75 秒恢复、EOF 后尾音、最终排空及引用释放。原有外部解码器 seek 测试同时通过。

vendor 仍为固定上游提交的 59 文件、3 个适配文件，逐文件哈希与完整补丁均已同步验证。

## 已测证据

本机证据位于 `.mobile-test-results/`。构建与测试使用 Release；下述音频均为受控合成文件，不是真实平台音乐。

| 验证 | 结果 |
| --- | --- |
| 时间标记 | 0.88／1／1.12 三个初始速率，各测恒定速率和途中变速，共 6 组、24 个标记；最大媒体时间误差 0.01163033187933471 秒 |
| 非零微弱尾音 | 峰值 1.8079541e-08，完整输出与原系统执行器逐样本误差为 0；确认排空后继续比较一个以上秒的零输出 |
| 同步 EOF | 不让主线程派发 delegate，仍能得到全部 88,200 媒体帧、2 秒终点及最后一个不完整缓冲的 EOF |
| 暂停／拖动 | `tempo-stream-resume-fix`：新生命周期测试及原 seek 测试 2 项 PASS，0.666 秒 |
| 完整原生回归 | iPad Pro 11-inch (M5) / iOS 26.5；`tempo-stream-full-after-legacy`：171 项 PASS，71.303 秒；3 个 HTTP 测试另行运行 |
| HTTP 补测 | `tempo-stream-http`：3 项 PASS，8.759 秒；实际 loopback Range 请求，覆盖预载取消、Mono 音效／seek、WebView 外连续队列 |
| iPhone 专项 | iPhone XS Max / iOS 18.7.10；`tempo-stream-device`：10 项 PASS，10.668 秒；媒体时间误差及尾音样本结果与模拟器相同 |

时间标记使用 1kHz 载波及中心位于 0.25／0.75／1.25／1.75 秒的包络，
从实际输出信号的能量中心计算媒体时间。既检查恒定速率，也检查一次覆盖尚未采用的请求及第二次变速。
没有用输入消费时刻或请求速率当作正确答案，也没有放宽原 DSP 参考样本的比较容差。

### 失败记录

- `tempo-stream-first`：两项测试漏设 PCM `frameLength`，有效容量校验返回 -10868；修正测试初始化。
  同轮六组时间标记已经通过，最大误差同上。
- `tempo-stream-buffers`：4/5 通过；暂停 seek 尚未完成，被新 reset 检查拒绝。
  `tempo-stream-seek` 在恢复后仍失败，由此确认上游恢复路径漏重新提交请求，而非仅为测试调用顺序问题。
  修复产品路径后 `tempo-stream-resume-fix` 通过；未移除 seek 就绪检查。
- `tempo-stream-full`：170/171 通过，旧 AVPlayer 格式探针在两秒采样等待内未得到数据。
  该路径不经过新变速模块；隔离运行格式与音效测试 `tempo-stream-legacy-isolated`，2 项通过，3.264 秒。
  确认旧路径可正常出声后，完整回归只重试一次并通过；未改旧测试、延长等待或放宽断言。
  首次超时的底层原因仍未确定，不以重试通过抹去该记录。

真机包含全部 5 项新增测试，另回归 AAC Mono 音效／seek、原系统变速器比较、四曲自动推进、
共享图及解码器释放、原始外部解码器 seek。短测试不证明长时间锁屏、真实平台播放、听感或功耗通过。

`tempo-stream-device-build.log` 为独立 QA 构建；`tempo-stream-device-identity.json` 记录签名与 manifest 身份核对，
`codesign --verify --deep --strict` 通过。测试使用原构建生成的 xctestrun，无手动更改宿主路径或标识。

本机 HTTP 服务已关闭，模拟器为 Shutdown；QA 包已卸载，回读个人 App 仍为 0.7.16 / build 10。
清理证据：`tempo-stream-qa-uninstall.json`、`tempo-stream-personal-app.json`。
本阶段不修改 `BUILD_RECORD.json`，没有新 IPA，手机日常安装不包含这些开发改动。
