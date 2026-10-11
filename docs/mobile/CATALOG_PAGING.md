# 在线个人歌单分页与请求隔离

2026-10-12。开发源码已完成，个人 App 仍为 mobile.20；本轮无新依赖、无服务器修改。

## 问题与修复

原移动 `useCatalog` 只读取个人歌单 offset=0 / limit=100，没有下一页入口；
账户刷新、歌曲搜索和歌单曲目加载共用一个请求序号。搜索先完成时会废弃尚未返回的账户结果，
账户刷新也可能废弃搜索结果，并使歌曲加载状态无法归位。

- 保留现有横向歌单列表，增加「加载更多歌单」、歌单／歌曲失败重试。
  沿原 `omni.getProviderUserPlaylists` 的 `hasMore`／`nextOffset` 逐页读取，没有新增总数截断。
- 复用 Library Core `collectionKey`：按来源、平台、类型和 ID 合并重叠页，保留新元数据；
  已加载歌单在下一页失败时保留，重试同一游标。宣称仍有下一页却不推进的游标明确失败，避免重复请求。
- 账户与歌曲请求分别递增序号。账户加载期间仍可搜索；新搜索覆盖旧搜索，重复的同页加载被合并。
  更换账户时废弃旧账户歌单曲目，但正常账户刷新不打断公开搜索。
- 平台切换／失联／卸载由现有原生请求取消与 session 失效共同处理；迟到结果不能恢复旧账户或旧歌曲。
  状态经 `useSyncExternalStore` 订阅，effect 重建会重新初始化，旧请求不能写入新生命周期。
- 退出先清界面并废弃请求；即使取消或上游退出失败，仍分别尝试清除 Keychain 会话和账户缓存。
  失败显示可重试；退出执行期间禁用再次登录与平台切换，避免旧清理覆盖新登录。
- 确认登录后的凭据刷新与歌单请求分开，歌单接口失败不再跳过已有的会话持久化。

在线调用仍只经过 Omni；没有直接接入 provider 原始接口的新移动端调用。
现有桌面账户 controller 包含桌面后端管理和切换流程，不适合直接挂进移动库；
本轮只增加一个 111 行的移动生命周期协调模块，复用原分页合同与身份规则，不另写平台分页规则。

## 网易云适配器的必要修正

`neteaseProvider.library.getUserPlaylists` 原来把缺少 playlist 的错误响应转为空数组，
导致调用者把接口失败当成成功读到空库。本轮按相邻 `getLikedSongIds` 的已有约定修正：

- 301／401／403 返回 `auth-required`；其他失败或缺失／非数组列表返回 `unavailable`。
- 正常空数组仍是合法空库。
- 上游提供布尔 `more` 时按该字段分页，缺失时保留原来的满页判断。

这是共享适配器修复，桌面与移动均受益；没有改变正常歌曲身份、登录或播放地址规则。
现有网关 policy 已允许这两个平台的 `/user/playlist` 与分页参数，无需更改服务部署。

## 本轮验证

| 验证 | 结果与边界 |
|---|---|
| TypeScript | `npm run typecheck` PASS |
| 逻辑与 provider | 3 文件 / 114 项 PASS：9 项移动请求／生命周期测试，加网易云与 QQ 原 provider 回归（含 10 项新网易云分页响应检查） |
| WebKit | 12 项 PASS：手机、iPad、iPad 窄窗；3 个新场景及原登录／曲库／队列／播放冒烟场景，各 3 视口 |
| 第 101 个歌单 | 真实 Omni 与网易云 adapter 读取受控分页，二页失败重试、打开该歌单、送入原生桥接播放入口通过 |
| 生命周期 | 页面延迟时完成搜索、退出后丢弃旧结果、切换本地后返回网易云重新读取首批，界面加载状态均恢复 |
| UI | 手机截图检查、无页面横向溢出；保留原播放画布与控制器样式 |
| NOT_RUN | 用户真实 QQ／网易云超 100 个歌单的完整性、原生容器端到端复测；本轮未更新个人安装包 |

WebKit 与逻辑测试使用受控数据，不是上游在线服务或真实账户验收。
本轮未改 Swift／原生播放，不重复声称已完成原生功能复测。

```sh
npm run typecheck
node node_modules/vitest/vitest.mjs run -c vitest.config.ts test/unit/mobile/catalogSession.test.ts test/unit/onlineMusic/neteaseProvider.test.ts test/unit/onlineMusic/qqProvider.test.ts
node node_modules/@playwright/test/cli.js test -c playwright.mobile.config.ts test/mobile-ui/catalog.spec.ts test/mobile-ui/mobile.spec.ts --grep 'playlists after|search and account|switching providers|login, catalog'
```

截图保存在忽略目录 `.mobile-test-results/catalog-{phone,ipad,ipad-narrow}.png`。
回退仅撤销本轮入口／session 及共享适配器校验，没有数据库、凭据或服务器配置迁移。
