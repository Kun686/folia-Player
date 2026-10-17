<!-- STARTUP_PLAYER_LIFETIME.md — catalog lifetime regression and separate real-account startup evidence. -->
# 启动与曲库切换不再取消播放器资源

2026-10-14，基线 `7d51e6ee50868e45031e8c9222c5223f3413fa0b` 加工作区修改。
承接 [真实播放界面与歌词重试](LIVE_PLAYBACK_FOLLOWUP.md) 的重开失败观察；本批只修复两平台核心流程，
保留现有全屏布局、半透明控制器、设置与原版动画。没有新增依赖或扩展其他功能。

## 原因与最小修复

`useProviders` 初始能力为空，异步 `health` 成功后 `useCatalog` 的 `connected` 从 false 变成 true。
这会重建曲库会话，旧 effect cleanup 原来无条件调用 `cancelProvider`。
该函数同时递增平台请求代次及全局歌词代次，正在恢复的歌曲封面／歌词因此失效；
歌曲身份没变时，播放器不会因为曲库能力更新而自动重新加载这些资源。切换曲库标签有同一问题。

复用 `catalogSession.dispose()` 的活动状态与请求代次，只丢弃离开页面的曲库结果，
不再在普通页面 cleanup 中撤销平台会话。真正退出账号、修改服务器连接、替换凭据的原有防护保留。
离开页面的已发送只读请求可以结束，但结果不能发布到旧页面；原生 gateway 请求有 20s 请求／25s 资源超时。
这是小范围生命周期修复，没有给所有取消增加自动重试，也没有放宽旧登录响应检查。

生产改动仅 `src/mobile/useCatalog.ts`，回退可恢复该文件原 cleanup，无数据迁移。

## 自动验证

新增 `test/mobile-ui/catalog-player-lifetime.spec.ts`，复用既有 native bridge、Omni 和平台响应样本。
精确暂挂歌词缓存与封面读取，在连接就绪／切换平台后再释放，检查歌词与封面加载、无错误，
队列／当前位置／播放意图不变，且没有配置、退出或播放命令。这些样本只用于离线回归，没有装入真实账号模拟器。

| 检查 | 结果 |
| --- | --- |
| 修复前手机最小复现 | 四项均 FAIL；两平台在连接就绪或曲库切换后缺少歌词 |
| 修复后第一轮 WebKit | 42 PASS／6 FAIL；六项均为网易云高亮 DOM 文本是「第第二二句句」，新断言误要求连续「第二句」 |
| 修正断言后定向复跑 | 12 PASS；允许原版前景／背景文字双层，仍要求对应歌词存在，未改变 renderer |
| 相关 UI 回归总覆盖 | 48 个唯一用例 PASS，包含上述 12 项及 36 项曲库分页、迟到响应、连接恢复、两平台退出清理；手机／iPad／窄 iPad WebKit |
| 定向 Vitest | 45 PASS：`catalogSession.test.ts`、`runtime.test.ts` |
| TypeScript／diff 检查 | PASS |
| 移动生产构建／Capacitor copy | PASS |
| Xcode Release build-for-testing | PASS；仅编译，没有重新执行真实账号 PCM XCTest |
| 安装包资源一致性 | PASS；128 份 dist-mobile／Capacitor／原生资源一致，见 `manifest.json` |

命令和原始输出保存在 `.mobile-test-results/catalog-player-lifetime/`：`red.log`、`green-ui.log`、
`corrected-ui.log`、`unit.log`、`typecheck.log`、`web-build.log`、`cap-copy.log`。
首次两轮失败截图分别保留在 `red-artifacts/` 和 `first-green-artifacts/`，不把测试断言失败隐藏为全绿记录。

## 真实账号与安装边界

本批仅更新 `app.folia.validation.App` 独立 iPhone 模拟器，不清除 QQ／网易云登录或真实队列。
设备为 iPhone 17 Pro／iOS 26.5，UUID `9213032A-657A-40CD-BD2A-A3065ACCC8EC`。
正常生产首页，没有 QA 启动参数、注入桥接、改写歌曲或读取平台凭据。

- 原位安装后，网易云账号／歌单和 51 首队列恢复。直接打开《陪我吃饭》，封面、歌词与绘光出现，
  暂停位置仍为 0:55；没有点击「重试歌词」或切歌促成此次恢复。见 `netease-startup.jpg`。
- 随后用原队列的上一首／下一首操作观察《玻璃》→《陪我吃饭》→QQ《我怀念的》，
  曲名、封面、歌词和进度随歌曲切换。此处只有界面观察，没有 PCM 或听感证据。
- 暂停 QQ《我怀念的》后终止并重开 App，直接打开播放器，歌词与封面自动恢复，暂停位置为 0:19。
  见 `qq-startup.jpg`；没有点击重试。切换 QQ／网易云曲库后返回播放器，仍是同一首与同一位置。
- QQ 账号和真实个人歌单重新展示；51 首队列数量保留。未新增、删除或重排队列，也未改平台歌单。
- QQ 真实歌曲竖屏→横屏→正常竖屏，保持全屏绘光与悬浮半透明控制器，未出现半屏控制面板。
  见 `qq-landscape.jpg`。最终模拟器停留在竖屏、QQ《我怀念的》暂停 0:19，供继续使用。

本次两次独立进程启动没有再出现原错误，加上离线时序反例和修复后的回归，支持该取消范围是一个已修复原因。
没有据此宣称所有平台网络失败已经消失。资源沿真实歌曲的正常缓存／服务链路加载，未强制清缓存，
因此不是每次都从上游重新下载的证明。个人 mobile.28 和服务器没有更新。

模拟器 UI 输入仍有工具限制：Mac 文本输入／粘贴未写入队列搜索框；部分控制器点击发生在隐藏／动画期间，
不能作为命令成功证据。后续使用固定迷你播放器暂停、可见控件切歌与原生触摸滚动完成检查，
未因这些操作尝试推断产品输入或播放故障。本批没有完成真实队列搜索输入验收。

真实双声道 PCM、QQ 搜索稳定性、完整 iPad 界面、当前版本真机和网易云 30 分钟锁屏仍待验收。
此前 iPad Diorama 的音频断续 FAIL、长期 WebContent 内存增长保持未解决；本批没有修改相关音频或动画算法。
