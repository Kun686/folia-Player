# 原频带交接与过渡响度平衡

2026-10-11。开发源码进度；个人已安装版本仍由 `BUILD_RECORD.json` 标识为 mobile.10。
本阶段未生成新 IPA，完整 Automix、动画事件接线与真机长期验收仍未完成。

## 复用与实现

- 频带曲线继续使用原 `buildBandCurves`，原生只执行包络；不在 Swift 重写风格选择。
  复用既有 `AudioEqualizer` 系数与 `AudioEffectBiquadState`，按原图在 trim 后、fade 前串联
  250Hz 低架、1000Hz/Q=0.8 峰值、4000Hz 高架。普通单曲平直路径不改 PCM。
- 原曲线结束后保持 6ms，再用 120ms 恢复到平直；取消用原 50ms 恢复。
  每个解码源独立持有历史，避免新歌继承旧歌滤波状态。回到 0dB 时保留滤波极点，让已有状态自然衰减；
  不能立即把系数换成纯旁路，否则取消／恢复处会偏离原版。
- 从原 `automixSession.ts` 提取 `nextBalanceTrim` 与原常量，Web 和原生 JavaScriptCore 共用。
  每 100ms 判断，只衰减出场曲、最多 6dB、至少变化 0.75dB 才更新，400ms 线性增益渐变。
  小于原 0.8 秒最短重叠的过渡不执行平衡。两侧优先使用各自 profile，缺失时用各自的新鲜实时测量。
- 原生 Crossfade 启动原生任务；任务不依赖 WebView 定时器。共享采样时钟接收带代次的 trim 命令，
  替换／取消从最后渲染的样本恢复，与原 `AudioParam.value` 行为对齐。入场曲不受该 trim 影响。
  换歌／暂停清理撤销任务，旧代次不能重新写入；暂时缓冲只跳过本轮判断，恢复后继续。
- 当前 ReplayGain 尚未移植，因此参考电平仍按 unity 补偿。频带执行层已有受控接线验证，
  当前产品仍只执行原 Crossfade，不能把本阶段称为完整 Automix 等价实现。
- 无新增依赖、vendor 改动、许可证复用范围扩展、设置项或主题／界面变化。
  没有另选系统均衡器替代既有数值已验证的滤波器；本阶段只补原图的调度和连接。

## 独立数值依据

- `test/mobile-ui/transition-tone-reference.spec.ts` 在真实 WebKit OfflineAudioContext 调用原
  `connectAutomixDeck`、`scheduleBandBlend` 和 `resetTone`，仅替换离线环境没有的媒体元素源。
  48 组覆盖 8/44.1/48/96kHz、三个形状、分数采样起点、开始前和中途取消、左右声道。
  原生两种分块逐样本对照最大误差 **7.599592e-07**。
- `test/mobile-ui/transition-trim-reference.spec.ts` 调用原 `rampGainDb` 和 `rampGain`，
  8 组覆盖四种采样率、渐变替换、取消恢复。原生验证不规则分块、反转音源拉取顺序、
  10 亿帧绝对时钟、旧请求拒绝，最大误差 **7.748604e-07**。
- JSON 参考只加入 NativeTests，不进入 App 资源。脚本默认跳过，显式设置
  `FOLIA_TONE_REFERENCE=1` 或 `FOLIA_TRIM_REFERENCE=1` 才可重新生成。
- 双 WAV 解码器集成测试检查真实共享图中的频带→fade 顺序、左右声道、源角色和统一时钟，
  对照误差 **0.0**。它使用已由上述独立 WebKit 对照验证的原生滤波器作为接线预期，
  不把这个集成测试另算一份独立 DSP 正确性证据。
- 两个实际恒定 WAV 解码器分别输入受控 profile 电平 -6/-12dB，输出达到预期
  `0.125 * (1 + 10^(-6/20))`；暂停其中一路后恢复仍执行修正，取消恢复到 0.25，
  短重叠不会施加 trim。这不是实际歌曲的响度测量或真实平台试听。

## 测试记录与边界

证据均位于 `.mobile-test-results/`。

- `tone-webkit-reference.log`、`trim-webkit-reference.log`：参考生成 PASS。
- `tone-native-poles.{log,xcresult}`：频带专项 2 项 PASS。
- `tone-full.{log,xcresult}`：频带接入后原生 151 项 PASS，67.280 秒。
- `trim-native-first.{log,xcresult}`：平衡专项 3 项 PASS，2.742 秒。
- `tone-balance-typecheck.log`、`tone-balance-mobile-build.log`：最终 TypeScript／移动构建 PASS。
- `tone-balance-unit.log`：移动和原 Automix 逻辑 35 文件、480 项 PASS。
- `tone-balance-ready-full.{log,xcresult}`：iPad Pro 11-inch (M5) / iOS26.5 / Release，
  合并后的完整基线 **154 项 PASS，68.086 秒**。沿用基线排除三个依赖独立 HTTP fixture 服务的
  用例，本轮未重跑这三项；真实本地解码、受控 URLProtocol 在线队列和既有 DSP／缓存／凭据回归通过。
- `tone-balance-device.{log,xcresult}`：iPhone XS Max / iOS18.7.10 / Release，**8 项 PASS，
  6.324 秒**。包括全部六项新增频带／平衡测试及两项实际逐路分析生命周期；频带和平衡最大误差
  与模拟器相同。启动／seek 后有效电平约 0.416／0.403 秒。这是受控样本的物理设备执行，
  不是三方平台、主观听感、持续功耗或长期锁屏验收。

首轮频带 `tone-native-first` 最大误差 0.04437555，定位到回到 0dB 时提前旁路丢失滤波历史，
保留极点与状态自然衰减后通过；未放宽断言。平衡首次 TypeScript 检查发现验证后的 unknown
仍需类型收窄，修复后通过。原失败日志保留。

`tone-balance-full` 首次合并回归为 153/154 用例通过，已有逐路分析恢复用例产生三条断言失败：
固定等待 650ms 后状态存在但响度仍为空，后续引用该初始响度再次失败。原共享分析逻辑要求至少
16 个采样帧，墙钟等待不保证已满足此条件；这个日志不能单独判定是启动延迟还是途中窗口失效。
测试改为等待有效测量，最多两秒，并输出实际耗时；保留原数值容差、seek 后立即为空和不伪造
完整历史的断言。未修改产品分析规则，也未把旧失败删去。
最终完整回归中，启动有效电平约 0.424 秒、静音后的读取约 0.001 秒、seek 后重新积累约 0.425 秒。

真机构建 `tone-balance-device-build.log` 成功，但 Xcode 生成清单的 `TestHostBundleIdentifier`
仍为个人包，实际签名 App 和测试插件均为 QA 身份。身份校验在运行前拒绝了这个不一致。
原清单保存在 `tone-balance-device-original.xctestrun`；核对实际两个 Bundle ID、两个包路径和
crash-report 目标后，复制为同目录的 QA 测试清单，仅将宿主字段对齐为 `app.folia.validation.App`。
`tone-balance-device-identity.json` 记录该调整，再使用 `test-without-building` 运行；未修改个人包。
测试结束卸载 QA，`tone-balance-qa-uninstall.json` 记录结果，并回读个人安装至
`tone-balance-personal-app.json`。`BUILD_RECORD.json` 和个人 IPA 不变。

真实 QQ／网易云 API 与 CDN、iPhone/iPad 各 30 分钟锁屏、耳机／蓝牙／网络切换、150ms 歌词
误差和连续温升／功耗仍为 NOT_RUN。本阶段证据不能代替这些验收。
