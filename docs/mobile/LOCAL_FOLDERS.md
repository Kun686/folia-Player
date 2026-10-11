# 本地文件夹移植

2026-10-12，扫描与增量计划层已实现并完成独立测试；文件夹功能仍 IN_PROGRESS，尚未开放个人 App 入口。
个人安装包保持 mobile.27。本记录不替代系统目录授权、实际导入、重扫或用户曲库验收。

## 复用与当前实现

- 从 `localMusicService` 抽出原文件分类、音频／歌词基础路径、文件夹封面优先级到
  `src/utils/localFileRules.ts`；桌面仍调用原规则。移动扫描额外识别现有原生导入支持的 MP4 命名。
- `nativeFolderRuntime` 复用 `.foliaignore` 继承／否定规则、可配置歌词排序及 FIA 优先规则，
  包括 `track.lrc`、`track.mp3.lrc`、翻译歌词及 cover.png／jpg／jpeg。
  不在 Swift 中复制 glob、歌词命名或排序规则，不新增生产依赖。
- 原生 `LocalFolderScanner` 是独立 actor，避免阻塞 LocalMediaLibrary 的播放文件访问。
  使用已有 JavaScriptCore 执行打包的 folders.js；LocalMediaLibrary 提供 scanFolder 接口。
- 系统目录读取使用 Foundation 文件协调和安全作用域，退出时释放访问；不跟随符号链接。
  文件系统错误、非法忽略文件、取消、深度或数量超限直接失败，不生成可被误认为空曲库的删除计划。
- 扫描只返回相对路径、目录和元数据；不修改源文件、不导入音频、不写持久曲库。
  手工忽略的目录保留可恢复节点；磁盘规则忽略的目录不继续扫描。
- 每个音轨分别保存音频、同名歌词文件和封面的元数据签名，以及最终选中的歌词／翻译／封面路径。
  只改变歌词排序时可以与歌词文件实际变化区分，后续导入不能因此覆盖用户上传的歌词。
  签名沿用原版路径、大小、修改时间语义，不是内容哈希或并发文件系统快照。

限制：默认最多 50,000 个目录项、64 层；单个 .foliaignore 最多 256 KiB，整次规则内容最多 8 MB，
单次 JS 请求／响应最多 32 MB。限制只会导致明确失败，不返回截断成功结果。
扫描发现 Ogg／Opus／桌面备用格式不等于原生解码通过；实际导入必须独立检查并报告不支持的文件。

## 验证

- PASS：TypeScript、69 项逻辑测试，其中 9 项移动扫描契约与 60 项原忽略、歌词排序及桌面音乐／封面导入回归。
- PASS_BUILD：ios:sync、iPadOS26.5 Simulator Release 和 iPhone Release 独立 QA 构建。
- PASS_NATIVE_SIMULATOR：iPad Pro 11-inch M5 / iPadOS26.5，5 项 XCTest。
- PASS_NATIVE_DEVICE：iPhone XS Max / iOS18.7.10，独立 `app.folia.validation.App`，同样 5 项 XCTest。
  实际执行协调目录读取和打包的 JS，覆盖父子忽略、同名歌词与封面优先级、重扫差异、删除检测、
  符号链接隔离、无效／过大忽略文件、数量／深度限制及取消。测试文件是扫描候选，不代表音频解码／播放验收。
- 首次模拟器构建缺少 ENABLE_TESTABILITY，补齐后通过。设备构建产生的测试描述仍缓存个人 Bundle ID；
  校验及时发现，第一次测试命令因无有效描述文件未执行用例。随后依据已签名 QA App 的 Info.plist
  修正独立描述文件并确认没有个人 Bundle ID，再执行测试通过。
- 证据位于 `.mobile-test-results/folder-scan-*`：unit.log、typecheck.log、sim.xcresult、
  device-fixed.xcresult、inputs.json 和设备前后记录。未修改个人 App 安装包。
- PASS_CI：源码 `f5802982eb2dcb0dbbd12d1eac69e3830cd8076c` 的
  [Mobile checks](https://github.com/Kun686/folia-Player/actions/runs/38173298578) 通过。
  提交前仅移除 localFileRules.ts 末尾的额外空行，差异记录于 cleanup-check.json；已测原生脚本未变。
- PASS_CLEANUP：QA 包移除、个人 App 重新打开，设备前后个人 App 记录完全一致；无遗留构建／测试进程或启动的模拟器。

逻辑命令：

```sh
npm run typecheck
npm run test:unit -- test/unit/mobile/nativeFolderRuntime.test.ts test/unit/utils/foliaIgnore.test.ts test/unit/lyrics/localLyricFormatOrder.test.ts test/unit/services/localMusicService.test.ts test/unit/services/localMusicCoverImport.test.ts
```

## 后续接线与验收

1. 系统目录选择和持久授权：保存设备本地 bookmark，根目录用独立稳定身份；同名根目录不得合并。
   失效授权通过重新选择恢复，不能当作目录已清空。
   已核对 Xcode iPhoneOS26.5 SDK 的 Foundation/NSURL.h：显式 withSecurityScope 选项不可用于 iOS；
   应使用 iOS 可用的 bookmark API，解析时避免隐式持有权限，并成对管理 start／stop 访问。
2. 导入事务：暂存到 App 自有目录，复用现有音频元数据、原歌词解码与封面处理；失败与取消回滚。
   读取实际内容前重新取得目录授权并核验签名；完整扫描成功后才允许处理删除项。
3. 增量重扫：保留歌曲身份、歌单引用和人工实体／匹配；分别处理音频、歌词、封面变化。
   扫描期间的用户编辑、文件变化与旧任务结果必须检查修订，不得覆盖新操作。
4. 目录浏览、搜索、范围播放、移除根目录／忽略子目录／恢复重扫：复用原目录和删除规则，
   只修改 Folia 自有记录及副本，不删除用户源文件。排队播放与歌单引用同步处理。
5. NOT_RUN：实际系统文件提供器权限、iCloud／NAS／移动目录、真实音乐导入／重扫、UI 和大曲库性能。
   以上闭环通过后再生成移动安装候选；扫描层测试不构成完整文件夹功能交付。
