# Folia iPhone / iPad 实现与安装

当前交付是 **0.7.16-mobile.5 开发候选**，支持 iOS/iPadOS 17+。源码基线为
d824c0b854e54d5411cb072092999823e9bd7071；移动分支发布到 Kun686/folia-Player，服务器内部部署记录见 SERVER_VALIDATION.md。
按用户最新要求优先移植原播放器、歌词和动效，同时支持本地导入与网易云／QQ。
服务器配置不再是使用 App 的前提。真实平台与真机完整验收尚未完成，不能作为已验收安装包发布。

后续附加音效开发见 [EFFECT_PARITY.md](EFFECT_PARITY.md)：基础DSP、过采样、压缩器及tap格式探测共15项原生测试通过，
尚未接入真实播放链，也未更新已安装的mobile.5。WebKit源码复用已获用户批准，仍需完成混响等处理及单声道输出方案。

## 已实现

- 独立 React 移动入口，手机音乐库／底部播放条／展开歌词，850px 起使用 iPad 双栏，窄窗口回到手机布局。
- 通过 Omni 复用网易云、QQ、酷狗登录、搜索、歌单和歌词；列表采用现有 react-window。
- 复用扫码状态机，支持平台登录渠道、分享 QR 图片、过期／取消／回前台立即检查；请求代次隔离。
- Keychain 保存服务器凭据与各平台会话，使用 AfterFirstUnlockThisDeviceOnly；WebView 仅恢复会话内存镜像。
  localStorage 只保存非敏感的主题、动效、外观及声音设置。退出取消平台请求、清除对应凭据、账户缓存和队列中对应平台歌曲。
- 系统「文件」选择器导入音频；副本保存在 App Application Support，以 UUID 的 local sourceRef 入队。
  AVFoundation 读取曲名、歌手、专辑、时长、封面和内嵌歌词；支持单独导入 UTF-8／UTF-16 文本歌词。
  文本歌词通过原 LocalFileLyricAdapter／worker 解析。支持本地搜索、移除副本和队列混合。
  无服务器时默认打开本地库；断网或退出在线账户不会暂停其他本地歌曲。
- AVQueuePlayer 管理队列、当前与下一首的解析和预加载。下一首直接进入原生播放器队列；
  原生网络请求不需要 JavaScript。URL 播放失败重新解析一次，连续失败三首停止，认证／限流错误直接停止。
- 队列触摸菜单：下一首播放、移到队尾、移除、打乱与清空。复用原版去重、插入与打乱规则，
  Native 原子校验队列版本；锁屏切歌后的过期行操作会明确失败，按歌曲身份加入可重取状态一次。
  调整队列保留当前 AVPlayerItem、进度和暂停状态；移除当前项／清空只修改队列，当前歌曲继续播放，
  也能以暂停状态恢复。退出账户或删除媒体则同时清除队列外仍在播放的对应歌曲。
  手动上一首直接切歌，队列边界不意外暂停；从暂停状态手动切歌会开始播放，与原版一致。
- 原生锁屏／耳机命令、音频中断、旧输出设备断开、网络不可用与恢复、代次保护、暂停恢复和身份队列持久化。
  网关 Authorization 不送往 CDN。
- 原生快照驱动前台 MotionValue 歌词时钟；隐藏／后台不挂载歌词视觉层，回前台读取原生状态。
  默认 Classic；复用原 VisualizerRenderer、14 模式注册表、背景注册表、参数面板和资产恢复。
  使用现有外观短码／JSON 编解码器导入、导出和应用自定义主题，不需要配置同步服务器。
  MTAudioProcessingTap + Accelerate 分析真实解码 PCM，向原渲染器提供 5 个频段和频谱。
  频谱沿用原版2048点Blackman窗、0.6幅值平滑、−100至−30dB量程和声道下混规则；
  按原生音量／静音修正分析副本，不重复衰减实际音频。FFT仅在界面请求新数据时运行，
  停止读取400ms后连PCM采集也停止；恢复、跳转或采集中断清除旧窗口。
  前台通过RAF读取，最多一个请求在途；隐藏后停止，旧响应不得恢复动画。
  原版五频段响应与暂停呼吸逻辑提取为两端共用，保持桌面频段边界及所有模式参数。
  无法读取 PCM 的流格式保留歌词时钟，不能宣称音频响应等价。
  修复 Partita 在暂停时挂载／切到新歌词行后不显示的问题：初始离散状态读取当前时钟，原动画参数不变。
  Automix、附加音效链、原桌面全部编辑工具尚未完成移植；所有复杂动画的真机性能也未验收。
- 音量／静音使用 AVPlayer 标准属性，修改音量保持静音；复用原 useAudioSettingsStore 及已有命令动作。
  十段均衡器复用原对话框、频段、±12 dB 范围、两个自定义栏位和重置操作。
  原生 Accelerate biquad 按原 Web Audio 低架／峰值 Q=1.4／高架滤波计算，频率同样限于采样率的0.475倍。
  参数采用15ms时间常数、每32帧更新，稳态与原 WebKit输出作数值对照；不声称动态自动化逐采样完全相同。
  音频处理始终运行，FFT继续按前台需求停启；当前与预加载曲目都接收最新参数，调节不替换当前项。
  声音设置保存到原生 UserDefaults，启动回填原 store；快速操作串行合并，失败回到最后确认值。
  移动触摸从实际input事件提交，避免WKWebView的最终值晚于pointerup而丢失；桌面保持原提交时机。
  当前只启用水平及无附加音效的自定义栏位。依赖混响等效果的预设置灰；原生也拒绝启用未支持的效果，避免静默丢弃。
  不支持tap／32位浮点PCM的流格式提示无法均衡，继续原始播放；全部在线编码和真机音质尚未验收。
- 独立认证网关 /mobile/request、/mobile/resolve、/mobile/health，接口和歌词目标白名单，
  禁止任意代理、重定向、平台写操作；有认证、并发上限、请求大小／响应大小／超时限制。
- 精简 Docker Compose 默认只启用移动后端、网易云和 QQ API，监听宿主机回环地址。HTTPS 网关和酷狗为可选配置；不启动同步或 AI。
- App 从认证健康接口读取可用平台；本地、网易云、QQ 入口保留，未连接的在线平台提示设置接口连接。

## 代码入口

| 范围 | 入口 |
|---|---|
| App 打包与启动 | capacitor.config.ts、vite.mobile.config.ts、src/mobile.tsx |
| 页面与状态 | src/mobile/ |
| 可注入移动传输 | src/services/mobileRuntime.ts、providerStorage.ts |
| 共享播放规则 | shared/mobile/ |
| 原生桥与 Keychain | ios/App/App/FoliaNativePlugin.swift、SecureStore.swift、GatewayClient.swift |
| 原生播放 | PlaybackEngine.swift、PlaybackQueue.swift、PlaybackSystem.swift |
| 本地媒体与音频分析 | LocalMediaLibrary.swift、LocalImportPicker.swift、AudioMeter.swift、AudioSpectrum.swift |
| 网关与部署 | deploy/mobile/ |
| 自动测试 | test/unit/mobile/、test/mobile-ui/、ios/App/NativeTests/ |

桌面/Web 播放行为保持原状；打乱函数提取为共同 helper，原逻辑不变；公共 provider 仅抽取播放解析并增加可选移动传输，不全局替换 fetch。

## 复用与依赖决定

复用 React、Omni/provider、登录状态机、歌词解析器、完整视觉注册表、现有主题、react-window、Vitest、
Playwright、Express 和各 API 服务。播放／凭据使用 Apple 标准框架，不引入解码、歌词、音频插件或新的 UI 库。
仅增加已批准的 Capacitor core/ios/cli 8.5.3（MIT）；core 依赖 tslib，ios 原生部分由 SPM 精确锁定
8.5.3，revision 4c7f346d16196e21fbe23d4a7a6fc7af62af6742。CLI 仅开发使用。
本次扩展不新增 npm 生产依赖。所有渲染器与资源随 App 打包；最终资源大小以本次构建记录为准。

选择 Capacitor 是为了复用现有界面与歌词；Swift 桥仅实现现有项目缺少的后台播放、Keychain、原生请求和系统分享。
全原生重写会重复平台业务与歌词视觉系统，首版不采用。Capacitor 8.5.3 不在已核查
GHSA-rvm3-566m-v7fv 的受影响范围；原生桥仅接受打包的 capacitor://localhost 页面，禁止远端代码导航，
关闭内建任意 HTTP 桥及 Capacitor 参数日志。这不等于所有依赖均无漏洞，见 VALIDATION.md。

## 本机构建

要求 Node 24+、npm、Xcode（当前验证使用 26.6）。无需 CocoaPods，使用 Capacitor SPM。

    npm ci --ignore-scripts --no-audit
    npm run ios:sync
    open ios/App/App.xcodeproj

--ignore-scripts 用于移动开发，避免下载桌面 Electron／ONNX 构建附件；若另行构建桌面端，应按原项目流程安装。
ios:sync 会构建本地资源、重命名首页并同步到 iOS。不要给 Capacitor 设置远端 server.url。

在 Xcode 的 App target 选择自己的开发 Team，使用独立 Bundle ID app.folia.personal
（若签名账户要求全局唯一，改为自己拥有的 ID），开启自动签名，选择 iOS 17+ 设备运行。
无需在源码填写 Apple ID、密码、服务器或音乐账户。
2026-10-10 已用本机有效 Apple Development 身份构建签名设备包，并通过 devicectl 安装到一台 iOS 18.7.10 iPhone。
签名配置通过命令行注入，不把个人 Team 配置写死在源码。
Debug-iphonesimulator/App.app 仍是模拟器构建，不能安装到真机。开发签名包仅供其描述文件覆盖的设备使用。

首次无服务器配置时直接进入本地音乐库，点击「导入音乐」，选取设备或 iCloud 文件即可播放。
在播放器中点击「导入歌词」或「歌词与动效」。本地媒体及其歌词不经过网关，首次解锁后可以锁屏读取。
「文件」中 Folia 的 Documents 区域可用于传入文件；实际曲库副本在不可见的 Application Support 中。

使用当前在线适配时，在可选设置中输入受信任的 HTTPS **源地址**（不含路径、用户名、查询串）和访问令牌。
这里连接的是音乐 API 网关，与原项目的配置同步服务不同。网关可运行于 Mac／NAS／服务器；
当前 iOS 包没有内嵌桌面端的 Node API 服务。可信 HTTPS 是当前在线桥的连接规则，不是本地播放器或动效的前提。
分别进入服务器已启用的平台扫码登录，将二维码通过 AirDrop／系统分享发到 Mac 或另一台设备，再用官方音乐 App 扫描。
发起登录的 App 持有会话；切回会立即检查结果。服务器变更会清除旧服务的平台会话，避免把 QQ 后端 token 送给新服务。

首版默认标准音质。在线播放受平台账号权限、地区、上游接口和音频 URL 支持情况影响；
不保证每个搜索结果都具有可播放权限。不会用模拟音源兜底。

## 自动验证命令

    npm run typecheck
    npm test -- test/unit/mobile test/unit/onlineMusic test/unit/library/core/providerLoginSession.test.ts test/unit/lyrics/qqLyricProvider.test.ts test/unit/lyrics/kugouLyricProvider.test.ts
    npm run test:mobile:ui
    xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test

Playwright 使用测试专属原生桥和响应样本，不联系真实平台。需要对应版本 WebKit：
npx playwright install webkit。XCTest Keychain 用例必须使用默认模拟器签名，不能设置
CODE_SIGNING_ALLOWED=NO；设备无签名编译可以用该参数。所有本次执行命令均有时限，测试服务在退出后清理。

## 仍须完成的外部验收

服务器内部部署、QQ／网易真实账户接口验证和 iPhone 开发签名安装已经完成。
可信 HTTPS 入口按用户选择暂缓；服务器端测试会话已清理，手机接通 HTTPS 后需要重新扫码，
再验证 App 内在线搜索、个人歌单、播放及锁屏接续。本地播放器可以立即独立使用与验收。
iPad 真机安装和两台真机的长期后台／性能验收仍待完成，模拟器结果独立记录。
酷狗按最新范围延后。配置与凭据不写入源码。
按 VALIDATION.md 和 ACCEPTANCE.md 逐项完成真实测试后，才能把状态改为首版交付完成。

## Fork 来源与自动化

本移动分支保留原项目 AGPL-3.0 许可、作者信息及源码。上游为 https://github.com/chthollyphile/folia-major ，基线提交见上文。
首次导入新仓库采用该基线加移动改动的源码快照；原始历史在上游可查。继承的桌面发版、定时发布与 issue 自动化移到 .github/upstream-workflows/ 保存，不在本仓库执行。
当前仅启用移动端类型检查、逻辑测试与资源构建 CI。
