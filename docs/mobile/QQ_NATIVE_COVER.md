<!-- QQ_NATIVE_COVER.md — real QQ artwork failure, native fix, and separate acceptance evidence. -->
# QQ 大封面缓存修复

2026-10-14。仅维护 QQ／网易云在线播放必需的封面缓存。个人 iPhone mobile.28、服务器、原版动效、前端资源和音频算法未改；只更新独立 iPhone 模拟器 `app.folia.validation.App`。

## 事实与最小修复

真实 QQ 搜索 `Power` 的《PO￦ER》／G-DRAGON，歌曲 mid `002y8Wh41vJv3s`、专辑 mid `000hlJOJ3987mu`，有完整封面地址。通过现有生产 HTTPS 网关和已登录会话读取歌曲元数据，没有修改平台账号或远端配置。

| 实际 QQ CDN 资源 | HTTP / 类型 | Content-Length |
| --- | --- | --- |
| 原图 `T002M000000hlJOJ3987mu.jpg` | 200 / image/jpeg | 16,547,444 bytes |
| `R300x300` | 200 / image/jpeg | 22,759 bytes |
| `R800x800` | 200 / image/jpeg | 122,470 bytes |

原生下载器上限为 8,000,000 bytes，原图会触发 `cache-limit`。项目 `getOriginalCoverUrl` 会还原 QQ 原图；原生先下载再生成缩略图，因此之前一直显示占位。

`NativeCoverCache.downloadURL` 使用 Foundation，将既有 QQ CDN 图片族请求为 800×800，沿用 `src/utils/coverUrl.ts` 的尺寸规则。只匹配 HTTPS、无 URL 凭据、精确 QQ 主机和标准图片路径，保留查询参数。原歌曲元数据、身份缓存键、8 MB 下载上限、解码限制、网易云和桌面逻辑不变。

Swift 中这段适配是为了锁屏播放器能独立取图，不依赖 WebView 执行。无新增依赖。

## 验证

| 层次 | 结果与边界 |
| --- | --- |
| 真实平台元数据／CDN | PASS；上述真实歌曲的服务响应和实际 HEAD 检查 |
| 原生测试 | 9 PASS / 0 FAIL / 0 SKIP；8 项受控回归，1 项显式启用的真实公共 CDN 检查 |
| 原生真实 CDN | 成功下载并解码为 800×800，缓存 JPEG 为 156,057 bytes；PlaybackArtwork 与禁止网络的缓存恢复均通过 |
| 回归覆盖 | 不请求超大原图、共享锁屏缓存、不发送授权头／Cookie、其他平台 URL 不变、合并请求、取消、退出清理、晚到封面隔离 |
| 原生构建／安装 | PASS；正确身份重新构建后，安装包签名、128 个前端资源和源文件摘要核对通过 |
| 已登录 iPhone 模拟器 | PASS；真实 QQ《PO￦ER》封面显示、进度推进至 0:25、歌词／绘光可见；切回网易云《莫愁乡》封面与歌词正常，推进至 0:19 后暂停 |
| 状态保留 | 两平台账号保留；只移除临时加入的 G-DRAGON 曲目，恢复原 51 首队列；最终网易云曲库、暂停 |
| 真实锁屏界面／新 PCM／长播／真机 | NOT_RUN；原生 PlaybackArtwork 测试不等于物理设备锁屏验收 |
| iPad | 按用户要求继续暂缓 |

本次真实 QQ 首次回车搜索直接返回歌曲；同轮服务诊断也返回 50 条。此前观察到的首次空结果未重现，**原因仍未定位**，不声称已修复，不增加猜测性的重试。

## 测试过程限制与打包纠正

- 修复前的单项红测失败，但报的是临时文件移除 `NSCocoaErrorDomain Code 4`，不是干净的 `cache-limit` 复现。根因依据是实际超限资源、下载器边界以及后来显式断言 `NativeMediaDownload.validate`；不能将该红测夸大为精准故障复现。
- 测试在独立 `app.folia.coverqa.App` 中执行，静态入口避免 React 正常启动。真实 CDN 检查须显式设置 `FOLIA_LIVE_COVER_QA=1`，普通单测默认跳过网络项。
- 首次暂存被重签名导致的可执行文件摘要差异拦截。改用已测试二进制并仅改外层 Bundle ID 后，发现内嵌模拟器 entitlement 仍是 coverqa，读不到原 validation 的 Keychain。该包已被替换，不能用于交付。
- 最终使用原 validation xcconfig **重新构建**，确认内嵌 `application-identifier` 为 `33GAKXJHL3.app.folia.validation.App`。无需重新登录，两平台账号和队列实际恢复。以后不能靠只改 Info.plist 迁移模拟器身份。

## 入口与证据

生产改动：`ios/App/App/NativeCoverCache.swift`。
测试：`ios/App/NativeTests/CoverCacheTests.swift`、`ProfileNetworkTests.swift`；后者仅允许精确注册的 URL 被测试协议接管。

证据目录 `.mobile-test-results/qq-search-cover/`（忽略提交）：

- `live-response.jsonl`、`800-headers.txt`：真实元数据与 CDN；不记录凭据。
- `green-command.json`、`green.xctestrun`、`green.log`、`green.xcresult`：9 项定向 XCTest；外层命令受 `codex-bounded 600` 限制。
- `green-build.log`、`validation-build.log`：隔离测试构建与正确安装身份构建。
- `package.json`、`app-manifest-corrected.json`、`verification.json`：测试源文件、前端资源、已安装签名和身份。
- `qq-cover-playing-then-paused.png`、`netease-cross-provider.png`、`final-netease-paused-51.png`：实际 UI。

最终安装二进制 SHA-256：`6b78bf55dbecbbacb5d2b17f4be620b1b3fe33c66f47effe2fc5c8bc1b43c925`。

回滚仅需给独立模拟器原位安装上一候选 `.mobile-test-results/qq-search-authenticated/App.app`；不卸载保留账号的 validation App。个人包、服务器本次无需回滚。完整移植与全部 UI 验收仍未完成。
