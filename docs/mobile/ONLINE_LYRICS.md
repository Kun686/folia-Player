# 原版在线歌词与原生衔接

2026-10-11，接续 [LOCAL_LYRICS.md](LOCAL_LYRICS.md)。开发源码阶段，个人安装包仍为
0.7.16 / mobile.10。本阶段没有改界面、主题、动效或原版规划阈值，完整 Automix 仍未开放。

## 复用与行为

- QQ 的请求参数、歌曲身份映射、QRC 解密和解析，以及网易云响应拆包、歌词轨优先级和格式选择，
  从原 provider 提取为共享函数。原前端继续通过 Omni 和 Worker 使用它们。
- 原生 JavaScriptCore 使用同一份函数，不依赖 WebView 执行下一首歌词请求；Swift 只执行已生成的
  请求并调用系统 zlib，替代浏览器 DecompressionStream。没有新增 npm、SPM 或解码依赖。
- 每首最多两次请求：网易云普通歌词一次，云盘歌词先读当前账户再读歌词；QQ 使用队列保存的数字
  songId，旧队列缺少它时先用原歌曲详情接口补齐，并检查返回的 mid。修复原生队列丢弃 songId 的问题。
- QQ 歌词仍按原实现匿名请求，不向该端点转发账户 Cookie；服务器认证不转发到音乐平台。
  网易云与 QQ 详情请求沿用既有网关和 Keychain 会话。网关只增加只读 `/cloud/lyric/get` 白名单。
- 当前／下一首缓存和取消逻辑复用原本地歌词实现。登录替换、退出账户及队列变化使旧请求失效；
  活跃衔接保留已选时间表。歌词失败沿原无歌词规划继续，不因歌词服务失败停止音频。
- 请求、加密文本、解压输出和规划结果均有大小上限；最多 2000 行。完整逐字／翻译／注音继续由
  前台原逻辑显示，原生只接收规划所需字段。`native/lyrics.js` 构建报告 164.95kB，非整包增量。

## 验证证据

证据位于本机 `.mobile-test-results/`。参考歌词和音频为合成数据，不包含真实账户凭据或版权歌词。

- `online-lyrics-bounds-typecheck.log`：TypeScript PASS。
- `online-lyrics-bounds-logic.log`：126 文件，1461 PASS、1 原有跳过。
- `online-lyrics-bounds-sync.log`：移动资源构建与 Capacitor 同步 PASS。
- `OnlineLyricReference.json`：原实现对照七种流程，包括网易云 LRC／嵌套 YRC／纯音乐／云盘，以及
  QQ QRC／旧歌曲身份补齐／无歌词。原生重放实际执行原解密、系统解压、原解析与请求顺序。
- 原生受控队列分别按 QQ→网易云、网易云→QQ 真实解码播放；歌词最后一句结束于 26 秒，
  验证原本 20 秒的无歌词衔接不会提前发生。无 WebView，不能据此声称真实平台或锁屏验收通过。
- `online-lyrics-ui.log`：9 PASS；WebKit 手机、宽 iPad、窄 iPad 覆盖登录／搜索／队列／布局、
  原 Worker 的 YRC→LRC 替换、Partita 暂停后切换与拖动。网络和原生桥接使用测试响应。
- `online-lyrics-native-final.log`／`.xcresult`：iPad Pro 11 (M5) / iOS 26.5，193 PASS，81.002 秒。
  原版歌词重放、两种在线顺序的真实解码队列、账户替换取消、本地歌词和并发预加载一起通过。
  后续审查给测试网关的调用记录加锁，避免当前／下一首并发请求竞争测试状态；生产实现未变化。
- `online-lyrics-device-fixture-build.log`：独立 QA 构建 PASS；`online-lyrics-device-identity.json`
  确认签名、entitlement、测试宿主和插件均为 `app.folia.validation.*`。Xcode 使用旧版顶层测试配置
  字典，检查脚本按实际结构核对后才运行 `test-without-building`，未修改配置指向个人 App。
- `online-lyrics-device.log`／`.xcresult`：iPhone XS Max / iOS 18.7.10，18 PASS，31.992 秒。
  包括上述五项在线歌词、并发代理回归、静默预加载、原本地歌词、离线四曲、缓冲项删除、地址刷新、
  WAV／AAC 单声道实际音效、频谱与 Keychain。该轮包含加锁后的测试网关。
- `online-lyrics-qa-uninstall.json`：QA 已卸载；`online-lyrics-personal-app.json`：个人包保持 0.7.16 / build 10。

## 预加载崩溃修复

完整回归暴露了固定 AudioStreaming 1.4.5 的并发缺陷：取消／释放播放器可能在文件读取线程调用
弱代理时清空它。Swift 协议弱引用含对象与协议表，未同步读写会产生非空对象配空协议表，
崩溃于 `FileAudioSource.dataAvailable()+600`，地址 `0x8`。反汇编及原崩溃记录均已保留。

- `preload-crash-repro`：原静默预加载测试重复至第 8 次出现另一次 CFStream 退出，整轮 FAIL。
- `file-delegate-red`：新回归通过实际 CFStream 读取和 20 万次并发代理替换，复现相同 `+600` / `0x8`。
- 修复复用库中已有 `UnfairLock`，只保护弱代理读写，调用在锁外进行，避免回调重入死锁。
  不改变 PCM 缓冲、解码器、播放队列或取消规则。
- `file-delegate-green`：并发回归和原静默预加载各重复 20 次，40 PASS。
- `verify-audio-vendor.py --upstream-root ios/DerivedData/SourcePackages/checkouts/AudioStreaming`：
  固定提交的 59 个文件及完整补丁校验 PASS；现有三个适配文件加 FileAudioSource，共四个。
  `.patch` 的空白上下文行是统一差异格式，源码空白检查排除该生成文件后执行。

先前失败不作为通过记录：`online-lyrics-native` 为 191/192，失败来自 songId 的 Int64/Int 测试边界，
现统一为平台 Int；`online-lyrics-native-fixed` 中新测试通过，但旧预加载崩溃使整轮失败。
测试端合成 QRC 首轮使用的 TypeScript transpile API 在本项目版本不可用，改为 Node 标准
stripTypeScriptTypes 后参考生成通过，没有新增工具依赖。

## 未覆盖与交付边界

真实 QQ／网易云歌词与账户、云盘权限、在线签名地址、长时间锁屏跨曲、真实 iPad、蓝牙／网络切换、
歌词显示误差、温升和功耗仍需独立验收。受控队列不能替代这些证据。
酷狗原生后台歌词、模型分轨与表现手势、ReplayGain、封面／在线歌词持久缓存和完整 Automix 仍未完成。
本地播放不要求服务器；在线接口仍沿用既有服务，未配置域名，不放宽生产 App 的 TLS 校验。
2026-10-11 已部署云盘歌词白名单；当前服务仍仅监听 `127.0.0.1:17863`，账户云盘歌词本身尚未验收。

## 真实平台与内部部署补验

运行源码 `6078c7c40d69be3c2bcc2b0d7ff76ee33528b71e`，部署输入相对上一版仅增加一条白名单。
内部网关认证、健康状态与路由检查 PASS；平台容器与其他应用容器未重建，凭据保持不变。
新旧镜像、旧配置和 SHA256 已保存，详见 [SERVER_VALIDATION.md](SERVER_VALIDATION.md)。

`dev/mobile/server-lyrics-smoke.mjs` 在网关容器内，经认证路由读取真实搜索和歌词响应，并在 Node vm 中
执行 App 打包的同一份 `native/lyrics.js`。其 SHA256 为
`99ff3d4b69c4535c14f4bb463dc8e91d02d3badd680b51d5390a9d4df180067d`，与本地 App 资源逐字节一致。
这是实际平台响应加共享适配器的检查；Node 系统 zlib 不能替代 iPhone JavaScriptCore／SDK zlib 的端到端验收。

- `online-lyrics-live-first.jsonl`：网易云真实搜索 3 条，歌词一次请求得到 50 行有效时间轴，PASS。
  QQ 首次“稻香”检索未返回歌曲，后续歌词步骤因此失败；此轮整体 FAIL，未用样本替代。
- `online-lyrics-live-qq.jsonl`：改为“晴天”检索后 QQ 返回 50 条，真实加密歌词经原算法解密、解析
  得到 63 行有效时间轴。带数字身份一次请求；旧队列补全身份两次请求，两份时间轴完全一致，PASS。
  首次无结果的具体原因未确定，不据此修改 App 搜索规则或声称上游稳定。
- 探针只输出状态、数量和构建摘要；原始响应与歌词只在进程内处理。未登录账户、未请求播放地址。
  账户云盘歌词、iPhone／iPad 到服务器的真实播放及后台连续播放仍为 NOT_RUN。
