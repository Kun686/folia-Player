# 原版 ReplayGain 的移动端接入

2026-10-11，接续 [ONLINE_LYRICS.md](ONLINE_LYRICS.md)。这是原功能的原生适配，完整移动移植尚未验收。
个人安装包仍为 0.7.16 / mobile.10；本阶段使用独立 `app.folia.validation.*` 测试宿主。

## 复用与实现

- 复用 `calculateReplayGain`，经现有 JavaScriptCore 执行器一次计算单曲／专辑两种模式。
  原版的专辑到单曲回退、正增益峰值保护和默认关闭均保持；Swift 不另写这些规则。
- 复用 `ReplayGainControl`、`usePlaybackStore` 和现有命令动作。模式与音量／音效通过同一个有序写入器
  保存到原生；拒绝时恢复上次确认值。旧原生设置缺少此字段时仅补 `off`，保留音量、静音和 EQ。
- 原生解析结果保留 `ProviderAudioSource.replayGain`，队列只保存四个有限数值字段。
  普通结束缓存、衔接播放和离线缓存租约保留这些字段，不持久化签名播放地址。
- 每个解码实例拥有独立增益，在实时分析、过渡 trim、分频和共享音效之前应用。模式变化使用原版
  100ms 线性渐变；新渐变从控制动作时最后已输出的采样值开始。渲染线程只做乘法和非阻塞锁尝试，
  不运行 JavaScript、不读取文件、不发请求。拖动重建解码器后仍使用本曲增益和最新模式。
- 衔接的预分析响度加上当前实际增益，实时测量本来就在增益之后，避免重复补偿。
  取消／快速切歌继续沿用原生 generation；元数据回填还检查歌曲身份，避免队列编辑后写错曲目。
- 本地标签使用 AVFoundation。ID3 TXXX 的名称读取自 `extraAttributes.info`，数值转换对齐原版
  `music-metadata` 的 dB／功率比语义。旧导入按需读取，无需重新导入；损坏的曲库 JSON 不覆盖，
  标签读取或升级写盘失败不应阻止已有音频播放。未找到字段时显示原版“无数据”，不推测增益。

没有新增 npm、SPM、音频解码或标签解析依赖；原 Web／Electron 播放链未替换。共享控件只补充
`aria-pressed`，移动 CSS 保证选中状态可见和 44px 触摸高度。主题、歌词动画和原版算法参数未调整。

## 验证与证据

本机证据在 `.mobile-test-results/`。测试音频、标签和平台响应均为合成输入，不能代替真实平台验收。

| 层级 | 结果 | 证据及范围 |
| --- | --- | --- |
| TypeScript | PASS | `replaygain-typecheck.log` |
| 移动逻辑 | PASS，89 项 | 模式恢复、连续编辑合并、拒绝回退、原版计算等 |
| 原版 WebKit 参考 | PASS | `ReplayGainReference.json`；8/44.1/48/96kHz、100ms 渐变、未结束时替换模式 |
| 手机／宽平板／窄平板 UI | PASS，6 项 | `replaygain-ui.log`；触摸、选中样式、标签展示、失败回退、音效控件回归 |
| 首轮原生比较 | FAIL 后修复 | `replaygain-first.log`；发现 WebKit 最后采样语义差异，误差 0.000112474 |
| 原生受控回归 | PASS，200 项 | `replaygain-native-final.log`／`.xcresult`；84.321 秒，最大参考采样误差 `8.34465e-7`；未运行需单独 HTTP fixture 的三项探针 |
| iPhone XS Max / iOS 18.7.10 | PASS，11 项 | `replaygain-device-final.log`／`.xcresult`；5.889 秒，真实解码输出、独立双曲增益、模式切换、离线缓存、快速切歌、URL 恢复、EOF 后换解码器拖动和损坏元数据保护 |
| 完整仓库 Vitest | FAIL，5920 PASS、2 FAIL、2 SKIP | `replaygain-logic.log`；两项失败来自未改动的 `electron/debug/crashLog.cjs`／`test/unit/electron/crashLog.test.ts`，测试的非 macOS 路径预期与本机 darwin 行为冲突 |

`replaygain-device-final-identity.json` 记录 App／插件签名、宿主 entitlement 与 xctestrun SHA256。
App 使用 `33GAKXJHL3.app.folia.validation.App`；测试插件无独立 entitlement，检查其签名 ID 与 team。
xctestrun 在同一 Products 目录原样复制，仅通过 `test-without-building` 使用，未指向个人 App。

UI 选中样式断言曾在颜色过渡的中间帧失败，已改用 Playwright 的重试式 CSS 断言等待原动画完成。
没有取消动画或降低波形比较阈值来让测试通过。
`replaygain-regression` 的 199 项及 `replaygain-device` 的 10 项是补充损坏元数据保护前的通过记录，
以 `*-final` 为最终源码证据。完整仓库那两项失败的源码、测试及依赖锁均与起始提交相同，
文件 hash 核对保存在 `replaygain-scope.json`。
最终 QA 包已卸载（`replaygain-qa-uninstall.json`），本轮启动的模拟器已关闭。
`replaygain-personal-app.json` 确认 iPhone 上个人 App 仍为 0.7.16 / build 10。

## 验收边界

- **NOT_RUN**：真实 QQ／网易云／酷狗服务返回的 ReplayGain、MP3／M4A／FLAC 等实际文件标签兼容矩阵。
  本轮已确认的是标准 ID3 TXXX 标签的合成 WAV 导入和实际 iOS 解码链，不能扩大为全部容器支持。
- **NOT_RUN**：30 分钟锁屏跨曲、真实 iPad、耳机／蓝牙／网络切换、温升／内存增长及歌词误差测量。
- 本阶段未把未通过验收的完整 Automix／模型分轨／表现手势开放给个人包；封面和在线歌词持久缓存
  等其余移植工作继续按原项目行为补齐。
- 未修改服务器部署、HTTPS 策略、账户凭据或 root README。当前移动产品使用共享双声道输出；
  保留的 AVQueuePlayer 验证后备路径没有新增 ReplayGain DSP。
