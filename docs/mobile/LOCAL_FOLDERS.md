# 本地文件夹移植

2026-10-12，扫描与增量计划层、原生索引／音频暂存及同目录歌词／翻译／封面暂存已实现；
文件夹功能仍 IN_PROGRESS，尚未开放个人 App 入口。
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

## 原生索引与暂存事务

新增 `LocalFolderRecord`、`LocalFolderStore`、`LocalFolderStoreIO`、`LocalFolderTransactions`、
`LocalFolderMedia` 和 `LocalFolderAuthorization`，复用现有音频导入器、歌词记录和 Foundation 原子文件写入，
没有新增依赖或另写音频解码器。本层尚未连接系统目录选择或前端入口。

- 旧单文件导入仍保存在 `FoliaMedia/<song-id>/`。文件夹歌曲使用稳定歌曲 ID，由 `folders.json` 指向
  `.folder-generations/<generation-id>/` 的 App 自有副本；外部路径不成为播放身份。
- 新批次先准备在 `.folder-staging/<transaction-id>/`。音频和元数据准备、校验、移动完成后，
  以一次 `folders.json` 原子替换作为提交点；提交前不可从曲库或播放解析读取新歌曲。
- 提交失败仅清理本次新增副本，保留之前的索引及可播放文件。提交后清理失败不把成功误报为失败。
  替换／删除后的旧副本留到下一次 App 启动且尚未取得播放 URL 时清理，避免截断当前播放。
  因此同一启动期间多次重扫会暂时增加磁盘占用；大曲库耗时与空间尚未测量。
- 一次只允许一个批次。歌词、匹配、实体编辑、导入、删除等写操作更新曲库修订，准备期间发生新写入
  会使旧批次拒绝提交。替换时保留上传歌词、匹配文档和人工关系，并撤销旧歌词编辑令牌。
- 索引损坏、空文件或版本不支持时严格读取失败，不重置为空库；索引缺失也不自动清理保留的音频副本。
  启动只清理已知暂存／过期代目录，不跟随符号链接。
- bookmark 仅在原生层保存，使用 iOS 可用 API 解析及刷新，访问成对释放。
  测试中的 bookmark 来自 App 临时目录；它不能证明“文件”App、iCloud 或 NAS 的跨启动授权。

事务验证：

- PASS_RED_TO_GREEN：首次 10 项新测试中，9 项通过；损坏暂存歌词仍被提交的用例失败，
  同一用例产生 3 条断言失败。修复为提交前解析并校验歌词记录、匹配文档结构和曲库元数据身份，
  复用普通歌词读写的长度／来源校验。之后该用例通过。
- PASS_NATIVE_SIMULATOR：iPad Pro 11-inch M5 / iPadOS26.5，Release QA 共 43 项 XCTest 通过：
  10 项事务／授权基础测试，另含文件夹扫描、单文件导入、歌词导入／恢复、匹配、实体及离线播放回归。
  使用实际生成的 WAV/M4A 测试文件，不使用真实用户曲库或在线平台。
- PASS_BUILD：Simulator 与 iPhone Release 独立 QA 构建；签名校验通过。
  构建仍报告已有 NativeDeckAnalysis 的 Swift 并发警告，本次新增文件无编译警告。
- PASS_NATIVE_DEVICE：iPhone XS Max / iOS18.7.10，独立 `app.folia.validation.App`，同组 43 项 XCTest 通过。
  使用前述已校验 QA Bundle ID 的 xctestrun，不把个人安装作为测试宿主。
- PASS_CLEANUP：移除 QA 包并重新打开个人 App，前后 `app.folia.personal` 的完整安装记录相同，仍为 build27。
  回读模拟器已 Shutdown，未生成或安装新的个人 IPA。
- 证据在 `.mobile-test-results/folder-transaction-*`：red、green、device 的日志／xcresult，
  selected-tests.json、inputs.json 及设备前后记录。154 项 Swift／项目／原生 JS 输入摘要用于对照两端构建。
- PASS_CI：已测源码 `ec9aae1bfa96b0602f968b209702640c2f7c7076` 的
  [Mobile checks](https://github.com/Kun686/folia-Player/actions/runs/38175103976) 通过，含 TypeScript、移动逻辑测试和资源构建。
  本文随后仅补写证据链接；`BUILD_RECORD.json` 继续描述实际安装的 mobile.27。

## 后续接线与验收

1. 系统目录选择和持久授权接线：原生 bookmark 基础已实现，根目录用独立稳定身份；同名根目录不得合并。
   失效授权通过重新选择恢复，不能当作目录已清空。
   已核对 Xcode iPhoneOS26.5 SDK 的 Foundation/NSURL.h：显式 withSecurityScope 选项不可用于 iOS；
   应使用 iOS 可用的 bookmark API，解析时避免隐式持有权限，并成对管理 start／stop 访问。
2. 扫描到提交的完整编排：音频、歌词／翻译／封面暂存和原子提交基础已实现；仍需连接原生桥接、
   前台解码、增量调度和取消／恢复。原生读取已核验扫描项大小／修改时间；完整扫描成功后才允许处理删除项。
3. 增量重扫：保留歌曲身份、歌单引用和人工实体／匹配；分别处理音频、歌词、封面变化。
   扫描期间的用户编辑、文件变化与旧任务结果必须检查修订，不得覆盖新操作。
4. 目录浏览、搜索、范围播放、移除根目录／忽略子目录／恢复重扫：复用原目录和删除规则，
   只修改 Folia 自有记录及副本，不删除用户源文件。排队播放与歌单引用同步处理。
5. NOT_RUN：实际系统文件提供器权限、iCloud／NAS／移动目录、真实音乐导入／重扫、UI 和大曲库性能。
   以上闭环通过后再生成移动安装候选；扫描与事务层测试不构成完整文件夹功能交付。

## 同目录歌词、翻译与封面

- 从已验证的手工歌词导入提取 `nativeLyricFile`，文件夹 helper `nativeFolderLyrics` 也使用
  原 `decodeLyricFileBytes`。UTF BOM、严格 UTF-8 → GB18030、KRC XOR／解压及换行规则不变，
  单个输入和解压后 UTF-8 内容均限 2 MB；取消不会返回可提交的完整结果。
- 字节解码在前台 WebView 执行。独立探查发现 Foundation 的有损 GB18030 解码与浏览器处理坏字节的方式不同，
  因此未新增系统解码替代或编码依赖。后台播放继续读取已保存的歌词，由原有独立原生 parser 处理。
  最终目录编排仍需在页面离开／取消时撤销未完成批次，不把前台解码等同于后台导入完成。
- `LocalFolderFiles` 只读取完整扫描中的相对路径，逐层拒绝符号链接，在文件协调内复核大小与修改时间。
  读取采用 64 KiB 分块，最多读取预期大小加一字节，避免源文件在检查后增长造成无界分配。
  这保持原元数据签名语义，不是内容哈希或跨进程文件系统快照。
- 歌词记录新增可选 `translationContent`、`contentOrigin`、`translationOrigin`；旧记录仍可读。
  本地译文进入原前台 source adapter 和原生 planner 的同一输入；上传操作记录 upload 来源。
- 暂存时遵循原版规则：单纯调整歌词格式排序保留用户上传；实际同名歌词／翻译文件变化后才替换。
  主歌词与译文独立处理，删除同目录文件会清除对应 sidecar，内嵌歌词仍独立保留。
- 封面使用已有 `NativeCoverCache.thumbnail`，限制输入 8 MB 和图片尺寸。选中的文件夹封面覆盖暂存的内嵌封面；
  不可用的可选图片保留内嵌封面并记录 `folder-cover-unavailable` 提示，匹配文档中的在线封面选择仍保留。
  源文件变化、所需解码内容缺失和存储失败拒绝发布该暂存版本。
  独立字节解码失败的原版跳过／提示规则仍需在最终批次编排中处理。

验证：TypeScript、39 项相关逻辑测试与 ios:sync 通过。最终同源 Simulator / iPhone Release QA 构建通过，
iPad Pro 11-inch M5 / iPadOS26.5 Simulator 与 iPhone XS Max / iOS18.7.10 各 50 项 XCTest 通过，无失败或跳过。
其中 7 项新增内容测试覆盖原始字节、文件变化／符号链接、超限／取消、翻译和封面持久化、上传保留／磁盘更新、
sidecar 删除、缺失数据及不可用图片的提示回退；另重跑之前 43 项扫描／事务／曲库／歌词／播放测试。
前两次模拟器分别通过 48、49 项，随后补上读取增长边界与原版可选封面回退，最终证据以 parity-sim 的 50 项为准。
157 项原生源码／项目／JS 摘要一致；QA 包移除、个人 App 重新打开，前后完整安装记录一致，仍为 build27；模拟器已关闭。
本轮仅基础层与受控测试文件，不替代实际系统文件提供器、真实音乐文件夹或管理 UI 验收。
证据前缀为 `.mobile-test-results/folder-contents-*`；最终采用 parity-sim.xcresult、device.xcresult、parity-inputs.json、
对应 summary.json 和 cleanup-check.json。个人 App 未更新，BUILD_RECORD.json 仍描述 mobile.27。
源码 `722594e145a8285a9e9695b462a00a483b114b52` 的
[Mobile checks](https://github.com/Kun686/folia-Player/actions/runs/38176627743) 已通过；随后仅补写本证据链接。
