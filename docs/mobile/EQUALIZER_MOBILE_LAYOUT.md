<!-- EQUALIZER_MOBILE_LAYOUT.md — narrow-panel EQ layout and real-account simulator observations. -->
# 移动均衡器布局与真实界面补验

## 2026-10-14 补充检查（歌曲菜单修复包）

在已登录的独立 iPhone 模拟器中，网易云《莫愁乡》保持 19.7 秒暂停，
核对了音效面板的纵向滚动、全部效果参数和页末关闭入口。原生桌面鼠标操作没有送达时，
改用已安装的 serve-sim 0.1.48 转发触摸，随后正常滚动并关闭；没有据此修改产品布局代码。
镜像只绑定本机，页面及助手已在检查后关闭。

检查中有一次点击落在滚动回弹后的“动态压缩”滑块，将其从 0 改为 100%，
并按现有设置逻辑启用音效、写入自定义1。随后已恢复动态压缩0、水平预设、音效关闭，
原生持久值确认十段增益均0、其他当前效果为中性。自定义1原值未单独留快照，
因此不能证明该槽位与检查前相同；当前自定义1为中性值。个人iPhone没有操作或更新。

证据位于 `.mobile-test-results/live-effects-review/`：
`portrait-effects-bottom.png`、`effects-restored-zero.png`、`equalizer-flat-off-restored.png`、
`final-paused-player.png`、`final-state.json`、`cleanup.json`。
51首队列完整内容及顺序摘要与菜单批次一致，index0／19.7秒；本批没有播放、原生音频采样或构建。
这只是滚动与关闭的界面观察，不覆盖全部音效、全套设置UI、真机或长播。
后台切歌额外执行请求仍待确认，本次未运行。

2026-10-14，基线 `7d51e6ee50868e45031e8c9222c5223f3413fa0b` 加工作区修改。
继续 QQ／网易云、原版动效、全部移动 UI 对齐；没有新增依赖或扩展功能。

## 问题与实现

独立 iPhone 模拟器播放工具中的原十段均衡器使用至少 520px 的单行布局，
竖屏只露出前六段，其余频率需要横向滚动。真实页面见
`.mobile-test-results/ipad-live-ui/iphone-equalizer-before.jpg`。

复用 `EqualizerBandGrid`，仅增加两个布局标记；在 `src/mobile/mobile.css` 中按实际面板宽度排版：
窄面板五列两行，内容宽度达到 520px 后十列一行。保留 44px 滑块触摸宽度、原频率顺序与数值标签。
标题说明可换行，去掉移动端卡片内部的固定最小宽度。桌面样式、预设、保存流程、DSP 和歌词算法没有改动。

回退只需撤销上述组件的两个标记及移动 CSS 对应八行规则；不要整文件回退覆盖既有视觉对齐工作。

## 验证

证据目录 `.mobile-test-results/equalizer-ui/`。

| 检查 | 结果 |
| --- | --- |
| 既有 `mobile.spec.ts` 的音量／静音／原音效设置用例 | phone、ipad、ipad-narrow 共 3 PASS；预设、滑块、迟到 input、保存失败恢复均沿用原测试；`ui.log` |
| `npm run typecheck`、`git diff --check` | PASS |
| `npm run build:mobile`、Capacitor copy | PASS，`build.log`、`copy.log` |
| 打包及安装资源 | 128 份资源在 dist-mobile、Capacitor、暂存 App 与已安装 iPhone App 一致；`manifest.json` |
| 原生编译／XCTest／PCM | 本批 NOT_RUN；只复用上一批已构建的 Release 原生二进制，替换前端后重新临时签名并通过深度签名校验 |

测试第一次命令在启动前因证据目录不存在退出；建立目录后执行一次，测试本身没有失败或重试。
离线回归仅证明 UI 行为，未向已登录模拟器注入样本、测试 transport 或平台响应。

## iPhone 实际操作

- iPhone 17 Pro / iOS 26.5，`9213032A-657A-40CD-BD2A-A3065ACCC8EC`，独立包 `app.folia.validation.App`。
  原位更新后网易云账户、个人歌单和 51 首队列仍可见。
- 打开队列原有 QQ《我怀念的》（孙燕姿），封面、绘光歌词和暂停 0:19 恢复；点按播放后检查音效页。
  竖屏全部十段频率可见，`iphone-portrait.jpg`；横屏变为一行，滚动可查看十段标签和页末关闭入口，
  `iphone-landscape-bands.jpg`、`iphone-landscape.jpg`。
- 用 Simulator 菜单指定正常竖屏后，实际设备画面恢复五列两行，所有增益仍为 0，
  `iphone-portrait-return.jpg`。没有修改预设、增益或效果参数。
- 关闭音效页后实际歌词画面继续变化，见 `real-player-after-settings.jpg`。
  本轮未测 PCM、听感、歌词误差或连续播放完整性，不能把变化中的歌词判为这些项目通过。
- 收尾重新打开 App 使其恢复暂停，当前曲目为《爱爱爱》（方大同），网易云账户和 51 首队列仍显示，
  `netease-session-queue-final.jpg`。最终 PID 77699；没有清除会话或队列。

触摸操作复用已缓存 serve-sim 0.1.48。原生 CUA 点击没有立即送达时改用本地镜像触摸，
镜像事件实际生效后才记录结果。外部 Simulator 菜单旋转后镜像的外框方向未同步，刷新页面也未纠正；
直接原生窗口与设备截图确认正常竖屏，未将镜像方向问题当作 App 旋转错误。
镜像、临时浏览器页和日志助手均在收尾清理；App 保持暂停供后续检查。

## iPad 准备与未覆盖项

iPad Pro 11-inch (M5) / iOS 26.5 本轮已安装此前曲库键盘修复包，实际打开设置并滚动到连接／缓存分组，
记录于 `.mobile-test-results/ipad-live-ui/ipad-connection-before.jpg`。
这台模拟器没有服务连接或平台会话，已请用户经本机私密文件填写连接；未读取或复制凭据。
旧 QA 本地条目没有用于音乐验收，均衡器新包尚未安装到 iPad，以免打断待填写的连接表单。

iPad 新均衡器原生观察／真实账号、整套 UI、物理设备、QQ 搜索稳定性、退出清理、网易云 30 分钟锁屏、
耳机／蓝牙／网络切换、歌词 ≤150ms、长期动画资源与温升仍待验收。
此前 iPad 音频断言失败和 WebContent 增长问题未解决。个人 mobile.28 与服务器未更新。
