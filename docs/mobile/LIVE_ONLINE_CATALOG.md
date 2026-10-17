<!-- LIVE_ONLINE_CATALOG.md — catalog-only gateway deployment and signed-in simulator evidence. -->
# 两平台真实专辑与歌手浏览

2026-10-14，接续 [主题与字体设置检查](LIVE_VISUAL_SETTINGS.md)。真实 QQ 歌曲菜单的
专辑／歌手入口被禁用，原因是线上旧网关未声明或开放目录能力。现已上线七条只读目录路由，
并在已登录的独立 iPhone 模拟器核对真实 QQ／网易云导航。完整移植尚未验收。

## 修正与复用

- 服务端：将仓库现有目录白名单、参数校验及 capability 声明回移到实际部署源码，
  仅增加目录能力。不是将当前工作区完整 gateway 全量上线。
- App：真实操作发现“歌手 → 专辑 → 返回”重置到热门歌曲。
  `OnlineCatalogSheet.tsx` 的现有导航栈现在按历史条目保存所选标签；
  `OnlineCatalogContent.tsx` 接收受控标签。重复进入同一歌手建立独立条目，关闭后释放。
- 保持原 Omni／provider、Library Core resource 的加载、分页、取消及缓存职责。
  没有新依赖，没有修改原生播放器、动效或主题样式；未扩展本地音乐。
- 列表滚动位置恢复不在此次标签修复范围，不宣称已经保留。

## 已部署服务

本节为该批目录上线快照；后续 current 与 backend 镜像已由
[网易云喜欢增量部署](LIVE_ONLINE_LIKES.md)更新，七条目录路由仍保留。

正式入口 `https://music.nb686.cn`，服务器 current 指向：
`/opt/folia-player/releases/20261014-online-catalog`。

健康能力为 `protocol:1`、`providers:["netease","qq"]`、`catalogProviders:["netease","qq"]`。
新增只读路由：

| 平台 | 路由 |
| --- | --- |
| 网易云 | `/album`、`/artist/detail`、`/artist/songs`、`/artist/album` |
| QQ | `/getAlbumInfo`、`/getSingerHotsong`、`/getSingerAlbum` |

访问认证、固定内部目标及请求参数限制保留。未认证为401，非法目录标识为400，
尚未发布的写入请求为404；网关认证头不转发给音乐平台。
收藏写入、歌单编辑及其他现有但尚未发布的能力不能视为本次交付完成。

- backend 镜像：`sha256:4060c3589e6f9b021711f4054b1dc87ebe119efa511037450d038601bd612840`
- gateway.mjs：`dc9ead3fdae1ecd4655470d6821d1f6ed6b3e11f638956ec84fcbe1c8c6663bc`
- policy.mjs：`dcd789d3f3ec4216beb8e2581c66b069f192f0c4a177a94d076895b751c18517`

QQ／网易云容器、镜像和会话卷保持原状。精确容器 ID、旧镜像及后端源码副本见本地证据目录
`.mobile-test-results/live-online-catalog/`；收尾 `final-server.json` 确认当前镜像／源码摘要、
三个服务运行及临时候选容器已移除。

回滚：保留上一版 `20261014-qq-search-status` 与 backend 镜像
`sha256:252d9b52b998b24e3ef683eb6ab986d773c13fcec91266a67bc2cf609403e662`。
当前 release 下 `rollback-catalog/mobile.env` 为0600备份。
需要回滚时只把 shared/mobile.env 中的 backend 镜像改回旧值，使用上一版 compose 执行
`up -d --no-deps backend`，检查健康和 HTTPS 后恢复 current 链接。不要覆盖整份现有配置或平台会话。

## 验证与边界

| 检查层次 | 结果 | 证据与范围 |
| --- | --- | --- |
| provider／gateway／artist resource 单元 | 178 PASS | `unit.log`，三个相关文件 |
| 精确部署补丁的本机 HTTP 校验 | 110 断言 PASS | `overlay-check.jsonl`，受控响应，不是平台验收 |
| 候选真实接口 | 七条 PASS | `candidate-corrected.jsonl` |
| 正式 HTTPS 真实接口 | 七条 PASS | `production-server.jsonl`，另含401／400／404边界 |
| 标签修复与既有目录 WebKit | 18 PASS，34.3秒 | `ui.log`，手机／宽平板／窄窗口，受控接口 |
| 类型、移动资源、Release 模拟器构建 | PASS | `typecheck.log`、`build.log`、`native-build.log` |
| 最终安装包身份／资源 | PASS | `manifest.json` 与 `installed-manifest.json`；128资源、2个空 Cordova 文件、签名 |
| 实际账号的原生容器导航 | 已观察通过 | 下列真实歌曲、回退标签、横屏关闭与竖屏恢复 |
| 本批目录播放、入队或账户写入 | NOT_RUN | 本批始终暂停，未修改真实队列／收藏／歌单 |
| 个人 iPhone 更新、真机、长播 | NOT_RUN | 个人 mobile.28 未更新；iPad真实账号按用户要求暂缓 |

实际接口数据：QQ《我怀念的》→《逆光》12首、孙燕姿10首热门歌曲和首50张专辑；
网易云《莫愁乡》专辑1首、亞細亞曠世奇才10首热门歌曲及29张专辑。
这些返回数量是指定目录的实际结果，不作为全部目录完整性结论。

部署候选第一轮由于内部 Docker 网络未分配可访问发布端口而失败，尚未调用目录路由；
改为连接既有 edge／providers 网络后仅重试一次并通过。失败与清理证据保留。
两次独立工具编排曾在执行前因 JavaScript 字符串引号失败，各改为模板字符串后一次重试成功；
无额外服务请求或部署发生。App回归／构建本批无失败重试。
构建仍有原有大chunk、混合导入和AudioStreaming排除目录警告，未记作已消除。

主要命令均使用 `codex-bounded` 限时；此次目录WebKit上限180秒，未自动重试：

```sh
npm run test:unit -- test/unit/mobile/gateway.test.ts test/unit/onlineMusic/qqProvider.test.ts test/unit/library/core/artistResource.test.ts
node node_modules/@playwright/test/cli.js test -c playwright.mobile.config.ts test/mobile-ui/online-catalog.spec.ts --output .mobile-test-results/live-online-catalog/ui
npm run typecheck
npm run build:mobile
node node_modules/@capacitor/cli/bin/capacitor copy ios
```

原生构建参数沿用上一批正确的 `qq-search-cover/validation.xcconfig`，见
`native-build.log`；未使用旧 `transition-validation.xcconfig`。

## 真实模拟器操作

iPhone17Pro／iOS26.5，UUID `9213032A-657A-40CD-BD2A-A3065ACCC8EC`，
Bundle ID `app.folia.validation.App`，模拟Keychain身份
`33GAKXJHL3.app.folia.validation.App`。原位安装，没有卸载。
包版本字段仍为0.7.16／28，依下列摘要区分，不能称作个人新版发布：
`71be95ceb4b837ee89af73e788157746a7d8a55042c3eec4c218928551d89a70`。

更新前真实 QQ《逆光》→孙燕姿→《飞瀑而下》与网易云《莫愁乡》→歌手→《花骨朵》
均可打开。更新后分别重走歌手专辑返回路径，两平台均保留“专辑”标签。
QQ还验证最终包横屏展示、点击关闭及恢复竖屏。关键截图：

- `qq-catalog-disabled.png`／`qq-catalog-enabled.png`：旧网关与能力上线后入口。
- `qq-album.png`、`qq-artist.png`、`netease-album.png`、`netease-artist.png`：真实目录。
- `qq-back-tab-fixed.png`／`netease-back-tab-fixed.png`：最终包返回后所选标签。
- `qq-back-tab-landscape.png`：最终包横屏。
- `final-qq-account.png`／`final-netease-account.png`：最终两平台登录与51首队列。

最终保持暂停《莫愁乡》，本批未新增播放或入队。登录／队列保持是可见界面观察，
不是凭据字节一致性或队列逐首摘要断言。
先前尝试原生输入／粘贴中文无效，随后通过真实个人歌单进入目录，
因此本批没有成功提交新的中文搜索，不作搜索验收。
上一独立包 `.mobile-test-results/live-visual-settings/VerifiedValidation.app` 留作同身份回滚。

收尾 `cleanup.json`：无遗留Vite、镜像、日志或SSH辅助进程；无临时候选容器。
保留用户已授权使用的独立模拟器App与正式音乐服务。安装后源码摘要及上述截图存在性再次核对通过。

目录导航不代表当前整套UI、其他动效、QQ偶发空搜索根因或长期稳定性已解决。
网易云30分钟锁屏、耳机／蓝牙／网络变化、歌词150ms测量和持续动画内存／温升仍待验收。
