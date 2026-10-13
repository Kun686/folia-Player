<!-- SESSION_PERSISTENCE_ISOLATION.md — isolate account durability failures without weakening per-platform playback checks. -->
# 两平台凭据保存错误隔离

2026-10-14；源码基线 `6408986ef39db46867c9abbbd44d7f03c9d645f4`。
继续 [当前范围](CURRENT_SCOPE.md) 中 QQ／网易云核心登录与播放，不扩展平台或本地曲库。

## 问题及最简修复

原 `flushSessions()` 等待串行凭据写入后，只要任一平台留下保存错误，就拒绝所有调用。
因此 QQ 保存失败会阻断网易云歌单读取、确认登录和点歌，反向同样发生；另一平台的既有凭据即使正常也受影响。
修复前，两平台各一项 WebKit 歌单用例和一项逻辑用例复现该错误。

复用原内存会话、按平台记录的 `persistenceErrors`、串行写入、歌曲来源身份和取消代次，不新增依赖或存储方案：

- `flushSessions` 接受可选平台列表，只检查本次操作涉及的平台；省略参数保留原有全平台检查。
  仍等待已排队的串行写入，不增加并行 Keychain 写入，也不把内存凭据当作保存成功。
- 登录确认、个人歌单和现有在线歌单／推荐／电台操作传入其所属平台。
- 队列操作复用提取后的来源平台集合：整组入队／替换检查全部相关平台；搜索单曲或从已有队列选曲检查目标歌曲。
  队列包含另一平台的歌曲，不会使当前目标歌曲依赖另一平台的新凭据保存结果。
- 保存失败的平台仍保留错误；另一平台保存成功不会清除它。自己的保存未完成或失败时，操作仍须等待或失败。
  同一平台重新保存成功后，沿用原错误清除路径。

生产改动限于移动端 runtime、队列辅助函数及相关调用接线。原 Omni／provider 路由、错误文案、
队列版本检查、取消与退出清理、Keychain 格式及 Swift 实现保持不变，没有自动补写或自动重试平台操作。
本地元数据匹配仍保留原来的全平台检查；本轮没有开发该功能。

## 验证记录

证据目录：`.mobile-test-results/session-persistence-isolation/`。真实 React、Omni/provider 和会话 runtime
参与测试；上游接口和 `saveSession` 结果来自受控样本，不是真实账户或 Keychain 故障验收。

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| 修复前 WebKit | 2 FAIL | 手机，两平台歌单被另一平台保存失败阻断 |
| 修复前定向逻辑 | 2 FAIL、2 PASS | 错误隔离失败，原保存等待仍通过；27 项因筛选未执行 |
| 移动逻辑回归 | **776 PASS，80 文件** | 含 4 项新增隔离／保存等待测试 |
| 首轮新增 WebKit | 33 PASS、3 FAIL | 同一网易云用例在三窗口出现测试定位歧义，记录保留 |
| 最终新增 WebKit | **36 PASS** | 12 项用例 × 三窗口；登录、歌单／搜索、单曲与混合队列、自己保存失败与恢复 |
| 既有 WebKit 回归 | **60 PASS** | 手机，登录恢复、歌单保存时序、搜索、替代歌曲、歌单操作、订阅、推荐和电台 |
| 类型检查 | PASS | `npm run typecheck` |
| 原生容器／真实账号／物理设备 | NOT_RUN | 受控桥只证明是否提交原生命令，不证明音频、实际保存失败或平台行为 |

首轮新增矩阵的三项失败发生在故障注入早于初始账号加载结束时：原账号读取和被测队列操作同时失败，
两个相同提示触发严格单元素定位错误。修正测试为先等待初始歌单加载，再注入被测队列保存故障；
没有删除错误断言或修改生产行为来规避。修正后复测一次，36 项全部通过，原日志与截图保留。
最终新增矩阵与既有回归共 96 个 WebKit 场景，无失败或跳过；初始失败及重复执行不累加。

三个窗口为手机 390×844、平板 1194×834、窄窗口 600×834，入口 `http://127.0.0.1:4179/mobile.html`。
既有回归中的受控拒绝请求及 QRC 解压警告保留在日志，不把断言通过等同于控制台无错误。
可复现命令（均通过 `codex-bounded` 限时）：

```sh
npm run test:mobile
npm run test:mobile:ui -- session-persistence-isolation.spec.ts
npm run test:mobile:ui -- collection-playback-session.spec.ts search-playback.spec.ts login-recovery.spec.ts song-replacement.spec.ts online-playlists.spec.ts subscriptions.spec.ts daily-recommendations.spec.ts personal-fm.spec.ts --project=phone
npm run typecheck
```

最终提交、对应 CI（含移动资源构建）、源码与证据哈希另封存于 `delivery.json`，重复执行不累加覆盖数。
本批没有本地重新打包、Xcode 操作、个人 mobile.28 更新或服务器部署。
真实账号、真机长播、网易云 30 分钟锁屏、耳机／蓝牙／网络切换、歌词误差与动画长期性能仍待验收。
回退本批移动端接线和 `flushSessions` 修改即可恢复旧行为，无数据迁移。
