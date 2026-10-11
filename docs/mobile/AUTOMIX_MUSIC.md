# Automix 真实人声音乐片段独立对照

2026-10-11。**PASS_REAL_MUSIC_FIXTURE_NUMERICS**，不等于完整 Automix、分轨听感或在线平台验收。
在 [30 秒合成窗口](AUTOMIX_WINDOW.md) 后，补测有明显人声、结尾伴奏与衰减的真实音乐窗口。
仍属于已批准的独立 ORT 1.30.0 验证；没有接入生产依赖、更新个人 App 或改变模型。

## 样本与复现身份

- Karissa Hobbs — *Let's Go Fishin'*，librosa 官方例子库 `fishin` 高质量文件。
  [来源](https://librosa.org/data/audio/Karissa_Hobbs_-_Lets_Go_Fishin.hq.ogg)、
  [官方摘要登记](https://github.com/librosa/librosa/blob/main/librosa/util/example_data/registry.txt)。
- 原文件 1,936,632 字节，SHA256
  `85901bde0bc5f2cad28acb83487ccf99bd6908d7359f1a449fd799d8bebb3319`，与官方登记相等。
- 官方 TXT 标为 CC-BY-3.0，TOML 标为 CC-BY-NC-SA-4.0，两份元数据及其登记摘要均已保存。
  本次按较严格的后者限制，仅用于本机非商业验证；不提交／分发音频，不将其打入个人 App。
- 系统 `afconvert` 解码成 44.1kHz／双声道 float32；新增 `dev/mobile/automix-music-input.swift`
  用 AVFoundation 提取末尾 30 秒，不引入解码或分析依赖。共 5,864,768 帧，从第 4,541,768 帧
  （102.98793650793651 秒）截取 1,323,000 帧，按原契约保存平面左右声道。
- 输入 10,584,000 字节，SHA256 `33ab08343bbe235478aba3835c5313083cfedf2caca038b67333bb867eb523aa`，
  peak 0.93745047、RMS 0.14891887；所有宿主使用同一输入，手机 Bundle 内输入哈希再次核对。

复用原 Node 推理、Python 拼接函数回放、C++ 窗口探针及原存储／人声退出对照，没有重写模型或音乐规则。
固定模型与运行库摘要见 [ORT 记录](AUTOMIX_RUNTIME_130.md)。Python 仍只执行原拼接函数，不是 Python ORT 实跑。

## 输出与资源

Mac 官方 Apple 运行库输出与参考拼接 **逐字节相等**，包括相减得到的 other 与原 16 位存储结果。
iPhone XS Max／iOS18.7.10 独立 Release QA，CPU 2 线程，关闭 CPU arena 与 memory pattern，11 段全部完成。

| 轨道 | iPhone maxAbs | relativeL2 | 16 位 PCM 最大差 | 原浮点诊断 |
|---|---|---|---|---|
| drums | 7.7486038e-7 | 7.9753331e-7 | 1 单位 | PASS |
| bass | 6.0722232e-7 | 6.6050503e-7 | 1 单位 | PASS |
| other（原相减） | 1.0132790e-6 | 8.4565958e-7 | 1 单位 | PASS |
| vocals | 8.3446503e-7 | 6.2858273e-7 | 1 单位 | PASS |

保持 `maxAbs ≤ 1e-5`、`relativeL2 ≤ 1e-4`；全部输出有限，四轨 gain 均为 1。
vocals 参考 RMS 为 0.07535434，本样本没有重现近静音相对误差超限；此前合成样本的失败仍保留。
每轨 2,646,000 个 PCM 样本中，分别有 3110／1714／4471／2641 个量化值不同。
原函数的 `lastVocalMoment` 两边均为 **23.650000000000002 秒**，即同一个人声退出点。
量化后四轨合成相对输入的最大误差为参考 5.9610233e-5／手机 5.9732236e-5，
两者合成结果最大差 6.1043538e-5。没有进行盲听，不能据此声称听感相等。

| 资源 | Mac | iPhone |
|---|---|---|
| 窗口推理、拼接、写出 | 6.121 秒 | **41.394 秒** |
| 启动至保存 | 6.310 秒 | 42.241 秒 |
| 峰值 physical footprint | 1,303,594,592 字节 | **1,157,876,008 字节，约 1.08 GiB** |
| 释放后 footprint | 本轮未单独测量 | 14,042,712 字节 |
| 内存警告 | 不适用 | 0 次 |

同机真实音乐本次比合成窗口的 33.084 秒慢；没有控制温度、系统负载或重复统计，不能把差异归因为音频内容。
二者都慢于实时；接入预算应使用已观察到的约 41.4 秒／窗口，仍需播放、动画、热状态联合实测。

## 运行与证据

本机证据根目录：`.mobile-test-results/automix-probe/music/`。源文件、解码文件、分轨结果全部忽略，不提交。
主要记录：`source.json`、`license.txt`、`license.toml`、`input.f32.json`、`node/report.json`、
`original/report.json`、`mac.log`、`mac-comparison.json`、`ios/result.json`、`ios/probe.log`、
`ios-comparison.json`、`ios-source.json`、`ios-build.log`、`ios-install.json`、`ios-uninstall.json`、
`personal-return.json`、`personal-app-final.json`、`extraction-guards.json`。

样本准备使用系统工具；下载后先核验上面的官方文件 SHA256：

```sh
"$HOME/.local/bin/codex-bounded" 60 -- afconvert -f WAVE -d LEF32@44100 -c 2 .mobile-test-results/automix-probe/music/fishin.hq.ogg .mobile-test-results/automix-probe/music/decoded.wav
"$HOME/.local/bin/codex-bounded" 60 -- xcrun swiftc -O dev/mobile/automix-music-input.swift -o .mobile-test-results/automix-probe/music/extract-input
"$HOME/.local/bin/codex-bounded" 60 -- .mobile-test-results/automix-probe/music/extract-input .mobile-test-results/automix-probe/music/decoded.wav tail .mobile-test-results/automix-probe/music/input.f32
```

提取工具拒绝已有输出、NaN、负数及超出文件的时间，不覆盖原样本；本轮四项检查通过。
推理／参考／比较的参数契约沿用 [窗口记录](AUTOMIX_WINDOW.md)，结果目录必须使用新路径。
工具链或系统解码器变化可能改变原始 PCM，此时应记录新哈希并对所有宿主使用同一份输入。

初次音频下载连接超时；改为 IPv4 HTTPS 后只重试一次成功，TLS 校验保持开启。
官方样本元数据许可存在差异，未据 TXT 单方面将样本作为可随产品分发的素材。
个人 App 缓存目录列表没有 FoliaMedia，未取得个人完整音乐缓存，也没有读取账户凭据来下载歌曲。

独立 QA 的签名、Bundle ID、两个原模型和输入／源码哈希核对通过；测试后卸载 QA，
原位保留个人 `app.folia.personal`，恢复前台并回读 **0.7.16／build20**。
独立工程的输入资源配置已恢复，测试时配置另行归档。没有任务推理／构建／设备命令遗留。

**仍未验证**：真实分轨交接听感、实际手势输出、播放／动画争用、背景调度、温升／长时内存、物理 iPad。
本样本数值通过不覆盖所有曲风、增益超限或近静音边界，也不消除此前失败。
正式工程接入仍按 [接入评估](AUTOMIX_INTEGRATION_DECISION.md) 等待批准，完整移植保持 IN_PROGRESS。
