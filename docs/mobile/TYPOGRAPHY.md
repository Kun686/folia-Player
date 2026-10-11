# 原版字体与字幕设置的移动适配

2026-10-12：开发源码阶段；个人 iPhone 保持已验证的 mobile.21。
本轮补全设置入口与上传字体持久化，不改变已接受的全屏舞台、气泡控制器或动画参数。

## 复用与范围

- 使用原 `useTypographySettingsStore`、`useVisualizerSettingsStore`、`FontFallbackStackControl`、
  `customLyricsFont`、`useAppPreferences` 和中英文文案，不新增依赖。
- 「歌词与动效 → 通用」提供原三种字体风格、自定义字体、备用字体、自动／指定字重、
  字号及整体透明度；Sonnet、Tempera、Lumiere 保留原版自动字号限制。
- 「字幕」提供原字幕隐藏、翻译／音译／双语／无、背景、模糊、透明度、字号、
  继承歌词字体／独立字体、和声字幕及和声背景；补齐移动渲染入口遗漏的字幕隐藏和整体透明度。
- 视觉设置继续使用原短码／JSON。补全同步 schema 未包含的字幕缩放、透明度、和声设置及可移植字体名；
  先校验再应用。短码不包含字体文件，空字体名保留本地上传字体；系统字体替换上传字体沿用原警告。
- 原桌面常量提取共用，备用字体输入增加稳定的可访问名称；不另建字体状态或恢复链路。

## WebKit 存储修复

实测 WebKit 在将 File 或复制后的 Blob 写入 IndexedDB 时抛出
`UnknownError: Error preparing Blob/File data to be stored in object store`。
原 best-effort 缓存写入会吞掉异常，让字体看似成功、重启却消失。

- 上传仍由原 FontFace 加载器验证字节，保留 woff2／woff／ttf／otf 和 50MiB 上限。
  文件选择器不限定 `accept`，避免 iOS 将可用字体文件置灰；扩展名／MIME、大小及实际解码仍校验。
- 沿用 `lyrics_uploaded_font`，新记录保存 `version: 2` 与单份 `ArrayBuffer`，不同时存 Blob 副本；
  读取时还原 Blob，兼容旧 Blob 记录，拒绝无效、空及超限字节。
- 使用原 Dexie 数据库与 cacheRepository 的事务写入，持久化失败明确返回错误并保留旧字体。
  写入期间被新上传或清除取代则中止事务；迟到加载不会重新注册已清除字体。
- FontFace 用 Map 跟踪，成功替换／清除释放旧实例，失败释放新实例；唯一 ID 避免同名同时上传碰撞。
- 恢复操作被取代使用独立取消错误；`useAppPreferences` 忽略取消，真实缺失／解码失败仍沿原提示恢复。
- 上传期间禁用相关设置及关闭按钮，完成或失败后恢复操作。

## 验证证据

| 层级 | 结果与边界 |
|---|---|
| TypeScript | PASS，`npm run typecheck` |
| 逻辑／存储 | PASS，7 文件 / 64 项；包含原字体栈、偏好迁移、字幕模式、外观导出、HTTP Web 无 randomUUID 兼容，以及真实 Dexie + fake-indexeddb 的结构化克隆／事务；FontFace 在该层被替身替代 |
| WebKit 新功能 | PASS，4 用例 × 手机／iPad／窄窗口 = 12 项；额外触控尺寸专项 3 项，取消错误分类调整后真实字体恢复专项 3 项；后两组为重复子集，不计为新增验收用例 |
| WebKit 回归 | PASS，12 项；原动画注册表、外观短码、本地歌词 GBK／KRC、逐字歌词替换及暂停 Partita；桥接使用受控 fixture，不证明真实平台 |
| 原生构建 | PASS，`npm run ios:sync`、Release arm64 Simulator；Swift 源码和生产依赖未修改 |
| 实际容器 | PASS_SIMULATOR_INTERACTION，iPad Pro 11-inch M5 / iPadOS26.5；从系统文件选择器选中本机测试 TTF，设置显示字体名，终止／重开 App 后保留，再恢复内置字体 |
| 真机 | NOT_RUN，新设置的 iPhone／物理 iPad 文件选择、所有字体格式、巨大中文字体性能及歌词字体视觉对照 |
| 个人安装 | NOT_RUN，本轮没有制作新 IPA 或更新个人 iPhone；`BUILD_RECORD.json` 继续描述 mobile.21 |

模拟器正向操作在最后补充取消错误分类之前完成；最终取消路径由上述新增逻辑测试验证，
最终源码的真实字体上传／刷新恢复由 WebKit 再次验证。不能把模拟器短测视作最终个人包验收。
首次模拟器构建禁用签名导致 Keychain 不可用；使用 Xcode 正常本地签名重建后恢复，未放宽 Keychain 保护。
回归日志中保留既有 Pixi、THREE.Clock 和 React useInsertionEffect 诊断，本轮不声称全部渲染器零警告。

测试字体为本机已有 Arial，仅用于本地验证；未提交或打入 App。模拟器测试副本已删除，
已恢复内置字体、停止 App 和日志辅助进程并关闭本轮启动的模拟器。

日志／截图位于忽略目录 `.mobile-test-results/`：

- `typography-final-{unit,typecheck}.log`
- `typography-bytes-{phone,tablets}.log` 与同名产物目录
- `typography-touch-size.log`、`typography-final-font.log`、`typography-regressions.log`
- `typography-ios-sync.log`、`typography-simulator-signed-build.log`
- `typography-simulator-{loaded,restored,cleared}.png`

最小复验：

```sh
npm run typecheck
npm run test:unit -- test/unit/services/customLyricsFont.test.ts test/unit/services/uploadedLyricsFontStorage.test.ts test/unit/mobile/typographyTransfer.test.ts test/unit/hooks/customLyricsFontPreference.test.ts test/unit/theme/fontStacks.test.ts test/unit/stores/subtitleContentMode.test.ts test/unit/obs/obsWebAppearance.test.ts
FOLIA_TEST_FONT=/path/to/locally-licensed.ttf npm run test:mobile:ui -- test/mobile-ui/typography.spec.ts
```

不提供 `FOLIA_TEST_FONT` 时真实字体正向用例明确跳过；不得把跳过当作通过。

## 回退

移动入口可独立撤回；播放器、媒体和账号无迁移。旧 Blob 数据继续可读；新上传会替换该字体记录。
旧源码不识别 v2 字节记录，回退到旧源码时自定义字体可能回落至内置字体；保留原字体文件，
再次升级后可重新导入。禁止通过卸载个人 App 回退；个人包仍为 mobile.21，旧 IPA 保留。
