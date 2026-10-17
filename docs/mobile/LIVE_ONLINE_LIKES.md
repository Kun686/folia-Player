<!-- LIVE_ONLINE_LIKES.md — minimal likes rollout and real-account evidence, separate from device acceptance. -->
# 网易云真实歌曲喜欢与取消

2026-10-14，接续 [真实目录浏览](LIVE_ONLINE_CATALOG.md)。已将原项目已有的网易云
歌曲喜欢接口接到正式服务，并在已登录的独立 iPhone 模拟器完成真实收藏、取消及回读。
QQ 保留原 provider 的只读喜欢状态。完整移植尚未验收。

## 服务与回滚

正式入口 `https://music.nb686.cn`；current 为
`/opt/folia-player/releases/20261014-online-likes`。
本次在精确部署源码上仅增加 `/like` 与 `songLikeProviders:["netease"]`，
保留上一批七条目录路由。没有把工作区其他未发布能力整体上线。

- backend 镜像：`sha256:4c8e34e11c65a3b94e1a63d2bff443fc6c38f891efd055b98a1f12719bb42ef8`
- gateway.mjs：`9f7482b3a0e712cdb27b7cfb070b18ab5b2f502aca95702c4fc13079c7e7e012`
- policy.mjs：`d4d7a0e55328937e2ba2ffdc6896668b7948696e35d4866bfa73694269550b18`

只接受正整数歌曲 ID 与显式 true／false；无网关凭据为401，非法参数为400。
歌单编辑仍为404。网关认证不转发音乐平台；不记录 Cookie、访问凭据或播放签名地址。
QQ／网易云容器、镜像和会话卷未更换。独立候选容器及临时私有配置已清理。

回滚版本 `20261014-online-catalog`，backend 镜像
`sha256:4060c3589e6f9b021711f4054b1dc87ebe119efa511037450d038601bd612840`。
新 release 的 `rollback-likes/mobile.env` 是0600备份。回滚只恢复 shared/mobile.env 的
backend 镜像，使用上一版 compose 执行 `up -d --no-deps backend`，检查健康／HTTPS 后
恢复 current 链接；不要覆盖其他配置或会话。回滚不会撤销已提交给平台的账户操作。

## 真实操作与发现

目标：iPhone17Pro／iOS26.5模拟器，UUID
`9213032A-657A-40CD-BD2A-A3065ACCC8EC`，Bundle ID `app.folia.validation.App`。
保留已登录的QQ／网易云身份与原51首队列；本批始终暂停，个人iPhone mobile.28未更新。

从真实喜欢歌单《莫愁乡》进入亞細亞曠世奇才热门歌曲，选择《花骨朵》：

1. 初始菜单显示“喜欢这首歌”，确认原本未收藏。
2. 点击后显示“取消喜欢”；关闭再打开菜单，重新请求平台仍为已喜欢。
3. 重新读取喜欢歌单后，《花骨朵》位于首行。
4. 取消本次测试收藏，关闭并重开菜单，回读为未喜欢，恢复原状态。

发现：写入成功后，已打开的喜欢歌单未自动刷新，必须重新点歌单。
修正复用 `catalog.refreshCollection`：当前同平台歌单在歌曲菜单关闭后重读；
如果写入在关闭后才完成，也会刷新。同平台重新打开的菜单会阻止提前刷新，
避免原 `SongList` 的行变更处理关闭正在操作的菜单。错误写入、失效会话不触发刷新；
切到其他平台／搜索后不会用旧歌单替换新页面。刷新沿用现有首50首分页语义。

首个刷新修正包在真实平台仍读到旧歌单。本地固定API源码的成功响应缓存为两分钟，
`netease.ts` 已给喜欢状态／写入和歌单详情加时间戳，却遗漏 `/playlist/track/all`。
现将可变歌单曲目加入同一时间戳规则，保留ID／limit／offset，不清空整个资源缓存。
未采集服务器cache-hit事件，因此不把缓存中间层的每次命中当作已独立证明。

最终包在21:28取消《花骨朵》，关闭菜单后歌单自动恢复《莫愁乡》为首行，
没有再次点击歌单，测试收藏恢复原状态。该次验证直接覆盖取消后的自动刷新；
新增收藏后的自动刷新在时间戳修正后的包中未再额外写入测试。

生产改动为 `mobileSongLikes.ts` 的会话内通知、`MobileApp.tsx` 的现有目录接线及
`netease.ts` 的曲目请求时间戳。继续走Omni／provider；不改播放器、动效、样式或依赖。

## 验证证据

本地证据根 `.mobile-test-results/live-online-likes/`。

| 层次 | 结果与边界 |
| --- | --- |
| 精确部署补丁 | 110条目录回归、58条喜欢接口断言PASS；受控上游，不代替真实账户 |
| 原有相关单元 | 串行226项PASS；首次225PASS／1超时，变更为串行后仅重试一次 |
| 候选与正式HTTPS | 七条真实目录读取及401／400／404边界PASS；脚本不发送真实账户写入 |
| 真实账户 | 上述《花骨朵》收藏、取消、重开菜单回读已观察通过 |
| 列表刷新状态机 | 36项PASS；时间戳补充后的最终相关逻辑39项／3文件PASS，不累计重叠数 |
| WebKit | 菜单时序修正后30项PASS／2.1分钟；时间戳补充后3视口定向回归PASS／19.2秒，检查桥接后实际请求时间戳变化 |
| 类型／构建／安装 | 最终PASS，128资源与2个空Cordova文件逐一一致，模拟签名身份及实际安装包核对PASS |
| 最终真实自动刷新 | 取消喜欢后自动从当前歌单移除PASS；保持暂停、原51首队列可见 |
| 个人iPhone／iPad／后台长播 | NOT_RUN；iPad真实账号按用户要求暂缓 |

关键服务器文件：`candidate-server.jsonl`、`production-server.jsonl`、`final-server.json`。
实际菜单截图：`netease-initial.png`、`netease-like-success.png`、`netease-like-readback.png`、
`netease-liked-playlist-reloaded.png`、`netease-unlike-success.png`、`netease-unlike-readback.png`。
未刷新问题保存在 `netease-library-after-like.png`，不能将原包的这项行为写成通过。

列表刷新首轮WebKit发现成功反馈被刷新关闭，已中断，保留 `refresh-ui.log` 与失败截图；
改为等待同平台菜单全部关闭后，唯一一次限时重跑30项全通过，没有放宽原成功反馈断言。
后续真实平台旧歌单问题则补时间戳并做一次有针对性的复验，未无限重试写入。
其余源文件定位中有不存在路径的检查失败，没有执行对应写入或服务请求。

最终包与收尾证据在 `freshness/`：`unit.log`、`typecheck.log`、`ui.log`、`build.log`、
`native-build.log`、`manifest.json`、`installed-manifest.json`。可执行文件SHA256：
`57cf365d78b431f5e5eeb7bb9d851936e4edce14fd5a4ea8df87c1a90d360fdc`。
包字段仍为0.7.16／28，不能称作个人新版。`VerifiedValidation.app`为独立QA包。
打包后只补强测试文件中的时间戳断言，核验快照同步记录该测试摘要，原快照另存
`manifest-before-test-assertions.json`；生产源码、可执行文件及包内资源未因此变化。
该快照命令曾因shell引号在执行前失败，去掉嵌套shell后一次重试通过。

`freshness/unliked.png`与`freshness/unlike-auto-refresh.png`分别为最终成功反馈和自动刷新结果。
根目录中`final-*`为时间戳修正前的中间包证据，其中旧歌单截图是失败记录，不能用于最终PASS。
回滚App保留本批前的 `live-online-catalog/VerifiedValidation.app`，可原位恢复相同模拟身份。
原构建的大chunk、混合导入与AudioStreaming排除目录警告仍存在，未声称消除。

最终QQ《我怀念的》菜单显示“已喜欢”和只读说明（`freshness/qq-readonly-like.png`），
QQ登录及51首队列可见（`freshness/qq-account.png`）；网易云登录与暂停状态见自动刷新截图。
以上是可见状态观察，未读取／比较凭据字节或逐首导出队列。本批没有QQ账户写入。
`freshness/cleanup.json`确认无测试端口、Vite／Playwright／SSH／构建／日志辅助进程残留，
保留已授权的模拟器App与正式音乐服务。首次进程检查遇到系统进程参数非UTF8字节，
改为替换非法字节后一次重试成功；没有因此杀死其他用户进程。

此记录只覆盖歌曲喜欢。网易云30分钟锁屏、耳机／蓝牙／网络切换、歌词150ms测量、
持续动效内存／温升、整套设置UI及物理设备仍待验收；QQ偶发空搜索根因仍未确认。
