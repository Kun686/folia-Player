<!-- QQ_SEARCH_DESKTOP_ADAPTER.md — candidate QQ search transport; local checks pass but server upstream acceptance fails. -->
# QQ 搜索移动网关适配

**已取代的失败候选。** 后续 [QQ 认证搜索](QQ_AUTHENTICATED_SEARCH.md) 已通过服务器候选与正式 HTTPS 验证并上线。
Desktop adapter 及对应测试已从生产源码撤出，历史文件保存在本批 evidence 目录。
下文仅描述该失败候选当时的状态，不代表当前线上版本；不得重新部署此候选。

2026-10-14：移动网关已增加 Desktop 搜索协议适配，**源码／本机真实接口验证 PASS，服务器候选真实搜索 FAIL，未上线**。
用户更正凭据后 SSH 已恢复。已按线上旧网关源码制作仅含两个搜索文件的候选镜像，
但候选在服务器请求真实 QQ 返回业务码 `2001`；因此没有切换线上镜像、current 链接或配置，也未重启三个现有容器。
本次没有更新模拟器、个人 iPhone mobile.28、平台账号或队列，不能将下列结果视为线上 App 已修复。

## 依据与范围

[此前诊断](QQ_SEARCH_LIVE_DIAGNOSIS.md)记录 Lite 搜索间歇返回 `request.code=2001`，Mac 直连与网关均出现。
本次没有重复那些已用完重试次数的请求，也没有推断 2001 等于登录失效。

进一步核对安装的 `@yakult-green-tea/qq-music-api` **3.1.4**：旧 `getSearchByKey` 仍发送 `new_json: 1`。
上游 [Rain120/qq-music-api #121](https://github.com/Rain120/qq-music-api/pull/121)已记录该参数导致旧接口空列表，
并于 2026-08-14 合并修复。这为旧回退空结果提供新的解释，**不证明 Lite 2001 的原因**；本次没有修改或升级该依赖。

同项目 [#113](https://github.com/Rain120/qq-music-api/issues/113)提供 Desktop 协议参数，#121 也确认该协议的存在。
据此独立检查 `DoSearchForQQMusicDesktop`，中文和英文各一次均返回真实歌曲。
随后只在移动网关适配该请求，保留现有 App／原生歌词匹配使用的 Lite 响应合同。
上游公开记录仅作协议线索，实际可用性以本次真实响应为据。

## 最简实现

可复用项：现有 `/mobile/request`、目标白名单、访问认证、15 秒超时、8 MiB 响应上限、取消信号，
以及 `normalizeQQLyricSearch` 的歌曲／封面／时长映射。无需 npm、SPM 或原生依赖，也不需要更新 App 资源。

- `deploy/mobile/qqSearch.mjs`：仅识别已通过现有白名单的 QQ Lite 歌曲搜索；校验关键词、页码和每页数量。
  构造固定 QQ Desktop 目标与四个搜索参数，使用固定匿名请求头；不复制访问凭据、QQ 会话、Cookie 或调用方 Referer。
- `deploy/mobile/gateway.mjs`：沿用一次上游请求，不做自动重试或备用请求循环。
  将成功结果的 `body.song.list` 映射为原合同的 `body.item_song`，保持歌曲 mid、歌手、专辑与时长字段。
  非零业务码保留失败；缺失列表／损坏 JSON 返回结构化错误，不伪造空结果。
  HTTP 429／503 与 Retry-After 保持；显式空列表仍为正常空页。
- 歌词获取、网易云、播放地址解析、音频、动画与 UI 均未更改。桌面／普通 Web 不经过这份移动网关的路径保持原样。
- `test/unit/mobile/qqSearchGateway.test.ts`：复用实际获取的《我怀念的》字段验证原解析器；
  控制响应仅用于错误、安全和协议边界回归，不作为真实平台验收。

既有 Dockerfile 的 `COPY deploy/mobile/*.mjs` 会包含新适配文件；已有 Node 24 原生模块加载测试通过。
生产回滚只需恢复原网关镜像／这两处源文件，无数据迁移；远端操作前仍须核对实际部署输入与旧镜像。
不要将当前整个脏工作区直接覆盖服务器，避免夹带未部署的其他改动。

## 验证记录

证据目录：`.mobile-test-results/qq-search-desktop-protocol/`。

| 检查 | 结果与边界 |
| --- | --- |
| Desktop 协议直接请求真实 QQ | `result.json`：`Power`、《我怀念的》各一次，HTTP 200／业务码 0，各返回 5 首。无账号或凭据 |
| 修复前受控网关回归 | `unit-red.log`：12 FAIL／2 PASS；原网关仍转发 Lite，不满足新协议和响应映射 |
| 最终相关回归 | `unit-final.log`：112 PASS；包括新适配、原网关及 QQ 歌词 provider；批次不累加 |
| 类型检查 | `typecheck.log`、`typecheck-final.log`：PASS |
| 生产网关连接真实 QQ | `gateway-live.json`：本机 loopback 网关，中文／英文各第 1、2 页，共 4 次请求，各返回 5 首、分页内容不同；无凭据转发，服务已关闭 |
| 《我怀念的》身份 | 第一页包含 `000BO3xy4fd8BJ`／孙燕姿，时长 289 秒，与已登录队列实际曲目身份一致 |
| SSH 与候选构建 | PASS：更正凭据后已核对实际镜像／配置；基于旧镜像增加两个文件，未安装依赖 |
| 服务器候选真实搜索 | FAIL：`Power` 返回 HTTP 200／上游 HTTP 200，但业务码 2001、0 首；停止该轮，未继续中文请求 |
| 候选健康与认证 | PASS：`/healthz` 正常、缺失访问凭据返回 401；只监听临时 loopback 端口 |
| 独立旧 CGI 协议纠正 | FAIL：去掉 `new_json` 后 HTTP 500；随后发现缺少上游示例参数／Referer 差异，补齐后限定重试一次仍 HTTP 500。两次均未接入产品，重试额度已用完 |
| 远端上线 | BLOCKED_UPSTREAM：候选未通过真实 QQ 验证，不切换生产；旧网关 healthy、QQ／网易云容器身份保持 |
| 线上 App 搜索、搜索后播放、长期稳定性 | NOT_RUN：仍需部署后在用户已登录模拟器检查，不把本机短时请求当作线上通过 |

本机网关联调首次因诊断脚本 import 路径多一级而在启动前失败，未请求 QQ；修正路径后只重试一次，4 次真实请求通过。
这项测试与此前失败的 Lite／旧 CGI 诊断不同，没有重试后者。
真实响应文件只涉及公开歌曲数据，不含凭据、账号资料或播放签名地址。

## 服务器候选与回退证据

证据：`remote-acceptance.json`、`candidate-inspection.json`、`deployment.patch` 和 `deployment-stage/`。

- 旧生产 release：`/opt/folia-player/releases/20261011-lyrics-6078c7c`，current 仍指向此处。
- 旧生产镜像：`sha256:851ce6cbeb2deae61912e33153e7f4774170a2a35fdf1470786708e4ebea644d`。
- 未启用候选：`/opt/folia-player/releases/20261014-qq-search-6221019`，保留源码、构建和验收记录。
- 候选镜像：`sha256:574fa44aafc0e54bd6f590d3c293a38f301d3639111880fd7e13ed9606a34713`。
- 实际容器入口与文件哈希核对通过：gateway `622101970c91d5f48c34667fb6ba4504cfe9f6a20aa1adad1234b95386bd2316`；
  qqSearch `8f89e947d093cbaa7fcdc32289e19d6b5e8751bdb311ef83f70eab29ddfeb3c7`。
- 候选只叠加搜索补丁，没有复制整个当前工作区网关；其他待上线的功能不包含在镜像中。
- 旧镜像另存 rollback 标签，旧配置在候选的权限受限 rollback 目录中留存；无需执行回滚，因为生产未切换。
- 候选首轮因启动瞬间连接重置而在健康检查失败，尚未请求 QQ；补上该就绪错误处理后重试一次，
  才得到上述真实 2001。该命令的重试额度已用完，没有循环请求上游。
- 临时容器、临时 token 文件均已删除；未暴露外网端口。原 HTTPS 缺失凭据仍返回 401。

Mac 与服务器实测结果不同，但测试时间与网络环境也不同；这些证据不能证明具体是 IP、地域、风控或登录原因。
目前无需用户再次提供 SSH 凭据，不建议以反复登录、改凭据或部署未通过候选来绕开未知问题。

## 尚未完成

QQ 搜索需要先找到并验证服务器可用的协议或确认具体失败原因；只有候选通过真实验证后才部署并验收 App。
源码中的 Desktop 适配仍是未通过服务器验收的候选，不能按已完成修复合并或发布。QQ 搜索整体稳定性及 2001 原因仍未知。
此前[真实短时音频](REAL_ACCOUNT_PCM.md)证据保持原边界；动效与音频并行、完整 UI、最新真机、
网易云 30 分钟锁屏及长期温升／内存仍待验收，iPad 继续按用户选择暂缓。
