<!-- TYPOGRAPHY_RESET.md — desktop section reset parity and exact verification boundaries. -->
# 通用与字幕恢复默认

2026-10-15：补回桌面已有的两处恢复默认入口，沿用移动设置卡片和44px按钮。
27项相关单测、三种窗口的WebKit回归、类型检查及移动构建通过。
后续已合入[设置候选](SETTINGS_CANDIDATE_PREPARATION.md)，原位安装独立iPhone模拟器并完成两组默认操作与重启保存补验。
个人App与服务器未更新，本批未播放歌曲。

## 实现与复用

- `src/mobile/TypographyControls.tsx`：通过原有store setter恢复通用／字幕参数。
  默认值逐项对照`VisPlayground.tsx`的`handleResetCommonSettings`与`handleResetSubtitleSettings`。
  桌面回调封装于预览组件且包含draft操作，因此移动端仅装配同一组store调用，不引入另一套状态或持久化。
- 通用：清除自定义字体及备用栈，恢复sans、字号1、自动字重、整体透明度1。
- 字幕：恢复显示、翻译内容、背景、待唱模糊、和声；透明度0.6、缩放1、继承歌词字体，
  独立字体恢复sans、自动字重、无指定字体和空备用栈。
- 使用既有`mobile-visual-reset`样式与`ui.default`三语言文案；在所属折叠卡片内放置。
  字体上传期间沿用父级disabled fieldset，未新增并发状态或快捷键。
- 外观配置仍走现有store、`buildVisualSettingsConfig`、codec及导入路径，无新字段或依赖。
  这是移动端补回原有面板动作；移动端无桌面command palette宿主，本批不扩展桌面命令。

首次回归发现原`appearanceCodec.ts`用`.length`判断备用字体列表，会丢弃显式空数组。
导入器仅处理存在的字段，因此导入重置后的短码无法清空旧备用栈。
仅将两处编码条件改为`Array.isArray`：保留空列表，未提供字段的部分配置仍保持原语义；旧短码继续兼容。
没有改动自定义字体文件的可移植性规则，也不声称短码携带或清除另一设备上的字体文件。

## 验证

证据目录：`.mobile-test-results/typography-reset/`。

| 检查 | 结果与边界 |
| --- | --- |
| 首次`typography-reset.spec.ts` | **3 FAIL**；两处重置、隔离范围及触摸检查已到达，失败均为短码缺少两个空数组；原日志`webkit.log`保留 |
| 编码与字体传递单测 | **27 PASS**，0.941秒；`visualSettingsImportExport.test.ts`及`mobile/typographyTransfer.test.ts`，含空／非空栈和缺省字段 |
| 修复后同一WebKit文件 | **3 PASS**，16.3秒，`webkit-fixed.log`；使用一次改变编码条件后的重试 |
| 类型检查 | **PASS**，`typecheck-final.log` |
| 移动Web构建 | **PASS**，`mobile-build.log` |
| Xcode构建／实际模拟器安装 | **PASS**，见设置候选记录；两组触摸改动→默认、隔离及重启保存通过 |
| 真机／真实iPad | **NOT_RUN（本批）** |
| 实际上传字体与并发上传／存储失败 | **NOT_RUN（本批）**；本批使用系统字体选择，未替代前批字体与图片验收 |

WebKit采用既有native bridge fixture和空队列，覆盖phone、ipad、ipad-narrow窗口；
不是Xcode模拟器或iPad真机证据。通过触摸按钮检查两组设置的隔离、44px触摸尺寸、旋转无横向溢出，
导出默认配置后改回非空备用字体，再导入确认清空，最后重开核对持久化。未发送播放命令。
已查看手机竖屏与窄平板旋转后截图，按钮沿用现有设置卡片样式；不据此声称全部UI或动画性能通过。

## 待验收与回退

前批[图片存储修复](VISUALIZER_IMAGE_STORAGE.md)的45项单测及原六项群唱WebKit已获准各追加一次并全部通过，
合并候选已更新独立模拟器；原生补验后44个采集外观键恢复基线，个人mobile.28不更新。
QQ偶发空搜索、网易云长时间锁屏、灵动岛真机及完整特效／性能等边界保持。

可分别回退本批两个按钮及其回调、codec两行条件；无数据库升级或数据迁移。
回退codec会重新丢失短码里的空备用栈；设备现有选择不会因源码回退自动清空。
