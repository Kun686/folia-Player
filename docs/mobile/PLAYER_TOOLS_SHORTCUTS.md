<!-- PLAYER_TOOLS_SHORTCUTS.md — stable mobile tool navigation and scoped real-account evidence. -->
# 播放工具入口固定与触摸检查

2026-10-14，基线 `7d51e6ee50868e45031e8c9222c5223f3413fa0b` 加工作区修改。
继续 [CURRENT_SCOPE.md](CURRENT_SCOPE.md) 的 QQ／网易云、动效和设置 UI；不扩展其他功能。

## 问题与最小修复

在 [真实歌曲绘光检查](LIVE_LUMIERE_RESOURCES.md) 中，滚动工具面板时曾误点官方歌曲外链。
这次代码检查发现一个可独立复现的位移来源：`OnlineSongLike` 从加载文字变为按钮／说明或错误／重试后，
会改变内容高度；原来同处滚动区底部的“歌词与动效”等导航按钮随之移动。
此结论不把此前所有滚动回弹与误点都归因于这一项。

WebKit手机视口受控复现：读取收藏成功后“歌词与动效”纵向移动23.203125px，失败后移动76px。
两例位置稳定断言均失败，RED证据保留；没有在真实模拟器中注入失败或样本歌曲。

复用原生HTML dialog、现有固定标题／滚动区域、原按钮与移动颜色／间距变量。
`PlayerChrome` 把常用入口放入独立底部 `footer`，`PlayerPanel` 只传入原按钮，
中间保留原音频、收藏与歌曲信息组件。底部入口不再参与中间区域的滚动与异步高度变化。
CSS仅作用于移动播放工具弹层，边距、分隔线和触摸尺寸沿用移动界面规范。

没有新增依赖、设置值或请求；未改变收藏权限、音乐／歌词算法、原动画、音效和桌面UI。
本批不尝试替换QQ搜索协议：已核对原版匿名Lite与已安装3.1.4旧接口，仍没有可靠替代路径，
未重复真实搜索失败探测，原稳定性未完成项保留。

## 验证

证据目录：`.mobile-test-results/player-tools-footer/`。

| 检查 | 结果与边界 |
| --- | --- |
| 修复前受控复现 | 手机2 FAIL，位移23.20／76px；`red.log`、`red-artifacts/` |
| 修复后WebKit | 54 PASS：手机、宽平板、窄平板各18例；其中新增6例覆盖加载成功／失败、滚动两端、横竖屏恢复、44px以上触摸命中和打开正确页面；`green.log` |
| 既有相关回归 | 包含在54例内：收藏读写／取消、设置关闭与返回、歌曲信息／外链，无重复累计 |
| 类型检查、移动构建、Capacitor copy、签名校验、diff检查 | PASS；相关日志在证据目录 |
| 安装身份 | 128资源在dist、Capacitor、暂存和已安装独立App匹配；已签名可执行文件与暂存副本一致，见 `manifest.json` |
| 原生编译、XCTest与PCM | NOT_RUN；仅前端变化，复用原Release二进制后重签名，不能把UI观察当作音频验收 |

命令：

```sh
"$HOME/.local/bin/codex-bounded" 600 -- npm run test:mobile:ui -- test/mobile-ui/online-likes.spec.ts test/mobile-ui/settings-layout.spec.ts test/mobile-ui/song-info.spec.ts
"$HOME/.local/bin/codex-bounded" 600 -- npm run typecheck
"$HOME/.local/bin/codex-bounded" 600 -- npm run build:mobile
```

没有为此运行无关全量测试。WebKit使用受控桥接以确定异步时序，只证明界面回归。

## 已登录 iPhone 模拟器

`app.folia.validation.App`，iPhone17Pro／iOS26.5，
UDID `9213032A-657A-40CD-BD2A-A3065ACCC8EC`。版本字段仍为0.7.16／28，
按本批资源清单辨别候选，不与个人mobile.28混淆。更新后PID81985。

- 真实歌曲《爱爱爱》／方大同恢复封面和绘光歌词，暂停位置仍1:53。
- 工具打开后直接显示底部三项入口。触摸滚动、真实收藏只读状态展示及展开歌曲信息后，入口保持原位置。
- 横屏仍完整显示固定入口，点击“歌词与动效”实际打开对应面板；恢复正常竖屏，关闭设置后歌词／控件恢复。
- QQ、网易云均显示已登录账号与个人歌单入口，51首队列保留；最终回到QQ曲库，保持暂停。
- 原生Simulator窗口的拖动／滚轮未产生可见滚动；随后改用已安装镜像的触摸操作完成验证。
  `native-tools-scrolled.png` 是未滚动成功的早期截图；实际滚动及信息展开使用 `native-tools-scroll-confirmed.png`。
  不把无效果的输入动作计作通过。

截图：`native-tools-top.png`、`native-tools-scroll-confirmed.png`、`native-tools-landscape.png`、
`native-player-restored.png`、`netease-session.png`、`qq-session.png`。
横屏simctl截图保留原生方向栅格，需按实际旋转方向查看，不将其误判为布局侧转。
模拟器镜像、浏览器临时页及测试服务已清理；App刻意保留运行。

## 未完成与回退

本批仅完成此工具面板修复，个人iPhone安装包与服务器未更新。
真实浅色全套UI、iPad真实账号／新版完整界面、真机触摸／VoiceOver、
QQ搜索稳定性、网易云30分钟锁屏、耳机／蓝牙／网络切换、歌词精度及长期动画性能仍待验收。
iPad按用户最新选择暂缓，不重复要求填写凭据。

回退只需将原按钮放回 `PlayerPanel` 的滚动子内容，撤销 `PlayerChrome` 的footer参数及对应移动CSS。
不涉及数据迁移、Keychain或服务变更；不要整文件回退覆盖之前的歌词错误恢复与UI修改。
