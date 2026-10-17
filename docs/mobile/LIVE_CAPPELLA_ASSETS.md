<!-- LIVE_CAPPELLA_ASSETS.md — Cappella asset wiring, simulator evidence, and unresolved WebKit storage failure. -->
# 群唱自定义头像与表情包

2026-10-15后续：[字节持久化补丁](VISUALIZER_IMAGE_STORAGE.md)45项单测及原六项WebKit已全部通过；
[合并候选](SETTINGS_CANDIDATE_PREPARATION.md)已安装独立模拟器，原生导入／选择／重启恢复／清空补验通过。
下面保留前批实际操作和自动失败记录，不能当作新存储补丁的验收证据。

2026-10-15：修复移动设置漏传状态导致「图片已导入，但自定义和清空仍禁用」的问题。
实际 iOS 模拟器素材链路通过；自动 WebKit 六项回归未通过，不能视为完整验收。
仅更新独立 iPhone 模拟器；个人 mobile.28、服务器及 iPad 未更新。

## 问题与最小修复

旧包通过原生文件选择器导入头像后已有图片预览，但面板仍提示没有自定义头像，两个按钮禁用。
`src/mobile/VisualSettings.tsx` 仅传了图片数组，漏传原版面板需要的数量、是否存在及加载状态。
对照 `src/components/visualizer/VisPlaygroundSettingsPanel.tsx` 的已有接线，在资产选择器补齐五个字段：
`cappellaCustomEmojiCount`、`hasCappellaCustomEmojiPack`、`hasCappellaCustomAvatar`、
`isCappellaCustomEmojiPackLoading`、`isCappellaCustomAvatarLoading`。

复用既有 Zustand store、原设置面板、导入／清空动作和 IndexedDB；不新增依赖、组件、样式或存储实现。
原版动画与参数语义保持。`VisualSettings.before.tsx` 是本批修改前副本，本批生产改动为五行；
工作区其他既有修改不归入本批。新增 `test/mobile-ui/cappella-assets.spec.ts` 保留真实存储检查。

## 验证结果

| 层级 | 结果与范围 |
| --- | --- |
| 类型与构建 | **PASS**：`npm run typecheck`、`npm run build:mobile`、`./node_modules/.bin/cap copy ios`、Xcode Release 独立包构建 |
| 包核对 | **PASS**：独立签名、128个 Web 资源和2个空 Cordova 文件一致；原位安装并重开成功 |
| 原代码复现 | **2 FAIL（预期复现）**：phone 两项均在导入后的 `custom.toBeEnabled()` 失败 |
| 修复后自动回归 | **6 FAIL**：选择状态已可用，但 WebKit 保存素材报 `UnknownError: Error preparing Blob/File data to be stored in object store`，重载后素材未保留 |
| 用户追加批准的一次回归 | **6 FAIL**：同一 PNG 改为内存字节输入，仍捕获 `Cache save failed DexieError`；失败在保存错误断言，未跑完后续恢复／清空步骤 |
| 实际 iPhone 模拟器 | **PASS（手动操作＋存储核对）**：头像及表情包导入、选择自定义、各显示1个、App 重启保留；横屏面板及关闭按钮可见 |
| 实际清空 | **PASS**：通过 App 分别清空，预览消失、自定义／清空禁用、回退内置；只读确认两类记录均删除，重开后仍不存在 |
| 真机、实际 iPad、音频、后台长播、性能 | **NOT_RUN**：本批全程真实 QQ《我不难过》暂停，没有 PCM、声音质量或播放连续性新增证据 |

自动六项为头像／表情包 × phone／ipad／ipad-narrow，使用空播放队列，仅检查素材设置。
没有模拟歌曲参与真实平台验收，没有用 mock 持久化、skip 或去除断言制造通过。
实际 iOS 能保存不等于自动 WebKit 错误已解决；具体原因未知，不能归因于文件路径输入方式。
追加许可已经消耗，本批不再运行该回归。

自动命令（均用有界包装执行）：

```sh
npm run test:mobile:ui -- test/mobile-ui/cappella-assets.spec.ts --project=phone --output=.mobile-test-results/live-mode-settings/red
npm run test:mobile:ui -- test/mobile-ui/cappella-assets.spec.ts --output=.mobile-test-results/live-mode-settings/green
npm run test:mobile:ui -- test/mobile-ui/cappella-assets.spec.ts --output=.mobile-test-results/live-mode-settings/byte-input
```

## 实际环境与证据

- iPhone 17 Pro／iOS 26.5，UDID `9213032A-657A-40CD-BD2A-A3065ACCC8EC`。
- Bundle `app.folia.validation.App`，application-identifier `33GAKXJHL3.app.folia.validation.App`。
- 版本字段仍为0.7.16／28；以本批 manifest 区分独立候选，主二进制 SHA256：
  `392bbc39656ea21c2efb6191bbc9a9f5c7da1db432f8cd36fd54be299ef864cf`。
- 素材是仓库 App icon，临时文件 `Folia-QA-Avatar.png`，110522字节；SHA256：
  `29e4777e319de3ee5a52c3a8004ec19d0568414004257e36d7c94a077d71c93b`。

证据目录 `.mobile-test-results/live-mode-settings/`：

- `cappella-import-disabled-before.png`：旧包导入后仍禁用。
- `avatar-restored-selected.png`、`both-assets-selected.png`、`both-assets-after-restart.png`：可选、数量和重启保留。
- `assets-landscape-mirror.png`、`both-assets-cleared.png`：横屏及清空状态。
- `restored-assets-storage.json`：两类资产记录和测试文件名；只读取相关记录。
- `red.log`、`green.log`、`byte-input.log`：自动失败证据。
- `typecheck.log`、`mobile-build.log`、`cap-copy.log`、`native-build.log`：构建结果。
- `manifest.json`、`installed-manifest.json`：源码／资源／包身份。

安装成功后 CoreSimulator 迁移了 data 容器；最初安装脚本在路径不变断言处失败。
后续按 `installed-paths.json` 的新容器核对数据与包内容通过，没有再次安装；不能把容器路径变化当作数据丢失。
更新后两平台账号可见，网易云歌单入口可见；QQ截图时歌单仍在加载，不算两平台所有接口重新通过。

## 恢复、清理与后续边界

App 内清空素材之后，停止独立 App，仅把本轮两个外观键恢复到基线：
`visualizer_mode=diorama`，删除基线不存在的 `cappella_tuning`。
修改前确认值为本轮群唱／内置设置，事务内核对其他 localStorage 条目保持。
这是测试收尾，不作为产品自动恢复证据；清空资产的 PASS 依据来自此前 App 操作和只读核对。

临时 PNG 在 SHA256 相符后删除；未写队列、音效、账号或 Keychain。
`restoration.json` 与 `after-relaunch.json` 确认16个采集外观键、完整50首队列、index 2、
276.4506575963719秒暂停位置及音效保持。`restored-player.png` 显示镜台和04:36暂停状态。
`cleanup.json` 确认安装资源保持、测试助手无残留，3200／9222／4179无监听；镜像页关闭。
独立 App 保留打开供用户使用。

回退包保留于 `.mobile-test-results/logout-cancellation-ownership/VerifiedValidation.app`；本批未执行回退。
QQ偶发空搜索、完整特效／设置UI、当前候选真机及长播仍待验收；不扩展本地音乐或其他功能。
