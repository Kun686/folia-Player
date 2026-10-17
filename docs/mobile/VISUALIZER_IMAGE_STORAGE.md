<!-- VISUALIZER_IMAGE_STORAGE.md — owned-byte image persistence and explicit validation boundaries. -->
# 自定义特效图片持久化修复

后续[莫奈／流浪／凝彩补验](VISUALIZER_SINGLE_ASSETS.md)：12项WebKit、类型与移动构建PASS；
另修复凝彩批量删除失败被忽略的问题。本后续补丁尚未原生安装，不与下方已安装候选混为一项。

2026-10-15：**用户明确批准两组各追加一次后，45项存储单测及六项群唱WebKit全部 PASS。**
类型检查与移动构建此前通过；这只关闭本补丁的两组自动回归门槛，不是全部特效或真机验收。
后续[合并候选](SETTINGS_CANDIDATE_PREPARATION.md)已更新独立iPhone模拟器并完成两类群唱素材原生导入、选择、重启恢复和清空。
个人 mobile.28、服务器及 iPad 未更新；未播放歌曲或读取账号凭据。

## 已确认的问题与方案

前批群唱自动 WebKit 六项检查保存图片时报
`UnknownError: Error preparing Blob/File data to be stored in object store`，
用户追加的一次内存字节上传仍六项失败。上传输入改为内存并未改变 App 持久化的 File 类型。

代码确认 `db.saveToCache`、`db.removeFromCache` 吞掉异常；群唱素材服务使用它们，
store 在 await 后更新图片并通知成功。因此真实写入／删除失败可被报告为成功。
前批 iOS 模拟器手动成功不等于自动 WebKit 问题已解决。

复用 `customLyricsFont.ts` 已采用的 owned-byte 方案与现有严格 cache repository：

- `visualizerImageAsset.ts` 保存 version 2／ArrayBuffer，读取时还原 Blob；保持原缓存键和渲染接口。
- 群唱头像／表情包复用同一编解码；共享单图路径覆盖莫奈人物、莫奈／流浪背景和凝彩图片。
- 凝彩 thumbnail 同样保存字节及 MIME，恢复时保留小尺寸预览，不改为解码完整原图。
- 写入／删除错误向上传递，store 仅在实际成功后发布状态；通用 `db.ts` 的历史语义保持。
- 读取旧 Blob 记录时不重写；不识别的版本／损坏数据不交给渲染器。
- 拒绝空文件／读取失败，避免保存后无法恢复；一次素材包转换全部成功后才替换缓存记录。
- 群唱、莫奈与流浪面板捕获保存／清空异常，显示三语言失败提示，并在操作期间禁用同组上传／清空。

无新增依赖、数据库版本升级、图片解码库或动画重设计。

## 检查及证据边界

证据目录：`.mobile-test-results/visualizer-image-storage/`。

| 检查 | 结果 |
| --- | --- |
| 初始独立单测 | **34 FAIL／5 PASS**（39项，0.893秒）。原实现写 Blob、无 byte record 兼容；其中错误注入位置无效，不能把这些失败认定为已成功注入存储故障 |
| 修改后独立＋相关单测 | **57 PASS／18 FAIL**（75项，4.39秒）。本文件21项通过：字节往返、重开读取、旧记录兼容、文件读取失败、版本过滤、缩略图。相关字体、凝彩归档和头像设置共36项通过 |
| 剩余18项错误注入 | **PASS（最终45项中的对应用例）**。原来 spy 的表实例未命中实际repository，已改到`IDBObjectStore.prototype.put/delete`，用例同时验证注入调用次数、拒绝结果及保留原素材／设置 |
| 最终45项存储单测 | **45 PASS，0.950秒**，`unit-approved.log`；含空文件／缩略图读取失败；本次授权仅执行一次 |
| 最终类型检查 | **PASS**：`npm run typecheck`，含最终生产补丁及测试源码 |
| 移动构建 | **PASS**：`npm run build:mobile` |
| 原六项 WebKit | **6 PASS，30.3秒**，`webkit-approved.log`；手机／宽平板／窄平板各头像及表情包一项，本次授权仅执行一次；历史FAIL保留 |
| 实际iPhone模拟器安装／群唱操作 | **PASS**，见合并候选；原生文件选择、重启渲染、App清空及只读持久化核对 |
| 真机、实际iPad、音频与性能 | **NOT_RUN（本补丁）** |

`unit-red.log`、`unit-green.log` 是未修正注入位置时的原始日志，保留失败，不能用作最终通过证据。
`typecheck-final.log`、`mobile-build.log` 对应最终候选；`source-manifest.json` 记录相关源码 SHA256。
`storage.patch` 与 `visualizerImagePersistence.test.ts` 为本批可审阅源码快照。

已更正之前口头“注入存储失败已复现”的表述：吞异常问题由实际 WebKit 日志和代码路径确认；
当时单测没有命中写入／删除，不能证明故障已注入。本次不靠移除断言或替换成成功 mock 取得通过。

## 获准执行及下一步

用户回复“允许两组各追加一次”后，顺序执行以下命令，均在时限内通过：

1. 最多60秒：`npm run test:unit -- test/unit/services/visualizerImagePersistence.test.ts`，45项。
2. 第1项通过后，最多180秒：`npm run test:mobile:ui -- test/mobile-ui/cappella-assets.spec.ts`，
   phone／ipad／ipad-narrow 的头像与表情包共六项，空播放队列、实际 IndexedDB，无真实平台请求。

WebKit使用真实IndexedDB与同一App图标的内存输入，不替换存储为成功mock；
验证导入、选择、刷新恢复、旋转后的清空按钮、清空后再次刷新。空队列，无真实平台请求。
两组结果与源码摘要记录在`approved-validation.json`，未覆盖历史失败日志。

独立模拟器构建、安装及群唱原生选择器补验已通过。辅助快照第三次获准执行仍失败后已弃用，
复用既有流程核对Mach-O内嵌身份、签名和128资源，见[候选准备记录](SETTINGS_CANDIDATE_PREPARATION.md)。
UI失败提示的真实错误状态、
莫奈／流浪／凝彩新存储路径仍需后续界面检查；不能把存储单测当作全部界面验收。

## 回退及范围

本批安装包为 `.mobile-test-results/settings-candidate-20261015/VerifiedValidation.app`，
回退包保留 `.mobile-test-results/visual-reset/VerifiedValidation.app`。
旧包只能读取旧 Blob 格式；若之后安装并新保存素材，回退旧包将无法显示这些 version 2 图片，
应在更新前保留原始素材／测试数据快照。没有自动删除或批量重写旧素材。

继续限定 QQ／网易云核心、原版特效和设置 UI。QQ偶发空搜索、完整特效／设置验收、
新候选真机、网易云30分钟锁屏和性能仍未完成；不扩展本地音乐或其他功能。
