# Navidrome 原生连接层

2026-10-13。此批完成原版 Navidrome 的移动原生凭据与只读请求接口，**尚未交付移动 Navidrome 音源**。
当前个人安装版本仍是 mobile.28。本批没有操作物理设备、真实账户、个人 App 或生产服务器。

## 复用与边界

Navidrome 在原版是独立 Subsonic 服务，不属于 Omni 的网易云／QQ／酷狗 provider，也不是配置同步服务。
移动 App 直接连接用户配置的 Navidrome HTTPS 地址，不需要经过 Folia 音乐网关。

复用 `SecureStore`、`NativeJSONTransport`、`NativeJSONTasks` 和现有 HTTPS 地址／租户路径校验。
认证使用系统 CryptoKit 的 MD5 和 Security 随机数；没有新增 npm／SPM／运行库依赖，锁文件未变。
Swift 仅负责凭据、协议认证、请求边界和错误分类；曲库映射、歌词解析、界面与播放器算法没有复制或修改。

协议依据为原版 `src/services/navidromeService.ts` 与
[Subsonic 官方 REST API 文档](https://www.subsonic.org/pages/api.jsp) 的 Authentication／Error handling。
维持 `v=1.16.1`、`c=Folia`、`f=json` 以及 `/rest/<operation>` 路径。
原版名为 `passwordHash` 的字段实际保存密码；新接口使用准确的 `password` 名称，不迁移或读取桌面 localStorage。
每次请求生成新盐值，并计算协议要求的 `MD5(password + salt)`；MD5 不作为本地密码存储方案。

## 已实现

- `NativeNavidromeSettings` 保存独立 `navidrome.settings` Keychain 记录，沿用首次解锁后可访问、仅限本设备的保护策略。
  读取接口只返回地址、用户名、启用状态、是否有密码和连接版本，不返回密码或认证 URL。
- 保留密码中的空格／Unicode。切换服务器、服务器子路径或用户名时清除旧密码，除非本次明确提供替换值。
  缺少完整凭据时自动禁用；更换凭据生成新 scope，单纯启停保持 scope。
- 设置带 revision 和 scope 校验。Keychain 写入成功才提交新状态并取消待执行请求；保存失败不取消旧请求、不清除旧连接。
- 原生请求不依赖 WebView，限制两项并发、30 秒超时和 8 MiB 响应；支持精确请求取消、提前取消、父 Task 取消及连接变更取消。
  过期连接的结果不能返回当前调用方。
- 17 个只读操作：连通性、扩展、当前用户、音乐目录、许可证、专辑列表／详情、歌单列表／详情、随机歌曲、收藏、艺术家列表／详情、歌曲、两种歌词接口及搜索。
  固定操作与参数白名单；拒绝任意 URL、认证参数覆盖、其他用户查询、写操作、流地址与封面地址请求。
- 复用现有网络层隔离 Cookie、Authorization、其他服务密钥、缓存和重定向。
  HTTP／Subsonic 错误只返回稳定错误码，不回传可能回显凭据的服务端错误文本。
  明确区分认证失败、LDAP 不支持 token、权限不足、资源不存在及非法响应，不将它们转成空曲库。
- Capacitor 方法已注册并通过实际 WebView 调用检查；仍使用原有 `capacitor://localhost` 来源限制。

## 验证证据

本地证据目录：`.mobile-test-results/navidrome-transport/`。测试账户、URL 与响应均为受控样本。

| 验证 | 结果 | 范围 |
| --- | --- | --- |
| `npm run typecheck` | PASS | 新桥接类型及现有调用方 |
| 原 Navidrome／歌词／曲库 Vitest | 7 文件／60 PASS | 原版服务、歌词与资源行为；未请求真实服务 |
| Release 原生 build-for-testing | PASS | iOS 17 最低版本，独立 QA Bundle ID；TSan 关闭 |
| 首轮模拟器测试 | 28 PASS／1 FAIL | 被拒绝重定向的测试替身未结束响应，30 秒后超时；保留 `native.xcresult` |
| 修正测试替身后的完整组 | 30 PASS／0 skip | `native-final.xcresult`；iPad Pro 11-inch (M5)，iOS 26.5 模拟器 |
| 真实 Navidrome 服务／物理设备 | NOT_RUN | 无真实登录、曲库或音频证明 |

最终 30 项由 13 项新增 Navidrome、6 项同步、10 项 AI 请求回归，以及 1 项原流式播放重定向回归组成。
新用例覆盖真实 Keychain 保存／恢复、官方认证向量、原 `blueimp-md5` Unicode 向量、URL 编码、随机盐值、地址限制、密码更换、
保存失败、旧请求隔离、并发／取消、响应大小、错误分类、拒绝重定向及实际 Capacitor 桥接。
原有流式重定向用例验证测试替身的默认行为未受影响。

首轮失败只修正了 `ProfileHTTPFixture`：原替身仅模拟跟随重定向，拒绝后缺少 `didReceive`／结束事件。
新增可选的响应结束行为后，真实 URLSession delegate 拒绝跳转，目标端收到零请求，调用方得到 `navidrome-redirect-refused`。
没有放宽凭据、重定向或超时规则，也没有改写首次失败记录。

## 尚需完成

移动设置入口、原版服务的可注入 transport、曲库浏览、搜索、播放及账号退出联动尚未接入，
因此没有新增可点击但不可播放的 Navidrome 页签。
下一阶段必须先贯通服务器／账号 scope 与歌曲身份，再接原生队列、音频／封面／歌词缓存；
禁止把带认证参数的流 URL 持久化进歌曲或暴露给 WebView。
原版收藏／歌单编辑／scrobble 也需按既有行为单独接通，当前只读接口不替代这些功能。

Navidrome HTTPS 真实部署、真实服务器兼容性、系统挂起后的连续播放、设备温升与完整 Automix 真机验收继续标记 NOT_RUN。
现有个人 App、UI、动效、播放引擎与音效算法未变；`BUILD_RECORD.json` 保持原值。
回退此批源码不影响既有账户／曲库／设置；仅遗留独立 Navidrome Keychain 记录，当前没有生产界面写入它。
