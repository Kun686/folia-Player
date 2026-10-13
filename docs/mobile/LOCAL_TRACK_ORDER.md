# 本地曲库曲号与排序移植

2026-10-13。移动端现已复用桌面端本地歌曲排序；本批仅自动测试和独立模拟器 QA，个人 mobile.28 与服务器未更新。

## 原问题与行为

原版专辑按碟号／曲号排列。移动专辑已调用同一排序器，但原生导入没有保存这些标签，实际退回歌曲标题排序。
本批补上原生导入、旧曲库补读和原模型投影，并把原来的文件名／修改日期／专辑号、升序／降序偏好接入移动触摸入口。

- 全部歌曲和实际文件夹可切换排序，使用原 `compareLocalFolderSongs`、实体专辑分组和 `useLocalTrackSortStore`；同名不同专辑仍分别排序。
- 专辑详情沿用原碟号、曲号、标题规则与原 `formatLocalAlbumTrackLabel`。无曲号歌曲放在末尾；具体缺失值和降序规则与桌面一致。
- 点击歌曲时采用当前可见列表生成队列，包括文件夹范围和搜索过滤。单独修改排序不会重排已播放队列，也不改变歌单的人工顺序。
- 偏好沿用原存储键；保存失败保留旧值并显示错误。选择器在 WebKit 下明确为 44px，支持手机、平板、窄窗口和旋转。
- 全屏播放器、磨砂控制器、动画、音乐解析及 Automix 算法保持原实现。

## 复用与保存

没有新依赖。MP3／M4A 的标签由 AVFoundation 读取，再由已有 `music-metadata@11.16.1` 的 `CommonTagMapper.normalizeTrack` 规范化；FLAC 沿用现有受限文件读取器和同一库的原 FLAC 解析器。
iTunes 二进制曲号转换遵循已安装 MP4Parser 的字节行为，包含其超过 255 时的现有截断语义；本批没有另行改变桌面规则。
收集限于 64 个相关标签、单值 1024 字节；取消、过大或损坏数据不会写入半个结果。

新导入保存 `trackNumber`、`discNumber`、保留文件的修改日期和大小；已有曲库在读取时只补缺失字段，成功写入 `trackOrderVersion: 1`。
已完成或更高版本记录不重写。解析失败保留旧值，之后可重试；源文件缺失时不重建音频、不删除曲库记录。
补读在现有原生 actor 内进行，异步解析后再次检查歌曲目录和原始 JSON 字节；重扫、删除、较新修改或另一轮补读优先。
写入只涉及 `song.json`，使用原子写入和首次解锁后可访问保护，不触碰歌词／匹配文档、实体记录或音频内容。
曲库原有完整性校验保持原语义；可选补读不会把损坏目录当作一次成功的完整曲库读取。

## 验证

证据目录：`.mobile-test-results/local-order/`。

| 层次 | 结果 | 范围 |
| --- | --- | --- |
| 类型检查 | PASS | `npm run typecheck`；`typecheck.log` |
| 逻辑 | PASS，128 文件／1376 项 | `npx vitest run -c vitest.config.ts test/unit/mobile test/unit/utils/localSongSorting.test.ts test/unit/library`；`unit-full.log` |
| WebKit | PASS，57 场景 | `local-order`、`local-folders`、`local-playlists`、`local-entities`、`local-metadata`，phone／ipad／ipad-narrow；`ui.log`、`ui/` |
| 原生模拟器 | PASS，23 项 | 独立 `app.folia.validation.App`，iPad Pro 11-inch M5／iOS 26.5，空白离线 WebView；`native-tests.log`、`native.xcresult`、`native-summary.json` |
| 移动资源／原生 Release QA 构建 | PASS | `build-final.log`、`native-build.log`，10 个原生 JS 资源与 QA 包逐字节核对 |
| 已批准音频依赖 | PASS | 固定 AudioStreaming 1.4.5，59 个文件／4 处既有补丁；无依赖改动 |
| 实际 Files 提供方／物理设备／真实平台 | NOT_RUN | 本批没有操作个人 App、账户、手机或服务器 |
| 大规模旧曲库首次补读性能 | NOT_RUN | 扫描按曲目逐个完成，尚无大量真实文件的耗时证据 |

新增 15 项逻辑用例、12 个不同尺寸的界面场景、4 项原生测试；其余是既有回归，不与早期分批运行重复相加。
三种格式共享 `LocalTrackOrderReference.json` 的真实音频字节，期望来自原桌面解析器。
原生测试验证实际导入、修改时间复制、重启投影、并发补读、歌词／匹配／人工重命名／音频字节保留、版本跳过、取消与缺失文件恢复。
既有文件夹重扫、歌词格式和匹配播放回归一并通过。文件样本是测试音频，不代表用户曲库或平台验收。

首轮 WebKit 6 项通过／6 项失败：发现默认系统选择器忽略最小高度而只有 27px，修正外观和明确高度；另有测试错误假设搜索框使用 `type=search`，改为其实际可访问名称。
首轮原生 21 项通过／2 项失败：测试尚未执行实体编辑便假设实体文件存在；缺失音频又触发了补读前的完整曲库校验。
前者补上实际人工重命名，后者将可选补读改为容错枚举并保留原曲库完整性策略；测试同时使用既有浏览回退接口核对记录保留。
类型检查也纠正了测试输入的额外字段类型写法。首轮日志和产物保存在 `*.first`，修正后上述最终结果全部通过。

## 复现与回退

Swift 测试与共享样本分别在 `ios/App/NativeTests/LocalTrackOrderTests.swift` 和 `LocalTrackOrderReference.json`。
生成脚本为 `dev/mobile/local-order-m4a.swift`（Apple AAC 编码器）与 `dev/mobile/local-order-reference.mjs`（桌面解析期望）。
在项目根目录、使用尚不存在的临时输出路径运行；无需联网或新增库：

```sh
"$HOME/.local/bin/codex-bounded" 60 -- swift dev/mobile/local-order-m4a.swift /tmp/folia-order.m4a
"$HOME/.local/bin/codex-bounded" 60 -- node dev/mobile/local-order-reference.mjs /tmp/folia-order.m4a
```

回退可撤回本批入口、投影与可选标签扩展。保存字段均为旧版本可忽略的附加字段，无音频重编码和破坏性迁移。
`BUILD_RECORD.json` 保持不变；本批提交与 CI 不代表个人 App 已安装。完整 Automix 真机热状态、后台和长期性能验收仍未完成。
