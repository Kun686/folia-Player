# 歌词更新与已锁定 Automix 交接

2026-10-13；源码基线 63feaa866b44e0abb757ffc07b0a6261f94e76a4。
继续不依赖真机的工作；个人 App mobile.28、服务器、账户、界面、原算法及模型均未改动。

## 问题与修复

前台保存在线歌词基线／自动匹配结果后，原桥接统一当成手动选择通知 NativeCrossfade。
通知会撤销已进入一秒准备期的计划，还可能丢弃静音预播放中的下一首。
真实解码的 30 秒音频复现：原计划在 26 秒交接，自动基线更新后清空计划，实际拖到 29.055 秒。
同一用例还复现手动选择失效：缓存异步重读期间没有歌词，回退计划可能先锁定，新选择来不及生效。

复用现有缓存、队列、原版规划器和音频图；无新增依赖或自研音乐算法。

- FoliaNativeLyricsPlugin 将基线写入和经过选择版本校验的自动结果标记为 automatic；手动 state 写入保持明确选择。
- NativeCrossfade 的自动刷新与原生匹配回调遵守相同锁定规则；准备期保留计划及静音预播放中的同一音频对象。
  准备期之前可重新规划，已经发声的交接保持原日程。
- NativeLyrics 在明确选择后标记待重读。Automix 等选定缓存结果可用后再规划，避免空窗的回退计划抢先锁定。
  普通播放、普通 crossfade 和可选匹配不受阻；缓存失败、暂停取消、队列移除会释放等待状态。
  自动刷新不会撤销尚未读取完成的手动选择标记。

## 验证

Release 独立 app.folia.validation.App；iPad Pro 11-inch M5、iOS 26.5／23F77 模拟器。
复制宿主并替换为空白离线页后重新签名，测试不调用前台脚本驱动引擎。

| 检查 | 结果 | 本地证据 |
|---|---|---|
| 修复前复现 | FAIL：1 用例、7 条失败，包括手动选择等待超时 | before.xcresult、before-summary.json |
| 修复后缓存／队列回归 | 18 PASS，0 FAIL／SKIP | fixed.xcresult、fixed-summary.json |
| 原版模型与音乐联合验证 | 1 PASS，0 FAIL／SKIP，45.921 秒 | model.xcresult、model-summary.json、online-automix.json |
| Release build-for-testing | PASS | build-fixed.log、build-model.log |
| 固定音频 vendor | PASS：59 文件、4 处既有补丁 | verify-audio-vendor.py |
| 真实平台、物理设备、系统挂起、温升／总内存、歌词显示精度 | NOT_RUN | 不以本批模拟器结果代替 |

共 19 个不同原生用例，不累加失败重跑或同一用例的两次交接。
18 项包括基线／自动选择保持计划、手动选择重新规划、发声期间刷新、共享缓存、迟到写入保护、
退出与清理、暂停／恢复、拖动／跳歌、队列编辑、单曲循环及禁用 crossfade。

原模型用例使用已批准且摘要核对一致的 Beat This!／HTDemucs 和两首不同音乐样本。
传输为 URLProtocol 受控响应，音频实际解码、分析、分轨并经生产音频图输出。
受控在线和完整缓存离线各一次，在第 123.013 秒、下一首正以零增益播放时发送自动更新通知；
两次都保留原 123.98 秒计划、同一预播放对象与增益调度版本，并完成真实分轨交接。
分别采集 446,400／451,200 帧，RMS 约 0.12831／0.12774，无采样到停止、分轨失败或时钟失效。
地址解析仍为两次，离线重播无新增解析／网络请求；结束后只有当前音频节点，退出 QQ 保留网易云缓存。
样本和模型复用来源见 [ONLINE_AUTOMIX.md](ONLINE_AUTOMIX.md)，未下载或提交素材。

## 复现、边界与回退

证据目录 .mobile-test-results/lyric-handover/；完整测试参数见 fixed-command.json、model-command.json。
复用 transition-validation.xcconfig，build-for-testing 使用 Release、ENABLE_TESTABILITY=YES、
固定依赖解析和独立 Bundle ID。固定回归每项 45 秒上限；原模型单项 360 秒上限。
QA Documents/ORTQA 复用原有四个已核验文件，缺素材导致 SKIP 不视为通过。

本批只验证原生通知和真实音频生命周期，未端到端调用 WKWebView 的保存按钮；
受控 HTTPS 形式 URL 不证明实际平台／CDN／TLS，空白页不证明系统挂起，RMS 不代替人工听感。
保留既有 Swift 并发编译警告。公开 stems/full 能力继续关闭，整体移植尚未验收完成。

撤回本批 Swift 与测试改动即可回退，无数据格式、依赖、模型或服务迁移；回退会恢复上述时序问题。
测试进程退出，模拟器恢复 Shutdown。受保护 BUILD_RECORD.json SHA256 未变：
ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73。
