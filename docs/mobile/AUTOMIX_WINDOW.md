# Automix 原版 30 秒分轨窗口独立验证

2026-10-11。状态：**独立运行完成，数值诊断部分失败；尚未接入完整 Automix**。
承接 [官方 Apple ORT 1.30.0 验证](AUTOMIX_RUNTIME_130.md)。本阶段没有更新个人 App、生产依赖或模型。

## 复用与参考边界

- 固定官方 ORT 1.30.0 和原 `shared/modelManifest.json` 的 htdemucs，CPU 2 线程，关闭 CPU arena 与 memory pattern。
- `automix-node-probe.mjs --window` 对完整窗口逐段执行已安装的 Node ORT，并记录每段输入／输出的 SHA256。
- `automix-window-reference.py` 从原 `electron/analysis/htdemucs_runner.py` AST 直接执行
  `segment_of`、`build_window`、`separate`，回放上述真实推理结果；逐次验证原函数请求的输入哈希。
  这是原 Python **拼接函数**参考，不是 Python ORT 服务实跑。使用已有 Python 3.12.14／NumPy 2.3.5，没有安装依赖。
- `automix-window-probe.hpp` 为原拼接的薄 C++ 适配：模型读取的 172032 帧段长、43008 帧重叠、
  129024 帧步长、float32 加权累积、原轨道顺序；禁止乘加收缩以保持原来的两次舍入。
  三轨为 drums／bass／vocals；`other` 仍由原版相减得到，不使用模型的 other（索引 2）输出替代。
- `automix-window-compare.mjs` 直接执行原 `stems.ts` 的 `peakOf`／`toPcm` 和
  `stemGesture.ts` 的 `envelopeOf`／`lastVocalMoment`。仅用已安装的 Babel parser 和 Node 内置类型擦除。

## 固定输入与实测

输入是 44.1kHz、30 秒、双声道平面 float32 合成扫频／脉冲／接缝瞬态，共 1,323,000 帧、10,584,000 字节。
SHA256：`1ec8c05a848c5db56f2996fa3bef1d1a3176f2879ce54d7c419a2f7e82e4ce8d`。
共 11 段；这是算法与资源样本，**不是真实音乐分离质量或听感验收**。

| 项目 | macOS arm64 | iPhone XS Max／iOS 18.7.10 |
|---|---|---|
| 执行 | 官方 Apple ORT，完整 11 段 | 独立 `app.folia.validation.ort130`，完整 11 段 |
| 窗口推理、拼接及写出 | 7.237 秒 | 33.084 秒 |
| 峰值 physical footprint | 1,313,261,200 字节 | 1,154,631,976 字节，约 1.08 GiB |
| 释放后 footprint | 本轮未单独测量 | 14,304,816 字节 |
| 输出 | 三轨均与原拼接参考逐字节相等 | 全部有限，具体误差见下表 |
| 内存警告 | 不适用 | 0 次；不等于播放／动画争用时安全 |

耗时取 `window_before_run` 至 `window_saved`，不包含模型加载。
XS Max 处理本样本慢于实时；必须提前准备，不能在交接时才开始。两窗口连续准备及并行播放尚未测试。

### iPhone 数值诊断

保持原诊断门槛 `maxAbs ≤ 1e-5` 且 `relativeL2 ≤ 1e-4`，没有因结果失败改阈值。

| 轨道 | maxAbs | RMSE | relativeL2 | 诊断 |
|---|---|---|---|---|
| drums | 4.6659261e-7 | 9.6613446e-9 | 2.5247759e-6 | PASS |
| bass | 2.1886081e-8 | 2.4646210e-9 | 8.5915896e-6 | PASS |
| vocals | 5.5326382e-8 | 7.7055978e-9 | **1.1004219e-4** | **FAIL_RELATIVE_L2** |

vocals 参考 RMS 仅 7.0024031e-5，近静音使相对误差的分母很小；绝对误差小不能抹掉该失败。
所有段边界前后 512 帧的最大绝对差不超过 4.5780326e-8，本样本未观察到边界误差尖峰。
后续需要有明显人声的真实音乐样本，以及实际分轨手势／混音对照，才能判断产品影响。
后续已有一个真实人声窗口通过原门槛，退出点相同，详见[AUTOMIX_MUSIC.md](AUTOMIX_MUSIC.md)；
本节合成样本失败保持原状，不用另一个样本的通过替代。

### 原存储与人声退出判断

额外复用原函数检查产品实际消费结果，没有替换上述浮点诊断：

- 四轨 gain 均为 1。每轨 2,646,000 个 PCM 样本中，drums／bass／other／vocals 分别有
  368／179／696／516 个量化值不同，最大差均为 **1 个 16 位 PCM 单位**。
- 原版与手机输出的 `lastVocalMoment` 均为 null；这是无明确人声退出点的样本，不证明实际人声退出精度。
- 量化后四轨合成与原输入的最大误差两边均为 0.00006003282032907009；
  两个合成结果的最大差为 0.00003053247928619385。
- 此项为 `PASS_STORAGE_AND_VOCAL_EXIT_FOR_THIS_FIXTURE`，不升级为全部数值门槛通过。

## 边界与回归

- Mac：1 帧、恰好 129024 帧、129025 帧分别运行 1／1／2 段，均与原拼接函数逐字节相等。
- Node 与 C++ 均拒绝空输入、7 字节不对齐、NaN、超过 30 秒一帧；没有写出结果。
- 既有 Node 单段模式和 C++ 实际取消／恢复模式复测 Beat This!，仍与原参考输出逐字节相等。
- Node 语法、diff 检查及独立 iOS Release 构建通过。没有为探针改动重新打包个人 App。
- 核对测试源码与 `ios-source.json` 一致。QA 已卸载，个人 App 已恢复前台；
  `personal-app-final.json` 再次回读 `app.folia.personal` 为 0.7.16／build20，ORT QA 不在已安装列表。

## 运行入口与证据

先按 [固定运行库记录](AUTOMIX_RUNTIME_130.md) 核验模型和运行库，再编译既有 C++ 探针。
原始输入与输出保存在本机忽略目录 `.mobile-test-results/automix-probe/window/`，未将大文件提交到仓库。
输出目录／报告应使用新路径，保留已有证据。以下为参数契约，`<...>` 需替换为相应绝对路径：

```sh
"$HOME/.local/bin/codex-bounded" 60 -- node dev/mobile/automix-node-probe.mjs <htdemucs.onnx> <input.f32> <new-node-directory> --window
"$HOME/.local/bin/codex-bounded" 60 -- <existing-python-with-numpy> dev/mobile/automix-window-reference.py <input.f32> <node-directory> <new-reference-directory>
"$HOME/.local/bin/codex-bounded" 60 -- <compiled-probe> <htdemucs.onnx> <input.f32> <new-output-prefix> window
"$HOME/.local/bin/codex-bounded" 60 -- node dev/mobile/automix-window-compare.mjs <input.f32> <reference-directory> <native-output-prefix> <new-report.json>
```

iPhone 在上述隔离宿主使用 `--model htdemucs --window`，内置 50 秒 watchdog；结果写 QA 沙盒。
`--window` 不与 `--cancel-once` 组合。取消证据来自独立的单段 Run 测试，不能计作整窗口切歌取消验收。

证据索引：`input.json`、`node/report.json`、`original/report.json`、`mac.log`、`mac-comparison.json`、
`ios/result.json`、`ios/probe.log`、`ios-comparison.json`、`storage-comparison-verified.json`、
`boundary-validation.json`、`input-validation.json`、`beat-regression/`、`beat-cancel-regression.*`、
`ios-source.json`、`ios-build.log`、`ios-install.json`、`ios-uninstall.json`、`personal-app-final.json`。
原 Python 源码 SHA256：`e8e8922ac45395781b0b45327b3aac8c164ddd7c9bb32572bbe1c3a48b95e7b3`。

**NOT_RUN**：真实音乐质量、实际分轨播放／手势、播放与动画争用、后台任务调度、长时间温升／内存、物理 iPad。
完整移植仍为 IN_PROGRESS。后续用户已批准独立QA工程接入，范围见 [接入评估](AUTOMIX_INTEGRATION_DECISION.md)。
2026-10-12：原拼接已提取为生产／探针共享 helper，并在实际 Folia QA 中验证完整文件至分轨存储，
见 [ORT_WINDOW_INTEGRATION.md](ORT_WINDOW_INTEGRATION.md)。本页先前实测及失败边界保持不变。
