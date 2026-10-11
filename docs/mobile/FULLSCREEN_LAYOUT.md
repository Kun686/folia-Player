# 全屏播放布局

用户在 mobile.16 真机试用后明确要求桌面版的全屏歌词体验；该反馈取代此前手机横屏分栏和 iPad 曲库／播放双栏方案。
播放器在所有窗口尺寸覆盖完整窗口，曲库为独立页面。原 `VisualizerRenderer`、歌词时间、主题、音效、队列和平台接口继续复用。

- 竖屏：顶部小封面、歌名与返回／更多按钮；底部悬浮进度和播放控制，主体留给原歌词与动画。
- 手机横屏：进度与按钮排列为更矮的一条悬浮控制条；iPad 播放页同样全屏。
- 控制层使用安全区内缩，动画背景延伸到屏幕边缘。缩小后不改变歌词画布尺寸。
- 正在播放且无操作三秒后缩小淡出。拖动期间、暂停、错误、设置弹窗和键盘焦点保持控制可见。
- 隐藏时首次触摸仅唤回控制，不向下层歌词传递跳转操作。队列按钮返回独立队列页面。
- 音量、ReplayGain、音效、歌词编辑／导入和视觉设置归入「更多播放选项」，原功能保留。
- 减少动态效果时只淡入淡出；减少透明度或增加对比度时使用实色控制层。

实现入口：`src/mobile/PlayerChrome.tsx`、`PlayerPanel.tsx`、`mobile-player.css`。
自动隐藏事件与计时从桌面 `usePlayerChromeAutoHide` 提取为 `src/hooks/usePlayerChromeActivity.ts`；桌面模式和偏好策略不变。
没有新增 npm／SPM 依赖，没有改动原动画和平台播放规则。

回归覆盖 `test/mobile-ui/chrome.spec.ts`、`layout.spec.ts`，以及原歌词、音效、队列、导入／导出用例。
Playwright 原生桥使用受控样本；实际模拟器和个人设备的结果分别记录在 `VALIDATION.md`，不相互代替。

桌面遗留问题：React StrictMode 初次挂载会重复执行偏好同步，使保存的 `always-hidden` 变成 `always-visible`。
该问题在未改动的 `958c89c` 上复现，和本次提取后的行为相同；移动端不使用这段偏好策略。
`test/component/playerChromeIdle.spec.ts` 保留预期失败以追踪它，不能把该项算作功能通过。
正常模式切换、拖动／取消、窗口外释放和卸载清理另有通过用例。
