# 移动端 AMLL 歌词匹配

开发源码开放原版 AMLLDB 搜索、逐字歌词预览和保存。本地歌曲只更新歌词，保留歌名、歌手、
专辑及封面选择；在线歌曲沿用原缓存及替代来源字段，音频队列不重启。

复用原 `amllApi`、查询候选映射、TTML parser、两个匹配弹窗和存储事务。公开接口直接访问
`https://api.amll.dev`，原逻辑使用 `credentials: omit` 和 5 秒超时，不携带网关认证或平台 Cookie，
不新增依赖、代理或服务器配置。保留原失败策略：429/错误停止兜底搜索，不自动重试。
页面切换和关闭沿用已有代次／存储保护，公开只读请求仍按原 5 秒超时结束。

修复原共享预览只比较来源和数字 ID 的缺口：AMLL 的 QQ／网易云候选可使用相同数字 ID，
现将 `amllDbPlatform` 纳入预览身份，选中另一个平台时重新加载正确歌词。

## 证据与边界

证据为 `.mobile-test-results/amll-*`：

- TypeScript PASS；6 文件 54 项逻辑测试 PASS。
- 三种 WebKit 窗口：24 项不同用例 PASS，由 `amll-ui-final.log` 中18项及
  `amll-corrected-assertions.log` 中6项组成。覆盖本地元数据保护、在线保存失败重试、离线恢复、
  平台身份、429不重试、旧搜索隔离，以及原 QQ／网易云本地匹配回归。
- 首轮3失败、1中断、5通过，测试样本缺 TTML `itunes:key`、本地元数据 `artists`，并误用另一处空列表文案；
  第二轮18通过、6失败，断言混淆在线 `matchedSongId` 与本地 `matchedLyricsSongId`，且空列表文案仍错误。
  保留所有日志及错误快照；修正测试输入和断言后，单独验证这6项通过，没有为测试修改产品语义。
- `FOLIA_AMLL_LIVE=1` 的公开接口专项1项 PASS：Mac WebKit 使用真实原版搜索与 TTML parser，
  两次实际 HTTPS 请求，不带 Cookie／Authorization，得到非空逐字歌词。
  该项使用替代原生桥启动前端，不代表 iPhone App 真机验收。
- curl 带 `Origin: capacitor://localhost` 收到200及 `Access-Control-Allow-Origin: *`；
  仅证明服务当前允许该来源，不能代替 WKWebView 真机操作。

个人 App 保持 mobile.28，未更新或重启。真实账号歌曲匹配、实体 iPad、手机新入口验收仍 **NOT_RUN**。
撤销本阶段提交可恢复原入口；已有缓存格式无需迁移。
