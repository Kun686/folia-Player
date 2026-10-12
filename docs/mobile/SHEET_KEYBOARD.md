# 移动弹窗的软件键盘与旋转

2026-10-13，实现源码 `46a5053b278e1792e11a196b04e591ac2baa8b58`。
修复移动弹窗在键盘出现、横竖屏切换后遮住当前输入框的问题。
本轮仅本地开发与独立模拟器 QA，个人 `app.folia.personal` 仍为 mobile.28，服务器未更新。

## 复现与修复

基线 `a1da564`，独立 `app.folia.validation.App`，iPad Pro 11-inch M5／iPadOS 26.5。
打开「AI 服务设置」，焦点放在模型输入框，显示软件键盘，竖屏后转回横屏：
输入框仍获得焦点但处于键盘下方；手动滚动才能找到，再旋转又会被挡住。
截图 `keyboard-rotation-baseline.jpg` 记录第二次横屏遮挡。

布局使用完整 layout viewport，键盘缩短 visual viewport 时原弹窗高度没有同步变化。
分词编辑器还有一个固定高度，默认 grid 轨道的内容最小尺寸会将容器撑开。

- 复用原有 `.sheet`、CSS Grid、浏览器 `visualViewport` 和 `scrollIntoView`，无新增依赖。
- `useSheetViewport` 在视口 resize／scroll 和焦点变化时，按事件合并到一次 RAF，
  更新弹窗专用的尺寸与偏移；仅在当前输入框越出面板时滚入可见区域。
  没有常驻逐帧轮询或 React 高频状态更新，卸载时移除监听、RAF 和专用样式。
- 明确 grid 轨道为 `minmax(0, 1fr)`；短可视区中的分词编辑器允许外层滚动，
  保留原编辑器、保存逻辑和词级时间。播放器画布不引用这些尺寸变量。
- 浏览器无 `visualViewport` 时沿用 CSS 原布局；非 1 倍缩放交给浏览器。
  实际捏合缩放、浮动／拆分键盘、iPad 多任务窗口及所有其他弹窗尚未纳入本轮原生矩阵。
- 保持 `ios.scrollEnabled: false`，没有改 Swift、播放引擎、背景或歌词动画。

## 已排除的干扰

前期在后台 Simulator 窗口拖动时观察到面板不滚动，曾尝试给整个 `.sheet` 添加 `pan-y`。
该候选没有改善；将 Simulator 置于前台后，原样式即可滚动。候选已撤销，
不能把这次输入投递问题写成 Folia 滚动缺陷，也未据此扩大此前主题生成区域的局部样式。

临时 Swift 探针只在独立 QA 环境下采样 45 次几何信息，不读输入值，不注册事件或修改页面。
键盘失败截图采集时采样已经结束；最终包彻底移除探针，283 个原生输入与上一轮一致。
探针文件归档于本地证据目录后从模拟器 Documents 移除。

## 自动检查

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| `npm run typecheck` | PASS | TypeScript 检查 |
| 新增 `sheet-viewport.spec.ts` | PASS，6 项 | phone／ipad／ipad-narrow，受控可视高度、焦点、旋转、偏移、恢复高度和播放器尺寸不变 |
| `segmentation.spec.ts`、`font-size-touch.spec.ts`、`layout.spec.ts` | PASS，27 项；6 项按原规则跳过 | 原保存／恢复／错误、字号触摸、明暗主题旋转；短窗口／旋转重复场景本就只在 phone 项目执行 |
| `npm run build:mobile`、`cap copy ios` | PASS | 移动资源构建、同步 |
| 独立 Release `build-for-testing` | PASS | 构建通过，不计为 XCTest 已执行 |
| 产物核对 | PASS | 125 个资源逐文件匹配 dist、同步目录和 App；QA Bundle ID 与构建源码身份正确 |

新增测试先在未修复的页面上捕获两处焦点遮挡。初始普通表单选择器写成「设置」，
实际标签为「服务器与外观」；修正选择器后仍在目标遮挡断言失败。
首次候选修正普通表单，但分词编辑器仍失败；约束 grid 轨道后通过。

扩展到 phone 时又发现测试夹具在 viewport meta 解析前冻结了 980px 初始宽度，
导致点击坐标越界。已改为在覆盖可视尺寸前使用实时 layout 尺寸，新增 6 项重新全过。
原有 27 项通过结果无需重复运行；不将失败批次与重跑数目累加。
这些 WebKit 测试明确注入可视高度，不代表真实系统键盘证据。

## 最终包原生交互

同一无诊断代码的 Release QA 包，通过 CUA 实际点击、拖动和系统软键盘操作：

| 模拟器 | 实际执行 | 结果 |
| --- | --- | --- |
| iPad Pro 11-inch M5／26.5 | 模型输入框：键盘出现、横屏→竖屏→横屏、输入及删除字符 | PASS，焦点可见，未保存 AI 配置或发起 AI 请求 |
| 同上 | 数字输入框；键盘打开时从留白滚到保存按钮；收起键盘 | PASS，底部操作可达，高度恢复 |
| 同上 | 通过系统 Files 导入原仓库合成 WAV 和增强 LRC，打开分词编辑框，输入字符，横竖屏切换、滚到保存按钮 | PASS，草稿与焦点保留；未将测试字符保存为歌词 |
| iPhone 17 Pro／26.5 | 模型输入框：竖屏→两侧横屏→正常竖屏，软键盘输入／删除字符，收起键盘 | PASS，输入可见、内容保留、高度恢复 |

iPhone 未启用倒置竖屏；模拟器单向连续旋转经过该方向时，App 沿用支持的方向，
不将这个系统方向限制报告为本次回归。iPhone 分词编辑器原生交互仍为 NOT_RUN。

QA 无音乐账户和网关连接。本轮分词保存／重启恢复、系统剪贴板往返没有新增原生证据；
这些项目继续沿用各自原有自动测试和待验收边界。没有访问真实 QQ／网易云、物理设备或线上服务。
真实设备键盘、多任务窗口、长期运行、温升和完整 Automix 联合负载均未据此通过。

## 证据与回退

本地 `.mobile-test-results/sheet-viewport/`：
`baseline.json`、`ui-red-corrected.log`、`ui-green.log`、`ui-grid-fixed.log`、
`ui-regression.log`、`ui-final.log`、`typecheck.log`、`final-build.log`、`final-native-build.log`、
`source.json`、`native-inputs.json`、`package.json`、`native-ui.json`、`cleanup.json`。
`final-ipad-*` 和 `final-iphone-*` 为最终无探针包截图，`probe-original/` 仅为早期几何诊断。

撤销实现提交即可回退这一 UI 修复，无数据格式变化，无需卸载、清缓存或重新登录。
独立 QA 已停止，两台模拟器已关闭。个人 `BUILD_RECORD.json` 的 SHA256 仍为
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。
