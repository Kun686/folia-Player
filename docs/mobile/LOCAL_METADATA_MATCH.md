# 本地歌曲批量信息整理移植

2026-10-13，本批沿用原版文件夹“批量自动匹配／手动在线匹配”，补充移动触摸入口。
个人 App 仍为 mobile.28；本批不安装真机、不访问实际账户、不更新服务器。

## 行为与复用

- 本地音乐“全部歌曲”提供批量入口；实际文件夹内的入口只包含该目录及其后代。曲库搜索文字不改变整理范围，面板内仍可逐曲选择和搜索。
- 复用 `FolderAutoMatchEditor`、`FolderSongPicker`、`LocalSongMetadataMatchDialog`、原评分、来源回退及最多两个匹配任务的调度。
- 默认网易云优先、QQ 次之；酷狗仅在现有服务声明支持时参与。所有音乐搜索经过 Omni，仅发送原检索字段，不发送音频、歌词正文或内嵌封面。
- 批量自动匹配只更新歌曲信息与可选在线封面，保持歌词。沿用 `noAutoMatch` 与人工整理来源保护；手动匹配可分别选择元数据、封面，并确认替换已整理的实体关系。
- “使用本地信息”沿用原版完整恢复语义：恢复导入标签与内嵌封面、回到自动歌词来源、保留已有歌词载荷，并禁止后续自动匹配。这个显式恢复动作与批量匹配保持歌词是不同操作。
- 歌曲匹配成功但封面缓存失败时仍保留信息更新，显示逐曲部分成功状态。取消停止后续搜索／写入；已经开始的原子保存允许完成并计入结果，不撤销已完成项目。
- 保存过程中禁用关闭／重复提交；切换手动搜索来源、关闭面板或卸载组件后，迟到搜索结果不得恢复旧列表或触发保存。

没有新增依赖、数据格式、音乐模型或播放器视觉改动。桌面调用保留原服务默认实现；只增加可注入传输／存储接口。

## 原生保存边界

`LocalMatchStorage` 为原始歌曲、歌词编辑版本、匹配文档、当前实体分配／显示以及内嵌封面生成歌曲上下文摘要，排除全库版本与封面 Base64。
提交时在解析之后、同一原生 actor 的原子写入之前校验该摘要：允许其他歌曲导致的全库版本变化，拒绝同一首歌或其所引用实体的修改。
已有不带摘要的调用继续执行原全库版本检查，兼容此前接口。

在线读取另附不含 Cookie 的会话代次凭据。写入再次比对并验证原生账户与网关配置；前端也检查会话代次和取消状态。
恢复本地信息不依赖在线账户。新移动批量调用缺少原生摘要／必要会话凭据时失败，不退回无保护写入。

## 验证证据

本地证据目录：`.mobile-test-results/local-metadata/`。

| 层次 | 结果 | 范围／证据 |
| --- | --- | --- |
| 类型检查 | PASS | `npm run typecheck`；`typecheck.log` |
| 逻辑与原本地库回归 | PASS，78 文件／709 项 | `npx vitest run -c vitest.config.ts test/unit/mobile test/unit/localLibrary`；`final-unit.log`。其中移动646项，本地库63项，不与早期单独运行相加 |
| WebKit | PASS，45 场景 | `local-metadata`、`local-match`、`local-entities`、`local-folders`，各自覆盖 phone／ipad／ipad-narrow；`ui-final.log`、`ui-final/` |
| 原生模拟器 | PASS，19 项 | 独立 `app.folia.validation.App`、离线空白 WebView、真实原生文件／JSCore，受控网络；`native-tests.log`、`native.xcresult`、`native-command.json` |
| 移动资源与 Release QA 编译 | PASS | `final-build.log`、`native-final-build.log` |
| 已批准音频依赖核对 | PASS | `vendor.log`；固定 AudioStreaming 1.4.5，59 文件／4 处现有补丁 |
| 实际平台搜索／匹配 | NOT_RUN | 本批未请求真实音乐平台，受控响应不能代替平台验收 |
| iPhone／iPad、后台系统挂起 | NOT_RUN | 用户要求继续不依赖真机的工作 |

新增6项逻辑测试验证原回退与本地封面／歌词保留、无匹配许可或无原生凭据、取消迟到结果、取消期间已完成保存、账户变更／编辑冲突及封面部分失败／离线恢复。
新增5类界面场景共15项；新增2项原生测试证明不相关提交可共存，以及人工重命名实体不会被旧匹配覆盖。其余为既有回归。

首轮界面测试6项通过、3项失败：手动保存脚本错误查找“应用”，原版按钮实际为“保存选择”。仅修正定位器，保留首轮 `ui.log`／`ui/`；修正后的完整45项通过。

## 交付与回退

入口与移动适配分别位于 `src/mobile/LocalMetadataManager.tsx`、`src/mobile/localMetadataMatch.ts`；Swift 桥接与原子校验位于 `FoliaLocalMatchPlugin.swift`、`LocalMatchStorage.swift`。
原生队列、解码器、原模型 Automix 和已接受的全屏／磨砂控制器保持既有实现。
`BUILD_RECORD.json` 未修改。需要回退时撤回本批入口／适配及接口扩展；持久歌曲仍使用既有匹配文档和实体格式，不需要迁移。
完整 Automix 的真机／热状态与长期性能验收仍未完成，公开完整能力维持关闭。
