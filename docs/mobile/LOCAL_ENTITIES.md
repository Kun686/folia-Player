# 本地艺术家／专辑实体移植

2026-10-12，实体编辑已完成端到端接线，汇入 mobile.27 并原位安装于个人 iPhone，已启动且回读 build27。
下述原生／WebKit／模拟器交互分别记录，不能替代用户曲库与物理 iPad 验收。完整移动移植仍 IN_PROGRESS。

## 复用与实现选择

- 原 `localLibraryEntityMutations` 的改名、合并、拆分和成员迁移提取到
  `localLibraryEntityOperations`／`localLibraryArtistSplit`；原桌面 API 与 Dexie 原子事务保留。
  仅选中成员的操作仍使用 `bulkGet`，合并仍按全量关系表处理；不为抽取引入额外全曲库扫描。
- 原删除歌曲后的孤立实体家族清理提取到 `localLibraryEntityDeletion`，由桌面和原生共用。
- 名称清理、导入歌手拆分、别名、合并重定向均复用原 helper。在线结构化歌手名保留整体，
  导入标签按原规则拆分；空标签不会生成空名称实体。
- `nativeLibraryRuntime` 编译为本地 `native/library.js`，用已有 JavaScriptCore 执行。
  不在 Swift 中重写实体匹配／合并规则，不需要新 npm、SPM 或运行库。
- `NativeLibraryStore` 接收歌曲身份和元数据快照，仅持久化实体、关联及元数据版本，
  不修改音频、原始标签、歌词或凭据。现在由 LocalMediaLibrary actor 唯一持有，原生目录、匹配写入和队列均已接入。

## 数据一致性

原生文档为 `library-entities.json`，版本 1。读取缺失文档可生成确定性的初始实体 ID，
读取本身不写盘；首次编辑才原子保存。改名保持实体 ID，合并保留别名与重定向，
拆分仅修改选中的当前成员，艺术家支持多个目标的追加／替换模式。

原业务输入检查同时补强：已失效的源实体、循环重定向、跨种类合并、没有当前成员的拆分、
无效追加／替换模式会失败，不创建空实体。桌面有效操作行为与原测试保持一致。

写入修订值同时覆盖磁盘文档和当前歌曲元数据；两者任一变化，旧编辑提交返回
`local-library-changed`。比较到原子写入之间没有异步挂起点，需由同一个 `LocalMediaLibrary`
actor 串行持有存储。磁盘损坏、未知文档版本和读写失败均保留原文件，不当成空曲库重建。
落盘使用首次解锁后可访问的文件保护策略；单次输入／输出限制 32,000,000 字节。

原生输入的 `metadataRevision` 表示明确的匹配／恢复动作。相同输入保留人工关系；
匹配流程在同一份原子歌词／匹配文档中持久化独立的歌手与专辑版本，只重新计算显式选择的字段。
在线结构化名称不按导入标签重新拆分；候选缺少的字段及 protectOrigins 指定的人工关系保持不变。
普通歌词／封面修改不改变关系。沿用原弹窗对人工关系覆盖的确认，提交再检查歌词 token 与曲库修订。

## 存储层初期验证（接线前历史记录）

- TypeScript：通过。初次抽取的可空名称类型错误已修正。
- 42 项逻辑测试：原曲库事务／解析／编辑模型 32 项，加原生 runtime 10 项。
  包括原子回滚、稳定 ID、别名、改名／合并／拆分、多歌手、失效成员、损坏文档、
  空标签和在线结构化名称，不请求真实平台。
- iPadOS26.5 模拟器独立 QA：5 项原生测试通过，实际执行打包的 JavaScriptCore 规则并读写临时文件。
  首轮 4 项通过，保护属性检查失败；确认模拟器不返回该属性后明确记为
  `NOT_RUN_SIMULATOR`，重跑通过。覆盖重启重读、旧修订拒绝、损坏文档保留、真实目录写权限失败、
  拆分和删除成员清理；此处的“重启”是重建存储对象，不是 App UI 重启验收。
- 最终源码 iPhone XS Max / iOS18.7.10 独立 QA：5 项测试通过，包含真实文件保护属性、
  重建存储对象后重读、陈旧输入／编辑拒绝、损坏文件不重建、目录只读时原文件不变、原多歌手拆分与孤立清理。
  首次一体化 `xcodebuild test` 错选已有个人 App 为宿主，测试未执行；改为已核验
  `app.folia.validation.App` 的显式 xctestrun 后通过。最终补充提交前完成响应序列化检查、拒绝 JSON null 文档，
  重新签名构建并执行这 5 项测试仍通过，记录 `entities-device-final.xcresult`。
  文件保护属性符合首次解锁后策略，不等于实际锁屏／重启手机周期验收。
- 最终 TypeScript、42 项逻辑和 `ios:sync` 通过。实际设备 QA 包中的 `native/library.js` 与同步资源一致，
  SHA256 `b8ea06dacfea380f6f5db14b57414eeb687bc0c8fa2b9a0dcd0ded0883807506`。
  QA 包在测试后移除；个人 `app.folia.personal` 始终为原 mobile.26，未被更新或卸载。

证据位于 `.mobile-test-results/entities-*`。模拟器证据是前一轮实现，最终源码由上述逻辑测试和 iPhone QA 验证；
该阶段没有执行移动编辑 UI、大曲库性能、播放中编辑或真实平台操作；后续接线证据见下一节。

## 实际接线与验证

- 完整目录快照由同一个 actor 同步读取、计算、校验和提交；导入中尚未完成的目录、损坏文件会拒绝编辑。
  普通浏览可降级展示仍能读取的歌曲，但不开放实体编辑，也不会持久化部分目录所推导的关系。
- 从 playbackAdapters 提取原实体展示映射为纯 helper，桌面仍使用同一实现；原生 JavaScriptCore 同样投射名称。
  曲库返回稳定实体身份和独立的原始标签／匹配数据，编辑建议不会把人工改名误当成导入标签。
- 原生队列在启动时恢复最新元数据，提交编辑与匹配时更新重复歌曲和脱离队列的当前曲目。
  前端送回旧名称会被已读取的原生元数据覆盖，保留音频对象、generation、位置和播放意图。
- 手机从专辑／艺术家详情进入原 EntityEditorWorkspace，支持改名、双向合并、专辑拆分／移入、
  多歌手目标追加／替换。写入失败保留输入；冲突必须主动重新读取；提交中禁用关闭及重复操作。
- 源数据 key 兼容原四项结构，新字段版本分别跟踪歌手和专辑，保持文档版本 1。
- 本轮 92 项相关逻辑／原桌面曲库回归通过，TypeScript 通过。移动 WebKit 33 项独立用例通过；
  最后修复窄屏底栏负边距后重跑其中 12 项实体编辑用例通过，不能合计为 45 项独立用例。
  手机／iPad／窄窗口覆盖改名、合并、单曲拆分、多目标追加、错误／冲突／待处理提交与横屏。
- iPadOS26.5 模拟器 14 项原生测试、iPhone XS Max / iOS18.7.10 独立 QA 14 项测试通过。
  实际执行 JavaScriptCore 和原生文件 I/O，覆盖新增 4 项完整导入目录／匹配／队列集成，以及 10 项原匹配／存储回归。
  最初新增测试没有加入测试目标，只执行了原 10 项；修正后核实报告为 14 项，再在 iPhone 执行同样 14 项。
- iPad 模拟器实际从系统文件选择器导入两首带歌手／专辑标签的合成 M4A，显示并播放到第二首；
  将 QA Artist 改名 QA Renamed，将 Entity QA 1 拆至 QA Solo，旋转横屏后两个分类各一首。
  终止并重启 App 后分类名称、成员及当前队列名称保持正确，磁盘文档与界面一致。
  不是商业歌曲或真实音乐账户验收；播放中编辑不跳音的精确断言来自原生测试。

证据位于 .mobile-test-results：entities-wiring-regression.log、entities-ui-matrix.log、
entities-ui-layout-fixed.log、entities-integration-fixed.xcresult、entities-wiring-device.xcresult、
entities-wiring-native-inputs.json、entities-sim-*.jpg、entities-ui-record-final.json。
独立 iPhone QA 包已删除，模拟器已关闭。

## mobile.27 交付

准确源码 `e98b13e8671ff6c9afd9db3b014f49e4a425b706`；3,043 项输入与 121 项资源、签名、IPA 一致性通过。
`ios:sync`、iPhone Release 构建和 [准确源码 CI](https://github.com/Kun686/folia-Player/actions/runs/38172209182) 通过。
88 项原生测试输入（含生成的共享 JS）在最终打包时摘要一致。iPhone XS Max / iOS18.7.10 原位更新并启动，
设备回读 build27；mobile.26 原包摘要未变，可原位回退。构建和安装记录见 mobile27-* 与 [VALIDATION.md](VALIDATION.md)。

## 验收边界与未完成项

- NOT_RUN：用户真实本地曲库、物理 iPad、大曲库性能、实体文件跨实际锁屏／手机重启周期。
- 匹配界面冲突会明确失败，重新打开可读取最新状态；不存在后台自动覆盖人工关系。
- 文件夹管理、完整 Automix 的生产接入、长期真机矩阵等完整移植事项继续保持未完成。
