# 移动端文件夹导入闭环

2026-10-12。承接 `LOCAL_FOLDERS.md` 的扫描、原子事务及配套歌词／封面基础层。
本轮不新增依赖，不改播放器、动效和在线 provider，不更新个人安装包。

后续打包：已汇入 **mobile.28**，2026-10-12 原位更新个人 iPhone 并启动，回读 build28。
准确源码 `25e69b409b30ac9bebcadb8ed179c8d281c226e8`；签名、资源一致性及
[准确源码 CI](https://github.com/Kun686/folia-Player/actions/runs/38179232026) 通过。
下文“个人 App 保持 mobile.27”描述独立 QA 开发阶段；当前交付见 [VALIDATION.md](VALIDATION.md)。

## 已接入

- 本地音乐增加“文件夹”分类。通过 iOS 系统目录选择器导入，浏览根目录／子目录，搜索范围内歌曲，
  复用原歌曲列表播放、追加队列及歌单操作。手机和 iPad 使用已有曲库布局、触摸目标和主题颜色。
- 支持重扫、忽略子目录、恢复重扫和移除根目录；移除前说明并确认仅改变 Folia 曲库及副本。
  原目录文件不被改写或删除。只在导入期间显示取消，原子移除不会展示无法兑现的取消操作。
- 原生 `LocalFolderImportSession` 持有访问权限、完整扫描、旧记录和暂存结果。
  WebView 仅提供批次 token、顺序索引和解码后的歌词，不提供绝对路径、书签或任意文件读取地址。
- 导入逐首读取／解码／准备，前一首完成后才读取下一首。字节解码继续使用原 `decodeLyricFileBytes`；
  可选歌词解码失败或超过 2 MB 时记录提示，不阻止可播放音频入库；翻译独立处理。
- 未变化歌曲复用已有 generation。相对路径未变化的更新保持歌曲 ID、手工匹配及实体关系。
  同名目录按实际目录身份区分；其他暂不可访问的根目录不会阻止新增可访问目录。
- 最后再扫描并比较完整计划、文件元数据与目录列表；新增、删除或修改会拒绝旧计划。
  比较仍基于原有大小／mtime 签名，不是内容哈希，也不是跨进程文件系统快照。
- 全部曲目处理后一次提交；旧目录快照、用户编辑冲突、取消和失败都不能发布半成品。
  不支持的音频逐首报告；无法解码的替换保留已有可播放副本，下次扫描仍会重试。
- 切到后台、WebView 开始导航、显式取消或桥接请求超时撤销批次；桥接操作及等待前端的阶段有 120 秒租约。
  进行中的文件协调／复制持有权限直到返回，之后释放。已完成的原子提交优先于紧接着发生的取消，前端总会刷新权威曲库。
- 提交后刷新队列的本地元数据、歌词缓存和曲库事件。现有本地歌单通过完整曲库刷新修复引用。
  成功提交后视图刷新失败不会把已成功的导入误报为失败。

主要入口：`src/mobile/localFolderImport.ts`、`useLocalFolders.ts`、`LocalFolderTools.tsx`、
`localFolderBrowser.ts`；原生 `FoliaFolderPlugin.swift`、`FolderImportBridge.swift`、
`LocalFolderImport.swift`、`LocalFolderPreparation.swift`。

## 验证与边界

| 层次 | 结果 | 证据与范围 |
| --- | --- | --- |
| TypeScript | PASS | `folder-flow-typecheck-final.log` |
| 相关逻辑 | PASS，27 项 | `folder-import-unit.log`：批次顺序、取消、过期响应、提交竞争、可选解码失败、目录范围、原有分组／解码／扫描 |
| WebKit UI | PASS，15 项 | `folder-import-ui.log`：手机、宽屏 iPad、窄窗口，各 5 项，包括原专辑／艺术家回归 |
| UI 最后调整 | PASS，6 项 | `folder-flow-ui-removal.log`：三尺寸各 2 项；补验标签单行、取消、移除及错误处理 |
| 原生模拟器 | PASS，57 项，无跳过 | `folder-flow-sim.xcresult`：7 项完整批次测试 + 原有 50 项回归 |
| 原生 iPhone QA | PASS，57 项，无跳过 | `folder-flow-device.xcresult`：iPhone XS Max / iOS 18.7.10，独立 `app.folia.validation.App` |
| 系统选择器实际操作 | PASS，生成样本 | iPad Pro 11-inch M5 / iPadOS 26.5 模拟器中用系统 Files 选择目录；3 个生成 WAV 中按 `.foliaignore` 导入 2 个 |
| 导入后播放与恢复 | PASS，模拟器观察 | 原歌词动画与翻译显示、自动切到第二首、横屏全屏布局；重启后重扫保留 root/song ID 与 generation，源文件摘要不变 |
| 真音乐／真实文件提供器 | NOT_RUN | 用户目前没有本地歌曲可测；iCloud、NAS、移动／失效目录的授权恢复、真机系统目录选择仍待验收 |
| 性能与生命周期压力 | NOT_RUN | 大曲库、低存储、长时间导入、后台／WebView 崩溃时的系统级故障注入仍需独立验证 |

全部本地证据位于 `.mobile-test-results/`。系统选择器证据为 `folder-flow-picker-*`：
source.json、import.json、rescan.json、landscape-final.png、rescan.png。无私人音乐、账户或书签内容进入报告。
原生测试与最后界面微调分别保留证据：测试间 Swift／项目及 `public/native` 资源未变化；
模拟器原生测试后修正标签换行，设备原生测试后修正移除状态文案／取消入口，均重跑受影响 UI 与类型检查。
`folder-flow-inputs.json`、`folder-flow-final-inputs.json` 保存构建输入摘要，最终前端资源另经 `ios:sync` 生成。

初次 7 项模拟器测试为 6 通过、1 失败：错误地要求重启刷新书签后的索引字节摘要相同。
修正为核对稳定身份及 generation 后，最终 57 项全通过；初次失败没有算作验收通过。

QA 测试包已从 iPhone 移除，个人 App 重新打开；前后完整个人安装记录相同，仍为 build 27。
`BUILD_RECORD.json` 继续描述实际安装的 mobile.27。本轮源码不是已安装的 mobile.28。
模拟器已关闭，测试服务器和自动日志采集已结束。

源码 `d29633408308ff3ddc5df503ab744be90755ccc1` 已推送；
[Mobile checks](https://github.com/Kun686/folia-Player/actions/runs/38178575681) 全部通过，
包括 vendor 校验、干净安装、TypeScript、全部 mobile 单测和移动构建。
清理复核 `folder-flow-cleanup-check.json` 确认个人安装记录不变、QA 已移除、164 项原生输入摘要一致且无遗留测试进程。

## 尚未交付

目录扫描能发现 Ogg／Opus，不代表现有 AVURLAsset 本地导入器已经能解码这些格式；本轮会明确提示跳过。
全根目录一键重扫后续已完成开发与独立 QA 验证，尚未加入个人安装包，见 [LOCAL_FOLDER_RESCAN.md](LOCAL_FOLDER_RESCAN.md)。
自动监听目录变化、曲库规模性能验证和真实文件提供器验收尚未完成。
完整移动移植任务继续进行，Automix 生产集成和其他既有未验收项不因本轮测试通过而改变状态。
