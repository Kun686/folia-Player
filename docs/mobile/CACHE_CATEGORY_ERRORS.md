<!-- CACHE_CATEGORY_ERRORS.md — mobile cache error propagation and bounded verification evidence. -->
# 封面与歌词缓存错误反馈

2026-10-15：移动端缓存容量读取／分类清理不再吞掉网页数据库错误。
10项逻辑、9项WebKit、类型与移动／原生构建通过，修复包已原位更新独立iPhone模拟器。
个人iPhone mobile.28、服务器和实际iPad未更新；没有清除已登录模拟器的现有缓存。

## 问题与修复

`src/services/db.ts` 的历史兼容层将分类容量读取失败转换为全零，并忽略分类清理错误。
原生封面／歌词缓存的错误原已向上传递，但原生步骤成功、后续IndexedDB步骤失败时仍会进入上述兜底。
结果是有缓存却显示0 MB，或清理未完成而设置页不显示错误。

复用现有 `MobileRuntime`、严格数据库仓库和 `ResourceCacheControls` 错误／重试界面：
只在已注入移动运行时的两个分类API中继续抛出错误，非移动端保持原兼容语义。
没有新依赖、新缓存格式或额外重试，也没有改变缓存类别、原生播放、动效和设置样式。
普通读取失败显示“—”并允许重试；清理失败显示现有错误，显式再次清理可恢复。

原生缓存与网页数据库是独立存储，清理不具备跨存储事务：原生部分可能已清空、网页部分保留。
本修复报告未完整完成的清理，不声称能撤回此前成功的原生删除。
OPFS内部的历史兜底不在本次修改范围，不将本次IndexedDB故障覆盖说成所有存储故障均已验收。

## 检查与证据

目录：`.mobile-test-results/cache-category-errors-20261015/`。

| 检查 | 结果与边界 |
| --- | --- |
| 原实现定向逻辑 | **3 FAIL／2 PASS**，`red.log`；移动读取和两类清理错误被吞，非移动兼容项通过 |
| 修复后相关逻辑 | **10 PASS**，`green.log`；新5项边界及既有5项原生缓存集成，不重复相加历史结果 |
| WebKit界面 | **9 PASS，17.7秒**，`ui.log`；phone／ipad／ipad-narrow各3项，实际IndexedDB getAll／delete一次性故障及命中计数、错误显示、读取重试、删除失败记录保留与再次清理 |
| 类型检查 | **PASS**，`typecheck-final.log`；首次测试文件的浏览器动态import路径被TS误作本机路径，修正为运行时路径与真实模块类型后仅重试一次 |
| 移动资源／原生构建 | **PASS**，`mobile-build.log`、`capacitor-copy.log`、`native-build.log`；沿用锁定依赖和validation配置 |
| 安装资源与身份 | **PASS**，`manifest.json`／`installed-manifest.json`；128个前端资源及2个空Cordova文件、签名、内嵌权限与xcent一致 |
| 原生实际设置页 | **PASS（正常读取观察）**；显示封面0.9 MB／歌词0.3 MB，没有错误提示，见 `native-cache-settings.png`。未注入原生错误、未点击清理 |
| 两平台账号／歌单入口 | **PASS（界面观察）**；QQ和网易云加载完成后原账号与个人歌单入口可见，不是全部接口／播放回归 |
| 原队列与外观保持 | **PASS**；`final-state.json`：完整50首队列／音效JSON逐值匹配本批基线，位置276.4506575963719秒，44项采集外观相同，未做数据恢复写入 |
| 音频／长播／性能／真机／实际iPad | **NOT_RUN（本批）**；故障测试空播放队列，原生实际QQ《我不难过》保持暂停 |

测试文件：`test/unit/mobile/cacheCategoryFailures.test.ts`、`test/mobile-ui/cache-category-errors.spec.ts`。
逻辑测试在仓库API边界注入错误；WebKit直接注入真实IndexedDB调用并核对缓存记录，不使用虚构歌曲替代平台验收。
构建既有大chunk、动态导入和供应商排除路径提示保留；本批未变更打包策略或第三方源码。

实际命令均由 `codex-bounded` 限时执行：

```sh
node node_modules/vitest/vitest.mjs run -c vitest.config.ts \
  test/unit/mobile/cacheCategoryFailures.test.ts test/unit/mobile/coverCache.test.ts
node node_modules/@playwright/test/cli.js test -c playwright.mobile.config.ts \
  test/mobile-ui/cache-category-errors.spec.ts
npm run typecheck
npm run build:mobile
node node_modules/@capacitor/cli/bin/capacitor copy ios
xcodebuild build -project ios/App/App.xcodeproj -scheme App -configuration Release \
  ENABLE_TESTABILITY=YES ONLY_ACTIVE_ARCH=YES \
  -xcconfig .mobile-test-results/qq-search-cover/validation.xcconfig \
  -destination 'platform=iOS Simulator,id=9213032A-657A-40CD-BD2A-A3065ACCC8EC' \
  -destination-timeout 30 -derivedDataPath ios/DerivedData -disableAutomaticPackageResolution
```

## 候选与后续边界

Bundle `app.folia.validation.App`，内嵌身份 `33GAKXJHL3.app.folia.validation.App`；版本字段仍0.7.16／28。
本批主二进制SHA256：`811b5dde15ff46daf4455f9cb1a584e68bc3fbc98d8487958478d25e07067300`。
回退包 `.mobile-test-results/single-assets-native-20261015/layout-final/VerifiedValidation.app` 保留，可同身份原位回退，不卸载App。
结束恢复网易云曲库和原QQ歌曲暂停状态；无镜像服务，Playwright管理的Vite已结束，进程核查见 `cleanup-final.json`。

切回网易云时观察到加载期间短暂显示“扫码登录”，加载完成恢复原账号；未见真实退出或凭据丢失。
这项加载反馈另待核对，不计为本修复解决。QQ偶发空搜索、完整特效／设置UI、真机长播、蓝牙／网络、歌词误差和长期性能仍未完成。
