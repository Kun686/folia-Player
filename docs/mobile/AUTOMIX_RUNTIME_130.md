# Automix 官方 Apple ORT 1.30.0 独立验证

2026-10-11。状态：**APPROVED_INDEPENDENT_VALIDATION**。用户已批准官方 Apple 1.30.0 独立验证。
此前授权只覆盖 Swift ORT 1.24.2；新增授权覆盖本文件的固定候选与验证顺序，不包含生产接入。
mobile.20 用户已确认 QQ／网易云登录保留、播放正常；个人 App 与已接受的 mobile.19 外观保持原状。
官方产物现已完成下载、Mac及iPhone单样本与30秒窗口验证；窗口浮点诊断部分失败，具体结果与未测边界见文末。完整Automix仍未接入。

## 兼容性问题与最简方案

- 固定原 htdemucs 在 Apple ORT1.24.2 创建会话时，被 `/dft_istft/DFT_6` 形状推断拒绝：
  `is_onesided and inverse attributes cannot be enabled at the same time`。
- 只读解析确认模型采用 opset17，该节点的 `inverse=1`、`onesided=1` 表达 IRFFT。
  ORT1.24.2 固定 ONNX1.20.1，其DFT17规则禁止此组合；ORT1.30.0 固定 ONNX1.22.0，对复数输入明确支持。
  同一原模型已在现有 Node ORT1.30.0 成功加载并完成单段推理；没有改图、删节点或改属性。
- 复用原清单、两个已校验模型、预处理／后处理和 `dev/mobile/automix-runtime-probe.cpp`。
  新增 Node 参考探针仅用已安装的 `onnxruntime-node` 与标准库，不重写算法。
- 推荐直接验证官方 `onnxruntime-c` 1.30.0 ZIP 的 C/C++ XCFramework。
  不需要安装 CocoaPods、新增 npm／SPM 包或自编 ORT。系统框架不能直接执行原ONNX，Apple运行库仍必要。
- Node结果不能证明Apple产物的算子、链接与资源可用；须对实际产物复测。

## 固定依赖与成本

| 项目 | 已核查事实／限制 |
|---|---|
| 候选 | Microsoft `onnxruntime-c` **1.30.0**，CocoaPods 官方登记，2026-09-10 发布 |
| 维护 | 主仓最新1.31.0、Swift包仍1.24.2、CocoaPods C包当前最新1.30.0；不可混称同一发布状态 |
| 来源 | 固定podspec指向 `https://download.onnxruntime.ai/pod-archive-onnxruntime-c-1.30.0.zip` |
| 许可 | podspec标明MIT；解包后核对并保留LICENSE及实际附带声明 |
| 下载 | 验证TLS的HEAD返回200、**63,965,603字节**（约64MB），比旧ZIP多11,827,006字节 |
| App成本 | ZIP解压条目合计254,948,747字节；首轮QA可执行文件37,185,872字节，连同原模型的QA Bundle为231,070,101字节。这些不是个人App的链接增量 |
| 平台 | podspec：iOS15.1+、macOS14+；静态XCFramework、C++标准库、Apple系统框架，弱链接CoreML，无其他Pod依赖声明 |
| 扩展／模型 | 不下载Extensions；复用原两个模型，不重复下载、转换、量化或改图 |
| 完整性 | podspec未公布SHA256。固定官方HTTPS下载后的本地摘要为 `e6f1670c14406fd9f082bb400ab197a9b0a9646058ca6366e440642e2b54a2ea`；字节数、ZIP CRC、路径和三个平台片段已核对，MIT LICENSE已保留。该摘要不冒充上游签名或独立认证 |

## 安全核查与资源风险

- 2026-10-11，GitHub Global Advisories 的 `pip / onnxruntime@1.30.0` 返回空数组。
  该范围不覆盖全部Apple二进制风险，不能据此声称没有漏洞。
- 1.30.0说明包含模型深度、外部数据路径、内存分配及算子检查加固；1.31.0仍增加模型加载、图验证、
  CPU算子与空DFT输入等修复。1.30.0不等同最新安全状态；本次仅隔离加载固定哈希的原模型。
- 原桌面Python的 `enable_mem_reuse=False` 仍无可复用的公开C API setter；
  `DisableCpuMemArena()` 不是该开关。不得虚构配置或修改内部二进制结构。
- Node参考单段进程峰值约 **1.21GiB**，不是Apple C++宿主或iPhone用量。XS Max资源可行性未知。
  两模型顺序测试，每次命令限60秒；资源不可行时记录结论，不擅自缩段或改模型。

## 本轮已完成的参考推理

```sh
"$HOME/.local/bin/codex-bounded" 60 -- node dev/mobile/automix-node-probe.mjs \
  .mobile-test-results/automix-probe/assets/htdemucs.onnx \
  .mobile-test-results/automix-probe/htdemucs-input.f32 \
  .mobile-test-results/automix-probe/htdemucs-node-reference
```

输出目录须不存在；执行前后校验原模型清单中的大小／SHA256。Session与tensor均释放。
探针检查通过：错误输入长度被拒绝且释放session；已有输出目录在推理前被拒绝；
Beat This!复跑与先前Node参考逐字节相等。证据 `node-probe-validation.json`，语法及diff检查通过。

| 项目 | 实测 |
|---|---|
| 宿主 | macOS arm64，Node24.17.0，已安装Node ORT1.30.0；CPU、2线程、all优化、关闭CPU arena |
| 模型SHA256 | `099b5be76c1f6922124d07f850250f39d1f33f254a0b8cc90f4ec0dfd0912329` |
| 输入 | 44.1kHz合成立体声 `[1,2,172032]`；110/220/330Hz正弦与120bpm衰减脉冲，约3.90秒 |
| 输入SHA256 | `4a214bd0e298f90af1b4f8b7f5cf259cc8e6cc86692256b5c04b19b667172bd5` |
| 输出 | `stems [1,4,2,172032]`，1,376,256个有限float32；peak0.1579267、RMS0.0546287 |
| 输出SHA256 | `24d9f8248664d9b3cbd241a5fcf707c2237d39bac56a6f528b873af20499de02` |
| 加载／单段 | 约194ms／682ms；同进程checkpoint差值，不含输入输出落盘 |
| 进程峰值RSS | 1,298,743,296字节，约1.21GiB；含校验、加载和单段推理，不是独立算子内存 |
| 边界 | **PASS_REFERENCE_ONLY**；不是桌面Python数值对齐、Apple兼容、真实音乐质量、跨段接缝或手机验收 |

## 批准后的验证与边界

1. 下载固定ZIP，记录SHA256／大小，核对许可证与iOS／模拟器／macOS片段，隔离放入忽略目录。
2. 复用C++探针测两个原模型加载、同一输入输出形状／有限性、最大误差与RMSE；Beat This!复用原谱图及拍点后处理。
   记录逐阶段耗时、进程峰值；先一个模型后另一个，单段可行才测连续片段、原窗口拼接与释放。
3. Mac资源表现可行才建立独立QA Bundle ID的iOS宿主，测手机峰值、播放争用、取消和内存警告。
   不替换或卸载个人App，不将模拟器结果计作真机结果。
4. 失败记录精确错误与资源，不加入个人App。生产接入、改模型、自编运行库、安装Python、服务器推理均不在本次申请内。

## 替代方案与回退

- 推荐官方1.30.0独立验证：下载和维护成本最低，已有新版Node参考，保持原模型；Apple兼容和内存仍未知。
- 等Swift包更新：管理更直接但无确定日期，当前1.24.2已有失败证据。
- 自编／CoreML转换：新增工具链、维护、数值一致性与回归成本；有官方候选时尚无理由承担这些成本。
- 服务器推理改变本地能力、延迟与运维，不作为原生完整移植的默认替代。
- 回退只移除独立验证产物，不涉及个人App、队列、凭据、源模型和UI；旧1.24.2证据保留可复核。

## 来源与本地证据

- [固定CocoaPods podspec](https://trunk.cocoapods.org/api/v1/pods/onnxruntime-c/specs/1.30.0)
- [ORT1.30.0发布](https://github.com/microsoft/onnxruntime/releases/tag/v1.30.0)、[1.31.0后续修复](https://github.com/microsoft/onnxruntime/releases/tag/v1.31.0)
- [ORT1.24.2依赖](https://github.com/microsoft/onnxruntime/blob/v1.24.2/cmake/deps.txt)、[ORT1.30.0依赖](https://github.com/microsoft/onnxruntime/blob/v1.30.0/cmake/deps.txt)
- [旧DFT17规则](https://github.com/onnx/onnx/blob/v1.20.1/onnx/defs/math/old.cc#L4042)、[新DFT17规则](https://github.com/onnx/onnx/blob/v1.22.0/onnx/defs/math/old.cc#L3426)
- 本地 `.mobile-test-results/automix-probe/`：`htdemucs-graph-readonly.json`、`htdemucs-node-load.log`、
  `htdemucs-input.json`、`htdemucs-node-reference/report.json`及原始float32、固定podspec、发布说明与通告响应、
  `onnxruntime-c-1.30.0-head.json`。系统curl TLS失败后只重试一次，改用现有Node OpenSSL且保持证书验证成功。

## 官方1.30.0验证结果

**兼容性 PASS（固定样本）**：Apple官方库已能加载两个未修改模型。Mac原生输出与Node参考逐字节相等，
三路输出maxAbs和RMSE均0。原DFT创建会话失败已解除；不再把该旧错误当作新版阻塞原因。

**内存配置需调整**：默认memory pattern在第二次推理时分轨峰值physical footprint升至
1,986,529,392字节（约1.85GiB），拍点升至1,792,411,520字节。
仅增加公开 `DisableMemPattern()`，分轨8次峰值降到1,253,951,048字节（约1.17GiB），
拍点降到1,167,459,720字节；第8次输出与原参考相等。此选项与Python内部memory reuse开关不同。
8次为同一输入的重复运行，不是完整30秒分轨窗口或长期内存测试。

首次加载smoke存在短暂进程重叠，性能数据采用后续串行 `apple130-serial-*`、`apple130-repeat-*`、
`apple130-no-pattern-*`；两个模型不并行测试。串行单段分轨588ms、拍点514ms，均为Mac数据。

**iPhone XS Max／iOS18.7.10 实测**：独立 `app.folia.validation.ort130`，Release，
CPU2线程、all优化、关闭CPU arena和memory pattern。签名、Bundle ID及Bundle内原模型哈希核对通过。

| 模型 | 同会话3次推理 | 峰值physical footprint | 释放后footprint | 数值对照 |
|---|---|---|---|---|
| htdemucs | 2884／2835／2917ms，单段3.90秒PCM | 1,105,545,432字节，约1.03GiB | 13,518,264字节 | maxAbs `1.49e-7`，RMSE `1.79e-8`，相对L2 `3.27e-7` |
| Beat This! | 2722／2864／2944ms，单段30秒谱图 | 681,133,776字节，约650MiB | 11,781,200字节 | beat／downbeat maxAbs `1.81e-5`／`2.34e-5`，RMSE约 `4.9e-6` |

两者均0次内存警告，输出全部有限；iPhone浮点输出不是逐字节相等。
原 `beatsFromLogits` 后处理的61个拍点与57个小节线标记数组和Node参考完全一致。
合成输入不用于宣称真实音乐识别质量。iPhone分轨数值的诊断检查为maxAbs≤1e-5、相对L2≤1e-4；
拍点保留原始差异并验证实际后处理结果，不把两模型套同一绝对logit误差阈值。

**取消及恢复 PASS（Mac＋iPhone固定样本）**：在Run开始后25ms从另一线程调用公开
`RunOptions.SetTerminate()`，确认正在执行的Run确实被取消，再以 `UnsetTerminate()` 清除，
同一Session／RunOptions连续跑3次。iPhone从启动Run到观察取消分别49ms（分轨）、31ms（拍点），
包含设定的25ms等待；恢复后的输出与取消前iPhone输出逐字节相等，原拍点后处理仍与Node相同。
0次内存警告；这不是实际切歌取消、后台调度或系统内存警告路径验收。
Mac取消恢复也通过，最终输出与Node参考相等。命令在上述启动后追加 `--cancel-once`；
对应探针C++尾参为 `3 no-memory-pattern cancel-once`。

探针源码：`dev/mobile/automix-node-probe.mjs`、`automix-runtime-probe.cpp`、`automix-ios-probe.mm`。
独立Xcode工程在 `.mobile-test-results/automix-probe/ios-qa/`，不修改个人App工程、锁文件或生产依赖。
构建使用该工程 `FoliaORTProbe` scheme／Release／generic iOS destination。
真机启动示例：`xcrun devicectl device process launch --device <id> app.folia.validation.ort130 -- --model htdemucs`；
每次须在新的结果目录中运行，探针50秒watchdog，输出只写该QA沙盒。

证据：`runtime-1.30.0-verified.json`、`apple130-comparison.json`、上述串行日志与输出、
`ios-qa-build.log`、`ios-qa-identity.json`、`ios-htdemucs/`、`ios-beat/`、`ios-*-comparison.json`、
`ios-beat-postprocess.json`。下载首轮120秒超时，校验同一ETag并以Range续传一次成功；TLS校验始终开启。
取消恢复证据：`apple130-cancel-*`、`ios-qa-cancel-source.json`、`ios-htdemucs-cancel/`、
`ios-beat-cancel/`、`ios-cancellation-comparison.json`。独立QA已移除，个人App仍为build20，见
`ios-qa-uninstall.json`、`personal-app-after.json`；未卸载或更新个人App。

**后续完整窗口**：原30秒／11段拼接已完成Mac与独立iPhone验证；Mac与原Python拼接参考逐字节相等。
iPhone耗时约33.1秒、峰值约1.08GiB，0次内存警告。近静音vocals相对L2为1.1004219e-4，
仍记为未通过原1e-4诊断门槛；原16位存储最大差1单位，人声退出判断相同。详见[AUTOMIX_WINDOW.md](AUTOMIX_WINDOW.md)。

**NOT_RUN**：真实音乐质量、播放器与动画争用、后台调度、温升功耗和长期内存。
独立推理可运行不等于完整Automix；生产接入仍待批准，见[接入评估](AUTOMIX_INTEGRATION_DECISION.md)。
