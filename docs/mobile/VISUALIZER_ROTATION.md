<!-- VISUALIZER_ROTATION.md — original renderer rotation and resource lifecycle; no device acceptance claim. -->
# 歌词动效旋转与恢复

2026-10-14，基线 `81746d585c30eb8575ab8f602617c73baef519e5`。
按 [CURRENT_SCOPE.md](CURRENT_SCOPE.md) 检查 QQ／网易云播放页动效，不扩展其他功能。

## Tilt 旧尺寸排版

暂停在线歌曲，从 844×390 横屏转成 390×844 竖屏后，Tilt 仍保留横屏的两段歌词与字号，左右文字被裁切。
同一首歌、同一时间点，在竖屏打开并关闭设置后重新挂载 renderer，原算法能正确显示为四段。
实际截图与排版比较保存在 `.mobile-test-results/tilt-rotation/before/`；`before.json` 中该用例 RED。

根因是 `buildTiltLayout` 会读取窗口宽度，但缓存结果的 `useMemo` 只依赖歌词、主题、模式参数和字号，
窗口变化没有使缓存失效。播放时间不变时，这份旧排版可以一直保留。

`src/components/visualizer/tilt/VisualizerTilt.tsx` 现在复用既有 `useViewportSettle`，将尺寸稳定后的 `epoch`
加入排版依赖。共享 hook 在 resize 停止 140ms 后通知，不在拖动每一帧运行重排。
原分段、随机种子、字号规则、逐字时间、倾斜样式、入场／退场动效保持原实现。
没有新增依赖，没有修改原生播放、平台接口、歌词缓存或用户配置。

## Tempera 旋转后滤镜异常

三种窗口的原模式检查都捕获到 `_filterStack[currentIndex].inputTexture.source._resolution` 空引用。
去掉其他模式、前后台切换和多次旋转后，单独“在线歌词 → 暂停 → 改变窗口尺寸”仍复现；
见 `tempera-minimal.json` 与日志。无需关闭反色／后处理，问题不来自歌词样本或后台退出。

Pixi 8.21.0 在尺寸改变时销毁旧屏幕纹理池桶，但 `FilterSystem` 会复用上一帧的滤镜栈对象。
其 `_findFilterResolution` 在新输入纹理赋值前读到了旧引用；原 `pixiFilterPoolCompat.ts` 只解绑了 GPU bind group，
尚未清掉这些闲置栈条目。因此本批扩展同一版本限定兼容处理，在池回收前清除对应闲置条目的 input／backdrop 引用。
只清理确定将销毁的纹理，保留活动父滤镜和仍待归还的输入；后者必须等 `FilterSystem.pop()` 归还 backdrop 后才能再归还。
不修改 node_modules，不升级依赖，不关闭滤镜或吞掉异常，也不改变 shader。

`pixiFilterPoolCompat.test.ts` 使用真实 Pixi 纹理池和滤镜对象，新增 6 个案例初始全部 RED，修复后 15/15 PASS。
覆盖 resize、分辨率改变、renderer 移除、池清空、活动父纹理和 backdrop/input 顺序。
`tempera-fixed.json` 记录真实 WebKit renderer 的最小复现通过，但三个项目当时都强制使用手机尺寸；
最终 `tempera-viewports.json` 改用各项目实际窗口尺寸，分别验证手机、iPad 和窄窗口，结果见下表。

## 验证范围与证据

证据目录：`.mobile-test-results/tilt-rotation/`。原失败、修正后的结果及截图分别保留。

- `tilt-rotation.spec.ts`：QQ／网易云两种歌曲身份，手机／iPad／窄窗口，横屏→竖屏→横屏；
  比较旋转后与相同尺寸新挂载的实际段落及字体尺寸，确认没有触发播放命令。
- `visualizer-rotation.spec.ts`：14 个原模式的窗口尺寸、旋转、模拟前后台与状态恢复；
  每个模式保存原窗口、旋转、恢复三张截图，捕获页面和控制台错误。
- 全模式用例对 DOM renderer 检查歌词文本；Fume、Diorama、Lumiere、Sonnet、Tempera 使用 Canvas，
  检查画布挂载／卸载及截图。首次把像素歌词当成 DOM 文本检查导致 3 项测试失败，已修正测试边界，未修改这些 renderer。
- 新用例通过原有模拟原生桥写入在线歌词缓存，再推送播放快照；它们不是实际登录、音乐 API 或解码验证。
- `matrix-final.json` 保留发现 Tempera 问题的一轮结果：44 PASS、3 FAIL、1 未执行；
  修复后的 `verified-matrix.json` 全部 48 PASS，不把重复运行累加为新增覆盖。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| Tilt 两平台身份旋转对照与 14 个原模式窗口／生命周期 | PASS，48 项 | `verified-matrix.json`、同名日志与截图目录 |
| Tempera 最小复现，各项目实际窗口 | PASS，3 项 | `tempera-viewports.json` |
| 视觉逻辑回归 | PASS，1014 项；1 SKIPPED，82 文件 | `unit-final.log` |
| 类型检查 | PASS | `typecheck-final.log` |
| 移动资源构建 | PASS | `build.log` |

本批合计 51 个唯一 WebKit 用例 PASS；早期重跑不重复计数。
逻辑测试跳过项为 `LUMIERE_CLEARANCE_OUT` 控制的可选测量报告，不计入通过。
本地移动资源构建发生在提交前，内嵌源码身份仍为上述基线；提交源码摘要、报告摘要、资源归档和准确提交 CI
分别记录于本地 `delivery.json`，不把构建时间或内嵌旧 SHA 误写为新源码安装证据。

三维镜头、沿曲线运动等模式允许文字在运动过程中出入画面；本批未把每帧所有歌词都完整放入屏幕作为通用规则。
全模式检查只证明对应样本的布局容器／生命周期与播放状态，不能据此宣称所有歌词、所有主题的可读性或真机性能均通过。

## 仍待验收

本批原生容器、真实账号、物理 iPhone／iPad、软件键盘、实际系统挂起与长时间动画负载：`NOT_RUN`。
网易云 30 分钟锁屏、耳机／蓝牙／网络切换和歌词误差 ≤150ms 继续保留原验收缺口。
个人 App 仍为 mobile.28，服务器和签名记录没有修改。回退本次提交即可恢复旧布局缓存与纹理清理行为，无数据迁移。
