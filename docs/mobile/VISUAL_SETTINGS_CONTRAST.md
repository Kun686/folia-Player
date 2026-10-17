<!-- VISUAL_SETTINGS_CONTRAST.md — actual mobile settings contrast defect and scoped verification. -->
# 动效设置的文字对比与卡片背景

2026-10-14，基线 `7d51e6ee50868e45031e8c9222c5223f3413fa0b` 加工作区修改。
承接 [均衡器布局](EQUALIZER_MOBILE_LAYOUT.md)，只继续两平台核心与移动 UI 对齐；没有新增依赖。

## 发现与修复

在已登录的独立 iPhone 模拟器，从真实队列《爱爱爱》（方大同）的暂停播放器进入「歌词与动效」，
发现绘光的前景散景、线稿等标签接近背景色。共享设置把次要文字颜色乘以低透明度；
WebKit 复现的标签对比度为深色 1.70、浅色 2.29，均低于普通文字 4.5 的检查标准。
另发现移动入口给 `controlCardBg` 传了 Tailwind 类名，而共享组件将其用作 CSS `backgroundColor`，值无效。

最简方案复用已有移动颜色变量与原设置组件：

- `src/mobile/mobile-settings.css` 为该面板绑定主／次文字变量，将指定低透明度文字类改为移动次要文字颜色。
  选择器要求文字字号／等宽类，排除按钮和表单控件；不覆盖禁用容器、图片或歌词画面透明度。
- `src/mobile/VisualSettings.tsx` 给原模式和背景设置传入有效的 CSS 颜色变量，使卡片背景与其他设置分组一致。
- 同包包含 [QQ 缺失列表的错误分类补修](QQ_SEARCH_LIVE_DIAGNOSIS.md)：复用现有 invalid-response 分类与提示。

没有改动渲染器、歌词算法、主题数据、音效或动画参数。桌面不加载移动样式。
回退只需撤销本批移动 CSS 规则与两处背景参数；不要整文件还原覆盖此前设置分组和键盘修复。

## 检查与证据

证据 `.mobile-test-results/settings-live-followup/`，QQ 分类逻辑证据另在 `.mobile-test-results/qq-search-response/`。

| 检查 | 结果与边界 |
| --- | --- |
| 对比度修复前 | 手机深、浅两例 FAIL，`contrast-red.log`；没有歌曲样本或实际平台请求 |
| 设置 WebKit 回归 | 21 PASS：手机、宽平板、窄平板各 7 例；包含深浅文字对比度 ≥4.5、固定关闭入口、旋转、返回滚动及三语言窄屏；`webkit.log` |
| QQ 分类逻辑 | 修复前 11 FAIL／21 PASS，修复后相关三组 117 PASS；仅协议边界回归，不能证明 QQ 搜索稳定 |
| 类型、移动构建、Capacitor copy、diff 检查 | PASS，`typecheck.log`、`build.log`、`copy.log` |
| 包身份与安装 | `app.folia.validation.App`，128 资源在 dist-mobile、Capacitor、暂存 App、已安装 App 相同；`manifest.json` 保存哈希 |
| 原生编译、XCTest、PCM、本轮听感 | NOT_RUN；复用此前 Release 原生二进制，替换资源并重新临时签名，深度签名校验通过 |

## 实际独立 iPhone 模拟器观察

设备 iPhone 17 Pro / iOS 26.5，`9213032A-657A-40CD-BD2A-A3065ACCC8EC`。
包版本字段仍为 0.7.16 / 28，以 `manifest.json` 区分本轮资源和个人 mobile.28。

- 更新后网易云账号、歌单与 51 首队列保留；QQ 切换后也显示已登录账户及真实歌单。
- 《爱爱爱》保持暂停 1:53，绘光歌词恢复；本轮没有启动歌曲播放，没有注入样本歌曲或测试 transport。
- 标签、说明及卡片背景修正已观察：`dark-labels-before.png` → `dark-labels-after.png`。
  横屏布局、固定关闭入口、正常竖屏恢复及关闭后播放器均已观察。
  `dark-landscape-after.png` 为 simctl 原始设备方向截图，查看时需按屏幕方向理解，不是布局侧转故障。
- 真实浅色面板本轮 NOT_RUN；深浅自动对比度通过不替代全部主题的实际观感验收。
- 收尾保留暂停 App，PID 10919；截图 `netease-session-after.png`、`qq-session-after.png`。
  临时镜像和浏览器页已清理，iPad 的连接输入表单保持原状。

## 尚未覆盖

QQ 间歇业务码 2001 的根因和稳定性、新错误分类的真实失败页面、iPad 真实账号与新版全套 UI、
新版真机／NetEase 30 分钟锁屏、耳机／蓝牙／网络切换、歌词精度和长期动画性能均未完成。
此前 iPad 音频断言失败和 WebContent 内存增长仍保留。个人 iPhone 包及服务器未更新。
