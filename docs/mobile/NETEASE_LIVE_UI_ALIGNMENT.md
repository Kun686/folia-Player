<!-- NETEASE_LIVE_UI_ALIGNMENT.md — real account observations and the mobile library disclosure change. -->
# 网易云真实账号与曲库界面收拢

2026-10-14，基线 `7d51e6ee50868e45031e8c9222c5223f3413fa0b` 加工作区修改。
用户本人完成网易云扫码，授权代理操作独立模拟器。承接 [QQ 搜索诊断](QQ_SEARCH_LIVE_DIAGNOSIS.md)
及 [移动 UI 对齐](UI_ALIGNMENT_LIVE_QQ.md)。个人 mobile.28 与服务器均未更新，无新增依赖。

## 界面改动

真实网易云歌单加载后，私人 FM、收藏专辑、云盘和推荐功能的入口／服务版本提示占据首屏，歌曲位于底部播放器以下。
复用原组件与 HTML `details`，将这些辅助入口收进「更多音乐功能」，默认折叠；歌单与歌曲直接显示。
展开后仍显示原入口和能力限制，不把未部署功能伪装为可用。QQ 同样使用这一分组。
沿用公共字号、间距、卡片圆角和至少 44px 的分组触摸区域；没有改动接口、默认音质、歌词算法或渲染器。

修改位置：`src/mobile/MobileApp.tsx`、`mobile-shell.css`、`locale.ts`。
七份既有 UI 规格通过 `test/mobile-ui/music-features-navigation.ts` 展开入口后继续测试原行为。
没有增加测试专用歌曲到真实 App，没有写入或改动用户平台歌单。

## 真实使用观察

证据目录：`.mobile-test-results/qq-search-live-diagnosis/`。使用打包的生产 `index.html`，未注入测试 transport。
设备为 iPhone 17 Pro / iOS 26.5 Simulator，独立 Bundle ID `app.folia.validation.App`。
版本字段沿用 QA 的 0.7.16 / 28；必须以资源哈希区分个人包与各轮 QA 包。

| 项目 | 本次结果与边界 |
| --- | --- |
| 网易云登录与个人歌单 | 用户扫码完成，App 显示已登录账户及真实歌单；打开「喜欢的音乐」加载 50 首 |
| 真实网易云播放界面 | 从《莫愁乡》进入播放，随后观察到《记忆回潮》1:46→2:00，自动进入《玻璃》（大碗小面）；歌词与原动效更新。没有采集 PCM 或听感证据 |
| 暂停与跳转 | 《玻璃》暂停在 0:21，点按进度条后显示 1:30、歌词重新定位，截图 `netease-seek.jpg`。一次 CUA 拖拽未移动进度，拖拽手势本批未验收，不能用点按替代 |
| 手动下一首 | 《玻璃》→《陪我吃饭》，随后进度达到 0:21、歌词更新，截图 `netease-next.jpg` |
| 最终分组包安装 | 原位更新独立模拟器；QQ、网易云会话及 50 首队列保留。网易云歌单首屏可见歌曲，分组展开／收起正常，截图 `netease-library-after.jpg` |
| 跨平台队列 | 将 QQ《我怀念的》（孙燕姿）设为网易云《陪我吃饭》的下一首，队列增至 51；下一首进入 QQ，进度达 0:30；上一首回到网易云并达 0:51，两首歌名／封面／歌词对应。`mixed-qq.jpg`、`netease-landscape-final.jpg` |
| 旋转 | 最终包竖屏→横屏→正向竖屏，控制器保持覆盖，歌词重排后正常；短暂转场帧不当作稳定布局。截图 `netease-landscape-final.jpg`、`netease-portrait-final.jpg` |
| 网易云搜索 | 最终包查询 `Power`，返回 JordanBeats、Interrupt / Luna LePage 等真实结果；截图 `netease-search-final.jpg`。只证明此次请求 |
| QQ 搜索 | 前一包 `Power` 曾成功；两路真实诊断也出现过 2001，稳定性仍未通过，详见 QQ 诊断记录 |

暂停／下一首的首帧可能仍是准备状态；以上播放观察以随后推进的时间和歌词为依据，不将初始 0:00 当作播放成功。
模拟器中文键入未写入内容，改用实际歌曲英文查询；不是中文搜索接口失败的证据。

## iPad 与自动验证

iPad Pro 11-inch M5 / iOS 26.5 Simulator 使用分组前的同批 UI 包，巡检了设置的深色竖屏、
深色横屏、睡眠定时、浅色外观与连接／缓存区域，没有观察到裁切或重叠；截图为 `ipad-*.jpg`。
未配置该 iPad 的真实账号，未播放旧本地测试条目；未验证转回竖屏，未安装最终分组包。
这些观察不覆盖 iPad 真实音频或整套 UI。巡检后已关闭 iPad 模拟器。

| 自动验证 | 结果 |
| --- | --- |
| 最终分组类型检查 | PASS，`typecheck-layout-final.log` |
| 七份既有手机 WebKit 规格 | 46 PASS，`layout-regression.log`；受控接口响应，仅证明功能入口回归 |
| 最终移动构建／Capacitor copy／Xcode Release build | PASS，`build-layout-final.log`、`copy-layout-final.log`、`native-build-layout-final.log` |
| 最终包资源 | `bundle-layout-final.json`：128 个资源在 dist-mobile、Capacitor、原生 App 一致；两个额外空 Cordova 文件保留 |
| QQ 错误分类逻辑 | 前一阶段 116 PASS，见 QQ 诊断；本阶段未重复累计 |

## 未验收与回退

QQ 搜索稳定性及真实失败提示页面、两平台退出后清理、当前版本真机听感／长播、网易云 30 分钟锁屏、
耳机／蓝牙／网络切换、歌词 150ms 误差、完整 iPad UI 与长期动画内存仍待验收。
此前 iPad 音频断言失败和 WebContent 增长问题继续保留。当前网关未提供的 FM／推荐等功能仍不可用。

回退只需移除该 `details` 包装及相应样式／翻译／测试导航调整；不涉及数据迁移或服务部署。
不要整文件回退覆盖此前 QQ 错误分类、公共视觉对齐与 R3F 修改。
