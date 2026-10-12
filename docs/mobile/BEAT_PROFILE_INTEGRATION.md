# Beat This! 接入原版歌曲分析：独立 Folia QA

2026-10-12，沿用已批准的 ORT1.30.0、原模型及独立QA范围。
状态 **PASS_SIMULATOR_PROFILE_PIPELINE**。原生现在可从22.05kHz PCM执行原梅尔频谱、原分段、
实际模型、原拍点后处理和原歌曲分析；当前个人App仍为mobile.28，尚未给真实队列配置模型或启用完整Automix。

## 实现与复用

- `beatThis.ts` 仅给 `melSpectrogram` 增加可选等价FFT参数，Web／Electron默认继续调用原FFT。
  窗口、反射填充、滤波器、分块、keep-first拼接、峰值检测、下拍对齐与网格拟合均复用原函数。
- `nativeProfileRuntime.ts` 的新边界导出原梅尔准备及拍点后处理；原 `analysePCM` 增加可选网格JSON。
  缺省参数保持`gridless: true`；显式网格或JSON null表示已尝试模型，`gridless: false`。
  结果为null与未运行模型区分，沿用原`TrackProfile`语义。异常／无序／越界网格拒绝处理。
- `NativeProfileFFT` 复用系统Accelerate双精度FFT，支持原profile的2048点及Beat This!的1024点。
  `NativeProfileRuntime` 把现有JSC脚本校验、45秒期限、取消和FFT回调提取为共享宿主，阶段结束释放VM。
  `NativeBeatAnalysis` 在准备阶段复制typed array后释放JSC，再运行模型，随后创建短期VM后处理；
  不保存跨线程JSC指针，不把PCM编码进JSON，不经过WebView。
- `FoliaORTJob.runBeatChunks` 共用一次模型会话处理同一首歌的原分块，输出按beat／downbeat成对返回。
  接口最多41段、每段1–1500帧，覆盖既有20分钟profile上限。分段之间检查取消，不发布部分批次。
  `NativeORTInference` 复用全局串行模型队列、固定摘要快照与60秒执行期限，不新增运行库。
- `NativeTrackProfiler` 的本地、完整媒体缓存、远程前缀入口均接受可选`beatModel`。
  明确传入模型时才运行新的流程，模型异常会抛出且不写入分析缓存；取消不发布结果。
  未传入时保留原行为和原缓存键。已测模型缓存包含固定模型SHA256及ORT执行路径，读取也检查
  `gridless`，不会用原无模型结果挡住新分析。UI和当前队列尚未配置这个参数。

## 验证

证据在 `.mobile-test-results/ort-beat-integration/`。

- `reference/`：使用既有授权音乐窗口（来源及许可见`AUTOMIX_MUSIC.md`），选取交替采样点并按原
  `(L+R)/2`／`(L-R)/2`生成固定22.05kHz测试PCM。此构造用于固定相同输入，**不是解码器或重采样器对照**。
  参考生成器直接打包原`beatThis.ts`／`trackProfile.ts`，由已安装Node ORT1.30.0运行原模型。
  1501帧梅尔谱按原规则拆为2段，参考得到37个拍点、10个小节起点。模型、源码与所有数据保存SHA256。
- `unit.log`：4文件、28项逻辑测试通过，含FFT注入默认兼容、原边界分段与峰值、partial和模型状态语义。
  `typecheck.log`、`sync.log`：TypeScript与移动资源构建／Capacitor同步通过。
- `native-final.xcresult`／`native-final-summary.json`：实际Release Folia QA，
  `app.folia.validation.App`，iPad Pro11-inch(M5)／iOS26.5模拟器，**19通过、0失败、0跳过**。
  准备梅尔与模型logits的最大绝对差均为0，最终37／10个时间点精确一致；
  完整与partial歌曲profile逐字段符合原参考（既有1e-6数值容差，结构／状态字段精确检查）。
- 缓存验证从真实WAV解码：无模型／有模型生成2份记录；换成无分析脚本的宿主仍可分别命中两者，
  证明测得模型后的结果持久保存且不被旧缓存替代。
- 实际完成一个拍点模型分段后取消批次，拒绝部分结果并可再次推理；另测准备阶段取消、非法尺寸、
  空输入、原无模型8组profile、前缀字段、跨provider缓存／退出清理和旧请求取消。
  既有单段ORT、实际取消恢复、完整30秒分轨与边界窗口也保持通过。
- 首轮`native.xcresult`为18通过／1失败：零长度NSData不能供JSC的无复制指针构造器使用。
  按系统`JSTypedArray.h`改用`JSObjectMakeTypedArray(..., length: 0)`，无需保留空指针所有者；
  新测空拍点准备和空profile均通过。保留首轮失败，未放宽任何数值阈值。
- 收尾检查为准备阶段显式清空回调捕获的临时JSValue，避免跨上下文的引用持有。
  `native-ownership.xcresult`新增原始PCM所有者释放检查，并重跑拍点完整链路、原模型profile和既有
  profile释放检查：4通过、0失败、0跳过。其中3项为前述重跑，本阶段共20项不同原生测试，非23项。

## 复现与范围

在仓库根，保留既有授权音乐与固定模型资产，生成一个新参考目录：

```sh
"$HOME/.local/bin/codex-bounded" 600 -- node dev/mobile/beat-profile-reference.mjs \
  .mobile-test-results/automix-probe/assets/beat_this.onnx \
  .mobile-test-results/automix-probe/music/input.f32 \
  .mobile-test-results/ort-beat-reference-new
```

按`ORT_INTEGRATION.md`构建安装独立QA后，用`stage-beat-profile-qa.py <simulator-uuid> <reference-directory> <new-report.json>`
核验13个文件并放入该QA沙盒。与`stage-ort-window-qa.py`准备的分轨回归资产互不混用。
模型缺失时专项会明确跳过；验收必须确认0跳过。测试入口为`NativeBeatTests.swift`及上述相邻回归。

`source.json`记录19项回归时的16个源码／工程输入；最终释放检查对应`source-ownership.json`及
`package-ownership.json`，核对6份native JS在dist-mobile、复制目录和构建包中一致。
最终包内0个模型，模拟器可执行文件41,576,752字节，含测试插件的App137,067,157字节；不是手机IPA增量。
个人构建记录SHA256仍为`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。
独立QA已卸载，模拟器已关闭，任务启动的构建／测试进程已结束。

**未完成**：模型下载／删除／状态设置、实际队列模型预分析与升级触发、分轨预备和完整Automix交接启用。
**NOT_RUN**：本次拍点接入的物理iPhone／iPad、QQ／网易云真实曲目模型分析、播放／动画争用、
内存峰值、后台连续调度和温升。个人App、服务器和平台账户均未操作。

回退本阶段提交恢复原生无模型分析边界；无模型缓存键和用户数据未迁移，新增模型缓存可自然淘汰。
