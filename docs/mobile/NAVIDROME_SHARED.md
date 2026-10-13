# Navidrome 共享读取与移动连接

2026-10-13。在 [原生连接层](NAVIDROME_TRANSPORT.md) 上接入原版 JavaScript 业务解析。
本批没有操作物理设备、真实账户、个人 mobile.28 或生产服务器；没有改变播放器 UI、动画或音效算法。
**移动 Navidrome 的设置／浏览入口和原生播放尚未交付。**
后续原生播放与账号撤销已在独立 QA 验证，见 [NAVIDROME_PLAYBACK.md](NAVIDROME_PLAYBACK.md)；本文保留本阶段证据。

## 复用与实现

`src/services/navidromeReadApi.ts` 从原 `navidromeService.ts` 提取 17 个只读操作及服务器概况组合，
原版与移动端共同使用同一份请求参数、响应选择和能力映射。接口的配置类型只要求用户名，不要求密码。
桌面入口仍传入原 `fetchSubsonic`，沿用原签名 URL、localStorage、写操作、报错日志和空值回退行为。
提取过程中保留原方法注释，没有新增依赖或改写平台业务规则。

`src/mobile/navidromeConnection.ts` 将这些操作接到实际 Capacitor 原生桥接：

- 只复制公开配置字段；密码、认证 URL 和浏览器 localStorage 不进入连接对象。
- 一个连接负责同一会话的所有读取，最多两项原生并发、总计最多 64 项活动／等待任务。
  这是适配原生请求上限所需的局部调度；复用现有 Promise，没有引入通用队列框架。
  原版服务器概况的五项并行读取可以完整执行。
- 丢弃不同 scope／revision 的结果；取消连接立即拒绝等待与活动任务，并调用原生精确取消。
  登录失效或连接变更也关闭旧连接，后续不能重用它。更换设置后由宿主创建新连接。
- 普通网络／接口错误保持明确失败，不变成空歌单；只对明确缺少的扩展／结构化歌词接口保留原版回退能力。
  未知错误文本统一清理，避免回显 URL 或认证信息。

歌曲身份允许携带原生 Keychain 的连接 scope。已有桌面歌曲继续用原 `navidrome:<mediaId>` 键；
带 scope 的歌曲使用独立前缀加 JSON 二元组，不会与含冒号的旧歌曲 ID 相撞。
转换为统一歌曲时保留 scope，队列保留当前歌曲时使用现有 `isSamePlaybackSong`，不再仅比较生成的数字 ID。
回归覆盖同一 ID 属于不同服务器／账号，以及同一服务器内不同 ID 恰好生成相同数字的情况。

## 验证

证据目录 `.mobile-test-results/navidrome-shared/`。

| 验证 | 结果 | 范围 |
| --- | --- | --- |
| 针对性 Vitest | 9 文件／96 PASS | 共享读取、原版服务、来源身份、歌词、曲库 |
| 相关完整回归 | 141 文件／1,451 PASS | mobile、playback、Navidrome、library/core 与相关工具；包含上述 96 项 |
| TypeScript | PASS | 首次检查发现泛型 Promise 返回标注问题，显式标注后通过；两份日志均保留 |
| QA JavaScript 构建 | PASS | 原连接模块经现有 Vite 打包，Safari 17 目标；约 12.86 kB，仅加入独立 QA 包 |
| Release 原生测试构建 | PASS | 无生产 Swift 修改，无新运行库 |
| iPad Pro 11-inch (M5)／iOS 26.5 模拟器 | 14 PASS／0 skip | 13 项原生连接回归，加 1 项实际共享 JS → Capacitor → Keychain／URLSession 的集成用例 |
| 真实服务器／物理设备／Navidrome 播放 | NOT_RUN | 模拟器使用受控 HTTP 响应；不等同于音源或真机验收 |

新增原生集成用例实际运行 `dev/mobile/build-navidrome-qa.mjs` 打包的源码，未 mock JavaScript 桥接。
URLSession 仅响应合成歌单；配置写入唯一 QA Keychain 项并在测试后删除。
连续 10 次歌单读取成功；另 8 项旧会话读取在保存替换凭据后全部拒绝；新会话 6 次读取成功。
相同歌曲 ID 产生不同的连接 scope，公开返回值没有密码；原生读取确认新密码已保存。

提取后的首次对象组合曾使服务器概况绕过导出 API 上的方法覆盖；新增回归先复现失败，
随后改为保留原对象身份，完整 1,451 项回归通过。失败日志 `profile-dispatch-before.log` 保留，
未将这次提取引入的偏差描述为原版已有缺陷。

复测入口：运行 `node dev/mobile/build-navidrome-qa.mjs`，将其输出的 `navidrome-connection-qa.js`
复制进独立 QA 包的 `public/` 后重新签名，使用 QA xctestrun 运行 `NavidromeTransportTests`。
完整构建／测试参数、xctestrun、`.xcresult` 和日志保留在上述证据目录。
该脚本不会改写 `dist-mobile` 或个人发布包。

## 后续接入与回退

移动宿主尚未创建此连接，也未开放 Navidrome 页签。下一阶段需接原生歌曲／队列身份、凭据变更时的播放取消、
媒体解析、封面／歌词缓存，再装配设置和浏览界面；流 URL 必须留在原生层，不能作为歌曲身份或持久凭据。
原版写操作仍保持原桌面行为，移动收藏／歌单编辑／scrobble 尚未接入。

没有更新 `BUILD_RECORD.json` 或个人版本，也没有进行 UI、锁屏、性能或完整 Automix 真机验收。
回退需一起恢复原服务、共享解析、桥接类型和来源身份工具；当前没有生产入口写入新形式的歌曲身份，
因此此阶段回退不需要数据迁移。未来开放入口前须把 scoped 身份纳入原生持久化与回滚测试。
