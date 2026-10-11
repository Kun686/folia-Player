# 完整 Automix 原生推理依赖评估

2026-10-11。用户已批准下述固定版本的独立推理验证，并要求优先改善移动布局与旋转表现。
运行库ZIP与两个模型已下载并核对固定字节数和SHA256；尚未接入个人App。
本次批准不包含自编运行库、转换模型、安装Python或直接启用生产Automix。

后续定位：原htdemucs已在现有Node ORT1.30.0完成单段推理，旧版失败对应ONNX的DFT形状规则差异。
已找到官方Apple1.30.0二进制；固定依赖、资源风险和新的独立验证申请见
[AUTOMIX_RUNTIME_130.md](AUTOMIX_RUNTIME_130.md)。用户已单独批准1.30.0独立验证；新候选已解除DFT失败，
Mac与iPhone单样本结果见该记录。以下1.24.2失败保留为历史证据，不代表新版仍有同一阻塞；生产接入尚未进行。

## 为什么需要运行库

当前原生主混音、变速、原歌词时间轴、分析与过渡动画已接线；完整模式仍缺 Beat This! 拍点、
htdemucs 分轨及分轨手势执行。原版由 Node／Python 独立进程推理，不能直接移植进 iOS 容器。
已有 AVFoundation／Accelerate／JavaScriptCore 不提供 ONNX 模型推理；现有 onnxruntime-node 是桌面二进制。
复用原模型、预处理和过渡规则，增加成熟推理运行库，比重写推理或替换算法更能保持原行为。

## 固定候选及成本

| 项目 | 固定版本／身份 | 许可证与成本 |
|---|---|---|
| Microsoft ONNX Runtime 官方 Swift 包 | `1.24.2`，提交 `b7fb7f7dea8a2469e6335d95a61b8f36d0dc83b2` | MIT；iOS 15+／macOS 14+；无外部 Swift 包依赖，只选择 `onnxruntime` 产品 |
| 包中引用的 ORT C/C++ 二进制 | `1.24.2`；SHA256 `f7100a992d2a8135168c8afd831e6a58b465349101982aa58b3e11d36e600b54` | 官方 ZIP HEAD：52,138,597 字节；这不是 App 体积增量，实际链接增量待测 |
| 官方包附带的可选 Extensions 资产 | `0.13.0`；SHA256 `346522d1171d4c99cb0908fa8e4e9330a4a6aad39cd83ce36eb654437b33e6b5` | MIT；ZIP HEAD：19,359,053 字节。SPM 可能解析下载该资产，应用不链接 Extensions 产品 |
| 原版 Beat This! 模型 | `shared/modelManifest.json` 中 `beat_this` 的既有 SHA256 | MIT；83,077,778 字节，保持原权重与预处理常数 |
| 原版 htdemucs 模型 | 同清单 `htdemucs` 的既有 SHA256 | MIT；108,644,650 字节，保持仓库现有半段长版本 |

模型合计约191.7MB，含可选资产的验证下载总量约263.2MB。最终模型仍按原版按需下载，不塞进基础安装包。
不新增 npm 包、不在手机内嵌 Python、不更改模型权重或歌词动画。新增代码限于原生 I/O、推理调用、取消和生命周期适配。

## 已核对与未知

- 官方 Swift 包最新发布仍为1.24.2（2026-02-25）；ORT 主仓最新为1.31.0（2026-10-09）。
  不能把主仓持续维护等同于 Swift 包已同步更新。此候选用于兼容性验证，通过后才考虑接入。
- 2026-10-11 查询 GitHub Global Advisories 的 `pip / onnxruntime` 记录为空。
  这只是该数据源未返回记录，不证明 iOS 二进制没有漏洞；权重及二进制均需严格校验固定哈希。
- 1.24.2发布说明包含 `ArrayFeatureExtractor` 越界读修复；1.31.0另包含模型加载、形状检查及算子越界修复。
  因此1.24.2不应被描述为安全上已追平主仓。验证只加载清单中经哈希确认的两个模型，不接受任意模型文件；
  生产接入前仍需确定较新官方Apple构建的可用性与固定版本方案。
- 官方1.24.2 Objective-C接口可设线程数、图优化和配置项；原版分轨使用的 `enable_mem_reuse=False`
  没有出现在其公开接口。另查1.31.0公开C API及配置键也未找到对应开关，不能虚构配置项。
- 原仓记录 htdemucs 在桌面开关关闭后的峰值约483MB，未关闭时曾达约2.5GB。
  这些不是 iPhone 测量值，不能承诺本候选能在 iPhone XS Max 稳定运行。
- ONNX图版本、DFT等算子、真实输出一致性、加载及单段内存、持续播放争用、耗时与包体增量均待实测。

## 推荐验证与接入门槛

1. 先下载固定资产并核对哈希，在独立 macOS／模拟器验证宿主运行原模型，不替换个人 App。
2. 对同一PCM执行原前后处理与参考推理，比较拍点／小节线、分轨输出及段边界；记录峰值内存与耗时。
3. 先确认资源预算可行，再在独立 iPhone QA 包验证；失败、取消、并发切换、内存警告和后台调度必须可收敛。
4. 两模型满足兼容、数值和资源门槛后，才接入原生队列与原分轨手势；完整 Automix 仍需真实音乐听感、锁屏和功耗验收。
5. 若官方运行库无法满足内存需求，保留现有播放器并报告实测原因。修改／自编 ORT、转换模型、
   换模型或转移到服务器均属于另一个方案，不能自动扩展本次批准。

## 替代方案与回退

- Core ML是系统框架，但现有ONNX不能直接加载，需要模型转换及逐算子数值验证；当前没有可直接复用的产物。
- 自编ORT可增加内部省内存开关，成本是工具链、可审查补丁及跨架构维护；仅在证据表明必要后另行评估。
- 服务器推理改变离线能力、延迟与运维边界，不作为本次移动端原生方案的默认替代。
- 仅开启无模型兼容分支不能满足完整移植目标；可保留作为原版的正常运行时回退，不能把它标为交付完成。
- 验证包和下载资产可独立清理；未通过时不改个人 App、原队列或现有曲库。不修改已保存的歌曲和凭据。

## 2026-10-11 独立验证结果

- PASS：官方ZIP52,138,597字节及两个原模型全部通过上述SHA256与字节数校验。
  使用ZIP中的macOS arm64静态库和公开C++接口建立独立命令行宿主，代码见
  `dev/mobile/automix-runtime-probe.cpp`；未安装Python，未链接Extensions，未修改模型或个人App依赖。
- PASS（单样本数值）：Beat This! 使用原 `melSpectrogram`，输入661,059个22,050Hz采样，
  含220Hz正弦与120bpm衰减1000Hz脉冲，得到原契约`[1,1500,128]`张量。
  ORT Apple1.24.2与已安装的Node1.30.0在CPU、2线程、关闭CPU arena下，两条1500点输出逐值相等，
  maxAbs与RMSE均0；原 `beatsFromLogits` 的61个拍点与小节线结果相同。
  这是合成输入的运行库一致性验证，不是真实音乐识别质量验收。
- RESOURCE_CONCERN：该macOS进程加载约286ms、单段推理约625ms；`getrusage`进程峰值RSS
  为1,228,849,152字节（约1.14GiB）。不能外推为iPhone用量或稳定性；尚未测连续推理、取消和播放争用。
- BLOCKED_COMPATIBILITY：htdemucs在建立会话时失败：
  `Node (/dft_istft/DFT_6) Op (DFT) [ShapeInferenceError] is_onesided and inverse attributes cannot be enabled at the same time`。
  因此此固定候选不满足完整Automix接入门槛，停止后续手机接入；未用换模型或改图绕过失败。
- NOT_RUN：iOS原生推理、htdemucs输出、分轨混音、真实音乐听感、功耗、内存警告、取消／后台调度及App体积增量。
  需要先评估具备该DFT兼容性的较新Apple运行库；自编运行库仍须单独说明与批准。

本地证据：`.mobile-test-results/automix-probe/assets-verified.json`、`beat_this-load.log`、
`htdemucs-load.log`、`beat-inference.log`、`beat-comparison.json`及固定原始输入／输出。
构建示例：`xcrun clang++ -std=c++17 -O2 -mmacosx-version-min=14.0 -I <archive>/Headers
dev/mobile/automix-runtime-probe.cpp <archive>/onnxruntime.xcframework/macos-arm64_x86_64/onnxruntime.framework/Versions/A/onnxruntime
-framework Foundation -o <probe>`。只在校验固定资产后执行，使用`codex-bounded 60`限制每次加载／推理。

## 一手来源与本地核查记录

- [官方 Swift 1.24.2 发布](https://github.com/microsoft/onnxruntime-swift-package-manager/releases/tag/1.24.2)
- [固定 Package.swift](https://github.com/microsoft/onnxruntime-swift-package-manager/blob/1.24.2/Package.swift)
- [固定公开会话接口](https://github.com/microsoft/onnxruntime-swift-package-manager/blob/1.24.2/objectivec/include/ort_session.h)
- [ORT 1.31.0 发布](https://github.com/microsoft/onnxruntime/releases/tag/v1.31.0)
- 原模型契约：`shared/modelManifest.json`、`src/services/automix/MODELS.md`、`electron/analysis/htdemucs_runner.py`。
- 本地只读核查：`.mobile-test-results/ort-*` 的官方源码、许可证、发布说明、HEAD体积与通告响应。
  初次Python HTTPS受本机CA配置阻止，改用保持TLS验证的gh／系统curl；没有关闭证书校验。
