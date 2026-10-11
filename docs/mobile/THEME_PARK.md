# Theme Park 自定义主题移植

2026-10-12，实现源码 `76ff8d7a488b2411020ebc1b21d43698779d01b1`。
本次完成全局自定义主题编辑，在独立 QA 包验证；个人 iPhone 保持 mobile.28。
没有新增生产依赖，没有修改播放器布局、原生播放或动画算法。

## 复用与行为

本阶段入口原为「歌词与动效 → Theme Park · 自定义主题」；后续歌曲主题阶段改为「Theme Park · 主题编辑」。复用原版 `useThemeParkDraft`、
配色／信息／内容／AI 面板、主题校验、推荐色算法和 `ThemeParkPreview`。
移动宿主只负责触摸尺寸、面板切换、预览可见性和持久化连接。

- 编辑亮／暗两套颜色、名称、描述；情绪词颜色及歌词图标沿原版在两套主题间共享。
- 保存前保持草稿；取消不应用，空名称不能保存。重置沿原版仅恢复默认配色。
- 保存沿用 `custom_dual_theme` 和 `last_applied_theme_pointer`。选择写入失败时恢复旧主题；
  错误留在编辑器中，保留草稿供重试。底层存储若连恢复操作也拒绝，不能保证跨键事务，
  不将此错误处理描述为数据库级原子提交。
- 外观短码／JSON 沿现有编解码器包含完整主题，无新存储格式或同步服务依赖。
- AI 页复用复制提示词、导出草稿 JSON、粘贴 JSON 载入草稿的原流程。
  移动端注入已有原生剪贴板桥；桌面端默认仍使用浏览器剪贴板。
  复制失败显示错误，卸载时清理提示定时器，移动输入上限 200,000 字符。
- 预览默认折叠，展开时使用原示例歌词与 MotionValue 时钟，可暂停。
  折叠或页面隐藏时卸载预览；回前台重新挂载，不替代真实播放时钟。
  示例预览不属于真实音源播放或歌词时序证据。

原版 `ThemePark.tsx` 的封面提色状态当前没有写入路径；本次沿用基准主题推荐色，
没有增加封面提色行为。后续 `346cb23` 已补齐按歌曲主题缓存／切换，见 [SONG_THEMES.md](SONG_THEMES.md)。
自动 AI 生成仍待接入，手动 JSON 编辑通过不代表完整 AI 功能交付。

## 验证

| 层次 | 结果 | 范围 |
| --- | --- | --- |
| TypeScript | PASS | `npm run typecheck` |
| 主题逻辑 | PASS，14 项 | 原草稿规范化、输入校验、共享字段、提示词与推荐色 |
| 移动 WebKit | PASS，15 项 | phone／ipad／ipad-narrow：保存与重载、短码导出、双主题与共享字段、无效名称、取消、存储失败恢复／重试、原生桥剪贴板失败／重试、JSON 草稿、预览生命周期、横屏／短窗口、浅色触摸选色 |
| 桌面组件 | PASS，1 项 | 原 Theme Park 探针，浏览器剪贴板默认路径、失败提示及重试；使用本机 Chrome，未安装新浏览器 |
| QA 构建／资源 | PASS | iPadOS26.5 Release，独立 `app.folia.validation.App`；准确实现提交、125 项 public 资源与同步目录一致 |
| 实际 iPad 模拟器操作 | PASS | 拖动颜色为 `#1e1e8a`、名称编辑、旋转保留草稿、原动画预览、保存、终止重启后恢复选中主题；系统剪贴板 JSON 内容已断言 |
| 准确源码 CI | PASS | [Mobile checks](https://github.com/Kun686/folia-Player/actions/runs/38180992476) |
| 个人手机／物理 iPad 新入口、长期动画性能 | NOT_RUN | 没有更新个人 App，也没有用生成歌曲替代真实音乐验收 |

界面首轮有两处测试定位／交互问题：WebKit 将颜色输入也匹配为 textbox，
以及 `fill()` 不会模拟用户触摸滚动到输入框。改用明确的文字输入定位和真实触摸聚焦后复验通过，
未放宽可见性或内容断言。宽窗口面板宽度被通用样式覆盖的问题已限定在移动主题面板修正。
桌面组件首轮因缺少 Playwright 自带 Chromium 未执行；改用已安装 Chrome 后通过。

实现提交相对上一阶段没有修改 `ios/` 或 `shared/`；没有重跑或重复计入原生测试数。
QA 与个人包可能显示相同 mobile.28 版本号，但 Bundle ID 和源码不同；
个人安装身份以 `BUILD_RECORD.json` 为准，本次保持不变。

本地证据 `.mobile-test-results/theme-editor-*`：typecheck.log、unit.log、ui-recheck.log、
touch.log、desktop-recheck.log、sync.log、sim-build.log、build-check.json、sim-check.json、
native-clipboard.json、sim-preview.jpg、sim-restart.jpg、ci.json、cleanup-check.json。
完整移植目标仍未完成。
