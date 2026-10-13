# 在线歌词自动匹配偏好

2026-10-13。为移动端补齐原版「自动使用最佳歌词」和「歌词匹配优先级」触摸入口。
本批只修改源码和受控测试，未操作个人 App、物理设备、真实账户或服务器。

## 行为与复用

- `OnlineLyricPreference` 接入现有「服务器与外观」，沿用原 store、setter、默认值、文案、
  `LYRIC_MATCH_SOURCES` 和来源标签。来源仍为网易云、AMLLDB、QQ、酷狗；默认 QQ，自动匹配默认开启。
  非敏感偏好保留 `auto_use_best_lyric`、`preferred_alternative_lyric_source_v2`，无迁移和新依赖。
- 保存失败显示错误并保留原值，可再次操作重试；44px 触摸按钮和选择器使用现有移动样式。
  这是既有功能的移动入口，不涉及外观配置协议；桌面 `settings-playback` 导航、原设置和
  `playback-auto-match-best-lyric` 动作保持不变，移动端不另建命令系统。
- `useMobileLyrics` 的在线请求身份包含两项偏好。修改后重新运行原 `loadOnlineSongLyrics`，
  不发送播放命令、不改变队列或进度。过期请求既不能显示结果，也不能开始写入旧匹配。
  回调同时检查当前 store，覆盖 React 尚未运行 effect cleanup 的间隙。
- 原解析器和 `autoMatchBestLyric` 完整复用。歌曲所属平台歌词通过 Omni 获取，
  原跨平台自动匹配及 QQ 解密路径不改写。关闭自动匹配仍可读缓存或获取所属平台歌词。
- 已导入、手动选择、自动匹配保存的 override，以及纯音乐选择，继续具有原版的权威性。
  修改偏好不会清除已保存选择；首选来源作用于需要新匹配的歌词。编辑预览仍只读，
  离开编辑器时仍跳过自动匹配。在线偏好不会重载本地歌词。

## 后台边界

后续已完成原算法的请求端口分离，87 个逻辑用例、30 个 WebKit 场景及裸 JavaScriptCore 验证通过，
见 [LYRIC_MATCH_CORE.md](LYRIC_MATCH_CORE.md)。随后四来源原生请求宿主及期限／会话保护已通过独立验证，
见 [LYRIC_MATCH_HOST.md](LYRIC_MATCH_HOST.md)；当前队列尚未调用它。

**后台队列自动触发、偏好同步与自动结果缓存合并尚未实现。** `NativeLyricCache` 使用已经保存的原歌词及来源选择；
缓存未命中时，`NativeOnlineLyrics` 获取歌曲所属平台歌词。前台匹配写入共享缓存，后台后续读取
可以使用这个结果，但这不代表 WebView 停止运行时仍可自动搜索四个平台。
本批没有添加未被消费的原生设置字段，也没有更改原生缓存失效或过渡规划协议。

## 验证

本地证据：`.mobile-test-results/online-lyric-preference/`。
`source.json` 标识基线 `43932472e8b2112faa39109e47a49761f21e9d78` 及实际源码／测试摘要。

| 项目 | 结果 | 范围 |
|---|---|---|
| TypeScript | PASS | 初次及新增测试后的 `typecheck-final.log` |
| 逻辑 | 56 PASS / 4 文件 | 四来源偏好传递、关闭匹配、权威选择、旧结果隔离及原匹配算法 |
| WebKit | 30 个不同场景 PASS | 首批 24 + 后续新增 6；phone、ipad、ipad-narrow |
| 原生容器／真实平台／物理设备 | NOT_RUN | 无原生代码变更、无新安装或真实账户请求 |

WebKit 使用原 store、loader、matcher 和 QQ 加密样本，传输与原生桥为受控 fixture。
18 项新场景覆盖重载恢复、保存失败、44px 控件、旋转、QQ 自动匹配及离线恢复、切换偏好保护
已选歌词、取消旧匹配、首选来源变化和本地加载隔离；12 项为原本地歌词优先级及导入／导出回归。
fixture 改为仅在无保存值时预置关闭自动匹配，避免重载时抹掉测试实际保存的选择。
截图已检查 phone 横屏和 iPad 竖屏，无横向溢出；测试不代表系统选择器或真机验收。
QQ 样本在 WebKit 中出现原 `DecompressionStream` 警告后由既有路径完成解码，逐字结构断言通过。

```sh
npm run typecheck
npm run test:unit -- test/unit/mobile/lyricStorage.test.ts test/unit/onlinePlayback.test.ts test/unit/lyrics/autoMatchBestLyric.test.ts test/unit/lyrics/sourcePriority.test.ts
npm run test:mobile:ui -- online-lyric-preference.spec.ts lyric-priority.spec.ts lyricExport.spec.ts
```

最终提交 CI 执行类型检查、移动逻辑回归及前端构建，状态保存在本地 `ci.json`。
临时日志和截图不提交；`completion.json`、`cleanup.json` 记录完成与进程清理。

## 回退与待验收

撤销本批改动即可回退，原设置键、歌词缓存和桌面行为保持兼容，无服务端迁移。
个人 App 仍为 mobile.28，`BUILD_RECORD.json` SHA256 保持
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。
真实平台匹配、原生容器升级、后台跨平台自动匹配，以及完整 Automix 真机联合负载、
温升／内存和人工听感仍未完成，不能据此宣布完整移植验收通过。
