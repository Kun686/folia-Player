# 内部服务器验证

日期：2026-10-10。版本：0.7.16-mobile.1。目标仓库：Kun686/folia-Player。
本节记录最初仅内部服务部署；2026-10-11 已按用户指定接通 `music.nb686.cn`，见文末 HTTPS 更新。

最新运行网关已于 2026-10-11 更新至 `6078c7c`，见文末“在线歌词路由更新”。
以下 2026-10-10 账户验证是历史证据，不代表会话目前仍有效。

## 部署事实

- Debian 13.2 amd64，Docker 29.8.2，Compose 5.6.0。
- 独立目录 /opt/folia-player；current 指向 releases/20261010-mobile1-a367f22；运行源码提交 a367f2266238191525f9babcb4a815ea4d225361。
- 项目 folia-mobile，仅 backend、netease-api、qq-api；酷狗暂不启用。
- 宿主端口仅 127.0.0.1:17863；平台 API 无宿主端口，现有 nginx 配置未改动。
- 凭据在 shared/mobile.env，权限 0600；QQ 会话目录使用独立卷，平台容器关闭日志驱动。
- Node 基础镜像：24.17.0-alpine@sha256:156b55f92e98ccd5ef49578a8cea0df4679826564bad1c9d4ef04462b9f0ded6。
- 运行镜像按不可变 ID 固定，构建日志保存在服务器 evidence/。本地锁文件与服务器构建输入一致。
- 三个镜像另存 evidence/20261010-mobile1-images.tar.gz 及 SHA256，供恢复使用。
- 原有两个站点部署前后均返回 HTTP 200，原有 worker 仍在运行。公网直接访问 17863 未连通。

| 检查 | 结果 | 边界 |
|---|---|---|
| 三个镜像构建／服务启动 | PASS | 后端 Docker healthcheck 正常；平台另做真实接口检查 |
| 无令牌／错误令牌 | PASS | 拒绝访问；平台不接收网关 Authorization |
| 平台能力列表 | PASS | 只返回 netease、qq；酷狗 API／歌词／解析返回禁用错误 |
| 网易搜索／歌词／地址解析 | PASS | 真实上游结果；非 fixture |
| 网易扫码图片生成／真实登录 | PASS | 用户扫码确认，登录状态与账户资料身份匹配 |
| 网易个人歌单／歌曲／歌词 | PASS | 真实账户读取，不公开个人内容 |
| 网易带账户地址／CDN | PASS | HTTPS 地址，有限 Range 请求返回 206 audio/mpeg |
| 网易退出后的旧 Cookie | FAIL | 退出后携带原 Cookie 查询仍有 profile；未证明上游立即撤销；临时会话文件已删除 |
| 网易匿名登录 | FAIL | 上游返回 code=400；增加 timestamp/randomCNIP 后仍失败，无模拟 Cookie 兜底 |
| QQ 搜索／歌词 | PASS | 使用 App 相同的查询参数，真实上游结果 |
| QQ 匿名地址解析 | FAIL | 选定曲目返回 unavailable；登录后播放另行验证 |
| QQ 真实扫码登录 | PASS | 用户官方 App 扫码确认，返回会话，账户状态有效 |
| QQ 个人歌单／收藏歌曲 | PASS | 真实账户返回列表；不公开个人标识或内容 |
| QQ 带账户地址解析／CDN | PASS | 共享移动解析接口返回 HTTPS 地址；有限 Range 请求返回 206 audio/mpeg |
| QQ 退出 | PASS | 退出后 profile 消失，临时测试会话文件已删除 |
| HTTPS／App 到服务器 | NOT_RUN | 用户选择暂不配置域名；未绕过 TLS 校验 |
| iPhone签名安装／启动 | PASS | iOS18.7.10，用户确认与devicectl启动结果一致 |
| iPhone／iPad 后台连续播放 | NOT_RUN | iPad未安装，尚未做后台验证；CDN Range 不证明设备播放 |

QQ Node 3.1.4 没有可选 /login/channels 路由，返回 404；现有 adapter 按其原有规则使用 QQ 默认通道。
早期探测脚本把每页结果设为 3，QQ 返回 2001；换成与 App 一致的 50 和查询参数后返回有效歌曲。
这项失败来自探测参数，未通过改写平台响应掩盖。

## 当前依赖审计

部署网关锁与 QQ 锁：0 vulnerabilities。网易锁：2 High，均为 node-forge 签名验证公告及其依赖链。
无已发布修复版本，API 当前调用为 RSA 加密，未使用受影响的 verify 路径。详见 deploy/mobile/DEPLOYMENT.md。
根桌面依赖和未启用酷狗不在此次“部署依赖清零”结论范围。

## 仍需完成

可信 HTTPS、iPad 安装、两类真机各 30 分钟锁屏跨曲，
WebView 挂起期间下一首解析与 URL 失效恢复、耳机／蓝牙／网络切换、歌词误差和温升内存测量。
模拟器单测、浏览器 fixture 和接口检查不能替代这些验收。

网易退出以 App 清除会话为必要条件：原生 Keychain 清除与对应平台队列失效已有 XCTest；不能将调用上游 /logout 等同于原 Cookie 已被平台立即撤销。此次验证使用临时测试会话，未导入 App，手机安装后需重新扫码。

GitHub Mobile checks 已通过： https://github.com/Kun686/folia-Player/actions/runs/38040181997 。
最终服务器构建输入已与 BUILD_RECORD.json 按 SHA256 比对一致；两个测试账户临时文件剩余数量为 0。

## 内部重启与回滚材料验证

2026-10-10 09:36 UTC：仅对 folia-mobile 的 backend、netease-api、qq-api 执行一次 compose restart。
当前运行源码仍为 a367f22；未更新配置、镜像版本、域名或其他应用。

- 重启后容器 ID、镜像 ID、端口绑定不变；后台网关健康状态恢复为 healthy。
- 认证 /mobile/health 返回 protocol=1、netease/qq；无令牌访问仍为401。
- QQ 命名卷挂载与持久文件字节摘要不变，shared/mobile.env 摘要不变。
- 首次五秒接口探针失败；稍后改用十秒超时、手动处理重定向的只读探针，两平台内部根路径均返回200。
  没有再次重启；未确定第一次失败的具体原因，根路径响应不替代真实账户接口验收。
- 现有两个站点均返回200，原有 worker 保持运行，其启动时间早于此次 Folia 重启。
- 上一版 Compose 配置校验通过。发现旧后端镜像不在 Docker 镜像列表后，校验
  before-final-images.tar.gz 的已存 SHA256 并执行 docker image load；旧配置引用的三个精确镜像 ID
  随后均可查询。加载归档前后，运行容器 ID、镜像与启动时间不变，没有切换到旧版本。

脱敏证据位于服务器 /opt/folia-player/evidence/20261010-restart-validation.json。
真实账户会话跨重启、实际运行版本回滚、证书更新仍为 NOT_RUN；本次验证不能把这些项目改为 PASS。

## 在线歌词路由更新

2026-10-11，current 指向 `/opt/folia-player/releases/20261011-lyrics-6078c7c`。
源码提交 `6078c7c40d69be3c2bcc2b0d7ff76ee33528b71e`，归档 SHA256：
`58e35bbe5c23a1c68b84b6a8473fc1b44fcc27da17acc6004fbd4673601c7212`。
相对原服务器部署的生产输入仅改变 `deploy/mobile/policy.mjs` 一行：增加只读 `/cloud/lyric/get`。

- 新网关镜像：`sha256:851ce6cbeb2deae61912e33153e7f4774170a2a35fdf1470786708e4ebea644d`。
- 旧网关镜像：`sha256:a9b850a4dcbe8d4056689eed293ec90ee34388468c82de993f66562525971ad0`。
- Node 基础镜像摘要与依赖锁保持不变；镜像按不可变 ID 写入原配置，不使用浮动 tag 部署。
- 新网关 healthy；无认证访问 401，认证能力列表只含 netease、qq；云盘歌词路由已加入。
- 仍仅映射 `127.0.0.1:17863`；没有新增域名、TLS、平台端口或容器权限。
- `shared/mobile.env` 除后端镜像行外逐行一致，权限仍为 0600。QQ／网易云容器 ID、镜像、启动时间
  前后相同；其他正在运行的应用容器 ID／镜像前后相同，nginx 服务 active。没有重新验证其他站点 HTTP。
- 回退材料位于 `/opt/folia-player/evidence/20261011-online-lyrics/`：旧／新后端镜像归档及其摘要、
  `previous.env`（0600）、旧 release 路径与镜像 ID、构建日志、脱敏 `deployment.json`。
  原 release 和 QQ 命名卷保留。实际执行回滚仍为 NOT_RUN。
- 本地 `online-lyrics-server-deployment.json` 的输入 SHA256 已与当前源码及打包歌词运行时逐项对照。

真实平台检查详见 [ONLINE_LYRICS.md](ONLINE_LYRICS.md)：网易云 50 行歌词，QQ 63 行歌词，QQ 旧队列
身份补齐后的结果一致。QQ 首次检索无结果，换检索词后通过，首次原因未确定；失败证据保留。
执行环境为服务器 Node vm 加 App 共享适配器，不等于真实 iPhone／iPad 端到端或锁屏验收。

探针首次用 `docker cp` 写入只读容器被 Docker 拒绝，随后改用 `docker exec` 的标准输入写入既有
`/tmp` tmpfs；没有关闭 read_only。两轮探针退出时均删除临时运行文件，未保存歌词正文或账户会话。

## QQ 真机测试的 HTTPS 入口

2026-10-11 08:20 UTC，用户指定 `music.nb686.cn`，服务器公共 DNS 解析到 `111.229.218.169`。
复用现有宿主 nginx 和 acme.sh，无新依赖、无 App 更新，音乐容器及其配置保持不变。

- PASS：HTTP webroot 公网探针，Let's Encrypt YE1 证书签发及安装。
  SAN 为 `music.nb686.cn`，有效期至 2027-01-09 07:20:40 UTC。
- PASS：系统 curl 开启证书验证，直接连接服务器 IP 并验证域名，TLS 验证码 0。
  不带令牌 `/mobile/health` 返回 401；持有现有令牌返回 protocol=1、netease/qq。
- PASS：原有 nginx vhost 文件 SHA256 与部署前一致；所有现有容器 ID／镜像保持不变。
  `ceshi7.nb686.cn`、`ceshi8.nb686.cn` HTTPS 首页各返回 200。
- PASS：独立续签 timer 已启用，下次检查为 2026-10-12；只针对 Folia 域名，不改现有 crontab。
  实际证书续签 NOT_RUN。
- PASS：连接资料写入用户本机权限 0600 文件；访问令牌不进入源码、证据 JSON 或命令日志。
  iPhone XS Max 仍安装 mobile.12，devicectl 已成功启动 `app.folia.personal`。
- 待用户操作：在 App 保存入口和令牌，从 App 发起 QQ 扫码，让会话由 App 保存。
  **尚未确认真机登录、歌单读取或实际播放，不能将 HTTPS 连通写成这些项目通过。**

部署配置副本为 `deploy/mobile/nginx.host.conf.example`，配置 SHA256：
`a7c5d4d184184dae20e624a93045df1a7876c9758702824ef85706d99fdaf8a4`。
服务器证据：`/opt/folia-player/evidence/20261011-qq-device-tls/`；
本地认证检查：`.mobile-test-results/qq-device-https-health.json`。

失败记录：首次 nginx 检查因该主机不存在 `/var/log/nginx` 而失败，新配置当即撤回、未 reload；
使用独立 `/var/log/folia` 后通过。首次本机 Python HTTPS 检查因其 CA 信任库缺失失败，
改用系统 curl 的正常证书校验后通过；未关闭 TLS 校验。
