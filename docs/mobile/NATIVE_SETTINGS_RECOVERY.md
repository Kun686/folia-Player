<!-- NATIVE_SETTINGS_RECOVERY.md — current-source simulator evidence for sessions, cache recovery and visual settings. -->
# 会话与设置恢复原生补验

2026-10-14；生产源码基线 `d5e13c8e87fcdc4c00fdf8be4bf2ec3a25db7867`。
按 [当前范围](CURRENT_SCOPE.md) 补验 [凭据保存隔离](SESSION_PERSISTENCE_ISOLATION.md)、
[缓存恢复](CACHE_RECOVERY.md) 和 [动效设置返回](VISUAL_SETTINGS_RETURN.md)。本批仅新增 QA 和记录，未改生产行为。

## 复用与实际路径

复用 `checkPackagedVisualizers`、`AudioFixtureGateway`、`OutputMeasurement`、原生歌词缓存和已有
`online-session-qa` 打包入口；新增 `MobileSettingsContainerTests.swift` 的两个 XCTest 并注册到原测试目标。
QA 构建脚本增加可选输出目录参数，默认行为不变；本批输出独立保存，避免覆盖旧证据目录中的生成资源。
新目录构建的脚本与实际受测包内脚本哈希相同，旧生成文件已从旧封存包恢复。

独立 Bundle ID 为 `app.folia.validation.App`。测试先验证服务器地址和平台会话为空，
会话测试只写入合成值并在结束时恢复；不连接真实服务器、平台或个人账户。

1. **会话保存隔离**：生产 JS runtime 经真实 Capacitor 调用 `saveSession`，仅将目标平台的作用域改为过期值，
   由原生校验实际拒绝。另一平台仍成功写入 Keychain；自己的、混合来源的和无过滤的等待继续失败。
   恢复正确作用域后再次保存，通过重新初始化 runtime 和新建 `NativeGatewayStore` 读取验证两平台凭据。
   这是原生拒绝与成功持久化证据，不是 Keychain I/O 故障注入、真实扫码登录或整页登录流程验收。
2. **设置返回与缓存重试**：完整生产 React 页面播放两平台受控身份的音频。进入主题编辑再返回，
   验证外观草稿、展开分组、滚动位置保留，隐藏父层不可交互，明确点击应用后配置才写入。
   然后延迟一个缓存设置保存、注入一次读取失败，使用页面重试；不重新加载设置、不丢失待保存值，
   释放请求后实际原生缓存开关与页面一致。每个平台五个阶段采样真实双声道 PCM 与位置推进。

声音来自已有生成音频文件，经真实 PlaybackEngine／AudioStreaming 解码；文件只是离线材料，
不代表扩展本地曲库。缓存成功读取及设置保存使用真实原生桥，失败时机由 QA 包装器控制。
页面操作通过 JavaScript 触发实际处理器，未模拟人手触摸、屏幕旋转或系统键盘。

## 结果

证据：`.mobile-test-results/native-settings-recovery/`。两端均为 iOS Simulator 26.5（23F77）、arm64、Release，
版本标签沿用 `0.7.16-mobile.28`，包内版本记录指向上述生产源码基线。

| 检查 | iPhone 17 Pro | iPad Pro 11-inch (M5) |
| --- | --- | --- |
| XCTest | 8 PASS，0失败／跳过 | 同一8项 PASS，0失败／跳过 |
| 新增设置／缓存采样阶段 | 10 | 10 |
| 设置阶段最少 PCM 帧／声道 | 19200／2 | 19200／2 |
| 设置阶段最小 RMS | 0.1248269679 | 0.1248265169 |
| 450ms 检查窗最小位置推进 | 0.4479818594秒 | 0.4479818594秒 |
| 既有播放恢复检查点 | 10，含2次暂停 | 10，含2次暂停 |
| 暂停位置推进／RMS | 0／0 | 0／0 |
| 阶段页面异常／已挂载画布 GL 丢失 | 0／0 | 0／0 |

8个唯一用例由2个新增和6个既有回归组成：播放反馈／页面重载1项、两平台正常退出与取消桥失败4项、
缓存串行下载与退出隔离1项。两台设备的执行不合并为16个唯一测试；共享辅助函数的准备阶段也不额外计数。
原生测试无失败、无重跑。现有播放恢复用例仍覆盖迟到错误不闪现、页面真实重载后队列与歌词状态恢复。

前端构建、Capacitor 拷贝、原生 `build-for-testing` 和签名校验通过。128个前端资源在构建目录、
Capacitor 拷贝、Xcode 产物与 QA 包中哈希一致；QA 的生产入口映射为 `mobile.html`，
`index.html` 为离线测试入口。272个选定原生源码／项目／锁文件在测试后与构建清单一致。
包内的设置恢复截图显示背景与控制器；单帧网页快照不用于判定完整歌词动效观感或系统磨砂合成。

`package.json`、两端 `*-command.json`／`*-summary.json`、附件清单和 `metrics.json` 保存范围与结果。
同一 xcresult 的首次并行摘要／附件读取发生数据库展开冲突，改为串行后附件导出成功；没有重跑测试。
Xcode 已将两台模拟器恢复 Shutdown，额外的 iPhone shutdown 返回“已关闭”，没有重试启动或关闭。
最终提交、CI 与任务进程清理另见 `delivery.json`。所有命令均通过 `codex-bounded` 限时执行。

## 尚未覆盖

- **NOT_RUN**：最新源码对应真实服务、扫码、个人歌单与 CDN；物理 iPhone／iPad、网易云30分钟锁屏、
  耳机／蓝牙／网络切换、实际系统挂起或后台失效地址刷新。
- **NOT_RUN**：Keychain实际存储故障、真实触摸／VoiceOver、歌词误差≤150ms、长期内存／卡顿／温升。
- 本批只使用 Classic，不构成14模式的新增完整回归，不改写旧 WebKit 生命周期失败记录。
- 个人 mobile.28 与服务器未更新；根 README、依赖、原版动画／布局／控制器材质未改。

回退新增测试源注册与 QA 脚本输出参数即可，无生产数据迁移。
