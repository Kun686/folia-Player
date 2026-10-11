# 移动端原版歌词时间校准

2026-10-11，开发源码 `f0e38d471864d6171b122a3c2c88b5c5fddd5580`。
本阶段接入原版单曲／全局时间偏移，支持本地、网易云和 QQ 歌曲。
**尚未打包安装到个人 iPhone**；该设备仍为 [mobile.11](VALIDATION.md)，其源码和签名记录不变。

## 复用与行为

- 复用原 `LyricTimelineOffsetControl`、`GlobalLyricOffsetModal`、`lyricOffsetMemory` 和
  `useLyricSettingsStore`，保留原按钮步长、输入、重置、标尺、预览及应用／取消语义。
  无新增依赖；没有另写歌词解析器、动画或原生音频算法。
- `src/mobile/useLyricClock.ts` 只把原单曲／设备偏移接入原生快照驱动的 `MotionValue`：
  `歌词秒数 = 音频秒数 - (单曲偏移毫秒 + 全局偏移毫秒) / 1000`。
  不通过逐帧 React state 更新；暂停、切歌和前台快照变化都会重新校准。
  点击歌词时沿用原版逆变换，并将目标音频时间下限限制为零。
- 单曲存储键使用 `getPlaybackSongKey`，包含来源身份；相同数字 ID 的网易云／QQ 歌曲独立保存。
  沿用原偏移持久层，属于非敏感设置，不是平台 Cookie；没有改变 Keychain 凭据路径。
- `src/mobile/LyricTools.tsx` 为本地与在线歌曲共用入口，保留已有在线导入、匹配、来源切换和恢复操作。
  全局弹窗使用修正后的歌词时钟；在线匹配仍使用原始音频时钟，保持原预览语义。
  原组件增加 dialog 语义和返回按钮名称；安全区、44px 触摸区域等样式限制在移动包装层。

## 本轮修复的加载竞态

窄窗口回归复现：歌词尚未到达时打开工具，旧实现取消加载并在编辑状态直接返回，
导致校准预览一直没有歌词。现在本地解析继续运行；在线加载增加可选 `readOnly` 模式，
读取缓存／当前平台歌词，但抑制自动匹配和自动缓存写入。
关闭工具后先读取保存的手动选择；关闭、切歌或失效后的迟到结果仍不能写入或覆盖新状态。
该选项默认关闭，原桌面调用保持原行为。

## 验证证据

本机文件位于 `.mobile-test-results/`，网络及桥接测试样本不代替真实平台验收。

| 检查 | 结果 | 证据与范围 |
|---|---|---|
| TypeScript、逻辑回归 | PASS | `lyric-timing-logic-final.log`，131 项／23 文件；移动逻辑、原在线播放、全局偏移存储 |
| WebKit 交互回归 | PASS | `lyric-timing-ui-readonly.log`，27 项，1.3 分钟；390×844、1194×834、600×834 |
| 逐字高亮数值与拖动 | PASS（受控时钟） | 实际原解析和渲染；校验组合偏移、暂停预览、应用／取消／标尺、Monet 点击反向映射和前台恢复 |
| 来源、持久化、异步竞态 | PASS | 同 ID 不同平台隔离、元数据刷新、重新加载／重置、歌词迟到、只读不写缓存及原匹配回归 |
| 前端资源与 Capacitor 同步 | PASS | `lyric-timing-sync.log` |
| iPad 模拟器 Release 构建 | PASS | `lyric-timing-simulator-build.log`；使用固定依赖，构建期间未修改源码或资源 |
| iPad 实际容器操作 | PASS（短测） | iPad Pro 11-inch (M5)／iOS26.5；合成歌曲「Folia 验收音 2」，单曲 +250ms、全局 +50ms 应用后，结束 App 进程再启动仍恢复；启动保持暂停 |
| GitHub Mobile checks | PASS | [run 38111816022](https://github.com/Kun686/folia-Player/actions/runs/38111816022)，对应上述源码提交 |

界面截图：`lyric-timing-{phone,ipad,ipad-narrow}.png`；原生容器截图：
`lyric-timing-native-preview.jpg`、`lyric-timing-native-song-restored.jpg`、
`lyric-timing-native-global-restored.jpg`。模拟器此次校准使用无歌词的第二首合成短曲，
只验证操作和设置恢复；逐字预览数值由上述 WebKit 测试验证，不把两者混为实际声画延迟测量。
测试后单曲／全局偏移均恢复零，App 和日志辅助进程停止，该次启动的模拟器已关闭。

保留失败记录：首次新用例语法错误、导入共享 `beforeEach` 只作用于首个测试套件、
测试错误假设 LRC 不插入间隙行，已分别修复语法、改用自动 fixture、使用明确 YRC 时间样本。
`lyric-timing-ui-regression.log` 记录上述真实加载竞态；修复后按原断言通过全部 27 项。

**NOT_RUN**：本阶段 iPhone 安装和真机校准、真实账号 App 联机、实体 iPad、蓝牙声画偏移、
≤150ms 显示误差、30 分钟锁屏、持续温升和内存。Swift 未变，本阶段没有重跑原生 XCTest 全量，
旧原生测试数量不计入本阶段。本次未生成新个人 IPA，不修改 `BUILD_RECORD.json`。
完整 Automix、分词／导出／批量工具及本地完整来源管理等仍待移植，完整目标仍未完成。

## 回退

撤销本阶段源码提交可恢复 mobile.11 的入口；原偏移格式兼容，已保存设置不需要迁移。
个人 iPhone 未更新，不需要回退安装。后续打包须重新绑定源码、资源指纹、签名及设备回读，
不能把仍带 build 11 的开发模拟器产物当成已交付 mobile.11 的同一构建。
