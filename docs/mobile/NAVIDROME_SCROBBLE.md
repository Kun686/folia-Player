<!-- NAVIDROME_SCROBBLE.md — original playback reporting in the native mobile owner. -->
# Navidrome 原生播放上报

本批补齐原版 Navidrome 的 now-playing 与 scrobble，不依赖 WebView、音乐网关或数据同步服务。
复用 `NavidromeScrobbleSessionTracker`、现有 `FoliaListening` JavaScriptCore 资源、Keychain 与有界原生传输；没有新增生产依赖。
个人 mobile.28、现有界面、动画、音效算法和网易云上报设置保持不变。本批未操作真实账户、服务器或物理设备。

## 原版语义与原生接入

- 原 `useNavidromeScrobbleReporter` 在开始播放时报告 now-playing，每次会话各报告一次。
  原 `getNavidromeScrobbleThresholdSeconds` 使用 `min(60 秒, 歌曲时长 / 2)`，未知时长回退 60 秒。
  **这是播放位置阈值，不是累计有效听歌时长。拖动到阈值之后继续播放会触发上报，保留原版行为。**
- 原追踪器继续生成事件，Swift 只适配真实播放器状态、账号身份和请求生命周期；阈值未复制为 Swift 常量。
  使用歌曲元数据时长，缺失时使用原生解码时长。暂停、缓冲和恢复的暂停队列不发 now-playing；恢复同一会话不重复发送。
- 原生 `publish` 采样实际播放状态。手动切歌、同曲循环、预加载接续与 Automix 主歌曲交接重置会话；自然结束补齐最后位置样本。
  手动跳过不会伪造“播到末尾”。暂停／网络重解析保留该会话的去重状态。
- 只有显式 Navidrome scope／mediaId 可以上报，不接纳其他音源或旧账号歌曲。凭据变更取消正在进行的请求、清空待发送项；
  被拒绝的旧队列身份不会阻止新账号的有效歌曲。旧请求完成不能释放或覆盖新请求状态。
- 原生专用 `scrobble` 请求沿用 `/rest/scrobble`、GET、Unix 毫秒时间和 `submission` 布尔参数。
  WebView 的只读及歌单编辑入口均不能调用此路由。使用现有签名和 HTTPS／重定向保护，不转发网关认证和 Cookie，不记录凭据或签名 URL。
- 上报使用独立槽位，按事件顺序发送，不挤占播放解析或歌单编辑。最多保留 8 项（含在途请求），超限丢弃并记录安全错误码；
  已切歌的待发 now-playing 会被丢弃，已达到阈值的 submission 保持原歌曲身份；新连接等待已取消请求释放槽位后才发送。
  单请求最多 30 秒、响应最多 8 MiB，并使用系统有限后台任务。网络失败、回复不明和恢复联网不会自动重试已发事件。
  认证失效停止该连接的上报，等待配置更新；上报失败本身不暂停音乐。
- 不增加离线上报队列，不在重启时补发历史事件。原版追踪器与共享桌面实现保持不变。

## 验证

证据目录 `.mobile-test-results/navidrome-scrobble/`；`delivery.json` 记录最终源码、打包资源、二进制、CI 与范围。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| TypeScript | PASS | `typecheck.log` |
| 逻辑 | 86 文件／797 PASS | `logical-delivery.log`；移动端、原 Navidrome、网易云听歌统计与 hook 回归 |
| 移动资源 | PASS | `mobile-build.log`；`listening.js` 从 4,383 增至 5,577 字节（未压缩，增加 1,194 字节） |
| 原生 Release 测试构建 | PASS | `native-build-repaired.log`；独立 `app.folia.validation.App` |
| 原生 iPad 模拟器 | 60 PASS／0 skip | `native-repaired.xcresult`、`native-repaired-summary.json`；上报、原生队列、歌词、封面、桥接与交接测试 |
| WebKit 布局 | 本批 NOT_RUN | 未改动网页布局或控件；相关界面证据见前一批记录 |
| 真实 Navidrome 记录／真实账户／物理设备／系统挂起 | NOT_RUN | 原生测试使用受控 URLSession 响应，不能替代真实服务器或设备验收 |

新增用例检查原 tracker 输出一致性、拖动／暂停／循环／EOF、签名和路由隔离、账号切换、认证失败、拒绝重定向、队列上限和独立槽位。
三曲实际原生解码测试使用每曲 1.6 秒固定音频，观察 now-playing/submission 请求；同轮保留网易云实际解码计时回归。
模拟器短音频输出不能证明真机长时后台、温升或 Automix 长期稳定性。

保留失败证据：首轮 `native.xcresult` 为 59 PASS／1 FAIL。账号切换测试发现取消旧请求不代表单请求槽位已释放，
立即发起新账号上报可能被拒绝；修复为等待被取消任务完成清理，旧任务仍不能覆盖新状态，也不重试旧事件。
相同 60 条选择器复测全部通过，失败用例从超时恢复为通过；未修改阈值或放宽断言。
构建中已有的 Swift Sendable／无异步 await 警告与无效 PNG 测试样本日志仍保留；本批无新增编译错误。

执行逻辑命令：

```sh
npm run test:unit -- test/unit/mobile test/unit/navidrome test/unit/onlineMusic/playbackListenTracker.test.ts test/unit/hooks/useNeteaseScrobbleReporter.test.ts
npm run typecheck
npm run build:mobile
```

原生完整选择器及配置见 `native-repaired-command.json`。QA 包使用当批 `dist-mobile`，生产网页入口保存在 `mobile.html`，
测试启动页为空白离线页，用于避免前端参与原生时序；真实 Capacitor 桥接回归使用独立测试脚本。

## 交付与回退

本批仅交付开发源码与测试证据，个人 `BUILD_RECORD.json` 不变。原生代码与 `public/native/listening.js` 需要同时构建，不能只更新旧 App 的网页资源。
回退到 `f4ea5f705aec78e67ab6edb79086878ba53c8a1d` 后重建完整包，即恢复本批前实现。
完整移植仍需剩余能力核对、真实服务及 iPhone／iPad 验收；完整 Automix 的真机热保护、后台与长期稳定性继续待设备条件恢复。
