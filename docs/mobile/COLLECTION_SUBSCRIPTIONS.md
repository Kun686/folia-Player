# 网易云歌单与专辑收藏移植

## 范围与复用

在现有专辑目录和已打开的在线歌单页提供「收藏／取消收藏」，使用原 Omni、
`resolveCollectionMutationBranches` 和 `createCollectionMutationController`，不另建平台收藏规则。
自己的歌单、自己的喜欢列表和音乐云盘沿用原规则，不显示订阅按钮；QQ 保持原 provider 的只读能力。
本批不增加歌单发现、分享链接导入或 QQ 写入协议，不改全屏播放器、歌词动画和透明控制器。

复用 `mobilePlaylistEditor` 已有的账号检查、Keychain 持久化屏障和按平台的写入锁：

- 先确认账号及布尔收藏状态，再创建原版控制器；未知／失败不当作未收藏。
- 上游确认成功后才改状态。失败或结果不明时要求重新读取，不能自动重发原写入。
- 收藏与原歌单增删共用写入锁；重复点击不会重复提交，关闭重开等待已发送请求结束。
- 提交前重新检查账号与会话；退出／平台切换后的晚到结果不能恢复旧账号界面或刷新另一个账号。
- 回到前台重新读取状态。收藏歌单变更刷新当前账号列表，收藏专辑列表每次打开从原分页资源重新读取。
- 原控制器收到的异常和刷新诊断经过脱敏，不包含 Cookie、上游正文或请求地址。

网易云 provider 现在校验两个动态查询的状态字段及两类写入的成功码。
原先 HTTP 成功但业务失败可能被当作未收藏／成功写入；现在返回原 `auth-required`／`unavailable` 错误。
专辑动态状态和收藏列表带时间戳，避免取消收藏后读到旧的 GET 缓存。
没有新增依赖、原生实现、存储格式或数据库迁移。

## 网关与部署

认证入口新增四条固定网易云路由：`/album/detail/dynamic`、`/playlist/detail/dynamic`、
`/album/sub`、`/playlist/subscribe`。ID 必须为正整数；写入必须明确 `t=1` 或 `t=2`。
只允许所需查询字段，不接受自定上游、代理、checkToken 或 POST 请求体。
保留固定内部 API、拒绝重定向、请求超时及响应大小上限，网关凭据不转发上游。

`/mobile/health` 的可选 `subscriptionProviders` 仅声明已启用的网易云。
旧网关缺字段时显示更新提示，不尝试不支持的收藏读写；原目录仍可浏览和播放。
上线顺序为更新网关，再更新 App；回退网关与前端资源即可，不需要迁移用户数据。

四个调用模块已核对部署锁定的网易云 API 4.40.1，与已安装 4.41.1 对应源码逐字一致，
来源及 SHA-256 在 `upstream-source.json`。这证明路由依据，不证明真实账号权限或上游可用性。

本轮没有部署服务器、调用真实账号收藏接口、安装或重启个人 App；个人版本记录仍为 mobile.28。
原生容器和真实设备检查不计入本批的 WebKit 结果。

## 验证证据

证据位于 `.mobile-test-results/subscriptions/`。最终验证结果、资源摘要与源码摘要记录在该目录，
原失败日志保留；早期小范围通过项是最终回归的子集，不能累加。

| 检查 | 结果 | 证据与边界 |
| --- | --- | --- |
| TypeScript | PASS | `typecheck-final.log` |
| 移动／Omni／provider／原控制器及权限／网络缓存 | 1,043 PASS | `unit-final.log`，94 文件；首轮 179 项为其子集 |
| WebKit 三视口 | 78 PASS | `ui-final.log`：收藏 21、账号曲库 21、专辑／歌手目录 18、歌单编辑 18；截图已复核 |
| 移动生产资源 | PASS | `build.log`；123 文件，未压缩资源增加 4,954 字节，不是 IPA 增量 |
| 真实账号收藏读写／原生容器／真机 | NOT_RUN | 不以受控响应或 WebKit 代替平台／设备验收 |
| 服务器／个人 App 更新 | NOT_RUN | 未部署、未安装或重启个人 App |

复现命令：

```sh
npm run typecheck
npm run test:unit -- test/unit/mobile test/unit/onlineMusic test/unit/library/core/collectionMutations.test.ts test/unit/library/core/collectionMutationCapabilities.test.ts test/unit/services/neteaseLikeFreshness.test.ts
npm run test:mobile:ui -- test/mobile-ui/subscriptions.spec.ts test/mobile-ui/account-library.spec.ts test/mobile-ui/online-catalog.spec.ts test/mobile-ui/online-playlists.spec.ts --max-failures=1
npm run build:mobile
```

构建记录的 Git 基线为 `5b293a883bad5ff9bb43ef6b8a45bfee51ba6d5d`；本批实际工作区源码通过
`source-final.json` 与最终提交逐文件校验，产物摘要为 `web-resources.json`。
保留既有大块资源及歌词模块混合导入警告，没有调整打包策略；未运行 Xcode 或 Capacitor 同步。

单测覆盖动态状态类型、失败码、未知响应、明确的收藏方向、原版权限、Keychain 错误、
重复点击、关闭重开、账号变化、旧请求、日志脱敏、网关认证／参数限制和缓存时间戳。
界面测试通过真实 WebKit、Omni、provider 和原集合控制器执行，原生桥及平台响应使用受控样本。
覆盖手机／平板／窄窗口、旋转、收藏列表刷新、模糊写入结果、退出、关闭后的响应及旧网关。

首轮界面检查发现新增控件与内容共用了 React key，已改为不同 key；同时纠正了测试中加载文案的误写。
最终新功能用例检查浏览器错误日志，避免把 React 警告当作通过而遗漏。

真实平台读写、原生容器、真机和服务器部署为 **NOT_RUN**。完整移植及 Automix 真机联合负载验收仍未完成。
