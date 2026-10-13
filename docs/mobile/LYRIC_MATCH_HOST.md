# 原版最佳歌词匹配的独立原生宿主

后续接线与验证见 [LYRIC_QUEUE_INTEGRATION.md](LYRIC_QUEUE_INTEGRATION.md)。以下保留本阶段的历史验收边界。

2026-10-13，继续不依赖真机的工作。基线 `5cd0cdf196360a3833a2b86a58b67e55b9d168d4`。
本批完成四来源原始请求适配、Swift／JavaScriptCore 执行、真实期限／取消和会话隔离。
**尚未接入当前／下一首的自动触发、原生偏好同步和自动结果缓存合并**，不能标记后台完整功能交付。
个人 mobile.28、物理设备、真实账户及服务器未操作，无新增生产依赖或界面改动。

## 实现与复用

- `NativeLyricMatchJob` 在独立 VM 中运行 `createAutoMatchBestLyric`。每次调用独立持有事件、
  请求、期限和结果；Swift actor 串行访问 JSValue，异步请求仅返回 JSON，不把 VM 交给网络线程。
  使用原解析器、SDK JavaScriptCore／zlib、Swift Task／AsyncStream 和已有网关。
- `nativeLyricPorts` 是原有显式跨来源匹配的内部 provider adapter，普通前台数据流仍走 Omni。
  QQ 搜索参数／歌曲映射、原 QRC 解密、网易云规范化／分页／YRC／副歌、酷狗规范化／
  匿名签名／候选／KRC／高潮段，以及 AMLL URL／TTML 规则复用原代码；未用 Swift 改写评分。
  原 Web／Electron provider 也调用拆出的同一份 helper，原公共导出保留。
- 请求由 Swift 消费事件后执行，响应触发后续 Promise；没有定时轮询或 WebView 参与。
  搜索阶段 3500ms、歌词阶段 5000ms，阶段期限覆盖该阶段的多个请求。AMLL 每个 ID 5000ms，
  保留 mid 后数字 ID 的顺序和原外层期限。超时会取消未完成的底层请求；晚到响应按 ID 丢弃。
  完成／父任务取消时停止剩余网络与期限任务。单 job 另限 60 秒、128 个事件 ID、16 个同时待处理事件、
  256 次事件循环；请求／解析输入输出保留明确字节上限。
- `NativeLyricMatchTransport` 捕获网关与三平台会话快照，在每次请求前后及最终结果返回前检查。
  旧记录兼容读取可选 `sessionGeneration`；切号／退出成功提交后生成新值，解决退出后恢复相同 Cookie
  仍需使旧任务失效的问题。网关 scope 的既有语义不变，失败写入不改变已保存状态。
- Cookie 只按所属 provider 加到受认证网关请求。QQ 公共歌词接口只使用原固定匿名 Cookie；
  AMLL 走已有 `NativeJSONTransport`，仅允许官方 HTTPS 查询路径与单个音乐 ID，清除继承认证头、
  Cookie／凭据存储及缓存，拒绝重定向。响应限制 2,000,000 字节，不把响应正文／凭据／URL写入日志。
- 新增 `lyric-match.js` 构建资源，独立打包实测 1,399,229 字节。它复用已安装依赖，并非新增 npm／SPM 包。
  这是 JS 资源大小，不等于最终安装包增量；原生队列尚不自动创建此 VM。

10 项机械源码对照通过：原匹配内核完全未变；酷狗规范化／分页／搜索／副歌／歌词流程，QQ 搜索参数／映射，
网易云副歌／权限映射在还原 export 和空白后相同。对照不替代执行测试。

## 验证与边界

| 项目 | 结果 | 证据范围 |
|---|---|---|
| TypeScript | PASS | 最终类型检查；移走旧 imports 后另复核 |
| 逻辑回归 | 328 PASS，13 文件 | 平台适配、原匹配器、缓存、9 项新增原始响应／取消／隔离用例 |
| 前台 WebKit | 30 PASS | phone／ipad／ipad-narrow，在线偏好、AMLL、已选歌词保护及迟到响应 |
| Mac 裸 JavaScriptCore | 8 PASS | 四来源原始响应路径、同 actor 并发 job、实际期限和父任务取消 |
| iPad M5 iOS 26.5 模拟器 | 17 PASS，0 FAIL／SKIP | 8 项新宿主／网络用例、9 项原网关／Keychain 回归 |
| 独立 QA 构建 | PASS | Release 模拟器构建，`app.folia.validation.App` |
| 队列自动触发／偏好同步／缓存合并 | 未实现 | 新宿主目前仅由独立验证调用 |
| 真实平台／真机／WebView 系统挂起 | NOT_RUN | 全部平台响应受控，不能代替真实服务及锁屏验收 |

Mac 探针断言 `window/document/fetch/setTimeout/localStorage/Worker/URLSearchParams` 不存在。
QQ 搜索停滞时约 **3.61s** 取消并回退网易云；AMLL mid 停滞约 **5.11s** 后取消并查询数字 ID。
两次均记录活动延迟请求回到零。iOS 专项另外通过实际 URLSession／URLProtocol 验证取消、继承头清理、
大小限制、三平台任一会话变更、相同 Cookie 恢复和 QQ 搜索到原 QRC 的完整调用。

模拟器使用独立 QA 包，测试宿主页替换为空白离线 HTML，测试请求均被 fixture 拦截；没有借前台 JS 完成匹配。
模拟器运行前后都为 Shutdown；Xcode 已自动还原，后续 shutdown 命令只报告已关闭，未重试。
这一证据不宣称 iOS 的 WKWebView 进程被系统挂起；完全无 WebView 的执行证据来自 Mac 探针。

首轮新增逻辑测试 8 PASS／1 FAIL，并发现取消后有 6 个未处理 Promise rejection：期限注册失败时，
调用方已创建的 Promise 没有接收者。现已在注册期限前观察该 Promise，修复后 9 项全通过且无未处理 rejection。
AMLL 的首个合成 TTML 样本不符合原解析器的逐词标记要求，改用仓库已使用的 itunes timing／key 结构，未改解析规则。

首轮 iOS 专项 6 PASS／1 FAIL：测试错误假定拒绝超大 Content-Length 时网络必然未接收任何正文。
URLSession 可以预读，因此保留“过大正文被拒绝”的边界断言，取消“零接收字节”断言，并改为复用已有
`NativeJSONTransport`。最终 17 项通过。所有初次失败记录保留。

## 复现和证据

```sh
npm run typecheck
npm run test:unit -- test/unit/mobile/nativeLyricMatch.test.ts test/unit/onlineMusic/kugouProvider.test.ts test/unit/onlineMusic/kugouTransport.test.ts test/unit/onlineMusic/neteaseProvider.test.ts test/unit/lyrics/qqLyricProvider.test.ts test/unit/lyrics/amllDbProvider.test.ts
npm run test:mobile:ui -- online-lyric-preference.spec.ts amll-match.spec.ts
```

裸宿主：用已安装 Vite 将 `src/services/onlineMusic/nativeLyricMatchRuntime.ts` 打成 IIFE，
全局名 `FoliaLyricMatch`、target `safari17`、禁用 configFile／publicDir、删除 console 调用。
使用系统 swiftc 编译 `SecureStore.swift`、`NativeLyricInflate.swift`、`NativeLyricMatchJob.swift`
及 `dev/mobile/lyric-match-host-probe.swift`（`-parse-as-library -swift-version 5 -framework JavaScriptCore -framework Security`）。
执行参数为 `BUNDLED_JS ios/App/NativeTests/OnlineLyricReference.json NEW_RESULT_JSON`。

本地 `.mobile-test-results/lyric-match-host/` 保存源码对照、原始失败与最终日志、Mac receipt、QA 包身份、
两次 xcresult、模拟器状态、命令及源码／清理记录。临时包和日志不提交。最终执行测试之后仅移除未使用 TS imports、
调整两份 Swift 文件空白、给探针局部函数补 `@Sendable`；类型检查再通过，未改变被测行为。

## 接线与回退

下一步在 `NativeLyrics` 的当前／下一首生命周期调用该宿主，保留可用原歌词立即参与播放规划；
后台可选升级不得延迟播放。同步原 `autoUseBestLyric`／首选来源，升级时不得用新原生默认值覆盖已有偏好。
保存结果前须验证任务身份、设置版本及全部来源会话，并与最新共享缓存状态原子合并；导入、手动选择、
纯音乐 override 和已保存匹配必须继续优先。任何平台会话变更应取消跨来源任务，不能只失效该平台拥有的歌曲。

撤销本批源码／构建清单即可回退；旧版本忽略新增的可选会话版本字段，无服务部署或缓存格式迁移。
个人 `BUILD_RECORD.json` SHA256 保持
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。
