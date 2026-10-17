<!-- ACCOUNT_LOADING.md — account resolution feedback and scoped validation evidence. -->
# 平台切换时的账号加载反馈

2026-10-15：修复账号尚未确认时短暂显示“扫码登录”的问题。
48项逻辑、21项WebKit、类型与移动／原生构建通过，已原位安装独立iPhone模拟器。
实际QQ／网易云账号及个人歌单入口均恢复，个人iPhone mobile.28与服务器未更新。

## 问题与最小修复

切换平台时 `useCatalog` 创建新的视图会话，初始 `user: null` 原被界面直接视作未登录。
此前真实模拟器曾短暂出现“扫码登录”，随后恢复原账号；这是加载反馈问题，不是凭据丢失。

- `src/mobile/catalogSession.ts` 增加 `accountChecked`；初始及账号刷新时为false，当前账号响应成功后为true。
  歌单读取与分页继续使用原 `accountBusy`；账号确认不等待歌单，歌单错误不抹掉已经确认的用户。
- `src/mobile/MobileApp.tsx` 在未确认时显示不可点击的“正在加载…”，账号读取失败后显示“重试”；
  确认未登录后才提供扫码。已有用户刷新时保留用户名，避免将歌单加载当作退出。
- 未配置／连接失败沿用原连接反馈，不永久显示账号加载。显式退出仍沿用原清理和失败重试语义。
  未修改 `useCatalog` 的生命周期、Omni/provider接口、Keychain、取消范围或会话持久化。

复用现有会话、过期响应保护、按钮与翻译，无新增依赖、设置或样式。
不缓存一个平台的用户名到另一个平台，也不通过额外账户请求掩盖加载过程。

## 验证与证据边界

证据目录：`.mobile-test-results/account-loading-20261015/`。

| 检查 | 结果与证据 |
| --- | --- |
| 新状态契约原实现 | 6项FAIL，`red.log`；原状态没有区分未检查与确认未登录 |
| 修复后相关逻辑 | **48 PASS**，`unit.log`；新增6项、原曲库24项及退出／取消归属18项 |
| WebKit手机／平板／窄平板窗口 | **21 PASS／30.2秒**，`ui.log`；两平台延迟、切走切回、错误重试、确认未登录、歌单等待及未配置连接；DOM变更记录检查等待期间不出现扫码按钮 |
| 类型、移动与原生构建 | **PASS**，`typecheck.log`、`mobile-build.log`、`capacitor-copy.log`、`native-build.log` |
| 包身份／资源与原位安装 | **PASS**，`manifest.json`、`installed-manifest.json`；128前端资源和2个空Cordova文件、签名及内嵌权限一致 |
| 真实账号界面 | **PASS（独立iPhone模拟器观察）**；更新启动后网易云、切换QQ、再回网易云均显示原账号与个人歌单入口，见 `native-qq.png`、`native-netease.png` |
| 真实等待过程 | 账号请求较快，原生截图捕获到已确认账号及歌单加载阶段；不将截图说成逐帧证明。长时间账号等待与失败由WebKit受控测试覆盖 |
| 队列／设置保持 | **PASS**，`baseline.json`、`final-state.json`；完整50首队列及音效JSON逐值相同，位置276.4506575963719秒、44项外观保持，无恢复写入 |
| 本批音频／长播／性能／真机／实际iPad | **NOT_RUN**；QQ《我不难过》持续暂停，受控界面测试均为空播放队列 |

逻辑测试：`test/unit/mobile/catalogSession.test.ts`、`logoutSession.test.ts`、`logoutCancellationOwnership.test.ts`。
界面测试：`test/mobile-ui/account-loading.spec.ts`，复用原账号transport fixture与真实Omni，不替代真实平台验收。
两组最终检查、类型和构建均一次通过；构建既有大chunk／动态导入等提示保持，未改打包策略。

实际命令均由 `codex-bounded` 限时执行：

```sh
node node_modules/vitest/vitest.mjs run -c vitest.config.ts \
  test/unit/mobile/catalogSession.test.ts test/unit/mobile/logoutSession.test.ts \
  test/unit/mobile/logoutCancellationOwnership.test.ts
node node_modules/@playwright/test/cli.js test -c playwright.mobile.config.ts \
  test/mobile-ui/account-loading.spec.ts --output=.mobile-test-results/account-loading-20261015/ui
npm run typecheck
npm run build:mobile
node node_modules/@capacitor/cli/bin/capacitor copy ios
xcodebuild build -project ios/App/App.xcodeproj -scheme App -configuration Release \
  ENABLE_TESTABILITY=YES ONLY_ACTIVE_ARCH=YES \
  -xcconfig .mobile-test-results/qq-search-cover/validation.xcconfig \
  -destination 'platform=iOS Simulator,id=9213032A-657A-40CD-BD2A-A3065ACCC8EC' \
  -destination-timeout 30 -derivedDataPath ios/DerivedData -disableAutomaticPackageResolution
```

## 安装与回退

Bundle `app.folia.validation.App`，内嵌身份 `33GAKXJHL3.app.folia.validation.App`；版本字段仍0.7.16／28。
主二进制SHA256：`9a42132ba510aaccedbc2ca3fd3f51c17b38cd6b429bc46c8cb5ab77f5d84d58`。
本批包：`.mobile-test-results/account-loading-20261015/VerifiedValidation.app`。
回退包：`.mobile-test-results/cache-category-errors-20261015/VerifiedValidation.app`，同身份原位安装，无需卸载。
App按授权保留打开，结束处于网易云曲库及原QQ歌曲暂停状态；进程清理见 `cleanup-final.json`。
QQ偶发空搜索、完整特效／设置UI、真机长播、蓝牙／网络、歌词误差、长期性能及有岛机型仍待后续，不因本批通过而关闭。
