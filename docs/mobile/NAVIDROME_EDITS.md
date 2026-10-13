<!-- NAVIDROME_EDITS.md — mobile Navidrome mutation scope and evidence. -->
# Navidrome 移动歌单编辑与收藏

本批将原版 Navidrome 新建／重命名／删除歌单、加入／移除歌曲、收藏／取消收藏接到移动触摸入口，包含正在播放歌曲的工具面板。
复用原版写入参数、现有 Keychain、原生有界 JSON 传输和现有面板；未新增依赖，未调整已确认的全屏布局、主题、歌词动画或音频算法。
个人 App 保持 mobile.28；未操作真实 Navidrome、音乐平台账户、服务器或物理设备。完整移植及真机验收仍未完成。

## 实现与限制

- `src/services/navidromeWriteApi.ts` 提取原 `navidromeService` 的五个写入方法；桌面与移动端共用相同参数映射。
  保留原 GET 与重复数组参数，兼容没有 `formPost` 的 Subsonic 服务；没有改动桌面 scrobble。
- 原生桥接单独允许 `createPlaylist`、`updatePlaylist`、`deletePlaylist`、`star`、`unstar`，只读入口继续拒绝写入路由。
  凭据由原生读取并签名，禁止通过参数覆盖账号／路由／认证；不转发音乐网关认证或 Cookie，拒绝重定向。
  每个数组最多 1,000 项，总计最多 1,005 个值，单值最多 4,096 UTF-8 字节，完整 URL 最多 32,768 字节。
  越界整体拒绝，不截断或拆分为可能部分成功的多次写入。
- 一个账号共享写入状态。一次只允许一项写入，读列表等待已发送操作结束；关闭面板或切换曲库来源不丢失正在执行的操作。
  设置变更撤销旧请求，响应前后检查账号 scope 和 revision。应用不会自动重试写入。
- 编辑已有歌单先重新读取并核对所有者；收藏切换先读取当前歌曲的服务端状态。菜单仅列出当前账号拥有的歌单。
- 移除歌曲使用原始位置，保留同曲重复出现；发送前比较完整歌曲 ID 顺序及可用的 `changed` 字段。
  **协议限制：Subsonic 不提供条件写入／CAS。重读与写入之间另一客户端仍可能修改顺序；此校验不是服务端原子保护。**
  同时编辑同一歌单仍需避免；返回已变化时刷新后重新选择。
- 写入回复丢失或格式错误时，显示“结果无法确认”，阻止继续写入，直到用户明确刷新并检查结果。
  即使服务端已删除歌单，刷新也回到最新歌单列表核对，不能把查询已删歌单失败变成重复删除。
  此状态在当前 App 网页运行期内保留；重启后的服务端列表读取仍是结果依据。
- 播放器工具与曲库使用同一编辑器。原生时间快照更新不重复查询收藏或歌单。

## 与原版搜索对齐

此前 `NAVIDROME_LIBRARY.md` 将“搜索续页”写为待移植项目，现已纠正。
`src/stores/useSearchNavigationStore.ts` 的 `searchNavidromeSongs` 明确返回 `hasMore: false`；本次保留原行为，不新增分页需求。
现有曲库搜索仍使用原 Navidrome 搜索接口与默认数量。

## 验证与证据

本批证据保存在 `.mobile-test-results/navidrome-edits/`；`delivery.json` 记录源码、最终 QA 资源与二进制摘要、准确提交和 CI。

| 层级 | 结果 | 范围／证据 |
| --- | --- | --- |
| TypeScript | PASS | `typecheck-delivery.log` |
| 逻辑回归 | 132 文件／1,427 PASS | `logical-delivery.log`；移动端、Navidrome、library/core、歌词及封面 |
| WebKit 触摸界面 | 27 PASS；另 21 项 QQ／网易云收藏回归 PASS | `ui-delivery.log` 最终 Navidrome 9 场景×手机／宽 iPad／窄 iPad；`ui-player.log` 包含 21 项既有在线收藏回归，重叠测试不累计 |
| 移动资源构建 | PASS | `mobile-delivery.log` |
| 原生 Release 测试构建 | PASS | `native-build-delivery.log`；独立 `app.folia.validation.App` |
| 原生 iPad 模拟器 | 35 PASS／0 skip | `native-delivery.xcresult`、`native-delivery-summary.json`；最终资源重装配，包含 4 项新增写入测试及既有原生播放／歌词／封面／桥接回归 |
| 真实服务器写入、物理设备、系统挂起、温升／长期性能 | NOT_RUN | 受控 URLSession、WebKit 样本与模拟器不替代真实服务／设备验收 |

新增用例覆盖参数编码、只读／写入隔离、所有者和账号校验、重复歌曲位置、序列变化、请求取消、重定向目标零请求、未知结果不重试，
以及关闭后恢复、实际已删除但回复丢失、播放器快照期间请求次数稳定。原生桥接测试运行真实 Capacitor 调用，网络响应由受控样本提供。

主要命令：

```sh
npm run test:unit -- test/unit/mobile test/unit/navidrome test/unit/library/core test/unit/services/coverCache.test.ts test/unit/lyrics/navidromeStructuredLyrics.test.ts test/unit/utils/coverUrl.test.ts
npm run typecheck
```

Playwright 使用既有 mobile-ui 配置；原生以 `build-for-testing` 后的独立 QA 包执行 35 条选择器。
完整原生命令见 `native-delivery-command.json`，没有向个人包安装，也没有执行真机命令。

保留失败过程：初次单测中两项导航取消样本在请求发出前就切换状态，加入写入等待后已不再命中“在途取消”边界；
修正为先确认原生读取已启动，再改变导航／账号，保留原断言。类型检查补齐新增歌曲样本的必需 `durationMs`。
之后对应检查及最终回归通过。原有 QQ 解压样本警告和 npm 配置警告仍保留在日志，未作为失败隐藏。

## 部署与回退

源码与原生二进制／移动资源必须同步构建；新增 `navidromeMutation` 不能仅向旧 App 替换网页资源。
本批只提交开发源码与记录，不更新个人 mobile.28、签名或 `BUILD_RECORD.json`。
需要回退时恢复本批前提交 `651c45f928504eeda4d607fde58883afc20db8ed` 后重新构建完整包。

本批覆盖以上歌单／收藏触摸操作，不代表 Navidrome 全部功能或完整移植已验收；播放上报等原版能力仍需逐项核对。
完整 Automix 的真机热保护、后台及长期稳定性验收继续等待设备条件恢复。
