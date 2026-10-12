# 分轨素材的压缩音频解码与原版对照

2026-10-12。**PASS（生成编码样本、原版 WebKit 对照、原生模拟器自动测试）**。
接续 [完整媒体读取](STEM_MEDIA.md)，修复 48 kHz 压缩歌曲在分轨素材尾端与原版不同的问题。
完整 Automix 仍未接入模型和用户队列；个人 mobile.28、账户及服务器没有更新。
ORT 工程接入仍为 [PENDING_APPROVAL](AUTOMIX_INTEGRATION_DECISION.md)。

## 发现与修复

原版 `cutWindow` 在一次 `decodeAudioData` 中完成解码与重采样，再截取首尾 30 秒。
此前原生路径先用 AVAudioFile 得到已去除编码延迟／填充的 PCM，再单独重采样，
且将转换质量设为最高档。WAV 的独立正弦检查通过，不能证明它与原 WebKit 的边界相同。

本次直接导出并调用原 `cutWindow`，只增加 `export`，不改原函数行为；同一组编码字节交给两端。
首次原生对照为 **51 PASS / 1 失败**：总帧数相等，但 AAC 48 kHz 尾端最大采样差
`0.027762204`，FLAC 48 kHz 尾端 `0.0045594275`，超过事先设置的 `1e-5`。
44.1 kHz AAC／ALAC 的完整声道摘要相同。

排查使用 Apple SDK 说明和固定 WebKit 源码 `9c50e091cb1b47fddb7afa7ffec7f9f22c0ee38b` 的
`AudioFileReaderCocoa.mm`，确认原路径直接向 AudioConverter 提供编码数据、初始／尾端 trim 信息，
未将重采样质量改为最高档。仅查阅接口和参数，没有新增移植的 WebKit 源文件。

- FLAC 独立诊断中，默认质量 64 的采样与原参考相同；最高档会改变脉冲及文件边缘。
- 直接改用 AVAssetReaderTrackOutput 的解码输出也不等价：AAC／FLAC 的初始位置和总帧数发生变化。
  该方案只运行于临时诊断程序，没有接入 App。
- `NativeStemFileDecoder` 改用已有系统 AudioToolbox，向同一个 AudioConverter 分块提供原编码包，
  读取文件的 magic cookie、声道布局和 priming／remainder 信息，保留默认重采样质量。
  不自行计算编码延迟、不更改音频、不引入新的解码库。
- 已是模型 44,100 Hz 的文件继续复用既有 AVAudioFile 路径，不增加额外转换。
  既有曲目分析仍使用 `NativeAudioFileDecoder` 和原最高质量设置；这次只修分轨素材路径。
- 输出按原源时长四舍五入到模型采样率，过滤掉编码填充；不足完整有效帧时明确失败。
  首尾窗口、单声道复制、前两声道选择、完整文件摘要与快照租约保持原接口。
- 编码包工作区至多 1 MiB，输出复用 4096 帧；cookie／布局也有大小限制。
  固定大小的包不向转换器暴露未填写的可变包描述符。
  逐块检查取消／60 秒协作期限；文件、转换器和工作区通过作用域释放，渲染回调不执行此解码。

这是标准库接口适配。没有新增 npm／SPM／运行库，不使用 Python 解码或替代原模型。

## 样本与结果

样本由 `dev/mobile/stem-codec-inputs.py` 使用标准库生成 PCM，再用已有 macOS `afconvert` 编码。
内容为每秒 50ms 的 440／997Hz 渐弱脉冲，尾部有不完整脉冲；不含用户歌曲或外部音乐资产。
WebKit 对照由 `test/mobile-ui/stem-codec-reference.spec.ts` 直接调用原函数生成。
`StemCodecReference.json` 含固定编码字节、源摘要、首尾帧位置、边界／全程抽样和完整声道摘要，
共 **1,402,951 字节**，只加入 XCTest Bundle，不进入生产资源。

| 样本 | 原输入 | 原版／原生有效输出帧 | 首尾窗口结果 |
|---|---|---|---|
| AAC 48 kHz | 双声道，32 秒 + 137 帧 | 1,411,326 | head 起点 0，tail 起点 88,326；各 1,323,000 帧 |
| AAC 44.1 kHz | 单声道，3 秒 + 137 帧 | 132,437 | 短曲完整保留；左右复制 |
| ALAC 44.1 kHz | 双声道，32 秒 + 137 帧 | 1,411,337 | head 起点 0，tail 起点 88,337；各 1,323,000 帧 |
| FLAC 48 kHz | 双声道，32 秒 + 137 帧 | 1,411,326 | head 起点 0，tail 起点 88,326；各 1,323,000 帧 |

最终模拟器实测 **16 个完整 Float32 声道 SHA256 全部一致**，覆盖 16,405,748 个采样；
边界及全程抽样最大差为 0。数值门槛保持 `1e-5`，44.1 kHz 的精确摘要断言也没有放宽。
Mac 诊断程序曾测到 AAC 约 `1.8e-7` 的误差，不能用最终模拟器结果宣称所有宿主逐字节相同。

证据目录：`.mobile-test-results/stem-codec/`。

| 检查 | 结果与范围 |
|---|---|
| 原版参考生成 | `reference.log`：WebKit 1 项 PASS；直接使用原 cutWindow，包含实际压缩文件解码 |
| 逻辑回归 | `unit.log`：4 文件／22 项 PASS；原媒体读取请求、无完整字节等待、迟到结果和缓存驱逐规则 |
| 原生最终回归 | `native-reviewed.xcresult`、`native-summary.json`：**53 PASS / 0 失败 / 0 跳过**，包括压缩对照、中途取消／超时／错误后恢复及 51 项既有回归 |
| WAV／重采样回归 | 原 15,894,152 个 WAV 采样仍逐值相同；22.05／48／96 kHz 正弦重采样最大差 `2.415941190558879e-5`，保持原 0.001 门槛。原版默认滤波器不等于理想解析正弦，故不以此前最高档较小误差替换行为依据 |
| 环境 | iPad Pro 11-inch (M5) / iOS26.5 **模拟器**；Release、ENABLE_TESTABILITY=YES、独立 `app.folia.validation.App`，最低 iOS17 |
| 构建／资源 | TypeScript、plist／diff、模拟器签名及参考资源核对；6 个 JS 资源与已有产物一致，见 `package.json`。本批仅将原函数导出供测试，不修改已打包原生 JS 行为 |
| 个人 App／真实平台 | **NOT_RUN**；没有操作真实账号、更新个人安装包或测试实际 QQ／网易云歌曲 |

初次 `native.xcresult`／`native-first-summary.json` 保留 51/1 失败及四项数值断言；
修正后只重试一次，`native-final.xcresult` 为 52 项通过。
随后审查明确固定包的 nil 描述符并新增中途取消回归，再运行 53 项，保存为 `native-reviewed.xcresult`。
`diagnosis.json`、`quality-probe.json`、`asset-reader-probe.json`、`packet-reader-probe.json` 保留定位证据。
初次上游源文件扩展名查询错误和 Python 信任库错误也有记录；系统 curl 正常验证 TLS 后取得源码。

## 复跑与边界

```sh
"$HOME/.local/bin/codex-bounded" 60 -- python3 dev/mobile/stem-codec-inputs.py NEW-input-directory
"$HOME/.local/bin/codex-bounded" 120 -- env FOLIA_STEM_CODEC_REFERENCE=1 \
  FOLIA_STEM_CODEC_INPUTS=NEW-input-directory npm run test:mobile:ui -- \
  test/mobile-ui/stem-codec-reference.spec.ts --project=phone
```

参考生成需显式开启，并人工审阅编码器／WebKit 变化；正常原生测试只读取已提交参考。
53 项原生选择及完整参数见 `tests.json`、`command-reviewed.json`；重跑使用新的 resultBundlePath，
用 600 秒外部上限包裹，并在日志 55 秒无变化时终止进程组。
提交及远端检查在 `source.json`／`ci.json`，清理在 `cleanup.json`。

MP3、HE-AAC、更多采样率及声道布局、损坏压缩文件矩阵、真实音乐／实体设备仍 **NOT_RUN**。
现有机器没有 MP3 编码工具，本批没有为补样本安装依赖。
原分轨模型调用、队列接入、实际音乐听感、推理／播放／动画联合负载与长期性能仍待完成。
回退撤销新包读取器和 `NativeStemMedia` 调用，恢复先解码 PCM 后重采样；无持久数据迁移。
该回退会恢复本次已记录的 48 kHz 首尾差异，不应作为精确对齐的已验收路径。
