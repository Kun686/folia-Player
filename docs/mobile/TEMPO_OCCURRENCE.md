# 变速播放项的时钟、拖动与结束生命周期

2026-10-11。接续 [TEMPO_HANDOVER.md](TEMPO_HANDOVER.md)。开发源码阶段，无新 IPA。
完整 Automix 仍待模式调度和动画事件接线；`allowsTempo` 显式选择，默认队列不请求变速。
后续开发源码的主混音模式调度见 [MASTER_AUTOMIX.md](MASTER_AUTOMIX.md)；上述状态为本阶段完成时的边界。

## 实现边界

复用既有 `StreamOccurrence`、`StreamMixOutput`、已批准解码器与系统变速器。
通知采用项目 `AudioEffectController` 已使用的预创建 DispatchSource 合并信号，不新增依赖或 vendor 改动。

- 选择变速能力的播放项从交接器读取媒体时间与实际速率，解码器预读进度不再冒充输出时间。
  解码器 EOF 后仍可报告正在输出，保留 TimePitch 尾部；暂停／恢复以用户意图和外层输出为准。
- 变速状态、EOF／排空与渲染错误通知回到原生主控制队列；不是 WebView 定时器。
  信号在控制侧预创建，渲染侧只合并信号，不按音频块分配闭包或新增轮询计时器。
  reset／close 取消旧信号并校验代次，旧错误不能污染新的音源。
- seek 先停共享输出并拆除该源，清理旧历史、速率和通知。只允许单一当前源执行；
  控制器先取消过渡尾曲，再进行拖动，沿用原有顺序。
  控制任务等待新 PCM，只有最新代次可以重新接线；过程中暂停不会被异步完成恢复播放。
- 已结束后的重新定位创建新的解码实例，继续使用该歌曲 URL 和既有网络配置。
  旧实例取消后异步清理不能删除新实例的队列；迟到 delegate 还会核对实例身份。
  新解码器初始化期间再次拖动，也只应用最新目标。
- 进行中的 seek 串行处理：等解码器现有请求结束，再提交最新目标，不覆盖库内部正在处理的单个 seek 槽位。
  不扩展或放宽 vendor 协议；失败时保留用户请求的位置，交给原有解析与重试流程。
- Crossfade 通过播放项统一连接待播源，避免先连接原始节点、随后播放项要求变速节点的冲突。
  网络恢复和路由重建仅在新变速路径准备输出期间等待；普通解码器的 seek 继续沿用原恢复行为。
  过渡检查能识别异步 seek；锁屏速率读取播放项的实际速率。普通路径继续使用原 EOF 行为。

`ended` 对已启用变速的播放项表示输出可回收，不能直接作为完整 Automix 的下一首启动时机。
一秒精确零输出仍只是保守释放条件；后续协调器必须按原规划的媒体时间启动下一首，保留出场曲到包络完成。
因此没有把这些能力直接打开为完整 Automix，也没有将安装包的能力声明改为完成。

## 失败记录与修复

本机 `.mobile-test-results/` 保存全部原日志和 xcresult。

- `tempo-occurrence-first`：4 项中 3 项通过；拖到结尾后立即往回拖的用例等待超时。
  `AudioPlayer.stop()` 在 sourceQueue 异步清理，而 `play()` 可以先将新歌入队；旧清理会清空这个新队列。
  改为仅在结束后重新定位时创建独立解码器，常规拖动继续复用当前解码器。
  `tempo-occurrence-decoder-replace`：同 4 项只重试一次，全部通过，0.797 秒。
- `tempo-occurrence-full`：首轮完整原生回归 179 项通过，70.702 秒。
- `tempo-occurrence-control-scope-full`：最终生产代码完整原生回归 179 项通过，71.232 秒，零失败。
  iPad Pro 11 (M5) / iOS 26.5 模拟器 / Release；与后续 HTTP 和真机复核使用同一份生产代码。
- `tempo-occurrence-http`：5 项中 4 项通过；连续请求 8 秒、11 秒后实际停在 8 秒，位置断言失败。
  HTTP Range 也只请求了 8 秒偏移。库内正在进行的 seek 可能在处理旧目标后清掉被覆盖的新请求。
  控制层改为串行提交最新意图，初始化重开期间也等待真正的源就绪。
  `tempo-occurrence-http-serialized`：同 5 项只重试一次，全部通过，11.135 秒；Range 偏移 970244
  对应该 WAV 的 11 秒，暂停位置维持 11 秒，恢复后可再次变速。位置容差保持 40ms。

HTTP 播放项测试在主混音输出测得双声道 24000 帧、RMS 0.02123030347，实际速率约 0.88。
这些是受控 loopback HTTP 和真实解码／系统输出，不是 QQ／网易云真实账户或 CDN 验收。
最终生产代码复核 `tempo-occurrence-final-http`：同 5 项 PASS，10.625 秒；仍请求 11 秒偏移，
双声道 24000 帧、RMS 0.02140839771、实际速率 0.8799999952。测试服务正常关闭。
`tempo-occurrence-final-source.json` 保存对应变更源码的 SHA-256；后续原生构建期间没有修改源码或资源。

新增常规测试覆盖实际播放项尾音保留、EOF 后暂停恢复、只发一次结束事件、自然结束后的重新定位、
旧实例错误隔离、连续拖动与保持暂停、取消后的资源释放，以及合并错误通知和重置后的旧通知失效。
旧实例错误由测试注入，用于验证身份边界；不冒充真实平台网络错误。
真机 `tempo-occurrence-device`：首次 iPhone XS Max / iOS 18.7.10 / Release，12 项 PASS，12.335 秒。
包含全部四项新增常规测试，另回归预热系统对照、重置、媒体标记、微弱尾音、AAC Mono 音效、
四曲推进、共享图释放和 Crossfade 的暂停／拖动／跳歌。媒体标记误差仍为 11.630ms；
保音高变速的系统参考样本差异仍为 0。
最终生产代码 `tempo-occurrence-final-device`：同一真机和配置，13 项 PASS，12.911 秒；
增加路由重建、播放项身份保持与暂停不被唤醒的回归。路由变化由通知注入，未实际切换蓝牙。
媒体标记误差仍为 11.630ms、系统参考样本差异 0、保留尾音峰值 0.124996886。
这些短时执行层测量不等于扬声器端到端歌词误差或长时间混音验收。

`tempo-occurrence-final-device-build.log` 和 `tempo-occurrence-final-device-identity.json` 保存最终独立 QA 构建及身份检查。
签名、entitlement、宿主和测试插件均核对，xctestrun 原样复制后执行 test-without-building。
QA 已卸载，回读个人 App 为 0.7.16 / build 10；清理证据
`tempo-occurrence-final-qa-uninstall.json`、`tempo-occurrence-final-personal-app.json`。
构建、测试和 HTTP fixture 均已退出，18779 端口关闭，模拟器没有遗留启动实例。

个人安装包与 `BUILD_RECORD.json` 不变；后续真实平台、长时间锁屏混音、听感、温升和歌词同步验收仍未完成。
