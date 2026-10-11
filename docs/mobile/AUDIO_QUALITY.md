# 原版音质偏好的移动适配

2026-10-12。开发源码完成，随后汇入 mobile.21 并原位安装、启动、回读 build21。
没有修改服务器或新增依赖；真实平台各档音质及权限回退尚未验证。

## 行为与复用

- 「更多播放选项」增加原版标准、极高、无损、Hi-Res 四档默认音质。
  提取 `AccountTab` 原选项常量，复用原 store、翻译、平台解析和有序原生设置同步。
  桌面原控件与行为保持；本轮是已有设置在移动界面的适配，不扩展桌面命令面板。
- 移动默认继续为标准；缺少字段的旧原生设置恢复为标准，桌面原默认值保持。
  原生 `folia.audio` 为移动权威，启动时覆盖前端旧偏好；连续编辑按顺序合并，失败回退到最后确认状态。
- 原生解析把偏好传给既有 `/mobile/resolve`；网关已有四档白名单及共用 provider 规则，无需部署。
  Swift 不复制 QQ／网易云音质映射，未知偏好在保存和请求前均拒绝。
- 原版播放器优先使用歌曲音频缓存，不按音质存多份。本次保留该语义，不清缓存、不迁移音频／歌词／封面／分析身份。
  `NativeProfileIdentity` 中 `standard` 保留为历史命名空间，不代表缓存一定是标准编码。
- 当前流／AVPlayerItem、暂停状态和位置不变；只取消并重新准备后续在线曲目，本地预加载保持。
  异步准备开始时捕获偏好，取消后的旧结果不能覆盖新预加载。
  AVQueuePlayer 已自动推进时先校准当前歌曲；正在交叉淡化的两个可听声部继续完成，随后预加载采用新偏好。
- 控件提示「已有音频缓存优先，实际音质取决于平台及账号权限」。QQ 原接口只提供 FLAC 档位，
  Hi-Res 偏好仍请求 FLAC，并可能回退到 320／128；不宣称返回了独立 Hi-Res 音频。

## 验证

| 检查 | 结果与边界 |
|---|---|
| TypeScript | `npm run typecheck` PASS |
| 逻辑／provider | 4 文件 123 项 PASS；设置恢复、连续编辑／失败回退、四档平台映射和 QQ 回退 |
| WebKit | 手机、iPad、窄窗共 9 项 PASS：音质 3 项及原音量／静音／EQ／ReplayGain 6 项 |
| UI 修正 | 初次音质用例发现 WebKit 原生 select 高度 27px；明确 44px 高度与外观、修正 sheet label 样式覆盖后 3 视口重测通过 |
| 原生编译 | Release QA `build-for-testing` PASS；应用／测试 Bundle ID、签名和测试宿主隔离检查通过 |
| iPhone 自动测试 | XS Max / iOS18.7.10，11 项 PASS、0 失败／跳过；7 项音质测试及 4 项缓存／音效回归 |
| 已播放与预加载 | 实际 WAV 解码验证流身份与播放位置保持、暂停不恢复、下一首重解析、迟到结果丢弃、本地预加载保持、交叉淡化不中断、旧 AVQueue 身份校准 |
| 缓存 | Hi-Res 偏好下已有完整音频缓存仍可离线播放／拖动，播放地址解析次数为 0 |
| QA 清理 | 功能阶段独立 QA 已卸载；当时个人 App 恢复前台、回读 build20；后续统一交付 mobile.21，始终未卸载个人 App |
| mobile.21 容器复核 | iPad Pro 11-inch (M5) / iPadOS26.5 Simulator，原生四档选择菜单可用；选择无损，重启后仍显示无损；原 27% 音量／静音／EQ 保留，UserDefaults 回读一致 |
| NOT_RUN | 真实 QQ／网易云各档音质及权限回退、真机设置手工交互、真实平台长期播放、物理 iPad；受控测试不代替这些验收 |

原生测试使用独立 `app.folia.validation.App` 身份和受控音频／响应，不复制真实账户。
功能阶段原生编译验证 Swift 路径，WebKit 验证最新 UI；该 QA 包未声称包含最新前端资源。
后续 mobile.21 统一同步前端与原生，源码、资源和包内字节核验及 iPad 容器复核见 VALIDATION.md。

逻辑命令：

```sh
npm run test:unit -- test/unit/mobile/audioSettingsSync.test.ts test/unit/settings/audioQualityMigration.test.ts test/unit/onlineMusic/neteaseProvider.test.ts test/unit/onlineMusic/qqProvider.test.ts
npm run test:mobile:ui -- test/mobile-ui/audio-quality.spec.ts test/mobile-ui/mobile.spec.ts --grep 'original quality|original ReplayGain|volume, mute'
```

上述 UI 首次 6 PASS／3 FAIL；修正后仅重跑 `audio-quality.spec.ts`，3 PASS。
原生方法见 `ios/App/NativeTests/AudioQualityTests.swift`，回归覆盖 `MediaCacheTests.swift` 与 `AudioSettingsTests.swift`。
本地忽略证据：`.mobile-test-results/audio-quality-{build,device}.log`、
`audio-quality-device.xcresult`、`audio-quality-device-summary.json`、`audio-quality-validation.json`、
`audio-quality-{qa-uninstall,personal-launch,device-apps}.json` 及 Playwright 截图。

## 回滚

可回退本提交恢复标准请求；原生 Codable 忽略多余字段，缓存身份保持，凭据没有迁移。
只降级前端资源会保留旧客户端的标准默认语义，因此正式交付时前端与原生需作为同一安装包构建／回滚。
个人 mobile.20 没有此入口；首次个人包交付为 mobile.21。
