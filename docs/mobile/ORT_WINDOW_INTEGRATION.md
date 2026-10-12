# Automix 完整分轨窗口接入：独立 Folia QA

2026-10-12，承接用户已批准的 [ORT 工程接入](AUTOMIX_INTEGRATION_DECISION.md)。
本阶段完成实际 Folia 工程中「完整音频解码 → 30 秒窗口 → 11 段原模型推理 → 原四轨存储」的连接。
**PASS_SIMULATOR_PIPELINE**，不是完整 Automix 或真机联合验收；个人 App 保持 mobile.28。

## 实现

- `FoliaStemWindow.hpp` 从已验证的 `automix-window-probe.hpp` 提取原拼接算法，生产与探针共享。
  段长由原模型输入形状读取；当前为172032，四分之一重叠43008、步长129024，30秒共11段。
  保留 float32 分步乘加／归一化、首尾权重、零填充及 drums／bass／vocals 顺序，禁用乘加收缩。
- `FoliaORTJob.separateWindow` 在一次会话里执行所有分段，段间不重载模型，不缓存常驻会话。
  分段推理期间及拼接后均检查取消；取消整窗不会返回已完成的部分轨道。
- `NativeORTInference` 复用固定清单、完整文件快照、SHA256、全局串行队列和60秒执行期限。
  `infer` 单段接口保持兼容；增加 `separateWindow`，接受1至1,323,000帧的双声道平面 float32。
  超时从任务开始执行算起，包含模型核验与加载。会话创建不可中断、排队取消延迟的限制仍存在。
- `NativeStemInference` 消费现有 `NativeStemMaterial`，校验声道／范围／角色后执行完整分轨，
  输出交给现有 `NativeStemAnalysis.window`：从未量化人声计算退出点、原混音相减得到 other、
  原峰值与舍入规则保存四轨 Int16。取消后不发布结果。没有新增生产依赖或替代算法。
- 原 `NativeCrossfade` 的 `performance` 开关仍为 false；尚未接入真实队列的模型调度。

## 本次测试

证据目录 `.mobile-test-results/ort-window-integration/`；实际 Release Folia QA，
Bundle ID `app.folia.validation.App`，iPad Pro 11-inch (M5)／iOS26.5 **模拟器**。

- `native-final.xcresult`／`native-final-summary.json`：9通过、0失败、0跳过。
- 30秒合成输入、30秒授权音乐、1帧、129024帧、129025帧：三轨浮点输出均与原 Python
  `separate` 函数回放实际 Node ORT1.30.0输出所得参考**逐字节相等**。这是既有固定参考，
  本次未重新运行 Python ORT；参考输入、每轨摘要、原函数源码摘要在准备阶段核对。
- 完整133秒音乐 WAV 经 `NativeStemMedia` 解码所得末尾30秒，逐样本等于参考输入；
  文件总帧5864768、尾起点4541768。完整推理后四轨 gain／Int16 PCM与参考相等，
  人声退出点保持原函数值 `23.650000000000002` 秒，四轨存储21,168,000字节。
- 真正运行第一段后取消整窗：不返回部分输出，`running` 恢复为 false，后续窗口可再次推理。
  空／错字节数／超长／整数极限／NaN输入被拒绝；单段原模型、Swift取消和原混音链路相邻回归通过。
- 本次模拟器窗口调用耗时：合成8.97秒、音乐7.41秒；包括快照／模型加载及结果比较开销。
  **不能用于推断手机实时性能**，本次未测峰值内存、温升或同时播放／动画的争用。
- `build.log` 保留第一次泛型 C++ 调用缺 `template` 的编译错误；修复后构建通过。
  `native.xcresult` 保留首轮8通过／1失败：测试误把原人声退出值写成显示用的23.65。
  修正为原函数精确值，并补充完整文件解码链路后复测通过，未改变算法或误差门槛。

## 复现和包核对

按 [ORT_INTEGRATION.md](ORT_INTEGRATION.md) 准备固定运行库，使用独立 xcconfig 构建／安装 QA。
将既有参考资产保留在 `.mobile-test-results/automix-probe/`，运行：

```sh
"$HOME/.local/bin/codex-bounded" 60 -- python3 dev/mobile/stage-ort-window-qa.py \
  6A3572B5-C76C-49D5-8189-4C1F937D6762 .mobile-test-results/ort-window-integration/fixtures-new.json
```

脚本只访问该模拟器的独立 QA Bundle ID，核验并复制33个离线文件，不联网、不访问个人 App。
新环境缺少参考资产时，应按 `AUTOMIX_WINDOW.md`／`AUTOMIX_MUSIC.md` 重建；不能把缺样本跳过当通过。
运行 `NativeORTWindowTests.swift` 的4项和 `NativeORTTests.swift` 的4项，
另含 `testMeasuredStemPlanPreparesRealExpansionAndMix`，保存新的 `.xcresult`。

`source.json` 记录13个精确输入文件；`package.json` 核对6份 native JS 在 dist-mobile／复制目录／
已构建包中一致，模型清单一致，包内0个 `.onnx`。QA可执行文件41,520,704字节，含测试插件的
App为136,709,596字节；这些是模拟器包大小，不是iPhone IPA增量。
个人 `BUILD_RECORD.json` SHA256仍为
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。

QA已卸载、模拟器已关闭。本次设备检查显示iPhone disconnected，没有操作个人App或平台账户。

**NOT_RUN**：本次接入版本的真机完整窗口、物理iPad、播放／动画争用、总内存、温升及后台调度。
**待实现**：按需模型管理、拍点模型进入原分析流程、队列预备与失效清理、完整分轨交接启用。
早先独立探针的手机结果仍只适用于探针，不能合并为本阶段验收。

回退本阶段提交恢复单段工程接口；没有迁移个人数据，QA沙盒卸载即可清理。
