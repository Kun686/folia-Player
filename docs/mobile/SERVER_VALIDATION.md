# 内部服务器验证

日期：2026-10-10。版本：0.7.16-mobile.1。目标仓库：Kun686/folia-Player。
当前阶段按用户选择只部署内部服务，暂不配置域名和 TLS。

## 部署事实

- Debian 13.2 amd64，Docker 29.8.2，Compose 5.6.0。
- 独立目录 /opt/folia-player；current 指向 releases/20261010-mobile1。
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
| iPhone／iPad 后台连续播放 | NOT_RUN | 未签名安装和真机验证；CDN Range 不证明设备播放 |

QQ Node 3.1.4 没有可选 /login/channels 路由，返回 404；现有 adapter 按其原有规则使用 QQ 默认通道。
早期探测脚本把每页结果设为 3，QQ 返回 2001；换成与 App 一致的 50 和查询参数后返回有效歌曲。
这项失败来自探测参数，未通过改写平台响应掩盖。

## 当前依赖审计

部署网关锁与 QQ 锁：0 vulnerabilities。网易锁：2 High，均为 node-forge 签名验证公告及其依赖链。
无已发布修复版本，API 当前调用为 RSA 加密，未使用受影响的 verify 路径。详见 deploy/mobile/DEPLOYMENT.md。
根桌面依赖和未启用酷狗不在此次“部署依赖清零”结论范围。

## 仍需完成

可信 HTTPS、Apple 开发签名、两类真机各 30 分钟锁屏跨曲，
WebView 挂起期间下一首解析与 URL 失效恢复、耳机／蓝牙／网络切换、歌词误差和温升内存测量。
模拟器单测、浏览器 fixture 和接口检查不能替代这些验收。

网易退出以 App 清除会话为必要条件：原生 Keychain 清除与对应平台队列失效已有 XCTest；不能将调用上游 /logout 等同于原 Cookie 已被平台立即撤销。此次验证使用临时测试会话，未导入 App，手机安装后需重新扫码。
