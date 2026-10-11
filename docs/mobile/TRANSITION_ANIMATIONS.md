# 原版混音动画的移动接线

2026-10-11，接续 [MASTER_AUTOMIX.md](MASTER_AUTOMIX.md)。开发源码阶段，尚未生成个人安装包。

## 复用与边界

- 复用 `AutomixTransitionAnimation`、`NowPlayingToast`、卡片原着色器、原设置 store 与 `transitionCue` 通道。
  无新增依赖。圆环和卡片保留各自开关、主题、减少动态效果、触摸退出、短过渡／普通淡化不绘制等规则。
- `PlaybackEngine.snapshot()` 发布原生音频渲染时钟提供的 `transitionCue`，没有过渡时明确为 null。
  同一混音 ID 保持不变，时间取原生已输出样本数；暂停／取消清除。
- `nativeTransitionCue.ts` 只在新混音或前台恢复后广播一次，250ms 快照不重播动画。
  进入后台清理通道并卸载动画；回来重新读取原生快照，以已过时长接续，过期快照不会重播。
  空闲快照不会清除设置页的独立预览。
- 原 `announceTransition` 增加可选已过时长，默认仍为零。圆环订阅与卡片原有挂载逻辑都从通道读取进度。
  没有逐帧 React state 或新增网络请求。移动端只适配卡片在歌词区的定位及可用宽度。
- 不因此把完整 Automix 标记为已交付：歌词规划输入、模型分轨／表现手势和真实平台／长期真机验收仍待完成。
  本阶段保留过渡设置的现有能力限制，未开放完整 Automix 开关。

## 验证记录

证据在本机 `.mobile-test-results/`。

- `transition-cue-unit.log`：新适配器与原通道 21 项通过，涵盖中途恢复、重复快照、暂停清除、预览隔离、
  过期／非法数据和原短过渡／plain 绘制规则。
- `transition-cue-logic-full.log`：移动端与 Automix 共 38 个文件、496 项通过。
- `transition-cue-ui-fixed.log`：WebKit 的 iPhone／宽屏 iPad／窄窗口 iPad，动画专项 6 项通过。
  使用原生桥 fixture，不是实际平台或真机动画验收。隐藏页面测试通过可控的 visibility 事件模拟，
  不等于 iOS 真正冻结 WebView 的系统级证据。

失败及修正记录：

1. `transition-cue-typecheck.log`：新组件误从 `appPlaybackHelpers` 导入歌曲标识，改为已有的
   `appPlaybackGuards` 导出后，`transition-cue-typecheck-fixed.log` 通过。
2. `transition-cue-ui.log` 首轮 3/6 通过。两项手机测试遇到开发页面重载并丢失 fixture 队列，
   一项在原卡片滑入途中检查位置。移动 Vite 配置改为扫描 `mobile.html` 并提前优化已有动画依赖，
   布局断言等待入场后检查原边界；`transition-cue-ui-fixed.log` 一次重跑 6/6 通过，
   Vite 诊断确认启动扫描已找到全部使用的依赖，未继续运行时优化。
   首轮失败截图与上下文保留于 `transition-cue-ui-first/`。
3. 截图复核发现定位容器被左右约束撑宽，导致描边与卡片宽度不一致；修正移动端容器随内容收缩，
   增加描边容器与卡片同宽的断言。原着色器不变。
4. `transition-cue-ui-full.log`：播放器界面 33 项中 32 项通过；窄 iPad 音效用例在导入后立即点击，
   截图显示音效弹窗未打开。参照相邻已有用例，先等歌词加载去掉状态行、控件布局稳定，再点击并断言弹窗打开。
   `transition-cue-ui-placement.log` 一次重跑覆盖全部三个窗口的动画与该音效用例，9/9 通过（32.2 秒），
   包含卡片／描边同宽断言；截图和 trace 均保留。未延长测试时限或改变音效实现。

最终类型检查 `transition-cue-final-typecheck.log`、移动构建与 Capacitor 同步
`transition-cue-final-sync.log` 均通过。以上动画截图已经逐张复核手机和宽屏 iPad，
边框现在围绕卡片本身；三种窗口的布局断言均通过。

- 补充阻止恰好到期的 cue 在订阅回调中从零重播；`transition-cue-final-unit.log` 21 项、
  `transition-cue-ui-final.log` 三种窗口 6 项全部通过（24.7 秒）；`transition-cue-expiry-sync.log` 构建与同步通过。
- `transition-cue-native.log`／`.xcresult`：iPad Pro 11 (M5)／iOS 26.5 模拟器的相关 7 项全部通过，
  执行 3.508 秒。真实解码队列验证同一混音 ID 不变、两次快照的已过时长前进、暂停后的 cue 为 null，
  同时回归队列编辑、退出平台、拖动与状态恢复。
- `transition-cue-device-build.log`：独立 QA 构建与签名通过，核验测试配置和 entitlement 后使用
  `test-without-building`。`transition-cue-device.log`／`.xcresult`：iPhone XS Max／iOS 18.7.10，
  同一组 7 项全部通过，执行 3.984 秒。这是原生快照与队列验证，不是视觉同步误差或真机动效性能结论。
- `transition-cue-qa-uninstall.json`：QA 已卸载；`transition-cue-personal-app.json`：个人版仍为 build 10。
  `transition-cue-cleanup.json`：任务模拟器已关闭，18779／4179 无监听，未遗留构建或测试进程；
  原有 XcodeBuildMCP 和 Simulator 窗口进程保留。

QQ／网易云真实歌曲与账户、真正后台冻结 WebView 后继续混音、蓝牙／网络切换、真机动画听感／功耗、
150ms 歌词显示误差及长期 iPad 验收均未由这些受控测试证明，仍为 NOT_RUN。
