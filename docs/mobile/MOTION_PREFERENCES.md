# 原版动效偏好的移动入口

2026-10-13。原版「降低动态效果」已接入移动端「歌词与动效」，并统一浮动控制器与 CSS 的偏好读取。
本批仅修改源码和运行受控 WebKit 测试，个人 mobile.28、物理设备、真实账号和服务器未操作。

## 行为与复用

- 直接复用 `MotionReductionSettingsSection`、`useMotionSettingsStore`、`useReducedMotionFor`、
  原文案及 `data-reduce-motion` 属性。共享面板新增可选 `surfaceIds`；桌面省略时仍展示原六项。
  移动端展示实际使用的混音过渡、Monet 背景漂移、界面微动效，以及「跟随系统设置」。
- 保留原默认值：每项均为完整动画，跟随系统默认关闭。已有保存值继续生效，无设置迁移。
  系统减弱动画仅在用户选择跟随时参与；单项显式选择始终优先。被系统降级时显示原提示。
- `PlayerChrome` 改用原 `uiMicroMotion` hook，库列表／按钮／文件夹的 CSS 改读同一属性。
  降级时仍淡入淡出，但不缩放／位移；原弹簧参数、全屏布局、玻璃质感和点击隐藏／唤回不变。
  系统透明度／对比度适配保持原样，未与动效偏好混合。
- Monet 与混音圆环本来就消费原 store，无需改写 renderer。单独减少背景漂移不影响控制器；
  减少混音圆环装饰脉动仍保留真实进度弧线。设置只调整视觉表现，不发送播放、队列或音效命令。
- 触摸开关至少44px；沿用主题颜色与现有弹窗。无新增依赖、自研动画或音乐算法变化。

原 store 先改变内存状态、再写存储，写入失败会让页面表现与保存值分离。
已改为先保存再发布状态；共享面板捕获异常并提供中／英／印尼文错误提示，重试成功后清除。
正常保存语义不变；桌面共享入口也获得相同的失败保护。

这些是原版明确排除在外观短码／OBS／主题导入导出之外的个人无障碍偏好，继续遵守此设计；
没有为移植新增配置字段或覆盖他人设备偏好。桌面原有设置命令及其 surface 保留，
移动端提供触摸入口，不另建命令系统。

## 验证与证据

本地目录：`.mobile-test-results/motion-preferences/`；基线 `edb7e1d0f67cea0cf6ccf38ce8643d74d025bd75`。
`source.json` 保存实际源码摘要，命令分别保存在 `*-command.json`。

| 项目 | 结果 | 范围 |
|---|---|---|
| TypeScript | PASS | `typecheck.log` |
| 逻辑 | 42 PASS / 4文件 | 动效默认值、恢复、系统／单项规则、存储失败及原 store／命令／外观契约 |
| WebKit 主批 | 30 PASS | 新偏好9场景 + 原控制器21场景，`ui-fixed.log` |
| WebKit 圆环补充 | 3 PASS | 三窗口下实际进度绘制与装饰脉动区别，`ring.log` |
| 原生容器／物理设备／真实平台 | NOT_RUN | 无原生代码或接口变化，本批未安装 App |

WebKit 覆盖 phone、ipad、ipad-narrow，合计33个不同场景，不累加重跑。
检查触摸保存、失败保留原值、重载恢复、44px点击目标、横竖屏无溢出、运行中改变系统偏好、
实际控制器 transform、Monet 的实际 Web Animations 动画开始／取消及原混音圆环实际绘制。
原控制器回归覆盖自动隐藏、点击唤回、拖动与取消、暂停、错误、键盘聚焦及旋转时队列保持。
手机横屏与 iPad 竖屏截图已检查；原生桥使用受控 fixture，不能代替 iPhone／iPad 验收。

保留失败记录：`red.log` 的两项新存储失败用例在修复前失败、其余10项通过。
首轮 `ui.log` 为8通过、1失败、21未执行，因测试的「关闭」定位同时命中标题栏与原背景选项；
将定位限制为当前弹窗标题栏后，完整复测30项通过。没有为消除歧义改动产品文案或删除原按钮。

```sh
npm run typecheck
npm run test:unit -- test/unit/stores/motionSettingsStore.test.ts test/unit/stores/storeContract.test.ts test/unit/command-palette/commandRegistryContract.test.ts test/unit/obs/visualSettingsConfig.test.ts
npm run test:mobile:ui -- motion-preferences.spec.ts chrome.spec.ts
```

所有实际运行由有界 runner 记录 PID、日志并在60秒无输出时终止进程组。
最终提交 CI 的 vendor、TypeScript、移动逻辑及前端构建结果见本地 `ci.json`；不将 CI 当作原生验收。
`cleanup.json`／`completion.json` 记录临时服务退出、源码与最终状态。

## 回退与未完成项

撤销本批提交即可恢复原移动入口及控制器读取方式，原设置键兼容、无需服务迁移。
个人 `BUILD_RECORD.json` SHA256 保持
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。
真实设备的系统设置事件、升级恢复、动画流畅度／温升仍 NOT_RUN；完整 Automix 和整体移植验收仍未完成。
