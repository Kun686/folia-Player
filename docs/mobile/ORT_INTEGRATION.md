# ORT 接入 Folia 工程：独立 QA

用户于2026-10-12批准 [接入方案](AUTOMIX_INTEGRATION_DECISION.md)。本阶段已把固定 Apple
ONNX Runtime 1.30.0 静态 XCFramework 和可取消推理桥接入实际 Folia 工程。
个人 App 仍为 mobile.28；没有启用用户队列的模型调度，没有更新、卸载或重启个人 App。

## 实现与复用

- 原始官方 ZIP、72个文件／链接及独立第三方声明通过固定摘要核验。
  `ONNX_RUNTIME_VENDOR.json` 记录来源、版本和摘要；摘要来自实际下载，不宣称上游签名。
  `prepare-ort.py` 离线安装，拒绝错误 ZIP 和不匹配的已有目录。Xcode 每次构建都重新检查内容。
  不改官方二进制，不增加 CocoaPods、Extensions、npm／SPM 推理封装。
- `FoliaORTJob` 使用官方 C++ API：CPU两线程、顺序执行、关闭 CPU arena 和 memory pattern。
  薄桥只接受原拍点模型的1–1500帧×128梅尔频带，或原分轨模型的172032帧×双声道；
  校验数据大小、非有限值、输出类型与形状，错误统一为稳定代码，不记录模型路径或数据。
  后续已增加独立完整窗口接口，见 [整窗口接入记录](ORT_WINDOW_INTEGRATION.md)。
- `NativeORTInference` 共用一个串行后台队列，不在主线程／音频回调运行推理。
  复用 `NativeStemSnapshot` 的完整文件快照和 SHA256，按打包的原 `shared/modelManifest.json`
  验证两个模型；快照私有只读，保持到会话销毁，随后清理。错误哈希不会传给 ORT。
- 每个开始执行的请求限时60秒；Swift任务取消和超时均调用公开 `SetTerminate()`。
  等工作线程返回才释放会话／张量；Swift取消统一返回 `CancellationError`。
  ORT会话创建本身没有公开中断接口，因此取消需等待创建返回；排队取消需等待前面的串行任务退出。
- 每次调用结束释放会话，不保留模型常驻缓存。`infer`是单次推理边界；后续增加的`separateWindow`
  在同一个会话内执行完整分段拼接，不将单段接口循环11次来重复加载模型。
- App只打包清单、MIT许可证及官方第三方声明，两个模型仅放在独立 QA 沙盒，基础App中没有 `.onnx`。
  按需下载、模型能力身份和用户队列调度仍需后续实现；完整窗口已有上述独立QA记录。

## 本机验证

证据目录 `.mobile-test-results/ort-integration/`：

- `build-first.log`／`build-reviewed.log`：实际 Folia Release QA 构建通过。
  首次提示 Objective-C++ job 缺 Sendable 声明；核对其原子标记和 RunOptions 互斥后补齐声明，
  第二次不再有该警告。没有修改依赖二进制。
- `native.xcresult`：iPad Pro 11-inch (M5)／iOS26.5 **模拟器**，8通过、0失败、0跳过。
  涵盖真实原模型推理、错误模型拒绝、张量范围、取消与恢复，以及原分析／分轨读取的相邻回归。
  拍点的两个1500元素输出及分轨的1,376,256元素输出均与原 Node 1.30.0 参考逐字节一致。
  参考输入为既有受控样本；不是新一轮真实音乐或真机联合验收。
- `native-final.xcresult`：统一Swift取消错误后，4项推理专项再次通过、0跳过，含Swift任务中途取消和后续恢复。
  这是前述8项中的4项重跑，非额外4项独立覆盖；最终输出仍逐字节一致。
- `rejected-archive.json`：错误运行库归档在写入前被拒绝；现有依赖保持原样。
- `package.json`：核对独立 Bundle ID `app.folia.validation.App`、签名、沙盒模型及输入／参考摘要。
  第一轮模拟器QA可执行文件41,492,112字节，App含测试插件136,435,061字节，模型单独191,722,428字节。
  `before.json` 是上一个模拟器QA包（可执行文件4,223,072字节），并非同一源码去掉链接的对照；
  这些不能当成正式iPhone App／IPA精确增量。
- 个人 `BUILD_RECORD.json` SHA256保持
  `ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。

## 重建与边界

先获取 `ONNX_RUNTIME_VENDOR.json` 中固定的官方归档，在仓库根运行：

```sh
python3 dev/mobile/prepare-ort.py --archive /path/to/onnxruntime-1.30.0.zip
npm run ios:sync
```

使用独立 xcconfig 的 `PRODUCT_BUNDLE_IDENTIFIER = app.folia.validation.$(PRODUCT_NAME:rfc1034identifier)`
构建QA，避免与个人App重名。新克隆未准备归档时构建会失败，不会在构建时自动下载其他版本。
模型专项从该QA沙盒 `Documents/ORTQA` 读取固定原模型、原输入及参考输出；未准备会明确跳过，
不能据此声称模型测试通过。实际运行必须核对 `.xcresult` 的0跳过和对应输入摘要。

**NOT_RUN**：本次接入的iPhone实机推理、播放／歌词动画争用、总内存、温升、后台连续切歌、
设备包／IPA增量、模型下载及完整Automix调度。早先独立探针的实机证据仍只适用于探针。
`NativeCrossfade` 的表演模式没有因此自动启用，不能把单次推理称为完整Automix交付。

回退本阶段提交即可移除链接与桥接；忽略目录里的固定资产可保留供QA复用。
独立QA可卸载，个人App及其数据不参与本阶段回退。
