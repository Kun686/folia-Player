<!-- VISUAL_SETTINGS_RETURN.md — preserve the existing appearance form across theme navigation. -->
# 歌词与动效设置返回恢复

2026-10-14；源码基线 `c2771754f8aa1a8c757855d8939e2a22983404ea`。
按 [当前范围](CURRENT_SCOPE.md) 继续原版动效与设置联动，不扩展本地音乐或其他功能。

## 问题与修复

在「歌词与动效」输入尚未应用的外观 JSON／短码、展开通用设置，然后进入 Theme Park 再取消返回，
原父表单被卸载重建，输入变为空白、展开分组被关闭。既有返回测试只覆盖默认收起的表单与滚动位置。
QQ、网易云受控歌曲各一项手机 WebKit 测试均复现草稿与展开状态丢失。

复用原表单、配置 store、编解码与渲染器，将父表单保留到本次设置会话结束：

- 子页打开时用 HTML `hidden`／`inert` 隐藏父层；补充 CSS 避免已有 `display: grid` 覆盖隐藏语义。
  可访问树只保留当前子页对话框，父层不接受触摸或键盘操作。
- 返回时保留草稿、原生 `details` 展开状态及滚动位置；仍须点击「应用外观配置」才应用草稿。
- 关闭整层设置后仍卸载表单，再次打开不会保留上次临时输入或分组状态。
- 原主题编辑页仍按原流程挂载／卸载；已有另一子页入口沿用相同父层隐藏机制，未扩展其功能。

生产修改仅 `src/mobile/VisualSettings.tsx` 与 `src/mobile/mobile-settings.css`。
没有增加依赖、配置格式、动画循环或高频 React 状态。保留的是设置控件；播放器在设置期间停止视觉渲染的
逻辑未变。全屏布局、半透明控制器、动画／歌词算法、桌面与 Web 入口均未修改。

## 实际验证

证据目录：`.mobile-test-results/visual-settings-return/`。

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| 修复前 | 2 FAIL | 手机，两平台均丢失草稿与展开状态；日志／截图保留 |
| 修复后新增 | 6 PASS | 两平台 × 手机 390×844、平板 1194×834、窄窗口 600×834 |
| 既有回归 | 42 PASS | 三窗口的字号触摸、随机动画、减弱动态效果、布局／旋转／返回及三语言可操作性 |
| 类型检查 | PASS | `npm run typecheck` |
| 原生容器／真实账号／物理设备 | NOT_RUN | 受控原生桥和在线歌词缓存样本，无真实音乐服务或音频解码 |

最终共48个窗口用例，0失败、0跳过；修复前重复用例不累加。新增用例还验证子页仅一个可访问对话框、
未提前应用草稿、返回后显式应用成功、旋转后展开状态保持、关闭设置后原歌词可见、没有额外播放命令、
重新进入设置会话清除临时表单状态。新增两平台用例均未捕获 `pageerror`。
既有测试日志里的 QRC 解压警告保留，不把通过断言等同于所有控制台消息为空。

使用已有 Playwright 管理 Vite 的启动和关闭；所有命令均以 `codex-bounded` 限时：

```sh
npm run test:mobile:ui -- test/mobile-ui/visual-settings-return.spec.ts --project=phone
npm run test:mobile:ui -- test/mobile-ui/visual-settings-return.spec.ts test/mobile-ui/settings-layout.spec.ts test/mobile-ui/font-size-touch.spec.ts test/mobile-ui/random-visualizer.spec.ts test/mobile-ui/motion-preferences.spec.ts
npm run typecheck
```

提交身份、对应 CI、源码／证据哈希与进程清理结果封存在同目录 `delivery.json`。
本次未重跑旧动效生命周期失败矩阵，未执行 Xcode 构建、个人 App 安装或服务器部署。
个人 App 保持 mobile.28；最新源码的真实账号、真机操作、网易云30分钟锁屏、实际系统挂起、
耳机／蓝牙／网络切换、歌词精度与长期动画性能仍待验收。回退两处生产修改即可恢复旧行为，无数据迁移。
