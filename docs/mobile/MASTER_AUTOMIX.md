# 原版 Automix 主混音调度接线

2026-10-11。接续 [TEMPO_OCCURRENCE.md](TEMPO_OCCURRENCE.md)，开发源码阶段，没有新安装包。
完整移植目标继续保留：本阶段不等于模型分轨、表现手势、歌词输入、前台动画和真实平台验收全部完成。

## 复用与行为

- `masterHandover.ts` 提取原 `automixSession.ts` 的媒体窗口、短窗口变速限制、拍点换算、
  曲线形状和动画 cue 计算；桌面原状态机与原生 JavaScriptCore 调用同一组函数。
  原阈值、四种接法、包络样本和默认行为不改，原注释保留。无新增依赖或 vendor 改动。
- 原生调度读取实际选择的 `automix`／`crossfade`，不再把两者固定映射为 Crossfade。
  分析档案和实时 BPM 进入原规划器；无法取得的测量保持未知，沿原规则决定兜底。
- 原版准备窗口内固定已经选择的方案和档案；否则刚跨过拍点后重新规划可能选择后一个小节。
  队列、设置、拖动、暂停及取消仍使旧任务失效。
- `NativeMasterTransition` 先获取需要的速率，等待原生输出实际采用，再按当时的剩余媒体时间计算包络。
  等待只在控制任务执行，最多一秒；音频渲染线程不等待该任务。过时或失败的工作撤销待执行速率。
  只弯出场曲，入场曲保持原速。若等待后窗口变短，重新应用原短窗口限制。
- 主队列的播放项具备可选变速历史；未请求变速时直接输出原 PCM，不经过 TimePitch。
  拖动期间停止并重建该源，最新意图完成后接回；曲目身份和暂停意图保持。
- 包络、三频段和回声继续由既有原生执行层处理。输出时长按实际速率换算，
  25 秒媒体窗口在 0.88 倍速时可使用约 28.41 秒输出窗口，不能再被旧 25 秒输出上限拒绝。
- 动画 cue 已按真实曲线时钟提供原生快照；后续前端订阅接线见 [TRANSITION_ANIMATIONS.md](TRANSITION_ANIMATIONS.md)。
  界面能力说明与个人安装包暂不升级为完整 Automix。

## 逻辑与对照证据

证据均位于本机 `.mobile-test-results/`。

- `master-handover-baseline.log`：提取前既有桌面状态机和 JSON 规划测试通过。
- `master-handover-shared.log`：提取后同一组 52 项通过，TypeScript 检查通过。
- `master-handover-reference-armed.log`：新边界测试 2 项通过，其中 24 组对照覆盖四种接法、
  加速／减速、提前／延迟入场；以桌面状态机实际发给 Web Audio 的曲线、时长和 cue 为依据。
  参考保存在测试资源 `MasterHandoverReference.json`，不会随 App 生产资源打包。
- `master-mode-logic.log`：Automix 与移动端相关 37 个文件、491 项测试通过。
  `master-mode-typecheck.log`、`master-mode-sync.log`：类型检查与移动构建／Capacitor 同步通过。

失败记录：

1. `master-handover-reference.log` 首轮 1/2 通过。测试先把播放位置推进到计划点之后再请求规划，
   原规则合法选择了后一个小节，状态机尚未 armed，因此没有曲线。修正为先 armed、再模拟入场延迟，
   只重试一次后 24 组对照全部通过；未改原规则或放宽数值断言。
2. `master-mode-first.log` 原生测试编译失败，新测试调用 `LocalMediaLibrary.resolve` 缺少跨 actor 的 `await`。
   修正后 `master-mode-actor-fix` 构建成功，5 项中 4 项通过；24 组 JavaScriptCore 重放和真实队列 Automix 用例通过。
3. 同轮旧 Crossfade 拖动测试在异步重建完成前检查连接数，观察到 0 而预期 1。
   测试改为等待 seek 完成且恢复输出，再断言同一播放项及单连接；不放宽目标位置或恢复行为。
4. `master-mode-full`：182 项中 181 项通过。唯一失败来自旧包络上限测试仍要求 26 秒输出窗口被拒绝；
   25 秒媒体在减速后合法超过这个值。新增用例已验证 25/0.88 的窗口合法，旧用例改测 30 秒及新上限的
   下一个可表示值仍必须拒绝；NaN、无穷、零、负数和非法缓冲断言保留。

## 原生回归

- `master-mode-window-limit.log`／`.xcresult`：iPad Pro 11 (M5) iOS 26.5 模拟器，182 项全部通过，
  测试执行 73.518 秒。包括 24 组原版调度重放、真实双播放源与暂停取消、减速输出窗口边界。
- `master-mode-http.log`／`.xcresult`：5 项 HTTP Range 音频测试全部通过，测试执行 10.472 秒。
  覆盖静默预加载、单声道输入的双声道音效／拖动、队列取消／自动前进、变速输出时钟与连续拖动。
  使用本机合成音频，不能作为网易云／QQ 平台验收；测试服务已关闭。
- `dev/mobile/verify-audio-vendor.py`：固定 AudioStreaming 1.4.5 的 59 个文件校验通过，仍为已有的 3 个补丁。
- `master-mode-device-build.log`：独立 QA 构建成功，签名、entitlement、测试宿主及测试插件均核对为
  `app.folia.validation.*`，测试配置没有个人 App 身份。
  `master-mode-device.log`／`.xcresult`：iPhone XS Max／iOS 18.7.10，17 项全部通过，执行 18.711 秒。
  覆盖新增三项、实测静音边界及变速／拖动／队列／资源释放回归。受控队列测得 bassSwap、
  出场曲 1.100000023841858 倍速、入场曲 1 倍速，暂停取消通过。
- `master-mode-qa-uninstall.json`：QA 已卸载；`master-mode-personal-app.json`：个人包仍为 0.7.16／build 10。
- 主混音提交 `44aed833509094e331f0d783f3f4c8ac09c0e1b4` 已推送，
  [Mobile checks 38098451489](https://github.com/Kun686/folia-Player/actions/runs/38098451489) 通过。

## 未完成的验收与功能

本地／内嵌歌词时间轴输入的后续接线与验证见 [LOCAL_LYRICS.md](LOCAL_LYRICS.md)。
QQ／网易云在线歌词时间轴的后续接线与验证见 [ONLINE_LYRICS.md](ONLINE_LYRICS.md)。
模型分轨与表现手势、ReplayGain、封面／在线歌词持久缓存仍待接入或完成。
动画接线及其验证边界见上述后续记录。
QQ／网易云真实账户端到端、真实 iPad、长时间锁屏跨曲、真实蓝牙／网络切换、听感和功耗仍须单独验证。
受控档案加真实解码的队列测试不等于实际歌曲的分析精度或音乐平台验收。
