# 在线专辑与歌手浏览移植

## 范围与复用

本轮按用户要求继续不依赖真机的工作。个人 App 保持 mobile.28；不安装、不重启手机，
未部署服务器变更，未增加依赖，也未修改全屏播放器、歌词动画或音效设置。

从现有歌曲操作菜单打开歌曲所属的专辑或任一歌手，浏览热门歌曲与全部专辑，
进入专辑后播放、下一首播放或加入队列；原在线收藏动作仍保留。支持返回上一级、关闭、
失败重试及手机横竖屏／iPad 窗口尺寸。热门歌曲数量沿用原版的 10 首。

- `catalogRefs` 解析原平台规范标识。混合队列以歌曲来源路由，不依赖当前平台标签；
  QQ 缺失目录元数据时仍通过原 `/getSongInfo` 补齐 mid，不能拿数字 album/singer ID 代替。
- `Library Core` 的 artist／collection resource 继续持有分页、去重、缓存和取消代次。
  歌手专辑每页 50 张，失败从原 offset 重试；页面关闭／切换会销毁资源，晚到结果不更新内容或缓存。
- 复用已有 SongList、react-window、Omni、移动会话与原生队列桥。原生播放接口没有变化。
- 相邻页面内容与解析目标绑定，避免新标题短暂显示旧列表。嵌套歌曲菜单关闭不关闭目录页。
- 网易云目录错误码和缺失列表、QQ 缺失目录列表改为结构化失败；有效空数组仍是空结果。
  原公共业务方法行为仅在错误响应时收紧。目录加载／分页日志不打印可能带会话的上游错误对象。

## 网关兼容

`/mobile/health` 增加可选 `catalogProviders`，仅公布已启用的 QQ／网易云。
旧网关缺少该字段时，目录按钮禁用并提示检查连接或更新服务器；原有歌曲搜索、歌单和播放保持兼容。

新增 GET 只读路由：

| 平台 | 路由 | 标识与分页 |
| --- | --- | --- |
| 网易云 | `/album`、`/artist/detail`、`/artist/songs`、`/artist/album` | 正整数 id；原 limit／offset |
| QQ | `/getAlbumInfo`、`/getSingerHotsong`、`/getSingerAlbum` | query 中的 albummid／singermid；热门歌曲 page 为页码，专辑 page 为 offset |

保留 Bearer 认证、固定内部服务、禁止重定向／代理参数／POST body 的约束。
新增目录查询限制 limit 1–1000、offset/page 0–10000，并校验标识；网关认证头不转发。
部署时按既有移动网关流程更新固定源码／镜像，再验证 health 能力；本轮没有操作线上服务。
回退前一网关与 App 资源即可，未涉及凭据或曲库格式迁移。

## 验证

2026-10-14 后续真实验证见 [LIVE_ONLINE_CATALOG.md](LIVE_ONLINE_CATALOG.md)：目录专用网关补丁已上线，
七条正式HTTPS真实路由通过，独立iPhone真实QQ／网易云导航已观察，并修复返回歌手页标签重置。
下表为初次实现的历史结果，其NOT_RUN不能覆盖后续证据；真机和目录发起的实际播放仍未补验。

本地证据目录：`.mobile-test-results/online-catalog/`。

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| TypeScript | PASS | `npm run typecheck` |
| 单元／provider／网关／原分页资源 | 618 PASS | `unit-final.log`，63 个文件；包含全部 mobile 单元测试 |
| 新目录 WebKit 流程与原歌单回归 | 27 PASS | 手机 390×844、iPad 1194×834、窄窗口 600×834；受控接口 |
| 页面切换身份绑定复核后 | 18 PASS | 同一新目录套件，包含上述用例，不与 27 项相加 |
| 生产移动 Web 资源构建 | PASS | `npm run build:mobile`；没有生成或安装新 IPA |
| 新目录真实 QQ／网易云接口 | NOT_RUN | 测试数据不替代上游验收 |
| 新入口原生容器／物理 iPhone／物理 iPad | NOT_RUN | 本轮无 Xcode 或设备操作 |
| 服务器部署／个人包更新 | NOT_RUN | 现有服务及个人 mobile.28 未更新 |

WebKit 覆盖 QQ 规范 mid／混合队列来源、歌手专辑第 51 张及失败续页、专辑播放／队列身份、
嵌套菜单与返回、旋转边界、登录错误与空列表区分、关闭期间晚到响应、旧网关提示。
QQ 初轮 fixture 误用了 `album_mid/album_name`，与原 adapter 实际支持字段不符，导致目录为空；
保留失败证据后按既有真实响应样本改为 `albumMID/albumName`，没有为测试放宽生产解析。

与此前本地 dist-mobile 比较，未压缩 Web 资源增加 36,227 字节，详见 `bundle-size.json`。
这不是 IPA 或原生二进制体积测量。构建仍有既有大 chunk／混合静态动态导入提示，未为此改打包策略。

本功能不表示完整移植已交付。完整 Automix 已在独立模拟器验证原模型到实际分轨交接，
手机联合负载与温升仍待设备条件允许后验收，当前状态见 [MEL_PREPARATION.md](MEL_PREPARATION.md)。
