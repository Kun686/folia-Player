<!-- LIBRARY_KEYBOARD.md — actual WKWebView keyboard observations and separate offline geometry regression. -->
# 曲库与队列搜索键盘避让

2026-10-14，基线 `7d51e6ee50868e45031e8c9222c5223f3413fa0b` 加工作区修改。
承接真实 QQ／网易云与全部移动 UI 对齐检查。本批没有新增依赖，未扩展本地音乐或其他平台。

## 实际问题与改动

在独立 iPhone 模拟器的真实 51 首队列中点击搜索，WKWebView 会平移可视区域：
原曲库仍占布局视口的完整高度，FOLIA 标题及设置按钮进入状态栏，结果被键盘遮挡。
软件键盘和只有硬件键盘附件栏时都观察到这一位移，见 `before-native.jpg`。

复用已有 `useSheetViewport` 的 VisualViewport、每帧事件合并和清理，
将曲库滚动区域固定在可视区域内，并保留顶部／横屏侧边安全区。
搜索输入期间暂时收起迷你播放条，让搜索结果使用键盘上方空间；离开输入或键盘收起后恢复。
输入框在键盘开启／旋转时向上滚动，内容较少时以实际滚动末尾为限，不增加空白填充。
正常列表滚动没有新增监听，也没有 React 高频状态更新。

生产改动仅 `src/mobile/useSheetViewport.ts` 与 `src/mobile/mobile-shell.css` 的本批差异。
设置页沿用原避让方式；全屏播放器、半透明控制器、渲染器、音频和歌词算法不变。
回退仅需撤销上述本批差异，无凭据／数据迁移；不要覆盖同文件先前的公共视觉对齐改动。

## 自动验证

新增场景位于既有 `test/mobile-ui/sheet-viewport.spec.ts`，复用桥接和受控 VisualViewport。
检查手机／iPad／窄 iPad 的曲库及队列搜索、视口平移、安全区、130px 键盘区域、
查询保留、迷你播放条恢复、播放器尺寸和原队列／位置／播放命令不变。
这些歌曲样本只在 Playwright 离线回归中使用，从未写入已登录模拟器。

| 检查 | 结果 |
| --- | --- |
| 初次安全区修复：三组 WebKit 回归 | 39 PASS／6 SKIP；跳过的是已有精确手机尺寸场景在 iPad 上的重复执行 |
| 加入搜索向上滚动后 | 36 PASS／3 FAIL／6 SKIP；新断言要求短队列的输入框也必须到最上方，但滚动已到末尾 |
| 明确滚动边界后，仅重跑 viewport 文件一次 | 16 PASS／2 SKIP；允许到达实际滚动末尾，仍要求整个输入框在安全可视区域内 |
| 最终唯一用例覆盖 | 39 PASS：16 个 viewport、21 个队列操作、2 个多尺寸深浅布局；不累计重复执行 |
| `npm run typecheck`、`git diff --check` | PASS |
| `npm run build:mobile`、Capacitor copy、Xcode Release build-for-testing | PASS；原生只构建，未重跑之前失败的 PCM XCTest |
| dist-mobile／Capacitor／原生 App 资源 | 128 份逐项一致；`manifest-final.json` 记录源码与二进制 SHA256 |

证据目录 `.mobile-test-results/library-keyboard/`：`ui.log`、`ui-final.log`、`ui-corrected.log`、
`alignment-assertion-artifacts/`、`typecheck-final.log`、`web-build-final.log`、`cap-copy-final.log`、
`native-build-final.log`。日志中的离线歌词请求失败属于几何样本未配置歌词，不代表平台请求或歌词验收。

## 真实模拟器观察

只原位更新 `app.folia.validation.App`，iPhone 17 Pro／iOS 26.5，
UUID `9213032A-657A-40CD-BD2A-A3065ACCC8EC`。生产入口，无样本注入、QA 启动参数或凭据读取。

- 最终安装后 QQ／网易云账号与真实个人歌单可见，队列仍为 51 首。
- 实际软件键盘展开后，队列输入框和《莫愁乡》《记忆回溯》等真实队列行同时可见，
  状态栏不再与页面标题／设置按钮重叠，见 `queue-portrait-final.jpg`。
- 点击软件键盘按键输入 `Power`，旋转横屏再指定正常竖屏，文字保持、输入框完整，
  见 `queue-landscape-final.jpg`。当前队列显示 0 首匹配；这是队列内过滤，不是 QQ 或网易云在线搜索请求。
- 清除筛选后键盘收起、完整曲库与迷你播放条恢复，队列数量保持 51；没有新增、删除、重排歌曲。
- QQ 曲库搜索框进入同一键盘布局，真实个人歌单仍在可见区域，见 `qq-catalog-keyboard-final.jpg`；没有提交新在线查询。
- 返回 QQ《我怀念的》后，封面／绘光歌词／全屏半透明控件正常显示，仍暂停在 0:19，
  见 `qq-player-final.jpg`。本轮没有播放音频或采样 PCM。
- 直接 CUA 文本粘贴仍未输入中文，且收起了软件键盘；停止重复该输入路径。
  软件键盘按键路径已实际输入文字，不能把粘贴工具限制判为 App 输入故障。

本批独立模拟器留在 QQ《我怀念的》暂停 0:19、正常竖屏；个人 mobile.28 与服务器未更新。

## 仍待验收

本批 iPad 原生键盘、真机、浮动键盘、VoiceOver、全部子页与主题仍 NOT_RUN，
不能将三个 WebKit 窗口或上述 iPhone 模拟器观察视为完整 UI 验收。
QQ 在线搜索间歇失败、真实 PCM、网易云长时间锁屏、耳机／蓝牙／网络切换、歌词精度和长期性能未在本批补验。
先前 iPad 动画 QA 音频失败及 WebContent 增长问题保持未解决。
