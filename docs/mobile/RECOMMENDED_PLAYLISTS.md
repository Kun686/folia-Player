# 网易云推荐歌单移植

## 行为与复用

移动曲库增加原版网易云「推荐歌单」入口，复用 `HOME_FEED_RECOMMENDATION_LIMIT = 35`、
`createHomeFeedResource`、原 provider 推荐解析、虚拟列表和既有在线目录。
用户可浏览推荐、进入歌单、逐曲加入队列／播放并收藏；收藏成功后刷新自己的歌单列表。
目录中的歌曲仍可打开其专辑和歌手，队列保留原平台与歌曲身份。

与原首页绑定一致，推荐入口需要已登录账户。QQ 原 provider 没有推荐能力，因此不显示该入口；
没有构造 QQ 推荐数据，也不隐式转向网易云。新 Omni 方法 `getProviderRecommendedCollections`
按明确的平台路由，独立取得推荐歌单，不顺便发起 FM 或每日推荐请求。
原 `getHomeFeed` 与桌面 active-provider 路径仍保留。

推荐卡片可能不带创建者。NetEase provider 补接原来的 `getPlaylistDetail`，转换为统一集合信息；
打开推荐歌单前验证来源、ID、类型及创建者，成功后才显示目录和收藏操作，失败可重试。
缺失创建者、空 ID 和归一化产生的 ID `0` 均视为归属未知。
这样自己的歌单沿用原版权限而隐藏收藏按钮，不用卡片中缺失的元数据猜测归属。
歌单曲目仍走原 Library Core 的首页 150 首及后续 1,000 首分页、去重、缓存和失败续传。

推荐失败、缺失结果列表或无效条目不再被当作成功空列表。刷新失败保留已加载推荐，
真实空列表正常显示为空。页面关闭、平台／账号变化后不提交旧读取结果；诊断使用脱敏错误。
推荐顺序及文案来自原数据，界面使用已有主题与目录控件；没有更改播放器布局、控制器或动画。

没有新依赖、原生接口或存储迁移。本轮个人 App、服务器和 Xcode 工程资源未更新。

## 网关与回退

新增受认证的网易云 `/personalized` 只读路由；必须指定 1–100 的整数 `limit`，
只允许 `limit`、Cookie 与时间戳，不接受 offset、自定代理、URL、POST 请求体。
继续使用固定上游、重定向拒绝、超时及大小限制，不转发网关访问凭据。
既有 `/playlist/detail` 路由继续使用，未新增平台写入路径。

可选能力字段 `recommendedCollectionProviders` 仅公布已启用的网易云；
旧网关缺字段时禁用推荐并显示更新说明。推荐详情接入的是原平台数据，不改变 QQ 接口。
部署时先更新网关，再更新客户端；回退前端资源与网关即可，没有数据迁移。

已从固定网易云 API 4.40.1 核对 `personalized.js`、`playlist_detail.js`，与本机 4.41.1 对应模块逐字一致。
来源及摘要在 `upstream-source.json`；源码一致不表示真实推荐、账号权限或音乐播放已通过验收。

## 验证边界

证据目录：`.mobile-test-results/recommended-playlists/`。

逻辑验证涵盖原推荐条数／顺序、显式来源、避免额外 FM／日推请求、失败与空值、归属检查、
关闭和会话失效、网关认证／参数范围、原目录资源及移动端回归。
界面使用真实 WebKit、Omni、provider 和集合资源，原生桥及音乐服务响应为受控样本。

新入口覆盖 35 张推荐的滚动与横竖屏、151 首歌单自动补页、完整队列末曲播放、加入队列、
收藏操作、错误后重新读取、自己的歌单、缺失创建者、退出、迟到响应和旧网关。
真实平台、原生容器、物理 iPhone／iPad及服务部署均为 **NOT_RUN**。
完整移植和 Automix 真机联合负载验收仍未完成。

### 2026-10-13 验证记录

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `npm run typecheck` | PASS，最终源码 | `typecheck-final.log` |
| 移动／provider／原目录资源逻辑回归 | PASS，94 文件、1,011 项 | `unit.log` |
| 最终归属边界单测 | PASS，10 项；其中 7 项与上行重复 | `unit-resolution-final.log` |
| 推荐歌单 WebKit | PASS，18 项，手机／平板／窄窗口，最终源码 | `ui-final.log`、`ui-final/` |
| 原账号库／收藏／目录／歌单 WebKit 回归 | PASS，78 项 | `ui-regression.log`、`ui-regression/` |
| `npm run build:mobile` | PASS，退出码 0 | `build-final.log`、`build-exit.txt` |
| `git diff --check` | PASS | 提交前检查 |
| 新入口真实账号、原生容器、真机、线上部署、个人包更新 | NOT_RUN | 不以受控响应或历史版本反馈代替 |

逻辑测试去重为 1,014 项，界面测试去重为 96 项。最后的 ID `0` 防护是在主逻辑／界面回归后加入的，
其受影响流程已由最终 10 项归属单测、18 项推荐界面用例和类型检查重验；未重复计算早期推荐界面运行。
完整命令如下，输出目录均位于本批证据目录：

```sh
npm run test:unit -- test/unit/mobile test/unit/onlineMusic test/unit/library/core/onlineHomeFeeds.test.ts test/unit/library/core/onlineCollectionResource.test.ts
npm run test:unit -- test/unit/mobile/catalogResolution.test.ts
npm run test:mobile:ui -- test/mobile-ui/recommended-playlists.spec.ts --max-failures=1 --output .mobile-test-results/recommended-playlists/ui-final
npm run test:mobile:ui -- test/mobile-ui/account-library.spec.ts test/mobile-ui/subscriptions.spec.ts test/mobile-ui/online-catalog.spec.ts test/mobile-ui/online-playlists.spec.ts --max-failures=1 --output .mobile-test-results/recommended-playlists/ui-regression
```

构建共 123 个 Web 文件、12,678,051 字节，比上一批 12,675,799 字节增加 2,252 字节；
这不是 IPA 或安装体积。保留已有 chunk-size、静态／动态混合导入和 npm 配置警告，
本次构建另有插件耗时提示，没有构建错误。中断前的构建会话退出状态未被保留，
因此重跑一次构建并保存退出码，最终核验以 `build-final.log` 为准。

`web-resources.json` 保存全部资源 SHA-256；`source-final.json` 保存本批源码与文档摘要。
构建在提交前完成，`build-identity.json` 中的 commit 为基线 `6ac0beb367fdc99258ab5c823a17732856be53fb`，
实际增量由源码摘要及最终提交比对确认，不能将基线 SHA 当成本批完整源码。
标记仍为 `mobile.28`，仅代表沿用的构建配置，并不表示个人 App 已更新。
提交后的准确 SHA CI 与最终摘要核对单独保存在 `ci.json`、`completion.json`。
