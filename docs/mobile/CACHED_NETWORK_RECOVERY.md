<!-- CACHED_NETWORK_RECOVERY.md — cached QQ/NetEase playback during native network-path changes. -->
# 缓存歌曲断网连续播放

2026-10-14；源码基线 `765674ed597af7571d218b84e92cc2c032a46d55` 加本批改动。
按 [当前范围](CURRENT_SCOPE.md) 只修复 QQ／网易云必要音频缓存的播放问题。

## 问题与最小修复

已从完整缓存播放的在线歌曲收到 `networkChanged(connected: false)` 时，仍被当作需要网络的歌曲停止，
设置 `network` 错误和自动重连位置。重连又以 `refresh: true` 重新选曲，会绕过并移除原有缓存。
原因是旧判断只检查歌曲是否属于本地曲库，没有检查当前解码器已持有的完整缓存文件。

复用 `StreamOccurrence.cachedMedia`：`PlaybackSystem.swift` 的断网判断把当前解码器的缓存租约视为
可离线播放的来源。依据是正在使用的文件，不是缓存开关、歌曲在线标签、临时 URL 或缓存列表是否仍有记录。
未缓存曲目继续沿用断网暂停、联网重新解析路径；原解码失败与缓存损坏处理保留。
未新增依赖、文件格式、下载／本地曲库功能，未改前端、动画、布局、控制器材质或设置默认值。

## 复现与验证

新增 `MediaCacheTests.swift` 中 QQ、网易云各一项测试，共用现有音频样本、HTTP fixture、缓存、原生播放器
和 `OutputMeasurement`。这是合成歌曲身份／音频的真实原生解码测试，不是音乐平台请求。

1. 原代码在 iPhone 模拟器上 **2项 FAIL**，共6条断言：断网后出现 `network`、设置重连位置并停止播放。
2. 仅修改生产断网判断，新增测试源码与 RED 阶段哈希相同。
3. 最终同一11项 XCTest 在 iPhone／iPad 模拟器均 **11 PASS、0失败、0跳过**。未再次重跑。

其中2项新增用例验证：缓存完整时断网继续解码；清空缓存列表后租约仍可读；联网不更换解码器或播放代次；
手动暂停不被网络变化唤醒；清理后仍可拖动并继续。各平台网关解析次数为0，缓存 fixture仅下载1次。
9项既有回归覆盖缓存读取／退出隔离、失效地址只刷新一次、断网恢复、迟到选曲、连续三首失败停止、
播放卡住重试、快速拖动、暂停／中断／平台移除和睡眠到期后不自动续播。

| 结果 | iPhone 17 Pro | iPad Pro 11-inch (M5) |
| --- | --- | --- |
| 系统／构建 | iOS Simulator 26.5（23F77），arm64 Release | 同左 |
| 新增 PCM 检查点 | 4（两平台各2） | 同左 |
| 每检查点最少帧／声道 | 19200／2 | 19200／2 |
| 最小 RMS | 0.1248254977 | 0.1248254977 |
| 450ms检查窗最小位置推进 | 0.4480045351秒 | 0.4480045351秒 |

独立包 `app.folia.validation.App`；前端资源沿用已验证的 `d5e13c8` 构建，版本标签为 `0.7.16-mobile.28`，
本批没有前端变更。128个资源在 dist、Capacitor、Xcode产物和QA包中一致；测试后272个原生源码／项目／
锁文件哈希与受测清单一致。两次原生构建与签名校验通过。QA首页为离线空页，生产首页另存为 `mobile.html`。

证据目录 `.mobile-test-results/cached-network-recovery/` 保存 RED／GREEN 的独立包、命令、源码哈希、
构建／测试日志、xcresult、两端摘要和PCM附件；汇总为 `metrics.json`，最终交付核对为 `delivery.json`。
原生执行命令为 `codex-bounded 600 -- python3 .mobile-test-results/native-core-integration/run.py <阶段>/<设备>-command.json`，
参数文件选定上述11项（RED为2项），使用 `xcodebuild test-without-building`。
初次QA整理脚本在产物、命令与哈希文件已写完后，最后一行摘要打印因旧字段名退出；核验已生成文件后继续RED，
修正打印字段用于GREEN，没有重新打包或重跑RED。此工具错误与上述产品复现分别记录。

## 验收边界与回退

- **PASS（原生模拟器）**：以上11项及实际PCM；网络变化直接调用系统回调的处理方法。
- **NOT_RUN**：真实无线网络／蜂窝切换、真实账号与CDN、物理设备、WebView挂起期间的后台跨曲、
  网易云30分钟锁屏、耳机／蓝牙、歌词误差≤150ms、长期动画／内存／温升。
- 本批未运行新的WebKit或视觉矩阵；不改写旧动效生命周期测试失败记录。
- 个人 mobile.28 与服务器未更新；根README、依赖锁文件和个人构建记录保持不变。

回退 `PlaybackSystem.swift` 的本批判断即可，无持久化数据迁移。后续仍按两平台核心、原版特效动画、设置UI推进。
