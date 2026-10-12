# 移动端动画运行时修复

按“先继续不依赖真机的工作”完成；基线为 `b0a883d4d87176f6ed00a01f82f982cb3d5dac69`。
本批仅修改两处原版渲染实现及回归测试，没有新依赖、设置迁移、服务端或原生播放改动。
个人安装包未更新；完整移植与 Automix 真机联合负载验收仍未完成。

## 原因与最小修复

- **Tilt**：切换模式时，`useInsertionEffect` 立即调用歌词分段处理器，处理器再调用
  `setVisibleSegmentIndex`，触发 `useInsertionEffect must not schedule updates`。
  全模式切换与单独进入 Tilt 都能复现，调用栈直接指向初始化处理器。
  仅把这段离散状态初始化及订阅改到 `useLayoutEffect`，仍在绘制前校准当前分段。
  分段时间、逐字 MotionValue、状态相等保护、订阅清理和动画参数保持原样。
- **绘光 Lumiere**：辉光降采样和上采样仍调用 Pixi 旧式位置参数，
  当前锁定的 Pixi 8.21.0 已要求使用 options 对象。警告正文在 `console.groupCollapsed`，
  原测试只收集 `console.warn`，因而只看到了滤镜调用栈。
  两处调用改为等价 options；width、height、resolution、antialias 的值没有变化，
  shader、阈值、辉光层数、纹理归还和画质设置保持原样。

复用现有 React hook、Pixi 纹理池、原模式注册表及移动端 Playwright 原生桥夹具。
没有用禁用效果、吞掉日志或升级依赖来消除诊断。

## 验证与证据

证据目录：`.mobile-test-results/visualizer-runtime/`。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 初始全模式复现 | RED，Tilt 生命周期错误 | `red.log` |
| 最小 Tilt 复现 | RED，去掉其他主题和歌词导入后仍失败 | `minimal-red.log`、`minimal-red/` |
| 最小绘光复现 | RED，捕获纹理池弃用正文及实际调用栈 | `bloom-red.log`、`bloom-red/` |
| 动画逻辑回归 | 1,008 PASS，1 SKIPPED，82 文件 | `unit.log` |
| 新增 WebKit 回归 | 9 PASS，手机／iPad／窄窗口 | `ui-final.log`、`ui-final/` |
| 原 14 模式与暂停 Partita 回归 | 6 PASS；本批共 15 项界面用例 | `ui-regression.log` |
| 最终类型检查与生产 Web 构建 | PASS，退出码均为 0 | `typecheck-final.log`、`build.log` |
| 本批原生容器、真实平台、物理设备、部署、个人包更新 | NOT_RUN | 不以受控夹具替代 |

新增用例运行真实 renderer：遍历原有 14 种模式，等 Canvas 挂载，捕获 console error、
警告正文与调用栈；单独检查 Tilt／绘光暂停、正反向拖动和交换窗口宽高后恢复。
Tilt 检查当前行的完整分段文本与首段可见透明度，防止仅挂载了透明歌词也判为通过。
页面音频及原生状态使用受控夹具；这些结果不证明真实声音、物理旋转或持续运行性能。

扩展断言首次失败是测试错误地要求 Tilt 的一个分段包含整行歌词。按原版逐段显示方式，
改成拼接全部分段验证行文本，并单独验证首段可见；没有改变产品分段规则。
初始失败保留在 `ui.log`。唯一跳过的是 `LUMIERE_CLEARANCE_OUT` 控制的可选测量报告，
对应普通画面断言已运行，不能把报告计为通过。

**保留的已知诊断**：完整模式测试进入镜台时，React Three Fiber 9.8.1 内部创建
`THREE.Clock`，Three 0.185.1 输出弃用提示。最终三种窗口的调用栈均指向该依赖的
`createStore`；本批未改第三方包、未抑制日志。它不属于本次两项已修复问题。

```sh
npm run test:unit -- test/unit/visualizer
npm run test:mobile:ui -- visualizerRuntime.spec.ts --max-failures=1 --output .mobile-test-results/visualizer-runtime/ui-final
npm run test:mobile:ui -- mobile.spec.ts -g 'local playback without server|paused Partita' --max-failures=1 --output .mobile-test-results/visualizer-runtime/ui-regression
npm run typecheck
npm run build:mobile
```

运行命令均有外层时限；构建只在 Playwright 管理的 Vite 退出后执行。
产物与源码摘要、准确提交的 CI 状态记录在本地证据目录；构建资源不等于 IPA 或安装验收。
提交前构建中的版本标识仍为基线 SHA，最终输入以 `source-final.json` 与提交内容比对。
构建保留既有 chunk-size、静态／动态混合导入和 npm 配置提示，没有构建错误。
回滚可撤销本批两处 renderer 改动，无数据迁移。
