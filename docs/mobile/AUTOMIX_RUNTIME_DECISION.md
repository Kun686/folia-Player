# 完整 Automix 原生推理依赖评估

2026-10-11。当前为待批准的验证方案，尚未安装以下新依赖或下载模型。个人 App 仍为 mobile.15。

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

## 一手来源与本地核查记录

- [官方 Swift 1.24.2 发布](https://github.com/microsoft/onnxruntime-swift-package-manager/releases/tag/1.24.2)
- [固定 Package.swift](https://github.com/microsoft/onnxruntime-swift-package-manager/blob/1.24.2/Package.swift)
- [固定公开会话接口](https://github.com/microsoft/onnxruntime-swift-package-manager/blob/1.24.2/objectivec/include/ort_session.h)
- [ORT 1.31.0 发布](https://github.com/microsoft/onnxruntime/releases/tag/v1.31.0)
- 原模型契约：`shared/modelManifest.json`、`src/services/automix/MODELS.md`、`electron/analysis/htdemucs_runner.py`。
- 本地只读核查：`.mobile-test-results/ort-*` 的官方源码、许可证、发布说明、HEAD体积与通告响应。
  初次Python HTTPS受本机CA配置阻止，改用保持TLS验证的gh／系统curl；没有关闭证书校验。
