<!-- LIVE_LIBRARY_PAGINATION.md — actual account pagination, responsive controls, and verification boundaries. -->
# 两平台真实分页与曲库工具栏

2026-10-14，`mobile-main` 工作区。仅调整 QQ／网易云曲库的现有控件布局，复用
`CollectionQueueActions` 与现有样式；不新增依赖，不改变 provider、分页游标、播放或音效算法。

## 真实发现与修正

在已登录的独立 iPhone 模拟器里，网易云歌单原来的列表底部“加载更多”被固定播放条大幅遮挡。
输入框获取焦点、播放条临时隐藏后才能完整看到按钮；实际点击能将可入队范围从 50 增至 99。
因此本次将该按钮放入列表上方的“当前范围／加入播放队列”工具栏，搜索结果使用同样位置。
保留原有禁用、重试和队列行为，搜索仍使用单曲操作。

横屏时原有纵向顶部占用过多高度，分页区落在首屏下方。短而宽的在线曲库窗口将原有控件
两两并排，歌曲列表仍占整行。全屏播放器与动效面板不受此规则影响。

## 真实平台证据

目标：iPhone 17 Pro / iOS 26.5 Simulator，`9213032A-657A-40CD-BD2A-A3065ACCC8EC`，
Bundle ID `app.folia.validation.App`。使用用户此前完成登录的真实账号、正式 HTTPS 服务与歌曲。
操作通过实际界面完成，没有替换平台响应、账号或歌曲。

| 操作 | 已观察结果 |
| --- | --- |
| 网易云喜欢歌单 | 新入口可直接点击；可入队范围 50 → 99，原有首行保留 |
| QQ 我喜欢歌单 | 新入口可直接点击；可入队范围 50 → 100，原有首行保留 |
| QQ 搜索 `Power` | 回车提交有结果，关闭键盘后直接分页，显示范围 50 → 100 |
| 网易云搜索 `Power` | 回车提交有结果，关闭键盘后直接分页，显示范围 50 → 100 |
| 最终包横屏歌单 | QQ 50 → 100、网易云 50 → 99；分页按钮和第一首歌完整位于播放条上方 |
| 横屏 → 竖屏 | QQ 100 首范围保留，恢复原单列布局，分页按钮完整可见 |
| 状态保持 | 两账号仍显示登录，队列显示 51 首，仍暂停于网易云《莫愁乡》；未执行入队、歌单写入或播放 |

歌单“当前范围”是经过现有可播放性／身份处理的入队范围，99 不代表第二页原始响应只有 49 首。
搜索范围显示已加载结果数，不证明所有结果都可播放。未捕获本批完整原始响应，不推断上游总量。
队列保持本批依据是界面与未执行队列变更；没有新增 Keychain／队列字节级断言。

截图和本批日志：`.mobile-test-results/live-library-pagination/`。
`netease-page1.png`／`netease-page2.png`、`qq-page1.png`／`qq-page2.png` 记录真实歌单；
`qq-search-page1.png`／`qq-search-page2.png`、`netease-search-page1.png`／`netease-search-page2.png` 记录真实搜索。
`netease-before.png` 保存旧遮挡问题，`netease-landscape.png` 保存旧横屏占用情况。
最终横屏截图为 `qq-landscape-final-page1.png`／`qq-landscape-final-page2.png` 与
`netease-landscape-final-page1.png`／`netease-landscape-final-page2.png`；恢复竖屏为 `final-portrait.png`。

## 自动检查与安装

- 类型检查 PASS：`typecheck.log`、`typecheck-landscape.log`。
- 竖屏分页、搜索和队列回归：修正后 3 文件、三种 WebKit 视口共 **48 PASS**，`ui-corrected.log`。
  这些是受控响应测试，不替代上述真实平台验收；宽／窄 iPad 视口不等于 iPad 原生验收。
- 初轮 21 PASS／9 FAIL 保留于 `ui.log`。原因是测试仍拦截旧 QQ RPC 地址，生产移动搜索已改为
  `/mobile/search`；更新测试为当前移动路由和 502 错误封装后，只复验一次通过。
  未弱化错误重试、合法空页或登录保持断言。
- 移动资源与原生构建 PASS：`build.log`、`native-build.log`；原有 Swift 并发警告仍存在。
- 竖屏候选 128 个应用资源与 2 个空 Cordova 文件逐项一致；Bundle ID、模拟 Keychain 身份、
  `codesign --verify --deep --strict` 均通过。源码／产物摘要见 `manifest-portrait.json` 与
  `installed-manifest-portrait.json`，原包保留为 `PortraitValidation.app`。
- 横屏新增检查前两轮各 48 PASS／3 FAIL，分别保留于 `ui-landscape.log`、
  `ui-landscape-corrected.log`。首轮发现横向滚动的歌单行在网格中压缩，补 44px 最小高度；
  第二轮发现空的 `.collection-actions` 仍占行，导致首曲低于播放条，改为仅在横屏规则下隐藏空容器。
  用户已明确批准在原重试上限之外再执行一次、最多 3 分钟的回归；最终 **51 PASS（1.4 分钟）**，
  `ui-final.log`。新增断言覆盖 844×390 横屏、安全区、分页按钮和首曲不被遮挡、实际命中、分页与旋转恢复。
- 最终移动／原生构建 PASS：`build-final.log`、`native-build-final.log`。128 个应用资源在
  dist、Capacitor public、独立暂存包和已安装包之间一致；另有 2 个空 Cordova 文件。
  最终签名与模拟 Keychain 身份核对 PASS，`manifest.json`／`installed-manifest.json` 保存源码与资源摘要。
  主二进制 SHA256：`786d7f779a55ef9629b902274781a85d9cbac138d4297228590fb8e85c098d86`。
  最终包仅比竖屏候选增加横屏样式与在线曲库属性；真实搜索分页证据来自本批竖屏候选，最终包补验两平台横屏歌单。

执行命令（均由 `codex-bounded` 约束运行时间）：

```sh
npm run typecheck
node node_modules/@playwright/test/cli.js test -c playwright.mobile.config.ts \
  test/mobile-ui/collection-queue.spec.ts test/mobile-ui/qq-search-response.spec.ts test/mobile-ui/search-playback.spec.ts
npm run build:mobile
node node_modules/@capacitor/cli/bin/capacitor copy ios
xcodebuild build -project ios/App/App.xcodeproj -scheme App -configuration Release \
  ENABLE_TESTABILITY=YES ONLY_ACTIVE_ARCH=YES -xcconfig .mobile-test-results/qq-search-cover/validation.xcconfig \
  -destination 'platform=iOS Simulator,id=9213032A-657A-40CD-BD2A-A3065ACCC8EC' \
  -destination-timeout 30 -derivedDataPath ios/DerivedData -disableAutomaticPackageResolution
```

## 未覆盖与回滚

个人 iPhone 仍为 mobile.28，本批仅原位更新独立模拟器，未卸载或清除账号；服务器未再次部署。
本批音频／PCM、锁屏长播、蓝牙／网络切换、真机及完整设置／特效 UI 为 **NOT_RUN**；iPad 按用户要求暂缓。
QQ 偶发空结果的根因与长期稳定性仍未确认，见 [业务状态校验记录](QQ_SEARCH_STATUS.md)。
保留旧独立包，可同 Bundle ID 原位装回；不回写旧账号或缓存，不触及服务器会话。
本次记录只覆盖分页与曲库布局，完整移植仍未完成。
