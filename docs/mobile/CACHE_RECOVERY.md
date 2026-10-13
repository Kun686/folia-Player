<!-- CACHE_RECOVERY.md — online playback cache feedback recovery; controlled WebKit evidence. -->
# 在线缓存状态恢复

2026-10-14；源码基线 `3dd284e85ac29a4a044bcbaf2f12d4d533e8e047`。
按 [当前范围](CURRENT_SCOPE.md) 维护 QQ／网易云正常使用所需的缓存，不扩展本地曲库。

## 问题与修复

缓存列表读取失败后，后续事件或回前台读取虽然能更新数量和大小，旧错误却一直显示。
设置已经加载时，缓存区也没有重试按钮。两平台恢复场景及缺少按钮共三项手机 WebKit 复现失败。

复用现有 `useMediaCache`、`connectMediaCacheSettings`、原生缓存事件与原设置组件，没有新依赖或缓存机制。
生产改动仅在 `useMediaCache.ts` 和 `MediaCacheControls.tsx`：

- 分别保存列表读取、设置同步和事件订阅错误，成功读取只清除对应的读取错误。
- 列表读取失败时提供原有“重试”按钮；原设置初次加载失败仍可重新初始化。
- 设置已就绪时，手动重试仅重新读取缓存列表，保留现有设置同步和事件订阅。
- 沿用请求序号及卸载保护，旧成功／失败响应不能覆盖更新后的缓存状态。

复核首版修复时发现：若重试直接重新初始化整个 hook，会在开关保存未完成时读取旧设置，
把开关显示切回旧值。新增受控时序实际复现一项失败后，改为上述“只重读列表”的路径。
这项中间版本问题没有提交或安装到个人 App。
设置写入失败仍按原逻辑回退到已接受的值，并通过再次修改设置重试；读取成功不会掩盖它。

原缓存默认关闭／5GB 上限、下载／清理策略、数据格式、平台登录态、队列和原版动画均未改变。
没有新增自动轮询，错误详情沿用现有本地化文案。

## 验证

证据目录：`.mobile-test-results/cache-recovery/`。使用原 Playwright 配置与受控桥／在线歌曲身份，
入口为 `http://127.0.0.1:4179/mobile.html`，没有访问真实平台或个人服务。

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| 原始问题复现 | 3 FAIL | 两平台恢复后旧提示残留；就绪时无重试入口 |
| 中间方案时序复现 | 1 FAIL | 保存开关期间重新初始化导致旧值回写到界面 |
| 最终新增回归 | **24 PASS** | 8 项用例 × 手机、宽平板、窄窗口 |
| 既有缓存及设置回归 | **15 PASS** | 5 项用例 × 三窗口；缓存清理、离线歌词缓存、设置旋转／关闭／滚动恢复、三语言窄屏 |
| 相关逻辑 | **27 PASS，2 文件** | 现有缓存设置同步、队列操作；没有新增逻辑单测 |
| 最终类型检查 | PASS | `npm run typecheck` |
| 指定截图观察 | PASS | 手机及宽平板缓存错误和重试按钮可见；自动测试另覆盖窄窗口 |
| 原生容器／真实账号／物理设备 | NOT_RUN | 不把受控桥返回和队列状态断言当作实际音频或平台验收 |

最终共 39 个窗口场景，没有失败、跳过或自动重试；修复前及中间版本的重复执行不加入此数。
初版 21 项通过记录仍保留，后续增加保存时序检查后的 24 项才是最终新增矩阵。
窗口尺寸为 390×844、1194×834、600×834；既有设置用例另检查横竖转换及 320px 窄屏。

新增用例覆盖事件／回前台恢复、手动重读、保存期间重试、初始设置读取失败、设置保存失败隔离，
以及清理缓存后旧列表成功／失败不得倒退状态。受控 QQ／网易云歌曲保留完整来源身份。
既有缓存回归在无服务器场景中记录了 QQ 歌词请求失败；另有既有 QRC 解压警告，原日志保留，
不据通过的断言声称控制台无错误或真实歌词请求通过。

可复现命令（通过 `codex-bounded` 限时执行）：

```sh
npm run test:mobile:ui -- cache-recovery.spec.ts
npm run test:mobile:ui -- mobile.spec.ts settings-layout.spec.ts --grep "original cache controls|online lyric cache|settings close|returning from a settings|compact settings"
npm run test:unit -- test/unit/mobile/mediaCacheSettingsSync.test.ts test/unit/mobile/queueActions.test.ts
npm run typecheck
```

最终提交、对应 CI（包含移动资源构建）、源文件和证据哈希另见 `delivery.json`。
本轮没有本地重新打包或运行 Xcode；既有模拟器包不代表这次源码。个人 mobile.28、真实账号和服务器未更新。
事件订阅失败的原生行为、真实磁盘故障、长播、动画长期性能及完整观感继续待验收。
回退上述两个生产文件的本批改动即可，无数据迁移。
