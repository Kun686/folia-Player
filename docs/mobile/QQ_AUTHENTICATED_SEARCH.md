<!-- QQ_AUTHENTICATED_SEARCH.md — authenticated QQ search implementation, deployment, and real-account evidence. -->
# QQ 移动端认证搜索

2026-10-14，基线 `7d51e6ee50868e45031e8c9222c5223f3413fa0b` 加工作区修改。
本批修复 QQ 核心搜索，不扩展本地音乐、Automix 或其他平台功能。
此前 [Desktop 候选](QQ_SEARCH_DESKTOP_ADAPTER.md) 在服务器失败，已撤出生产源码；该记录仅保留历史证据。

## 实现与复用

复用固定 `@yakult-green-tea/qq-music-api` **3.1.4** 的会话解析、Android 设备参数、Cookie 构造、HTTP 客户端和 RPC。
原 `normalizeQQLyricSearch` 保持歌曲 mid、歌手、专辑、封面与时长映射，界面仍通过 Omni 调用 provider。
没有新增依赖、安装包、Swift 平台规则或另建凭据存储。

- `deploy/mobile/patch-qq-search.mjs`：为固定库加入单一 `mobileSearchSongs` 方法，调用已有认证 RPC。
  构建时同时核对版本及原文件 SHA256；版本漂移或重复打补丁直接失败。每次请求复用库提供的独立 Cookie 容器，
  避免共享账户查询／登录请求残留状态。限制 12 秒、8 MiB 响应和 256 KiB 请求。
- `qqSearchRoute.cjs`、`qq-search-server.cjs`：移动镜像的 `/mobile/search` GET 入口，读取原不透明会话标识。
  仅允许关键词、页码、页长和时间戳，固定歌曲搜索 RPC，不接受调用方 Cookie／目标 URL／任意 RPC。
  并发上限 12、断连取消、错误脱敏；缺失列表为 502，显式空数组才为空页。
  只有明确的凭据拒绝且全局码为 0 才返回 401；上游服务失败不清理有效登录态。
- `policy.mjs`：移动网关加入固定路径和参数验证。上线仅覆盖旧生产 policy 的这一处增量，
  没有带入工作区尚未部署的其他能力；生产 gateway.mjs、网易云镜像和 nginx 配置不变。
- `qqTransport.ts`、`qqProvider.ts`：仅移动容器使用认证搜索与原解析器，复用已有 Keychain 会话桥接。
  Web／Electron 搜索保持原路径；普通按歌曲身份获取歌词不变。暂缓的本地歌词自动匹配仍是原匿名路径。

## 验证与失败记录

证据目录 `.mobile-test-results/qq-search-authenticated/`。

| 层级 | 结果 |
| --- | --- |
| 真实认证对照 | 同一服务器、现有会话及设备参数，`我怀念的` 返回 5 首，含孙燕姿 `000BO3xy4fd8BJ`；原会话文件未改变，`result.json` |
| 逻辑回归 | 4 文件 **228 PASS**；参数、会话失效、空页／坏响应、凭据错误分类、取消、并发释放及真实固定库补丁，`unit-isolation.log` |
| 类型与移动构建 | PASS，`typecheck.log`、`mobile-build.log`、`copy.log`；无新增原生代码 |
| 独立服务器候选 | PASS；中文／英文各两页、每页 5 首，页间结果不同；缺网关认证／缺会话／无效会话 401，非法参数 400；会话恢复与保留，`candidate-result.json` |
| 正式 HTTPS | PASS；`https://music.nb686.cn` 同样完成 4 次真实分页搜索及认证检查，耗时 290–351ms；`production-result.json` |
| 独立 iPhone 模拟器安装 | PASS；`app.folia.validation.App`，128 资源与已安装包逐项匹配，签名校验通过，`app-manifest.json` |
| 新版真机、长时间搜索稳定性 | NOT_RUN；不把短时成功解释为上游 2001 的最终根因或永久修复 |

首轮新增单测因 package exports 不允许直接解析内部路径而未执行；修正为从公开 package.json 定位后通过。
首轮服务器候选搜索失败，已清理且生产未切换；隔离 HTTP 路由诊断成功，改用每请求独立 Cookie 容器后
仅复验一次并通过。首次诊断进程等待监听之前读取地址失败，修正等待后一次复验成功。
上述对照不足以唯一证明首次候选失败由 Cookie 污染造成；隔离同时消除了共享 Cookie 状态这一风险。

首次上线检查误用仅内部开放的 `/healthz`，触发自动回滚，未认定为业务接口失败。
修正为带认证的 `/mobile/health` 后只重试一次，正式 HTTPS 搜索通过才切换 current。
远端保留首次失败、修正后候选、上线与回滚日志；无无限重试、无明文凭据输出。

## 上线与回滚

当前 release：`/opt/folia-player/releases/20261014-qq-auth-search`。

| 镜像 | 固定身份 |
| --- | --- |
| QQ | `sha256:e3feb78ea9b8d00348271cc3fb1aeb75320acb522e086aaa3f4b7eb73c6cd6b1` |
| backend | `sha256:252d9b52b998b24e3ef683eb6ab986d773c13fcec91266a67bc2cf609403e662` |
| QQ 原始库文件 | `bdb3bd8bf7a7c05449b2f0553f1110c0a0d1d4f15781abbf87fc2cf580483acc` |

`deployment-auth-search.json` 记录旧／新镜像和源码哈希，`rollback/mobile.env` 为原配置备份（仅服务器、0600），
`rollback/qq-state` 为加密会话备份；原 QQ volume 与 secret 保留。候选使用独立私有副本，完成即删除副本与容器／网络。
没有修改网易云容器。回滚应恢复原配置中的 **MOBILE_QQ_IMAGE／MOBILE_BACKEND_IMAGE**，只重建这两个服务，
将 current 指向原 release `20261011-lyrics-6078c7c`。正常镜像回滚不覆盖现在的会话 volume，避免丢失期间新登录。

后续可复现构建：以已固定 QQ 基础镜像作为 `QQ_API_IMAGE`，上表原文件哈希作为 `QQ_SOURCE_SHA256`，
使用 `docker build -f deploy/mobile/qq-api.Dockerfile` 构建移动 overlay；不重新 npm install，不升级库。
实际部署 compose 的 `MOBILE_QQ_IMAGE` 必须指向已验证的新镜像摘要。桌面／普通 Web 镜像不要应用此 overlay。

## 原生模拟器实际观察

iPhone 17 Pro / iOS 26.5，`9213032A-657A-40CD-BD2A-A3065ACCC8EC`。
版本字段沿用 0.7.16 / 28，以本批 manifest 区分个人 mobile.28；复用此前原生二进制，仅替换前端资源并重签。

- 更新后 QQ、网易云登录与原 51 首队列保留。
- QQ 实际搜索 `Power` 显示 G-DRAGON、Little Mix／Stormzy、EXO 等真实结果，`qq-search-power.png`。
- 从搜索结果选择 G-DRAGON《PO￦ER》，进入原绘光全屏播放器，进度推进，韩文／英文歌词与翻译出现。
  点击进度跳转到 1:25 并暂停，`qq-search-playing-seek.png`。这条新歌曲临时追加到原队列末尾，未替换原队列。
- 本轮 CUA 拖动手势未成功改变滑块，只有点击跳转得到明确证据，不能把拖动记为通过；不据此直接判断真机拖动失效。
- 本轮没有重新采集 PCM／主观听感；此前 [真实音频与绘光并行](REAL_ACCOUNT_VISUAL_PCM.md) 证据仍是上一批边界。
- 随后从队列切回网易云《莫愁乡》，中文歌词／绘光恢复且进度推进到 1:10 以上，收尾暂停。
  通过队列筛选只移除本批追加的 G-DRAGON 歌曲，原 51 首队列恢复；两平台登录继续保留，`netease-final.png`。

收尾 backend 健康、QQ／网易云运行中；远端临时容器、网络及临时私有配置已清理，本地无本轮 SSH／构建／测试进程残留。
保留已暂停的独立模拟器 App 供继续验收；没有提交或推送代码。

最新物理 iPhone 安装、网易云 30 分钟锁屏、耳机／蓝牙／网络切换、歌词误差 ≤150ms、长期温升与内存、整套 UI 均仍待验收。
iPad 按用户要求暂缓。个人 iPhone mobile.28 尚未更新，不宣称它已获得本次前端搜索修复。
