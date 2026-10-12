# 原拍点前处理优化与模拟器完整交接

2026-10-12，接续 [分析串行化](ANALYSIS_SCHEDULING.md)。
**PASS_NUMERICAL_PARITY / PASS_SIMULATOR_ORIGINAL_HANDOVER / DEVICE_OPTIMIZATION_NOT_RUN**。
只使用独立 `app.folia.validation.App`。个人 App 保持 mobile.28，已接受的界面不改动。
用户要求先继续不依赖真机的工作后，手机 QA 已卸载，没有继续施加真机负载。

## 改动与复用

复用原 `beatThis.ts`、原 JavaScriptCore／vDSP FFT 桥、原规划器和原模型。
没有新增依赖，没有转换模型、缩短音乐或分轨窗口，也没有修改分析容差。

原三角滤波器为每个频带遍历全部513个FFT频点，多数权重严格等于零。
现在预先记录每行首尾非零范围，有限FFT输入只遍历该范围。权重、非零项累加顺序、
Hann窗、padding、归一化和模型分块保持原样。
出现NaN或Infinity时仍走原完整循环，保留 `Infinity * 0 => NaN` 的行为。
这是共享算法的等值优化，Web／Electron也会使用；原生资源只重新生成了 `profiles.js`。

另加两个只读诊断属性，按需读取分析队列压力、任务数和规划状态，不记录来源、URL或凭据。
静音边界测试的5秒超时与断言不变，增加逐秒热状态／预加载采样。
联合QA复用原133秒完整音乐、原模型、实际播放器和心象渲染器，新增准备后的真实交接检查。
歌词是明确标识的生成LRC，仅用于驱动原渲染器，不作为真实歌词匹配验收。

## 数值与性能证据

| 验证 | 结果 | 边界 |
|---|---|---|
| `npm run typecheck` | PASS | TypeScript静态检查 |
| `npm run test:unit -- test/unit/mobile/nativeBeat.test.ts test/unit/automix/beatThis.test.ts` | 22通过 | 原密集计算摘要、边界输入、模型分块与峰值检测 |
| iPad模拟器原拍点批次 | 6通过，0失败，0跳过 | 原30秒音乐、原模型、完整／部分profile、取消恢复、PCM释放 |
| dense／optimized原生输入 | 全部chunk字节相等 | 同一30秒PCM及同一vDSP FFT；1501帧、2个chunk |
| 原参考mel／logits／拍点 | 最大绝对差0／0，网格相同 | profile沿用既有1e-6容差，参考输出未重生成 |
| 原模型＋播放＋心象准备 | 1通过，0失败，0跳过 | iPad Pro 11-inch M5 / iOS26.5模拟器 |
| 原模型＋实际分轨交接 | 1通过，0失败，0跳过 | 同模拟器；生产队列／规划器／渲染时钟，无假分轨 |
| 优化版手机计时 | 0通过，0失败，1跳过 | 起始serious；不计作PASS |
| 优化版手机联合／物理iPad | NOT_RUN | 待设备条件允许后单独验收 |

模拟器同次30秒PCM前处理耗时：旧版 **80.26ms**，优化版 **17.53ms**。
这是一次相同输入的观测，不是稳定性能基准，也不代表iPhone速度或温升改善。

固定密集参考来自提交 `3b57ca129247e3cee5c2a848d13f343a912d20e8`，在优化前生成。
`test/unit/mobile/fixtures/mel-dense-reference.json` 保存六种确定性输入的完整chunk摘要。
基线源码SHA256为 `d624df5aa26d2ccdd8c66c30b0eba917165d6f47e975fb76cc3b30691948b418`，
原 `profiles.js` 为 `e808b91deba8211bfae1e9a1281c3fb43d099b65ddcc462fe53b955d8ef69080`。
原生计时用例核验旧脚本摘要后才运行；原模型仍按 `shared/modelManifest.json` 核验。

## 联合准备和实际交接

签名修正后的准备用例，模型阶段 **32.31秒**完成两份profile和头／尾分轨窗口。
当前／下一首分析按序执行，预处理分别86.97／101.63ms，拍点ORT执行分别5.94／5.85秒。
基线／模型／恢复rAF平均调度59.97／59.91／60.00Hz；模型阶段P95间隔17ms、最大39ms。
三阶段100ms状态采样均未观察到停止，tap记录到双声道非零PCM。
模拟器主进程footprint采样峰值2,006,110,456字节，未收到内存警告；不包含WebContent，
不能作为手机内存峰值或资源合格证明。截图附件显示实际心象歌词与背景。

新增交接用例重新用原模型完成准备，然后仅通过正常seek移到原规划器交接点前1.5秒，
不伪造profile、分轨或计划。规划点为out=110.38s、in=0.22s。
交接观察持续 **23.46秒**，231个采样中216个确认实际stem程序已推进渲染时钟，
状态为 `ready-expansion`。没有观察到stem失败、时钟失效或停止播放。
最后index=1、`isFading=false`、只剩1个音频节点；tap记录1,123,200帧双声道PCM，RMS约0.1534。
因此已覆盖原模型准备→真实分轨混音及扩展→队列交接→上一首释放。
复核后将「中途stem失败／时钟失效导致回退」也设为明确失败条件；最终源码重测仍为
1通过／0失败／0跳过，交接观察23.65秒、233个采样，最终仅1个节点且继续播放。

rAF与音频图证据不是GPU呈现帧率、物理输出无爆音或歌词误差测量；这次为两份同一首音乐的
离线QA，不代表跨平台在线、所有曲风或真实账号验收。仍需不同歌曲、手机资源与听感验证。

## 保留的失败与环境修正

- 先前两项静音边界超时，在加入诊断后的真机fair状态下2项通过，原失败未删除。
- 串行版手机联合仍在第一项拍点预处理期间触发热保护，尚无ORT事件；优化未在手机验证。
- 模拟器初次安装25秒超时，后来确认已安装。首个拍点批次因fixtures未准备完整为2通过／4跳过，
  不计入原模型验证；核验并补齐14项素材后上述6项全通过。
- 首次联合用例因 `CODE_SIGNING_ALLOWED=NO` 缺少模拟器Mach-O的 `__TEXT.__entitlements`，
  Keychain初始化拒绝，结果0通过／1失败。恢复已有签名构建参数后重跑通过，
  没有清空Keychain或修改安全存储来绕过。
- ORTQA staging最初误遍历了清单中的Python runtime项，读取不存在的sha256失败；
  修正为精确选择两个模型后核验复制。依赖命令未生成时的runner失败没有启动Xcode测试。

## 证据与回退

本地目录 `.mobile-test-results/profile-preparation/`：

- `diagnostic.xcresult`／`preparation-samples.json`：真机静音边界成功记录。
- `joint-serialized.xcresult`／`joint-serialized-report.json`：串行版真机热保护失败。
- `source-optimized.json`、`source-handover.json`、`reference-verification.json`：输入与固定参考来源。
- `mel-unit.log`、`typecheck.log`、`mel-simulator-staged.xcresult`、`mel-device.xcresult`：数值与跳过记录。
- `joint-signed-simulator-command.json`／`.log`／`.xcresult`、对应report／analysis与attachments：完整准备。
- `joint-handover-simulator-command.json`／`.log`／`.xcresult`、`joint-handover-report.json`：实际混音交接。
- `joint-handover-final-simulator-command.json`／`.log`／`.xcresult`、`joint-handover-final-report.json`：补强无回退断言后的最终重测。
- `build-simulator-signed-command.json`、`build-handover-simulator.log`：可复验的签名构建参数。
- `package-handover-simulator.json`：独立身份、签名、可执行文件／测试插件摘要、123项资源一致性。
- `source-final.json`、`package-final-simulator.json`：最终重测源码、测试插件及签名包摘要。

手机Release构建通过发生在新增交接用例之前；新增用例只在签名模拟器编译、执行。
所有包均为带测试插件的独立QA，不更新个人版本，不开启公开 `stems/full` 能力。
回退mel范围优化及QA／诊断即可恢复上版行为，无凭据、曲库或配置迁移。
