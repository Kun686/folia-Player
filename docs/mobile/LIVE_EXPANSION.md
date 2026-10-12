# 实时扩展效果的素材绑定

2026-10-12，接续 [时钟断裂恢复](STEM_CLOCK_RECOVERY.md) 与 [原扩展效果对照](EXPANSION.md)。
**PASS_GENERATED_AUDIO_DEVICE_AND_SIMULATOR / FULL_AUTOMIX_IN_PROGRESS**。
仅独立 QA；个人 App 保持 mobile.28。界面、模型、依赖及公开能力开关未变。

## 缺口与方案

已有离线扩展渲染必须先确定素材切片，但实际四轨接管需要在音频回调接纳时才能确定
媒体偏移。把先前渲染的重复／升速／倒放 PCM 直接接入，会取错素材；在回调里重新运行
JavaScriptCore 或复制整段 PCM 也不合适。

本次复用原 `expansionGesture.ts` 的采样循环，将其抽为同一条 `walkExpansionSamples`：
普通 Web／桌面 `renderExpansion` 继续写入 Float32 PCM；原生准备阶段写入每个输出采样的
源地址与 Double 增益。循环、wrap 淡化、重复覆盖顺序、甩盘步进和末尾衰减只保留一份。
没有在 Swift 另写效果算法，也没有新增依赖。

- `expansionSampleMapPCM` 使用既有计划校验和 262,144 字节 JSON 上限。
  大数组通过 Float64 typed array 返回，保留原 Double 权重，不压成 Float32。
- `NativeFloat32Bridge` 复用既有类型、长度和所有权检查，增加有界的 Double 复制。
  JSC 数组复制到原生后随短生命周期 VM 释放，不进入音频线程。
- `NativeExpansionProgram` 保留原 Int16 素材和不可变地址／增益表；接管时只绑定整数偏移。
  仍使用 `round(plannedOffset) + round(lateSamples)`，不是两项求和后再 round。
  例如 planned=0.25、late=0.49 仍读取第 0 个素材采样。
- 原生输出先还原原 Float32 源采样，再乘 Double 权重并舍入为 Float32，随后按原顺序
  累加 drums、other；扩展起点的分数采样插值与末对采样外推沿用既有语义。
  遮罩、ReplayGain、8ms 拼接、软限幅及最终效果链的位置保持不变。
- 无效映射、未覆盖素材、缺少扩展计划对应的替代输出会被拒绝，不能让已遮罩的轨道
  静音运行。计划取消、暂停失效、自然交接及主机时钟断裂复用已有生命周期。
- `NativeCrossfade.configure` 增加默认 false 的内部 performance 参数，将其传给原版
  规划器。QA 显式开启；公开设置调用仍使用默认 false，公开 `stems/full/desktop` 仍为 false。
  本轮没有向用户暴露未完成验收的开关。

## 最终验证

证据目录 `.mobile-test-results/live-expansion/`。`source-final.json` 保存 259 项源码／原生
运行时哈希，与两端最终测试一致。未重建或改写原 WebKit 参考样本及完整 PCM 摘要。

| 验证 | 结果 |
|---|---|
| 相关 Vitest：扩展、分轨、覆盖与原会话，Node 24.17.0 | **5 文件、103 项通过**；`unit.log` |
| 类型检查及前端／原生运行时构建、Capacitor 同步 | 通过；`typecheck.log`、`sync.log` |
| iPad Pro 11-inch M5 / iOS 26.5 模拟器，Release QA | **80 通过、0 失败、0 跳过** |
| iPhone XS Max / iOS 18.7.10，Release QA | **同一源码：80 通过、0 失败、0 跳过** |
| 既有完整扩展 PCM 对照 | **12 个完整声道 SHA256 保持一致** |
| 既有 WebKit 混音对照 | 184,624 个参考采样，三种块长；最大差 **4.8428774e-7**，原门槛 1e-5 |
| 新的延后素材绑定与完整原渲染混音对照 | 六组有效计划、三种延迟，共 **17,386,050 个采样**，最大差 **0** |
| 真实双解码器在观测后推进 3,840 帧（约 87ms） | 普通／扩展、正常／暂停四个分支，最大差 **2.9802322e-8**，原门槛 5e-6 |
| 实际 PlaybackEngine 身份队列 | 普通／扩展两模式，各完成自然交接、seek、时钟断裂；保留当前歌曲实例、清除尾曲 |

两个原生完整批次均首轮通过。实际数量已用 xcresulttool 摘要核实，结果为
`simulator-final.xcresult`、`device-final.xcresult`，命令保存在对应 `test-*-final-command.json`。
原 75 项加四项扩展测试（含一项新的延后绑定测试）及一项既有扩展音频图测试，共 80 项；
测试内的多个分支不重复计数。

六组计划覆盖四档强度、非整数开始时间、奇数拍及无节拍网格；原始第七组为空间不足、
无扩展输出，仍保留于原对照。素材绑定比较包含 planned=0.25 与 late=0.49 的分开取整边界。
实际队列要求已进入四轨窗口，且准备状态为 `ready-expansion`；完整音频差异由独立
真实双解码器图与数值对照验证，不只依赖状态名称。

## 资源与安装边界

计划表为每个扩展输出采样两个 Double。上述测试最大表为 **4,233,600 字节**；
30 秒输入上限对应表的理论上限为 **21,168,000 字节**。这是表本身的大小，不是进程
内存峰值；准备阶段还存在 JSC 与原生复制的短暂并存，必须纳入后续联合负载验证。
音频回调只读取已准备的表和素材，没有新增整段 PCM 数组构造或 JSC 调用。

`packages-final.json`：两端均无内置模型；123 项前端资源及两个空 Capacitor 占位文件
与本次 `dist-mobile`、同步目录一致。`transitions.js` 为 114,021 字节。

| QA 包 | 可执行文件字节数 | 含测试插件的 App 字节数 |
|---|---:|---:|
| iPhone | 42,124,416 | 135,584,234 |
| 模拟器 | 42,225,248 | 141,178,080 |

这些不是个人 IPA 的净增量。两端 QA 已卸载、模拟器关闭，个人 App 完整安装元数据
前后一致；`BUILD_RECORD.json` SHA256 保持
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。
回退本次原生与共享 JS 提交并重新同步即可恢复上一版，无持久数据迁移。

## 尚未完成

本轮使用生成音频与显式分离测试实现，**没有运行 ONNX 模型或请求真实音乐平台**。
原模型推理、实际播放与动画联合运行的 CPU／内存／温升，锁屏模型访问、长期后台、
物理 iPad 和人工听感均 **NOT_RUN**。计划表的逐采样读取成本尚未在联合负载下验收。
既有模拟器偶发主音轨切歌超时也未独立确认根因。

扩展效果已接入独立 QA 的实际队列，完整 Automix 与整体移动移植仍未达到交付验收条件。
