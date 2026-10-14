<!-- SETTINGS_MODAL_ISOLATION.md — settings isolate covered controls without changing rendering or layout. -->
# 设置面板的背景交互隔离

2026-10-14；基线 `a62a98ad27fc1c98609608e4bcc7d98eada496ad` 加本批改动。
按 [当前范围](CURRENT_SCOPE.md) 完善设置与原版播放器交互，保留原全屏布局、材质和动画。

## 复现与实现

打开「服务器与外观」或「歌词与动效」，以及进入睡眠定时／主题编辑子页后，背景的库入口、迷你播放器、
返回／播放／下一首仍可通过 `HTMLElement.focus()` 获得焦点。遮罩只阻挡了普通触摸命中，
`aria-modal` 声明本身没有禁用这些控件，焦点导航仍可能进入被覆盖的操作。

复用移动端现有 `inert`，没有新增焦点管理库或自建弹窗体系：

- `MobileApp` 在设置开启期间禁用背景曲库和迷你播放器；退出整层设置后恢复。
- `PlayerPanel` 将已有 `modalOpen` 状态传给 `PlayerChrome`，禁用被设置覆盖的标题栏与播放控件。
- 子页沿用原设置状态，因此切换子页不会暂时解禁背景。原有控制器隐藏、更多选项原生dialog和关闭行为保留。

没有CSS、渲染器、歌词／音乐算法、默认值、数据格式或生产依赖变更；未扩展本地曲库或其他平台。
这修复的是背景焦点可达性，不代表已实现或验证所有弹窗的完整焦点循环、自动焦点恢复或屏幕阅读器行为。

## WebKit验证

新增 `settings-modal-isolation.spec.ts`，复用已有QQ／网易云合成歌曲与原版Classic渲染器。
通过浏览器实际focus行为验证背景不可聚焦，进入子页再返回仍受保护，关闭后播放按钮可聚焦且触摸可播放。

| 阶段 | 结果 | 范围 |
| --- | --- | --- |
| 修复前 | 手机4项FAIL，36条背景focus断言 | 两平台各设置／动效两条流程；无其他失败 |
| 修复后第一批 | 33 PASS | 新增12个窗口场景、设置布局15项、主题返回6项 |
| 控制器与字号回归 | 27 PASS | 隐藏／唤回、拖动与取消、旋转、减弱动态、键盘唤回、Classic／心象字号触摸 |
| 静态与打包 | PASS | 类型检查、移动资源构建、Capacitor拷贝、原生构建及QA签名校验 |

最终60个WebKit用例覆盖手机390×844、平板1194×834、窄窗口600×834；两批文件不重叠，无跳过或再次重跑。
抽查手机通用设置与平板动效设置截图未见新裁切；这不是完整主题或视觉验收。旧动效生命周期失败记录未修改。

## 原生模拟器补验

给已有 `testPackagedSettingsReturnAndCacheRetryPreservePlayback` 增加背景focus断言和附件字段。
在实际WKWebView中尝试聚焦背景元素；原有设置草稿返回、缓存保存／失败重试、真实Capacitor与PCM继续验证。
同一唯一XCTest在iPhone 17 Pro／iPad Pro 11-inch（M5）模拟器各 **1 PASS、0失败／跳过**，没有重跑。

| 观测 | iPhone | iPad |
| --- | --- | --- |
| 系统／构建 | iOS Simulator26.5（23F77），arm64 Release | 同左 |
| 设置背景焦点隔离检查点 | 8（两平台各4） | 8 |
| 真实PCM／播放位置检查点 | 10 | 10 |
| 每检查点最少帧／声道 | 19200／2 | 19200／2 |
| 最小RMS | 0.1248266265 | 0.1248270372 |
| 450ms检查窗最小位置推进 | 0.4479818594秒 | 0.4480045351秒 |
| 捕捉到的页面异常／已挂载画布GL丢失 | 0／0 | 0／0 |

每个平台5个设置阶段中，应用设置回到歌词页的一阶段没有遮罩，不进行背景禁用断言。
共享辅助函数的准备阶段不重复计为新增用例；真实音频为生成样本，不是QQ／网易云CDN或账号验证。

独立包 `app.folia.validation.App`，标签沿用 `0.7.16-mobile.28`，构建记录为上述源码基线加本批更改。
128个前端资源在dist、Capacitor、Xcode产物和QA包中一致；272个选定原生源码／项目／锁文件在测试后与清单一致。
证据目录 `.mobile-test-results/settings-modal-isolation/` 保存WebKit日志／截图、构建与签名、包与资源清单、
两端xcresult／摘要／附件、`metrics.json`；最终提交、CI与进程清理保存在 `delivery.json`。
WebKit用 `npm run test:mobile:ui -- <测试文件> --output <证据目录>`，原生用已记录JSON参数的
`xcodebuild test-without-building`，均由 `codex-bounded 600` 限时执行；没有驻留开发服务器。

## 验收边界与回退

**NOT_RUN**：VoiceOver、真实硬件键盘、物理设备触摸／多任务、iOS17运行时、真实账号与CDN、
后台长播、歌词误差≤150ms、长期动效／内存／温升。原生操作由JS触发实际页面处理器，不能替代人手验收。
个人mobile.28和服务器未更新；根README、依赖和个人构建记录保持不变。
回退三处移动组件的inert接线即可，无持久化数据迁移。
