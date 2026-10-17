<!-- LIVE_THEME_EDITOR.md — original settings inspection, scoped layout fix, and install boundary. -->
# 移动主题编辑器：滚动操作与文字对齐

2026-10-15：移动容器修正完成，30项编辑／布局、12项文字检查、类型检查及移动资源构建通过。
后续[曲库遮挡回归](LIBRARY_PLAYER_OCCLUSION.md)获准执行并通过，修正版已原位安装到独立iPhone模拟器。
真实QQ歌曲上下文的编辑器滚动、横竖屏与取消返回已观察，取消／保存保持可见；详见[合并验证](COMBINED_UI_VERIFICATION.md)。
个人iPhone mobile.28及服务器保持原版本；没有新增依赖。下方旧包观察与失败证据保留。

同日后续[软件键盘与真实保存补验](LIVE_THEME_KEYBOARD.md)通过：独立iPhone完整软件键盘、英文触摸输入、
横竖屏操作区、横屏保存及App重开读回已观察。临时自定义主题已恢复，当前50首队列与原设置保持；中文输入未验收。

## 已安装版本观察与恢复

iPhone 17 Pro／iOS26.5，Bundle ID `app.folia.validation.App`，从暂停的QQ《我怀念的》进入主题编辑器。
预览／暂停、横屏及正常竖屏恢复已观察；滚动后标题、取消、保存离屏。名称草稿已取消，没有保存自定义主题或主题指针。
预览沿用产品示例歌词，不计作真实歌曲音频验收；模拟器连接硬件键盘，未测完整iOS软件键盘。

首次惯性滚动中的误触把绘光`darkField`从0.75改为0.42，偏差保留在`final-state.json`。
随后通过实际UI滑块恢复0.75；`restoration.json`确认已采集外观、完整51首队列、音效、
122.68798185941043秒暂停位置及二进制与`baseline.json`一致。没有覆盖原偏差证据。
安装程序SHA256仍为`4fd81f10da6d964268fcc5832d78f04cc95a6f3449f935b0ad8aa2f0cc8d9f17`。

## 实现与复用

- `src/mobile/MobileThemeEditor.tsx`复用`.sheet-pinned`／`.sheet-body`固定标题、取消、保存；中间内容独立滚动，重置仍在编辑内容中。
  原草稿、歌曲归属检查、存储错误处理与主题面板保持；保存移出fieldset后显式保留`saving`禁用条件。
- `src/mobile/mobile-theme-editor.css`沿用移动间距与44px触摸尺寸；130px键盘区域内取消和保存共享一行，
  标题仅视觉隐藏、无障碍名称保持；恢复视口后回到正常布局。继续由现有`useSheetViewport`处理键盘几何。
- `src/mobile/mobile-settings.css`复用文字透明度修正，保留原主题标签颜色及名称校验提示色。
  不改变歌词画布、主题配色和动画，不增加原生接口或滚动系统。

## 验证

| 层次 | 结果及证据 |
| --- | --- |
| 旧安装包实际操作 | 原编辑器预览、暂停、旋转及取消草稿已观察；操作离屏已复现。`portrait-editor.png`、`landscape-editor.png`、`actions-scrolled-away.png` |
| 修正版编辑／布局 | **30 PASS / 1.1分钟**，三种WebKit视口；编辑、存储失败、取消、预览、旋转、父页位置、背景操作隔离及130px键盘可视区域。`layout.log`／`layout/` |
| 深浅色文字 | **12 PASS / 27.2秒**；三种视口，主题标签／计数／说明及原设置页文字≥4.5:1；无效名称仍禁用保存并改变提示色。`contrast.log`／`contrast/` |
| 静态与资源 | `npm run typecheck`、`npm run build:mobile`及定向`git diff --check` **PASS**。`final-typecheck.log`、`build.log`、`manifest.json` |
| 修正版原生安装／实际触摸 | 后续合并补验及软件键盘补验 **PASS（限定范围）**：128资源／签名一致，滚动、横竖屏、取消返回；英文屏幕键盘、自定义主题保存及重开读回通过，详见 LIVE_THEME_KEYBOARD.md |
| 真实平台、音频、真机、长播 | 本批**NOT_RUN**；没有退出登录、搜索、播放音频或连接服务端，QQ偶发空搜索未解决 |
| 清理 | 镜像页关闭，指定模拟器助手停止，测试及构建退出。`cleanup.json` |

证据目录：`.mobile-test-results/live-theme-editor/`。受控测试复用原生桥fixtures，测试歌曲仅供离线交互回归，
不证明真实平台登录／搜索／播放。修正版自定义主题保存与完整软件键盘已补验；中文输入、iPad账号与物理设备仍待验收。

运行命令均有`codex-bounded`限时包装：

```sh
npm run test:mobile:ui -- test/mobile-ui/theme-editor.spec.ts test/mobile-ui/sheet-viewport.spec.ts test/mobile-ui/settings-layout.spec.ts test/mobile-ui/settings-modal-isolation.spec.ts --grep 'edits both themes|invalid names|original manual JSON|preview can pause|daylight touch|save and cancel|theme editing|returning from theme' --max-failures=1 --output=.mobile-test-results/live-theme-editor/layout
npm run test:mobile:ui -- test/mobile-ui/settings-contrast.spec.ts --max-failures=1 --output=.mobile-test-results/live-theme-editor/contrast
npm run typecheck
npm run build:mobile
```

源码回退只撤销本批三个移动UI文件的局部修改，保留同文件此前改动。合并包回退使用上一独立模拟器包原位安装，
不卸载或清理账号；具体路径见合并验证记录。
