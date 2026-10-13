<!-- LANGUAGE_SETTINGS.md — shared language preferences in the mobile settings surface. -->
# 移动界面语言设置

移动设置增加原版「界面语言」入口：跟随系统、简体中文、English、Indonesian。复用
`useSettingsModalStore.handleSetAppLanguagePreference`、`applyAppLanguagePreference`、原翻译与原存储键
`folia_app_language`，只增加系统 select 的触摸界面，不新增依赖、语言资源、存储结构或桌面命令。
原 `settings-language-*` 命令及通用设置入口继续使用同一实现；语言不是歌词视觉配置，不放进主题导入／导出。

- 切换即时更新界面、辅助功能标签和 `html.lang`；重开设置和重载保留选择。保存失败保留旧选项、显示错误并允许重试；在途切换禁用控件。
- 修复共享 i18n 初始化优先读取旧检测缓存的问题：选择「跟随系统」时，每次启动从浏览器语言重新检测；明确手动选择仍优先于系统。
  初次 WebKit 实际复现“中文环境＋system 偏好＋旧英文缓存”启动为英文。修改检测顺序后相同场景通过。
- 将浏览器的 `id`／`id-ID` 接到原有 `in` 资源，与原手动切换规则一致。使用已安装语言检测库支持的 `convertDetectedLanguage`，未替换 i18n 库。
- 语言控件沿用既有 44px／16px 设置样式；同页主题下拉框也接入该样式，避免 WebKit 原生小尺寸。没有调整播放器、动效、音频算法或配色。

## 验证

证据目录 `.mobile-test-results/language-preference/`，最终源码／网页资源／CI 与散列见 `delivery.json`。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| TypeScript | PASS | `typecheck-delivery.log` |
| 逻辑 | 88 文件／976 PASS | `logical.log`；移动、i18n、设置及原命令注册／契约回归 |
| WebKit | 33 PASS／0 skip | `ui-repaired.log`；phone、ipad、ipad-narrow 各 11 项 |
| 最后触摸样式变更 | 3 PASS | `ui-touch.log`；原旋转场景三窗口复测，不重复计为新增独立场景 |
| 移动网页构建 | PASS | `build-final.log`；提交后构建及身份在 `build-committed.log`、`delivery.json` |
| 原生 XCTest／实际系统语言／真机／真实平台／后台连续播放 | 本批 NOT_RUN | 未更改 Swift、桥接协议或 Xcode 工程；浏览器 locale 不能证明 iOS Settings 语言和 WKWebView 的系统集成 |

语言场景覆盖手动三语言、手动偏好重载、三种浏览器语言的跟随系统、存储写失败与重试、窄屏／旋转和深浅主题。
受控原生桥接确认语言切换不发播放、队列、配置或平台会话写入命令，队列位置及暂停状态保持；不等同真实音频连续性验证。
同时保留网关会话和队列偏好回归。首轮语言测试 3 PASS／1 FAIL，保存在 `ui-initial/`，复现旧缓存问题。
扩大回归首轮 32 PASS／1 FAIL，保存在 `ui/`：能力加载期间有两个同名设置按钮，旧队列测试定位不唯一。
将该定位限定为顶部设置按钮后相同 33 场景通过，未放宽业务断言。既有 npm 配置、Vite 大 chunk 和受控歌词解压警告保留。

```sh
npm run typecheck
npm run test:unit -- test/unit/mobile test/unit/i18n test/unit/settings test/unit/command-palette/commandRegistry.test.ts test/unit/command-palette/commandRegistryContract.test.ts
npm run test:mobile:ui -- test/mobile-ui/language-preference.spec.ts test/mobile-ui/gateway-settings.spec.ts test/mobile-ui/queue-preference.spec.ts --output=.mobile-test-results/language-preference/ui-repaired
npm run test:mobile:ui -- test/mobile-ui/language-preference.spec.ts --grep "translated settings" --output=.mobile-test-results/language-preference/ui-touch
npm run build:mobile
```

## 交付边界

个人 mobile.28、服务器、平台账户、依赖锁文件和 `BUILD_RECORD.json` 未变。本批为源码和网页资源交付，不是安装包发布。
回退到 `2b96adef3b26075cfb6fb796e6cdbae08ba604e7` 并重建可恢复前版，已保存的偏好仍采用原键和原枚举，无数据迁移。
完整移植仍未验收完成；完整 Automix 的真机热保护、后台与长期稳定性继续等待设备条件恢复。
