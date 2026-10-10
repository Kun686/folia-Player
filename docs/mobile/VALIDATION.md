# 移动候选验证记录

日期：2026-10-10。源码基线 d824c0b854e54d5411cb072092999823e9bd7071，移动候选源码及服务器内部验证见 SERVER_VALIDATION.md。
当前代码指纹见 BUILD_RECORD.json。**本地工程验证通过，不代表真实三平台／真机首版已验收。**

| 层级 | 结果 | 证据与边界 |
|---|---|---|
| TypeScript | PASS | npm run typecheck |
| 定向逻辑回归 | PASS | 36 个文件、477 项测试；provider、transport、歌词、扫码状态机、移动网关与安全存储 |
| 最近会话取消改动 | PASS | 扫码与移动专项 73 项；包含前台立即轮询、不过期复活、Keychain 写失败后仍能清除 |
| Web 构建 | PASS | npm run ios:sync，产物约 11 MiB，资源打包在 App 内 |
| UI | PASS | Playwright WebKit 26.6，6 项，390×844／1194×834／600×834 |
| 模拟器编译 | PASS | Xcode 26.6，iOS 26.5 Simulator，Bundle ID app.folia.personal，最低系统17 |
| 设备架构编译／开发签名 | PASS | generic iOS / iphoneos；有效开发证书，codesign strict校验与描述文件匹配 |
| 原生 XCTest | PASS | 15 项：原有11项及原生播放事件／地址恢复4项，见文末回归增量 |
| 加强自动换曲断言 | PASS | 单独复测，实际封闭的1秒静音WAV；要求下一首 readyToPlay、failures=0、时长正确，避免“失败跳歌”假阳性 |
| 实际模拟器启动 | PASS | 本地签名包安装并启动，原生 bootstrap／Keychain 读取后展示服务器设置页 |
| Compose 结构 | PASS | 实际服务器 compose config --quiet；默认3个服务，仅回环地址17863 |
| Docker构建与内部服务 | PASS | 三镜像已构建部署并固定不可变ID；HTTPS按用户选择暂缓 |
| QQ／网易真实账户 | PASS | 用户扫码后验证登录、个人歌单和带账户解析；CDN有限Range请求；详见服务器记录 |
| 酷狗账户 | NOT_RUN | 按最新范围延后 |
| iPhone安装与启动 | PASS | iOS18.7.10，devicectl安装成功；用户确认手动正常打开，随后devicectl启动亦成功 |
| iPad安装与两机30分钟锁屏 | NOT_RUN | 尚未进行iPad安装与后台验收 |
| 真实远程控制／蓝牙／网络切换 | NOT_RUN | 已实现系统通知／命令处理，但没有外设或真机证据 |
| WebView挂起时远程地址刷新 | NOT_RUN | 原生自动换曲与共享解析已有自动测试，未在真机挂起场景验证 |
| 歌词≤150ms／温升／长期内存 | NOT_RUN | 未做固定音频的仪器化测量或长期真机测试 |

## UI 检查

Browser插件未提供，使用已安装Playwright；测试地址 http://127.0.0.1:4179/mobile.html。
测试流程：启动 → 扫码确认 → 个人歌单 → 搜索 → 加入队列／播放 → 暂停 → 返回音乐库 → 退出；
另覆盖服务器设置和网络错误。响应和原生桥均为测试fixture，生产代码没有模拟音乐兜底。

三尺寸页面标题与首屏内容正常，无框架错误遮罩、无横向溢出，正常流程未发生pageerror。
故障注入场景有预期的“匿名Cookie请求失败”警告，界面展示错误，未将其当作真实服务结果。
截图均已人工查看，位于工作区上级“移动端验证”目录；名称含fixture的图片不是真实账号数据。

## 原生证据与修正

日志保存在本地忽略目录 .mobile-test-results：
native-final.log / native-final.xcresult、native-auto-advance.log、
simulator-build.log、device-build.log、mobile-build.log。不要把包含设备标识的完整Xcode日志直接公开。

初次未签名Keychain用例失败，改为模拟器本地签名后通过。
异步失败链最初使用固定短等待，随后改为观察明确停止状态；重复满足expectation的问题已修正。
短音频用例最初断言不足，最终关闭音频文件后再播放，并要求正常完成而非失败跳歌。
这些测试没有证明30分钟锁屏播放或线上URL有效性。

## 依赖审计

npm audit --omit=dev 返回6项High（包含传递依赖记录），0 Critical；
node-forge GHSA-86w9-cpqp-85rv、basic-ftp GHSA-c475-qrg2-pj4r，以及网易／酷狗和代理依赖链。
这些是继承的音源依赖风险，未执行不受控的audit fix。具体部署风险见 deploy/mobile/DEPLOYMENT.md。
Capacitor 8.5.3 未出现在本次production审计报告中；已核查的
GHSA-rvm3-566m-v7fv 不覆盖8.5.3，这不是全面安全认证。

## 交付条件

当前交付源码、Xcode工程、配置模板、构建说明与分层证据。QQ／网易内部服务与真实账户接口已验证，
已生成开发签名包并安装iPhone，未做真机后台验收。按 ACCEPTANCE.md 补齐 HTTPS 和设备条件后继续。

2026-10-10 部署阶段增量复测：TypeScript PASS，移动逻辑19项 PASS，三种窗口UI共6项 PASS，
ios:sync PASS，原生XCTest11项 PASS（native-deploy.xcresult）。当前部署锁审计见 SERVER_VALIDATION.md。
这些新增证据不把既往模拟器编译等同于真实设备安装。

## 真机安装增量

2026-10-10：开发签名包使用当前 a367f2266238191525f9babcb4a815ea4d225361 源码。
本地 codesign --verify --deep --strict 通过，开发证书在描述文件中，设备UDID也被覆盖，entitlements匹配。
首次远程启动被系统以签名／信任的合并错误拒绝，用户随后确认手动正常打开，再次远程启动成功。
不把首次错误未经证实归因于某个证书问题。legacy idevicescreenshot 服务不可用，因此没有此次真机截图证据。
签名IPA仅保存在用户本地“移动端交付”目录，未上传到公开仓库；SHA256为
021c414b16a82bf5c19efb7fbd1318ed85b46ccf13f30651208fcbe6bd085f7e。

## 原生播放事件回归增量

2026-10-10：补测移植新增的原生播放层，修复切歌／停止后旧 AVPlayerItem 通知仍被处理的问题。
修复前，上一首延迟结束通知会跳过新选曲目；停止后的旧失败／结束通知会清除认证错误并推进队列。
对应测试已分别复现失败。修复在切歌与停止时清除曲目监听归属，恢复播放时重新监听，
停顿与失败通知也必须属于当前仍被监听的曲目。未修改前端、provider、播放解析规则或服务器部署。

原生 XCTest **15 项 PASS**，包括全部既有用例和四个新增用例：旧结束通知隔离、停止状态保持、
恢复播放的监听重建、不可播放地址重新解析后实际播放。地址恢复测试使用缺失文件与一秒静音 WAV，
断言只解析两次且播放位置前进；没有 WebView 调用，也没有真实平台或远程 CDN。
它证明原生错误恢复路径，不能替代真机 WebView 挂起、远程 URL 过期或 30 分钟锁屏验收。

本地证据：.mobile-test-results/native-recovery-red.{log,xcresult}、native-stop-red.{log,xcresult}、
native-recovery-green.{log,xcresult}。执行命令为有时限的 xcodebuild test，使用同一 App scheme 和
iPhone 17 Pro / iOS 26.5 Simulator。服务器部署仍对应 a367f22；手机随后更新为下节所列修复包。

## 修复包设备更新

2026-10-10：基于源码提交 652be4593120a046d4e871457f0c8f4671dbe8d1 重新构建设备签名包，
源码与 BUILD_RECORD.json 的所有文件摘要一致。该提交的 GitHub Mobile checks 已通过：
https://github.com/Kun686/folia-Player/actions/runs/38041388838 。

generic iOS Debug 构建、codesign --verify --deep --strict、描述文件设备覆盖、Bundle ID 与
entitlements 一致性检查均通过。继续使用 app.folia.personal，在现有 iOS18.7.10 iPhone 上
执行覆盖安装，没有卸载 App；devicectl 安装和启动的结构化结果均为 success。
这仅证明修复包安装／启动，不证明账户恢复、在线播放或后台验收。

本地私有交付包：移动端交付/Folia-0.7.16-mobile.1-652be45-development.ipa，6,821,500 bytes；
SHA256：88b0eb4d6502b98c0143b139a877fce352b23acb85098966774ab3111eddc78a。
上一版 a367f22 安装包仍保留。IPA、设备标识与签名描述文件不上传仓库。
本地忽略目录 .mobile-test-results 中保存 device-recovery-build.log、device-recovery-install.{log,json}、
device-recovery-launch.{log,json}。此次未修改服务器、HTTPS 配置、平台规则或产品功能。
