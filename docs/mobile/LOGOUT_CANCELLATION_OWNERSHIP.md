<!-- LOGOUT_CANCELLATION_OWNERSHIP.md — cancellation-await ownership fix and real-account acceptance. -->
# 退出等待期间的账号归属与真实重登

2026-10-15，独立 iPhone 17 Pro／iOS 26.5 模拟器，Bundle `app.folia.validation.App`。
本批仅补齐 QQ／网易云的退出和重登，不扩展其他功能。个人 mobile.28、服务器与 iPad 未更新。

## 问题与最小修复

`catalogSession.logout()` 先等待原生请求取消，provider adapter 随后才捕获要退出的账号。
如果同平台凭据在这段等待中被替换，旧退出就会针对新账号执行退出和清理。
此前保护覆盖连接切换及 adapter 网络等待，没有覆盖调用 adapter 之前的取消等待。

复用 `runtime.ts` 已有 `sessionRevisions`，在退出开始时捕获凭据版本；取消等待结束后若版本改变，
不再调用远端退出或清理替换后的账号。使用独立凭据版本检查，因为退出自身会增加请求取消代次。
相同值写入及另一平台变化仍正常退出；既有错误提示／重试、正常退出移除平台队列与缓存的语义保持。
没有新增依赖、存储格式、平台协议或界面改动。

生产文件：`src/mobile/runtime.ts`、`src/mobile/catalogSession.ts`、`src/mobile/useCatalog.ts`。
新增 `test/unit/mobile/logoutCancellationOwnership.test.ts`，真实组合 catalog／Omni／adapter／runtime，
仅控制原生 IO 与账户缓存；既有 catalogSession、logoutSession 测试同步端口定义。

## 自动与构建证据

证据目录：`.mobile-test-results/logout-cancellation-ownership/`。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 原代码的取消等待竞态 | 8 FAIL／4 PASS，替换会话被清除 | `red.log` |
| 修复后相关逻辑 | 8 文件／369 PASS，1.28 秒 | `green.log` |
| 手机 WebKit 正常／取消失败退出 | 4 PASS，15.0 秒 | `webkit.log` |
| TypeScript、移动构建、Capacitor 复制 | PASS | `typecheck.log`、`mobile-build.log`、`cap-copy.log` |
| Xcode Release 模拟器构建 | PASS | `native-build.log` |
| 安装前后身份、严格签名、资源一致 | PASS，128 资源＋2 空 Cordova 文件 | `manifest.json`、`installed-manifest.json` |

逻辑测试覆盖两平台的凭据替换、替换后写回旧值、取消失败、无待取消请求的微任务窗口、同值写入与另一平台更新。
受控并发测试不等同于真实账号并发复现；真实平台验收如下单独记录。

安装包仍使用版本字段 `0.7.16 / 28`，本批按 manifest 区分内容。
主程序 SHA-256：`8debfeb366289ab5a03cf58d938e5c0df83a39f4ff5923288f908debdf07feae`。
本轮局部增量保存于 `change.patch`；不能用整个工作区 diff 代表本次修改。

## 真实账号操作

用户同意现在扫码后，通过实际模拟器界面依次操作两平台；由用户在官方 App 确认登录。

| 验证 | QQ | 网易云 |
| --- | --- | --- |
| 退出后昵称／个人歌单移除 | PASS | PASS |
| 退出后重启仍为未登录 | PASS | PASS |
| 退出不影响另一平台账号和歌单入口 | PASS | PASS |
| 重新扫码后显示原昵称与歌单入口 | PASS | PASS |
| 重新打开个人歌单，首批 50 首可见 | PASS | PASS |
| 重启后新登录会话保持 | PASS | PASS |

截图按 `qq-*`、`netease-*` 保存，包含退出前、退出后、重启、另一平台保持和重新登录后的真实歌单。
本轮不读取、记录或还原平台凭据；账号同一性按可见昵称及相同个人歌单核对，不将其描述为稳定账号 ID 比较。

重新登录后从真实歌单选择网易云《莫愁乡》与 QQ《我怀念的》，观察到对应封面、歌词／镜台动画及进度推进。
网易云进度观察至 02:08，随后前台进入《记忆回溯》，在 00:17 暂停；QQ 在 01:28 暂停。
网易云第一次点暂停时控件已自动隐藏，实际只唤回控件；改为唤回后立即点暂停才生效，保留这个操作边界。
没有采集 PCM 或进行听感判断，因此只记真实歌曲加载、进度／歌词界面观察 PASS，不记音频质量或后台验收 PASS。

测试收尾：停止独立 App，仅将 `app-baseline.json` 的完整原队列恢复到精确 App 容器的 `folia.queue`。
50 首、index2、QQ《我不难过》及 276.4506575963719 秒恢复；新扫码凭据未改写，原音效与 10 个采集外观键一致。
首次使用 Mac 的 defaults 服务只写入临时宿主偏好，没有修改实际模拟器队列，回读断言失败。
诊断后移除该临时值，一次修正使用模拟器 defaults 服务和精确容器路径，写入与回读通过。
其余偏好键逐值保持，恢复后再次启动，两个账号仍在、原歌曲显示 04:36 并处于暂停。
此为测试状态恢复，不是产品自动恢复；已清理的平台缓存不伪造回填，后续由正常使用重新建立。
详见 `restoration.json`、`final-qq.png`、`final-netease.png` 及 `final-player.png`。

## 边界与回退

QQ 退出实际将原 50 首全 QQ 队列移除，同时按已有原生行为清理对应平台缓存；不得写成全程队列保持。
`PlaybackEngine.invalidateProvider()` 的此行为未改动。测试收尾恢复原队列应单独记录，不能当作产品自动恢复。

QQ 偶发空搜索仍未解决；本次会话保护不是已证实的搜索根因修复。
物理设备、本候选长时间锁屏、蓝牙／网络切换、完整特效与设置 UI 验收仍未完成。
可原位回退到 `.mobile-test-results/combined-ui-verification/VerifiedValidation.app`，不卸载、不清 Keychain；
源码仅反向应用本轮局部补丁并对应测试变更，保留其他既有工作区改动。
