# 原版歌词匹配内核的宿主分离

2026-10-13，继续不依赖真机的工作。基线 `6aa3289a172f71b25fc3c6c394b48508f85a188c`。
本批完成原匹配内核的可注入请求边界及裸 JavaScriptCore 执行验证，**未完成后台跨来源匹配接线**。
个人 mobile.28、设备、真实账户和服务器未操作，无新生产依赖或播放器外观变更。

## 复用与改动

原 `autoMatchBestLyric` 同时包含评分／优先级规则和 Web provider 请求依赖，无法直接作为独立
原生宿主的算法入口。本批将原算法移动到 `autoMatchBestLyricCore.ts`，由
`createAutoMatchBestLyric` 接收请求端口；现有 `autoMatchBestLyric.ts` 保留公共导出和原 provider 适配，
桌面、Web 与移动前台仍走同一匹配规则。没有在 Swift 中重写匹配器。

- 端口覆盖网易云／酷狗搜索与歌词、QQ 专用搜索／解密歌词、AMLL 查询、副歌范围及超时。
  这是原有显式跨来源匹配的内部边界，普通在线调用仍使用 Omni；没有添加 UI 直连 provider 的新入口。
- 保留十个候选、原评分／可靠身份阈值、四来源顺序、逐字优先、逐行回退、纯音乐短路、
  已选 metadata 精确匹配、已有 provider 歌词复用及副歌处理。
- 搜索 3500ms、歌词 5000ms，QQ AMLL 的 mid／数字 ID 顺序及按 ID 数放宽的外层期限保留。
  当前 Web/Electron 适配器仍使用原定时器实现；未来原生宿主必须实际执行期限和取消。
- 输入／输出类型移动到独立类型文件，原路径重新导出，现有调用方无需迁移。
  AMLL 的纯 ID 归一化独立为 `amllDbIdentity.ts`；原 provider 保留公共导出和缓存／请求行为。
- 每次匹配的候选缓存与回退值仍在调用内部，宿主只注入函数，不把账号、请求或候选改成全局状态。

`policy-parity.json` 对照保存的原源码：辅助函数完全相同；主函数仅还原七处明确请求替换并归一化空白后，
每一个算法分支与原函数相同。这是机械源码对照，不替代执行测试。
原算法较长，本次保留它的内部结构以便核对，没有借移植重写或简化规则。

## 验证结果

| 验证 | 结果 | 能证明的范围 |
|---|---|---|
| TypeScript | PASS | 最终共享类型、原调用方、新端口与测试 |
| 逻辑 | 87 个不同用例最终 PASS | 原匹配／AMLL／loader／缓存，加 11 项宿主边界测试 |
| WebKit | 30 PASS | phone、ipad、ipad-narrow；原自动匹配偏好和 AMLL 流程 |
| Mac 裸 JavaScriptCore | PASS | 四来源算法路径及四次纯音乐 baseline 复用检查 |
| iOS 原生后台接线 | 未实现 | 不因共享算法通过而标记完成 |
| 真实平台／真机／系统挂起 | NOT_RUN | 没有真实账户或设备请求 |

逻辑首轮 86 PASS、1 FAIL：新测试使用的“无关专辑”仍与目标共享 album 词，被原模糊评分接受。
修正为明确不匹配的艺术家和缺省专辑后，受影响文件 11 项全部通过；生产算法未为测试调整。
首次类型检查发现移动类型时遗漏 AMLL ID 类型及 page 字段，修正后通过；原失败日志保留。

新增边界测试覆盖两个并发匹配交错返回、两个宿主实例隔离、外部请求失败、候选复用、
精确选择、QQ 双 ID、期限参数和十候选边界。原有测试继续验证评分及原调用路径。
WebKit 使用受控传输，覆盖偏好恢复、迟到 QQ 结果、导入歌词权威性、AMLL 限流和切换平台；
原 QQ `DecompressionStream` 警告仍由既有解码回退处理，没有为通过测试改动它。

## 裸宿主证据

`dev/mobile/lyric-match-port-probe.ts` 将实际共享内核和原 YRC／LRC 解析器打包为 IIFE；
`lyric-match-port-probe.swift` 用系统 JavaScriptCore 执行，无浏览器、网络、账号、签名或 App 安装。
探针断言 `window/document/fetch/setTimeout/localStorage/Worker` 都不存在。
输入为明确合成的标准化歌曲和歌词响应，端口立即完成，并记录内核传入的期限；
**没有模拟真实网络耗时，也没有证明原生期限／取消已实现**。这不是四个平台的服务验收。

本地证据 `.mobile-test-results/lyric-match-runtime/`：原源码、`extraction.json`、`policy-parity.json`、
`unit-existing.log`、`unit-final.log`、`unit-core-fixed.log`、两次类型检查日志、`ui.log`、
`probe/result.json`，以及最终源码／二进制身份与清理记录。临时包、日志不提交。

复现核心测试：

```sh
npm run test:unit -- test/unit/mobile/lyricMatchCore.test.ts test/unit/lyrics/autoMatchBestLyric.test.ts test/unit/lyrics/sourcePriority.test.ts test/unit/lyrics/amllDbProvider.test.ts test/unit/onlinePlayback.test.ts test/unit/mobile/lyricStorage.test.ts
npm run typecheck
npm run test:mobile:ui -- online-lyric-preference.spec.ts amll-match.spec.ts
```

裸宿主使用已安装 Vite：以 `dev/mobile/lyric-match-port-probe.ts` 为 lib entry，`formats: ['iife']`、
`name: 'FoliaLyricProbe'`、`target: 'safari17'`、`configFile/publicDir: false`，并删除 console 调用。
然后执行有界 `xcrun swiftc -framework JavaScriptCore dev/mobile/lyric-match-port-probe.swift -o PROBE`，
再用 `PROBE BUNDLED_JS NEW_RESULT_JSON`。本轮精确命令保存在本地证据；输出必须是新文件，防止覆盖旧结果。

## 仍需实现的接线

原生后台下一步需要消费此内核并接通四来源请求适配、真实期限、当前／下一首任务取消、
各平台会话隔离、设置同步，以及导入／手动选择／纯音乐 override 的权威性和缓存合并。
WebView 停止期间必须有独立原生测试证明完整流程，之后仍需真实平台及设备验收。
当前 `NativeOnlineLyrics` 缓存未命中时只获取歌曲所属平台歌词，行为未在本批改变。

回退撤销本批代码即可，无数据或服务迁移。个人 `BUILD_RECORD.json` SHA256 保持
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。
