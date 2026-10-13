# 在线缓存、原模型 Automix 与流式凭据隔离

2026-10-13。**PASS_CONTROLLED_ONLINE_SIMULATOR**。按用户要求继续不依赖真机的工作。
独立 QA 完成两平台身份的在线流式播放、完整缓存、原模型准备、分轨交接、离线队列重播及退出隔离。
这不是 QQ／网易云真实服务或手机验收；个人 App 仍为 mobile.28，服务器未更新。

## 实现与复用

复用现有 `PlaybackEngine`、`NativeMediaCache`、`NativeTrackProfiles`、`NativeTrackStems`、
原规划器、Beat This!／HTDemucs 模型和共享音频图。新增测试仅注入既有 `URLProtocol` 传输、
隔离目录和 QA 模型存储，使用 QQ／网易云的相同媒体 ID 检查来源隔离。
真实解码、完整音频分析、两个30秒分轨窗口和混音均由现有原生实现完成。
通过普通 seek 移至原规划器计算的交接点前1.5秒，随后观察真实渲染时钟，不替换计划或 PCM。

测试发现流式解码器直接采用调用方配置，继承了测试注入的 `Authorization` 和 `Cookie`。
完整缓存和有界前缀已有隔离，流式首次播放及 EOF 后重建缺少同样的配置处理。
这是受控哨兵值复现，**没有真实凭据泄露的证据**。

最小修复是复用 `NativeMediaTransport` 的配置清理方法：复制配置后移除额外头、Cookie 存储、
凭据存储及 URL 缓存，禁用 Cookie 接收。`StreamOccurrence` 保存并复用清理后的配置。
保留调用方超时、调度及测试协议；默认调度沿用固定 AudioStreaming 的 `.avStreaming`、
忽略缓存和 extended background idle 请求。下载与前缀的既有超时不变。
未新增依赖、修改 vendor、模型、解码实现、音乐算法、设置或已接受的界面。

## 最终结果

环境：Release 独立 `app.folia.validation.App`，iPad Pro 11-inch (M5)，iOS26.5／23F77，arm64 模拟器。
证据目录：`.mobile-test-results/online-automix/`。基线 `ff99b69736abcd8dd14b3b87a7384190781bd4be`。

| 检查 | 结果 | 证据 |
|---|---|---|
| 前端构建、Capacitor 拷贝 | PASS | `web-build.log`、`copy.log` |
| 最终 Release build-for-testing | PASS | `build-final.log` |
| 网络配置与重定向／拖动／EOF 重建 | 2 PASS / 0 FAIL / 0 SKIP | `transport-fixed.xcresult`、`transport-fixed-summary.json` |
| 原模型在线／离线交接及8项既有回归 | 9 PASS / 0 FAIL / 0 SKIP | `fixed.xcresult`、`fixed-summary.json` |
| vendor 校验、工程 plist、diff 空白检查 | PASS | 固定 AudioStreaming 59文件、4处原有补丁 |
| 源码／包资源一致性 | PASS | `package-final.json`：282项源码摘要，127项前端资源 |

最终共 **11个不同原生测试**，不累加中间重跑或两次交接。
回归覆盖前缀限流、下载重定向、自然 EOF 与手动跳歌缓存差异、串行下载、退出隔离、暂停／拖动／中断、
删除已缓冲下一首，以及在线分轨必须等待完整缓存。重定向用例检查实际捕获的所有请求，
即使响应设置 Cookie，也没有向音频请求继承认证头或 Cookie。

完整 Automix 用例耗时46.115秒；两首完整缓存摘要分别与既有音乐样本匹配：
`d7db2870d3ab5c1b56f793288c045a34043c1e1cfda468010a3e200f4e8c38a2`、
`ae4bfab915528a50d7f3eec75b0769c9981af4172c92e30402705716f86ee249`。
素材来源／许可见 [DISTINCT_HANDOVER.md](DISTINCT_HANDOVER.md)，本批没有下载或分发素材。
两模型经 `shared/modelManifest.json` 核验；音频、模型均未提交。

最终 `online-automix.json` 附件记录：

- 两次原规划相同：out=123.98秒、in=0.14秒；完整 profile 使用原拍点模型，无部分前缀分析请求。
- 在线交接：97次采样、475,200帧、RMS约0.12911；离线交接：98次采样、480,000帧、RMS约0.12870。
  两次都观察到分轨渲染，完成后继续第二首且只剩一个音频节点，无采样到停止、分轨失败或时钟失效。
  普通主音轨淡化回退不能通过本用例。
- 解析地址共2次。两曲受控传输分别4请求／97,551,680字节与4请求／65,003,792字节；
  这是含流式读取及完整缓存的传输总量，不是唯一歌曲大小。
- 禁用解析器后在同一进程重新设置队列，全部从完整缓存重播、再次完成分轨交接，无新增解析或网络请求。
- 退出 QQ 清除其完整音频、profile 和分轨缓存；网易云完整音频及分轨缓存保留。

## 失败记录与复测依据

保留初次 `native.xcresult`：一个用例失败、4条凭据断言失败。两次交接虽已完成，整项仍为 FAIL。
修复网络配置后首次编译因新测试误写不存在的 `output.stop()` 失败，改为现有 `output.close()` 后通过。
`transport.xcresult` 的重定向用例通过，配置用例因假设模拟器接受 extended idle=true 而失败；
Foundation 在该环境中返回 false，固定上游库同样如此。测试改为与固定上游的实际配置比较，
生产配置仍请求原值，不更改网络策略以迎合测试。最终构建和两批测试均通过，未删除旧证据。

## 可复现步骤与验收边界

复用独立 `transition-validation.xcconfig`，构建开启 `ENABLE_TESTABILITY=YES`；
在 QA `Documents/ORTQA` 放入核验后的 `music.wav`、`distinct.wav`、`beat_this.onnx` 和 `htdemucs.onnx`。
缺素材或使用非 QA Bundle ID 时跳过原模型用例，SKIP 不视为 PASS。
确切构建／测试参数保存在 `build-command.json`、`transport-fixed-command.json`、`fixed-command.json`。

```sh
"$HOME/.local/bin/codex-bounded" 600 -- xcodebuild test-without-building \
  -xctestrun ios/DerivedData/Build/Products/App_iphonesimulator26.5-arm64.xctestrun \
  -destination 'platform=iOS Simulator,id=6A3572B5-C76C-49D5-8189-4C1F937D6762' \
  -destination-timeout 30 -parallel-testing-enabled NO \
  -only-testing:FoliaNativeTests/NativeTests/testOriginalOnlineAutomixCachesMixedProvidersAndReplaysOfflineWithoutWebView \
  -test-timeouts-enabled YES -maximum-test-execution-time-allowance 360
```

HTTPS 形式的 URL 由 `URLProtocol` 受控响应，不验证实际 TLS、平台签名地址、真实 CDN 或账号权限。
测试不调用 WebView 驱动该引擎，不等于操作系统实际挂起 WebView；离线重播也不是杀进程后恢复。
tap 非零 RMS 与100ms播放状态采样不证明人工听感或不存在更短的断音。
真实 QQ／网易云 Automix、锁屏长播、物理设备、联合动画负载、温升、总内存和歌词精度均 **NOT_RUN**。
公开 `stems/full` 能力继续关闭，完整移植目标尚未验收完成。

最终提交的 CI 只运行 vendor、TypeScript、移动逻辑和前端构建，不运行上述原生测试，见本地 `ci.json`。
`cleanup.json` 记录 QA 已退出、模拟器恢复 Shutdown、无本批构建／测试进程；
`completion.json` 记录最终证据核对。个人 `BUILD_RECORD.json` SHA256 保持
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。
撤销本批提交无需数据或服务迁移，但会恢复流式配置的隔离遗漏；回退前应保留此凭据隔离修复。
