<!-- MONET_PORTRAIT_POSITION.md — mobile portrait position wiring; incomplete touch regression is explicit. -->
# 莫奈封面位置保存

2026-10-15 最新结果：**六项 WebKit 回归全部 PASS（36.6 秒）**，`settled-approved.log`。
拖动保存、重开恢复、2px 位置精度及字号保持均通过。保存仅提交位移，原版外观和手势保留。
原生候选已与本轮队列拼贴一起安装独立模拟器；实际拖动仍未取得通过证据，个人 mobile.28 不更新。
以下失败记录保留为历史，不覆盖最新结果。

## 事实与修正

1. 桌面 `useVisualizerRendererModel.ts` 将 `handleSetMonetTuning` 作为 `onMonetTuningChange` 传给渲染器；
   移动 `PlayerPanel.tsx` 原未传该回调。因此渲染器修改临时MotionValue后，保存没有持久化入口。
   本次直接接入同一个store，不新增设置、依赖或另一套保存机制。
2. `monet/entry.tsx` 在渲染时将模式字号乘以全局字号；`VisualizerMonet.tsx` 原保存位置时提交整份渲染参数。
   补上回调后，这会把已经放大的字号也保存回去。现在只提交 `portraitOffsetX`，保留其他原始设置。
3. 原复位按钮引用不存在的 `common.reset`，实际界面暴露该键名。现在复用已有 `ui.default` 翻译。
4. 补接回调后的WebKit检查仍显示触摸保存不提交，位置留在-65；拖动本身确实移动画面。
   移除编辑状态的 `pointerdown.preventDefault()` 后，获准回归的三个复位场景通过，三个拖动场景仍失败。
   保留原有 `touch-action: none`，不把这次部分通过记成完整修复。
5. 静态检查发现：原 `onDragEnd` 在回调后再等待50毫秒才清除点击屏蔽；已安装的Framer Motion还会将该回调延后到postRender。
   因而下一次独立点击也可能被误屏蔽。这是源码可确认的时序缺陷，是否解释本轮三个失败仍待动态验证。
   下一候选移除计时器，拖动开始时标记屏蔽、下一次pointerdown清除，仅阻止同一次拖动产生的click。
   继续复用原Motion拖动、MotionValue和store；无新增依赖、自研拖动算法或设置字段。

保留原封面形状、拖动范围、动效、控制器和窄屏不显示右侧封面的规则；未改样式。
设置仍由原store进入外观导出、同步及重置，无新增命令或配置字段。

## 验证记录

目录：`.mobile-test-results/monet-position-20261015/`。

| 项目 | 结果与边界 |
| --- | --- |
| 原实现定向界面检查 | **1 FAIL**，`red.log`；查找“重置”超时，实际按钮名称是缺失翻译键 `common.reset`。尚未到达保存断言，不作为持久化问题的动态复现 |
| 初步补丁手机／宽平板／窄平板 | **6 FAIL**，`fixed.log`；复位保存及拖动保存均未持久化，值仍-65。失败截图保留 |
| 移除pointerdown取消的候选类型／移动构建 | **PASS**，`typecheck-final.log`／`build.log` |
| 用户额外批准的六项WebKit重测 | **3 PASS／3 FAIL，37.5秒**，`approved.log`及`approved/`；复位场景通过，拖动保存均仍为-65。此次许可已使用，不再待执行 |
| 按手势区分点击的新候选类型检查 | **PASS／2.9秒**，`typecheck-gesture.log` |
| 按手势区分点击的新候选移动构建 | **PASS／4.5秒**，`build-gesture.log`；不是界面行为证明 |
| 手势候选获准回归 | **5 PASS／1 FAIL，31.2秒**，`gesture-approved.log`；三窗口保存值均正确；窄窗口坐标比较在50px入场动画中途取值 |
| 等待原入场动画停稳后的获准回归 | **6 PASS，36.6秒**，`settled-approved.log`；未放宽2px精度，未增加固定睡眠；事件JSON和截图均保留 |
| 原生构建／安装 | **PASS**，与队列拼贴合并候选同包，见下方链接 |
| 原生真实封面拖动 | **INCONCLUSIVE**：两次CUA自动拖动均未产生位移并退出编辑；尚无法区分自动输入与App手势问题。可进入编辑及点击保存0，不等于非零拖动保存通过 |
| 真机手指拖动／位置恢复 | **NOT_RUN**，不能用WebKit通过替代 |

测试文件：`test/mobile-ui/monet-portrait-position.spec.ts`。
使用已登录模拟器原队列QQ《我不难过》的真实歌曲身份与元数据，歌词为空、时钟受控；
不生成虚构歌曲或歌词，不把界面样本当作登录、平台请求或音频验收。
手机和窄窗口转为横屏以触发原版肖像布局，宽平板保持原窗口；不会证明原生iPad已验收。
覆盖计划为：复位／拖动保存、重挂载／刷新恢复、不叠乘字号、不发送播放命令。
拖动使用Playwright的鼠标Pointer Events，进入／保存使用触摸tap；真实手指拖动需另作原生补验。
获准回归虽然注册了pointerdown／pointerup／click记录，但使用inline attachment及list reporter，磁盘上没有事件JSON；
不能声称已从事件附件证实失败根因。原失败截图、日志及当时源码保留于`approved/`、`approved.log`、`approved-source/`。
下一候选显式写出`portrait-pointer-events.json`，记录时间、事件类型、取消状态、保存值，并跨刷新保留记录。
测试另断言拖动释放本身不提交、独立点击保存后退出编辑；不增加等待时间掩盖时序问题，不放宽位移和字号断言。

当前已执行的命令均经 `codex-bounded` 限时：

```sh
node node_modules/@playwright/test/cli.js test -c playwright.mobile.config.ts \
  test/mobile-ui/monet-portrait-position.spec.ts
npm run typecheck
npm run build:mobile
```

两次额外回归均已获用户批准并执行，无待许可项。最终测试等待 renderer 的 transform:none 与 opacity:1 后比较位置。
它只修正测试取样时机；生产动画未缩短或删除。
原生、真实音频与性能结果按 [队列拼贴和界面](MOBILE_LATTICE_UI.md) 分别记录。
