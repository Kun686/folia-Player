# 按歌曲保存和恢复主题

2026-10-12，实现提交 `346cb23`。本阶段补齐原版歌曲主题缓存与切换，个人 iPhone 保持 mobile.28。
没有新增依赖；播放器布局、动画算法和 Swift 播放实现没有改动。

## 复用与范围

入口为「歌词与动效 → Theme Park · 主题编辑」，沿用原版「自定义主题／AI 主题」目标。
自定义主题全局保存；AI 主题目标将当前草稿保存给打开编辑器时的歌曲。
本阶段支持手工编辑和原有 JSON 工作流，尚未接入自动 AI 请求或远端主题同步。

- 复用原 `getPlaybackSongKey`、`getCachedThemeStateForSong`、主题校验、偏好互斥规则与 Theme Park 草稿。
  读取原来源键、同步索引与旧版主题格式；没有另建主题数据库。
- 歌曲主题、最近使用主题和本地同步索引在一个 Dexie 事务中保存，写入失败或切歌令牌失效则一起回滚。
  localStorage 中的选择偏好与 IndexedDB 属于两个存储系统，不能承诺跨系统原子性。
  偏好写入失败时保留界面和草稿供重试；歌曲缓存可能已经成功保存。
- 切歌默认应用已有缓存；没有缓存时保留当前主题。关闭自动切换后仍可手动应用本曲主题。
  重启按原最近主题与选择指针恢复，原已选中的全局自定义主题保留优先级。
- 沿用 `theme_auto_switch_enabled`、`theme_auto_generate_enabled`、`custom_theme_preferred` 等原键。
  自动切换开关随原外观短码导入、导出；没有新增移动专属配置格式。
- 读取失败明确显示错误与重试入口，不当作「歌曲无主题」。编辑过程中切歌保留草稿，拒绝保存旧歌曲会话。
  原生 A→B→A 快速切换即使被 React 合并成一次渲染，也会按原生切歌序号重新读取。
  旧读取结果、旧编辑会话不能覆盖最新选择；这个序号只随歌曲变化，不按播放时间更新。
- 播放器、睡眠定时及批量歌词导出使用同一主题状态，避免设置面板另起一份自定义主题状态。

## 验证及失败记录

| 层次 | 结果 | 范围 |
| --- | --- | --- |
| TypeScript | PASS | `npm run typecheck` |
| 缓存及偏好逻辑 | PASS，29 项 | 真实 Dexie 测试数据库：来源区分、失败事务回滚、过期令牌、旧主题迁移、严格读取和原偏好规则 |
| 歌曲主题 WebKit | PASS，21 项 | phone／ipad／ipad-narrow：保存、切歌、无缓存、手动应用、重载、自定义优先、旧请求、A→B→A、读写失败重试、外观短码 |
| 原主题编辑器 WebKit | PASS，15 个用例 | 联合回归最初 14 项通过、窄 iPad 取色用例失败；修正取值时序后对三个尺寸的取色用例复验全部通过 |
| 设置面板回归 | PASS，4 项 | 睡眠定时和批量歌词导出，phone WebKit |
| QA 构建／资源 | PASS | iPadOS26.5 Release，`app.folia.validation.App`；实现提交及 125 项 public 资源一致，Swift／shared 源码未变 |
| iPad 模拟器容器操作 | PASS | 旧全局主题保留；两首分别编辑保存、切回恢复、无缓存保留、关闭自动切换、手动应用、终止重启恢复；横竖屏设置可操作 |
| 准确源码 CI | PASS | [Mobile checks](https://github.com/Kun686/folia-Player/actions/runs/38182717672)，HEAD `346cb234c3f55cb6b34ff6f0f611576f9596f2d7` |
| 真实平台主题、个人手机和物理 iPad | NOT_RUN | 不把 fixture 或生成歌曲视作真实平台／真机验收 |

修复过程中暴露并保留了失败证据：

1. 新接线曾写错自动切换存储键，导致重启重新开启；改回原版键并增加持久化断言。
2. 浏览器测试的 `/src/` 动态导入被 TypeScript 当成本地模块路径；改为浏览器运行时 URL。
3. 原取色测试在第二次手势的 33ms 限流提交前取值；分别等待两次手势完成，仍严格比较最终保存颜色。
4. A→B→A 合并事件复现主题加载卡住；主题读取依赖原生切歌序号后，三个视口均通过。

容器使用既有生成音频 `First`／`Second`，保存名称 `First Violet`／`Second Amber`。
重启初次截图曾呈现不同配色，随后由实际导出的外观短码确认当前主题 `First Violet`、
强调色 `#803dc1`、自动切换 `false`，稳定后的画面也一致；未据一次截图修改实现。
复制短码后的检查只解码本次 QA 导出。最初尝试使用未安装的 tsx／esbuild 读取 TypeScript 失败，
没有安装依赖，最终按源码确认的短码格式使用标准库解析。

测试歌曲身份通过 fixture 原生事件注入，未连接真实音乐平台。日志中的 QQ 歌词请求失败来自未配置服务的 fixture，
不属于真实 QQ 失败或主题验收范围。自动 AI 生成、远端同步、长时间性能仍未交付。

证据位于 `.mobile-test-results/song-theme-*`，包括 unit-final、typecheck-final、ui-recheck、picker-fixed、
epoch-before、ui-final、settings、sync、sim-build 等日志及 build-check、sim-check、
sim-restart-values、ci、cleanup-check JSON 和 sim-*.png。个人安装身份仍以 `BUILD_RECORD.json` 为准。
QA 包的显示版本仍为 mobile.28，但 Bundle ID／源码与个人包不同，不作为新的个人安装候选。
