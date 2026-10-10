# Folia iPhone / iPad 实现与安装

当前交付是 **0.7.16-mobile.1 开发候选**，支持 iOS/iPadOS 17+。源码基线为
d824c0b854e54d5411cb072092999823e9bd7071；移动分支发布到 Kun686/folia-Player，服务器内部部署记录见 SERVER_VALIDATION.md。
此前“本地音乐优先”路线已被本实现取代。真实三平台与真机验收尚未完成，不能作为已验收安装包发布。

## 已实现

- 独立 React 移动入口，手机音乐库／底部播放条／展开歌词，850px 起使用 iPad 双栏，窄窗口回到手机布局。
- 通过 Omni 复用网易云、QQ、酷狗登录、搜索、歌单和歌词；列表采用现有 react-window。
- 复用扫码状态机，支持平台登录渠道、分享 QR 图片、过期／取消／回前台立即检查；请求代次隔离。
- Keychain 保存服务器凭据与各平台会话，使用 AfterFirstUnlockThisDeviceOnly；WebView 仅恢复会话内存镜像。
  localStorage 只存明暗外观。退出取消平台请求、清除对应凭据、账户缓存和队列中对应平台歌曲。
- AVQueuePlayer 管理队列、当前与下一首的解析和预加载。下一首直接进入原生播放器队列；
  原生网络请求不需要 JavaScript。URL 播放失败重新解析一次，连续失败三首停止，认证／限流错误直接停止。
- 原生锁屏／耳机命令、音频中断、旧输出设备断开、网络不可用与恢复、代次保护、暂停恢复和身份队列持久化。
  网关 Authorization 不送往 CDN。
- 原生快照驱动前台 MotionValue 歌词时钟；隐藏／后台不挂载歌词视觉层，回前台读取原生状态。
  默认 Classic 与内置明暗主题；复杂视觉主题、频谱、EQ、Automix 等延后项有明确说明。
- 独立认证网关 /mobile/request、/mobile/resolve、/mobile/health，接口和歌词目标白名单，
  禁止任意代理、重定向、平台写操作；有认证、并发上限、请求大小／响应大小／超时限制。
- 精简 Docker Compose 默认只启用移动后端、网易云和 QQ API，监听宿主机回环地址。HTTPS 网关和酷狗为可选配置；不启动同步或 AI。
- App 从认证健康接口读取可用平台，仅展示服务器已启用的音源。

## 代码入口

| 范围 | 入口 |
|---|---|
| App 打包与启动 | capacitor.config.ts、vite.mobile.config.ts、src/mobile.tsx |
| 页面与状态 | src/mobile/ |
| 可注入移动传输 | src/services/mobileRuntime.ts、providerStorage.ts |
| 共享播放规则 | shared/mobile/ |
| 原生桥与 Keychain | ios/App/App/FoliaNativePlugin.swift、SecureStore.swift、GatewayClient.swift |
| 原生播放 | PlaybackEngine.swift、PlaybackQueue.swift、PlaybackSystem.swift |
| 网关与部署 | deploy/mobile/ |
| 自动测试 | test/unit/mobile/、test/mobile-ui/、ios/App/NativeTests/ |

桌面/Web 播放入口保持原状；公共 provider 仅抽取播放解析并增加可选移动传输，不全局替换 fetch。

## 复用与依赖决定

复用 React、Omni/provider、登录状态机、歌词解析器、Classic、现有主题、react-window、Vitest、
Playwright、Express 和各 API 服务。播放／凭据使用 Apple 标准框架，不引入解码、歌词、音频插件或新的 UI 库。
仅增加已批准的 Capacitor core/ios/cli 8.5.3（MIT）；core 依赖 tslib，ios 原生部分由 SPM 精确锁定
8.5.3，revision 4c7f346d16196e21fbe23d4a7a6fc7af62af6742。CLI 仅开发使用。
Web 构建目前约 11 MiB，既有公共模块仍带入部分未使用视觉资源，后续可独立减包。

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
已生成的 ios/DerivedData/Build/Products/Debug-iphoneos/App.app 是**未签名设备构建**，不能直接安装；
Debug-iphonesimulator/App.app 是模拟器构建，也不是 IPA。真实签名和设备安装需要用户的开发身份。

首次打开进入服务器设置。输入受信任的 HTTPS **源地址**（不含路径、用户名、查询串）和访问令牌。
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

服务器地址、可信证书、三平台测试账户和 Apple 签名身份尚未提供；这些不是源码中的示例值。
按 VALIDATION.md 和 ACCEPTANCE.md 逐项完成真实测试后，才能把状态改为首版交付完成。

## Fork 来源与自动化

本移动分支保留原项目 AGPL-3.0 许可、作者信息及源码。上游为 https://github.com/chthollyphile/folia-major ，基线提交见上文。
首次导入新仓库采用该基线加移动改动的源码快照；原始历史在上游可查。继承的桌面发版、定时发布与 issue 自动化移到 .github/upstream-workflows/ 保存，不在本仓库执行。
当前仅启用移动端类型检查、逻辑测试与资源构建 CI。
