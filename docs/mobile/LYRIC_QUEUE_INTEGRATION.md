# 原生队列歌词匹配与共享选择

2026-10-13；源码基线 76145952c8547d994a1c34dc7e34ab2abae2486e。
继续不依赖物理设备的移植工作：接入上一阶段的原版匹配宿主，没有新增生产依赖或界面布局。
个人 App mobile.28、服务器、真实平台账户和保护的 BUILD_RECORD.json 未改动。

## 行为与复用

- NativeCrossfade.updateLyrics 从真实队列选取当前／下一首，在播放状态发布及规划时调度；
  网易云／QQ 不再依赖淡入淡出开关、双曲队列或下一首音频已经准备好。单曲循环只加载当前曲目。
  音频启动完全不等待歌词任务；歌词变化仍遵守已开始的音频交接时序。
- nativeOnlineLyricJob 使用已有 provider ports 获取完整原始基线（包括网易云纯音乐、副歌等信息），
  先向 Swift 推送可用歌词，再运行原版 createAutoMatchBestLyric。同来源匹配保留基线，
  跨来源匹配和纯音乐答案使用从原播放器提取的 automaticOnlineLyricSelection；
  Web／Electron 也使用同一转换，匹配评分、模型和解析规则未修改。
- NativeBestLyrics.load 和现有缓存读写结合；原生任务拥有自己的 JavaScriptCore VM、计时和网络，
  不借助前台 JS。最新手动选择始终优先；已有导入／override 可直接离线恢复。
  取消尚未完成的任务时也丢弃其不完整内存结果，恢复播放后可以继续加载。
- 原有自动最佳歌词、来源优先级、本地／在线歌词优先级同步到原生设置。旧记录缺失新字段是迁移标记，
  首次用已有前台选择补齐，而非用新默认值覆盖用户选择；支持加载期间编辑、串行保存、失败回退。
  复用原 store、设置控件、命令入口，不增加设置分区。
- 缓存文件增加可选 selectionVersion。每次选择写入都换版本，包括先导入再恢复原始选择；
  自动写入必须同时匹配 provider token、选择版本、全部平台会话，并拒绝覆盖已有导入或 override。
  校验解析结束后重新验证，在缓存 actor 内同步合并／写盘；晚到的基线仅更新基线字段。
  前台自动写入携带不含凭据的会话版本回执；任何平台退出／换号都会撤销旧歌词快照。
- 原生保存新匹配后发出歌词事件；前台仅刷新对应歌曲，回到前台时再从共享缓存恢复。
  被原生拒绝的自动写入会撤销前台旧快照，防止随后重画旧歌词。用户明确导入／选择仍用原写入路径。

## 验证

全部平台响应为受控样本，不构成平台账户或锁屏验收。

| 检查 | 结果／范围 |
|---|---|
| TypeScript | PASS，最终 typecheck-final.log |
| 逻辑测试 | 70 文件、664 PASS；后续会话保护补测 2 文件、37 PASS，包含新增 3 项 |
| WebKit 原回归 | 30 PASS；phone／ipad／ipad-narrow，歌词设置、AMLL、迟到响应及已保存选择 |
| WebKit 新场景 | 3 PASS；原生缓存事件刷新、隐藏期间保留、返回后离线恢复 |
| Release 模拟器构建 | PASS；独立 app.folia.validation.App，既有 Swift 并发警告仍在 |
| 原生 XCTest | 24 PASS，0 FAIL／SKIP；iPad M5 iOS 26.5 独立 QA，native-final.xcresult |
| Mac 裸 JavaScriptCore | 8 PASS；四来源、并发、真实期限、取消及资源释放 |
| 真实平台／物理设备／系统挂起／温升及内存 | NOT_RUN；本批未启动真机验收 |

首轮原生 XCTest 共 24 项，2 个用例失败（3 条失败断言）。缓存测试直接比较未规范化输入，
漏算原版解析器自动补充的 renderHints；改为比较拒绝写入前后完整的规范化快照。
队列测试切到队尾后又直接要求两个曲目同时在当前／下一首集合里；引擎正确清除了上一首，
改为先将真实队列索引切回第一首再验证。生产代码不为这些断言改规则，原始失败结果保留。修正后完整重跑上述 24 项，全部通过。

测试宿主的 index.html 被替换为空白离线页，保证 iOS 原生匹配与缓存不依赖前台脚本。
新原生用例验证基线先于搜索、跨来源结果持久化、手动导入／纯音乐／恢复选择 ABA、
自动结果不能覆盖已有匹配、清理撤销、解析后会话复核，以及关闭淡入淡出的单曲／队列调度。
这仍不能证明 WKWebView 被系统挂起后的真机表现，或实际服务的可用性。

## 复现与证据

本地证据目录 .mobile-test-results/lyric-queue/，不提交临时 App、日志或账户数据。

    npm run typecheck
    npm run test:unit -- test/unit/mobile test/unit/onlinePlayback.test.ts test/unit/lyrics/autoMatchBestLyric.test.ts test/unit/lyrics/onlineLyricsState.test.ts
    npm run test:mobile:ui -- online-lyric-preference.spec.ts amll-match.spec.ts

原生使用现有 transition-validation.xcconfig 构建 Release／ENABLE_TESTABILITY 独立 QA，
lyrics-final.xctestrun 指向复制后重新签名的离线宿主。选择 LyricMatchTransportTests、
GatewaySettingsTests 及三个队列／缓存用例，每个测试 45 秒上限；完整命令和版本记录随本地证据保存。

## 边界与回退

这一批完成网易云／QQ 队列歌词自动匹配接线。尚未在个人安装包中交付或验证；
完整移植目标仍未完成。下一阶段需继续核对真实播放与 Automix 联合运行、系统挂起后的原生请求、
取消时序、物理 iPhone／iPad 的资源与歌词显示误差，不能用本批样本测试代替。

回退本批源码并重新生成原生 JS 资源即可；旧版本忽略新增的可选设置和缓存版本字段，
已有歌词／导入／选择保留。无服务器变更、新模型或新依赖需要撤回。
受保护构建记录 SHA256：
ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73。

清理已核对：测试前后目标模拟器均为 Shutdown，4179 端口关闭，测试进程已退出。
