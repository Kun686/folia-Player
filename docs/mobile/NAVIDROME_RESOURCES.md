# Navidrome 封面与歌词移植

本批把已接入的原生 Navidrome 队列连接到封面、歌词和原有歌词工具，不新增依赖。
该阶段个人 App 保持 mobile.28；后续移动设置与曲库浏览入口见 [NAVIDROME_LIBRARY.md](NAVIDROME_LIBRARY.md)，完整移植尚未完成。

## 实现

- 封面由原生凭据请求 `getSong`，取得 `coverArt` 后签名访问 `getCoverArt`。WebView 只获得缓存图片；锁屏复用同一缓存。
  签名地址保留在原生内存，拒绝全部重定向；请求不携带音乐网关认证头或平台 Cookie。
- 提取原 `appNavidromeLyrics` 的获取与选择流程，以及 `NavidromeLyricAdapter` 的解析流程。
  桌面端继续使用原 Worker 和元数据入口，原生 JavaScriptCore 调用同一解析核心。
  原有逐字、翻译、发音、普通 LRC 优先级和结构化歌词回退规则不变。
- 原生播放器独立加载当前／下一首歌词；Swift 负责会话、网络和取消，JS 只返回最多两次读取要求与解析结果。
  不依赖 WebView、音乐网关或浏览器 Worker。
- 复用原有歌词缓存与用户选择：支持导入、手动匹配、恢复来源、FIA/LRC 导出和批量导出。
  刷新服务端歌词不会覆盖导入的歌词。网络或认证错误保留为失败，只有明确缺失的可选端点回退到普通歌词。
- 所有缓存命中、异步解析和持久化都校验 Navidrome scope／revision；账号变更或停用撤销请求并清理资源。
  批量导出另绑定当前 scope，并拒绝没有身份或属于旧账号的 Navidrome 记录，覆盖“凭据已保存、清理前崩溃”的恢复情形。

## 验证范围

证据目录：`.mobile-test-results/navidrome-resources/`。

| 层级 | 结果 | 范围 |
| --- | --- | --- |
| 相关逻辑回归 | 140 文件／1,451 PASS | mobile、playback、Navidrome、library/core、结构化歌词 |
| 触摸界面 | 9 PASS | WebKit 手机、宽 iPad、窄 iPad；原有在线／本地与新增 Navidrome 歌词导入导出 |
| TypeScript、移动资源构建 | PASS | 原生歌词包 311,072 字节；无浏览器环境依赖 |
| 原生首轮 | 5 PASS／1 FAIL | 回退用例的空响应被音频 URLProtocol 样本拒绝；已改成有效 HTTP 错误体，保留首轮证据 |
| 原生扩大回归 | 87 PASS／0 skip | 8 项新增资源、51 项既有 Navidrome／播放／传输、28 项既有封面／歌词回归 |
| Release 原生构建 | PASS | iPad Pro 11-inch (M5)、iOS 26.5，独立 QA |
| 真实 Navidrome／物理设备／系统挂起／长时间性能 | NOT_RUN | 不以受控响应、模拟器或无 WebView 调用替代真实服务与真机验收 |

首次独立 JavaScriptCore 探测发现共享入口间接导入浏览器模块，报 `process` 不存在。
修复方式是使用已有纯函数入口并注入解析执行环境，没有添加 `process`／Worker 假实现或修改原解析规则。
结构化歌词单测首轮有一项不完整的 cue 样本，补齐原格式要求的 `line` 和 `index` 后通过。
首轮 Swift 构建缺少主线程隔离声明，已按现有会话的 MainActor 约束修复；失败日志均保留。

扩大回归首轮为 82 通过／5 失败，共 9 条失败断言（不是 9 个失败测试）。逐项修复：
1. 两项 Navidrome 播放失败测试在封面接入后多计算了一次 getSong；仅在这两项播放重试用例中关闭封面读取，
   保留原“认证停止／三首失败停止”的精确播放请求断言，新增独立用例另验证真实封面接线。
2. 新增认证响应样本缺少必填 version，按既有 Subsonic 契约补齐；不放宽生产响应校验。
3. 两项原有本地歌词用例把 revision 通知次数写死，但基线早已先发布本地结果、再发布最终结果。
   改为等待实际状态通知／单调修订，保留取消、旧结果丢弃和真实 Automix 接续结果的断言。
4. 最终完整同组重测为 87 通过／0 失败。Automix 样本实际从原 20 秒切换点推迟到歌词结束后的约 26.21 秒，
   已开始的双轨交接保持原计划。

最终结果包为 native-repaired.xcresult，命令列表保存在 native-repaired-command.json。
逻辑命令：npm run test:unit -- test/unit/mobile test/unit/playback test/unit/navidrome test/unit/library/core test/unit/lyrics/navidromeStructuredLyrics.test.ts。
界面命令：npm run test:mobile:ui -- test/mobile-ui/navidrome-lyrics.spec.ts test/mobile-ui/lyricExport.spec.ts。

## 交付与回退

独立 QA Bundle ID 为 `app.folia.validation.App`，仅操作模拟器，不操作真实账户、物理设备或服务器。
个人 `BUILD_RECORD.json` SHA256 保持 `ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。

本批代码和打包 JS 应一起回退。已有 QQ、网易云、酷狗缓存键及文件格式不变；新增资源位于独立 Navidrome 子目录。
下一步继续原版 Navidrome 设置与浏览业务的移动接线；真机恢复后仍需完成完整 Automix 的资源、热保护和后台验收。
