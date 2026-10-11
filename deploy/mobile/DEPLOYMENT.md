# 移动服务部署与回滚

2026-10-10 已完成首台服务器的内部部署，当前只启用网易云和 QQ。
按用户选择暂不配置域名与 HTTPS；App 的生产网络仍要求受信任 HTTPS，不为内部验证关闭 TLS 校验。
详细结果见 docs/mobile/SERVER_VALIDATION.md。三个 Node API 运行在服务器／NAS，不在 iOS 内运行。
2026-10-11 内部网关已更新到 `6078c7c`，增加云盘歌词只读路由；平台镜像和凭据未变。

## 固定版本

- 源码基线：d824c0b854e54d5411cb072092999823e9bd7071，叠加当前移动补丁；部署前记录最终提交或源码归档 SHA256。
- 网易云 Docker lock：@neteasecloudmusicapienhanced/api 4.40.1。
- QQ Docker lock：@yakult-green-tea/qq-music-api 3.1.4。
- 酷狗：KuGouMusicApi v1.6.0 GitHub 归档，完整性见对应 lock。
- 移动网关复用 deploy/docker/backend/package-lock.json 的 Express 5.2.1。
- 运行镜像填写 repository@sha256:digest，或本地构建的不可变 sha256:image-id 并保存镜像归档，不使用 latest。基础 Node 默认固定 24.17.0-alpine，
  可用 --build-arg NODE_IMAGE=...@sha256:... 进一步固定。

根依赖锁和 Docker 各服务锁不是同一份。不要把根目录的模拟 provider 测试当作 Docker 真实平台验证。

## 构建与配置

在含 Docker 的机器，从仓库根目录构建：

    docker build -f deploy/mobile/Dockerfile -t folia-mobile-api:0.7.16-mobile.1 .
    docker build -f deploy/docker/images/netease-api.Dockerfile -t folia-netease-api:mobile-baseline .
    docker build -f deploy/docker/images/qq-api.Dockerfile -t folia-qq-api:mobile-baseline .
    docker build -f deploy/docker/images/kugou-api.Dockerfile -t folia-kugou-api:mobile-baseline .

将镜像保存或推到自己控制的仓库，并把实际 RepoDigest 填入 .env。镜像名只是构建标签，
Compose 模板不提供虚构 digest。复制 .env.example 到同目录 .env，设置：

- 默认填写 BACKEND、NETEASE、QQ 三个不可变镜像标识；MOBILE_PROVIDERS=netease,qq。
- 默认只有 127.0.0.1:17863 映射到移动网关；平台 API 不映射宿主端口。
- 独立的 MOBILE_ACCESS_TOKEN（例如 openssl rand -hex 32），与 MOBILE_QQ_SECRET 分开生成。
- 仅启用独立 TLS 配置时需要 NGINX 镜像和可信证书 fullchain／私钥的绝对路径。
- 对外仅开放 TCP 443。若 NAS 已占用 443，应调整端口映射和原有反向代理，仍保持 App 使用受信任 HTTPS。
- .env、TLS 私钥、QQ state 卷按秘密文件保护，不发到聊天、不提交 Git、不输出 docker compose config 的完整展开内容。

    docker compose -f deploy/mobile/compose.yaml --env-file deploy/mobile/.env config --quiet
    docker compose -f deploy/mobile/compose.yaml --env-file deploy/mobile/.env up -d

默认配置仅在宿主机回环地址发布移动网关端口，平台 API 不开放宿主端口。
现有宿主 nginx 可反向代理到 127.0.0.1:17863；尚未选定域名时保持内部部署。
独立服务器可加 -f deploy/mobile/compose.tls.yaml 启动容器 nginx。
启用酷狗需设置固定 MOBILE_KUGOU_IMAGE、MOBILE_PROVIDERS=netease,qq,kugou，并加 --profile kugou。网关 /mobile/* 始终检查访问令牌；
容器 /healthz 只供内部健康检查，HTTPS 入口不暴露它。网关不启用通配 CORS；App 使用原生网络。

独立 nginx 配置关闭访问日志，平台容器关闭日志驱动，移动后端不记录请求。
不要在外层 NAS 代理、APM 或抓包工具启用请求体／认证头采集。客户端平台 Cookie 位于 HTTPS 请求体／头内，
后端访问内部音乐 API 时按既有协议传递。认证头从不转发到平台或音频 CDN。原生访问拒绝重定向。

## 校验与回滚

1. 检查已启用的容器和后端健康检查；HTTPS 上线后再检查证书链和公网可达性。
2. 无令牌访问 /mobile/health 应返回 401；合法令牌应返回 protocol=1 和实际启用的 provider 列表。
3. 在 App 逐个平台执行真实扫码、搜索、歌单、歌词、地址解析；保存无秘密的结果与时间，不保存 Cookie 或签名 URL。
4. 执行真机锁屏测试，见 docs/mobile/ACCEPTANCE.md。
5. 保存本次源码 SHA、镜像 digest、非秘密配置模板，以及加密的 .env／QQ state 备份。

更新前保存上一版镜像和配置；回滚时恢复上一份 digest/.env 并重新 up -d。
不删除 QQ state 卷，不运行 down -v。密钥变化会使既有会话失效，需要重新扫码。

## 当前依赖风险

2026-10-10 定向更新已有传递依赖，未新增生产依赖：
Axios 1.20.0、proxy-addr 2.0.8、qs 6.16.0，以及锁文件内兼容的 moment、ip-address、music-metadata。
网易锁对 qs 6.16.0 和 basic-ftp 6.2.3 使用精确 override。basic-ftp 保持 MIT；
get-uri 使用的 Client/access/lastMod/list/downloadTo/close 接口保留，移动入口禁止 proxy，FTP 路径不开放。
不整体执行 audit fix，也不升级音乐 API 的已选主版本。

网关和 QQ 部署锁的 npm audit --omit=dev 均为 0。
网易部署锁剩余 node-forge 1.4.0 和它的直接依赖记录，共 2 High、0 Critical，
对应 GHSA-86w9-cpqp-85rv（RSA PKCS#1 v1.5 签名验证）。
npm 当前没有修复版本；已核对 API util/crypto.js 只调用 publicKeyFromPem 和 encrypt('NONE')，
没有使用受影响的签名验证路径。这是当前调用路径分析，不能声称依赖无漏洞。
根桌面锁与延后启用的酷狗仍保留此前审计问题，未以更新服务器锁冒充全项目清零。

## 内部部署操作

服务器目录结构：releases/<version> 为源码；current 指向当前版本；
shared/mobile.env 为权限 0600 的凭据与不可变镜像配置；evidence 保存无秘密的验证记录。
所有运维命令在 current 下执行：

    docker compose --env-file /opt/folia-player/shared/mobile.env -f deploy/mobile/compose.yaml ps
    docker compose --env-file /opt/folia-player/shared/mobile.env -f deploy/mobile/compose.yaml config --quiet

真实接口探测从仓库根目录经 SSH 输入容器执行：

    ssh root@SERVER 'timeout 290 docker exec -i folia-mobile-backend-1 node --input-type=module' < dev/mobile/server-smoke.mjs

脚本只输出状态、数量和错误码，不输出 Cookie、二维码 key、播放签名 URL。
MOBILE_SMOKE_SCOPE=qq 或 netease 可定向运行；匿名接口失败会如实报 FAIL。
扫码生成通过只说明二维码可用，不代表已登录或真实设备播放通过。

只读歌词适配器补验可使用 `dev/mobile/server-lyrics-smoke.mjs`，与当前 App 打包的
`dist-mobile/native/lyrics.js` 一起传入网关 `/tmp` tmpfs。通过 `docker exec -i ... sh -c 'cat > /tmp/...'`
输入文件；只读容器可能拒绝 `docker cp`，不为探针修改容器安全选项。
执行 `node /tmp/server-lyrics-smoke.mjs /tmp/folia-lyrics.js`，结束后删除这两个临时文件。
可用 `MOBILE_LYRIC_SCOPE=qq` 和 `MOBILE_LYRIC_QUERY=晴天` 做已验证的 QQ 定向检查。
该探针复用认证令牌但不登录账户，只输出数量、状态、运行时摘要；失败返回非零，不使用模拟响应。
源码／运行时应记录 SHA256，具体真实接口验证和未覆盖边界见 ONLINE_LYRICS.md。
