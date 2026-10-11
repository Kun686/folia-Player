# 移动候选验证记录

## mobile.20：内嵌歌词格式与翻译（当前开发候选）

2026-10-11 已原位安装并启动于 iPhone XS Max／iOS18.7.10，设备回读 build20。
源码 `9f87ef458f01cf54e0b82ec090daea68b5c8e54d`，
[准确源码 CI](https://github.com/Kun686/folia-Player/actions/runs/38144231076) PASS。
汇集下述多 USLT／iTunes、独立翻译和 FLAC／SYLT 两个源码阶段，保留用户接受的 mobile.19 界面。

- PASS：资源构建／同步；个人 Release clean 签名构建；2,975 项冻结输入、120 项生成资源及签名包逐文件核验。
  歌词运行时和许可证的 SHA256 与最终 iPhone 专项使用的资源一致；没有重新声称执行原生测试。
  无 XCTest 插件残留，签名证书／描述文件／设备授权匹配；IPA 中各文件均匹配签名 App。
- PASS：准确源码的固定依赖安装、vendor 验证、类型检查、全部移动逻辑及构建；详见上述 CI。
  本地格式阶段的 43 项逻辑、修正前 41 项模拟器原生及修正后 10 项 iPhone 专项分别保留，不重复计数。
- 交付：`移动端交付/Folia-0.7.16-mobile.20-960fd016-development.ipa`，7,925,603 字节，
  SHA256 `fe0125d9eda9a51a6d598b4f360d59329d536d2987710a7971947a5e0c329954`。
  指纹 `960fd016b3f58d0eba2a2eabed6a314f6446712ed9a92ea982cca788fb174e73`。
  比保留的 mobile.19 IPA 增加 67,316 字节；不是运行内存或未压缩安装体积的测量。
- 个人 App 未卸载；原位更新成功后回读 `app.folia.personal`／build20，并经 devicectl 启动。
  mobile.19 回退包摘要未变；BUILD_RECORD 已更新到本次准确构建源码。
- NOT_RUN／待反馈：本版本更新后的真实账户和播放、FLAC／SYLT 文件选择器与歌词界面、物理 iPad、
  其余完整真机及性能矩阵。安装与启动不替代这些验收。完整移植保持 IN_PROGRESS。

证据：`.mobile-test-results/mobile20-*`；私人交付目录含 IPA、源码清单和版本说明。
本轮未新增生产依赖、未变更服务端；打包与安装命令已结束，个人 App 按预期保留运行。

## 后续开发源码：FLAC 与 SYLT 内嵌歌词（未更新个人 iPhone）

以下为源码阶段当时的验证记录；随后已汇入上述 mobile.20。

2026-10-11，复用已安装 music-metadata 11.16.1 的原解析器、选择器和 JavaScriptCore，
接入 FLAC／Vorbis comment 与 ID3 SYLT，保存正文／翻译并将旧扫描升级至版本 3。无新增依赖、无 UI 改动。

- PASS：类型检查；4 文件／43 项逻辑；移动资源构建／同步。
- PASS：iPhone 17 Pro／iOS26.5 临时模拟器，Release 原生 41 项／0 失败，12.315 秒。
  首次发现前置 ID3 隐藏 Vorbis，接入原文件解析器后通过。
- 真机首次未加载测试插件，未运行测试。核验独立 QA 签名与生成的 xctestrun 后执行，
  10 项中 2 项失败（8 个断言／异常）：iOS18 普通 FLAC 三种样本没有歌词。
- PASS：让所有 FLAC 均走原文件解析后，iPhone XS Max／iOS18.7.10 专项 10 项／0 失败，1.252 秒。
  覆盖 10 个实际音频样本、系统标签为空、翻译保存、旧扫描迁移、取消／截断和解析恢复。
  这次专项不冒充重新执行模拟器 41 项，也不计作文件选择器／歌词 UI 验收。
- QA 已卸载，个人 app.folia.personal 回读仍为 build19；临时模拟器删除，无新 IPA，BUILD_RECORD 不变。
- NOT_RUN：个人安装包、物理 iPad、真实平台长期测试和性能。完整移植保持 IN_PROGRESS。

范围、输入限制、许可证及原失败记录见 [EMBEDDED_FORMATS.md](EMBEDDED_FORMATS.md)。
本地证据索引为 `.mobile-test-results/metadata-formats-evidence.json`。

## 后续开发源码：多标签内嵌歌词与独立翻译（未更新个人 iPhone）

以下为源码阶段当时的验证记录；随后已汇入上述 mobile.20。

2026-10-11，将原桌面标签选择规则提取共享；原生收集多 USLT／iTunes 歌词、保留翻译、升级旧扫描，
并沿用前台解析和导出流程。没有新依赖，个人 App 和 BUILD_RECORD 仍为 mobile.19。

- PASS：类型检查；4 文件／28 项逻辑；增加翻译导出断言后单独复跑 7 项（不重复计数）；3 项 WebKit 视口。
- PASS：移动资源构建／同步；临时 iPhone 17 Pro／iOS26.5 Simulator Release 原生 23 项，0 失败，6.640 秒。
  首次命令遗漏 testability，模块导入失败，未执行测试；第二次仅给测试传入 ENABLE_TESTABILITY=YES／ONLY_ACTIVE_ARCH=YES 后通过。
- 样本覆盖实际 MP3 多 USLT 及 M4A 多 iTunes 标签、翻译持久化、旧扫描升级、旧正文来源判断、并发令牌、
  超限和取消，以及既有导入／匹配／原生歌词规划。详情与证据见 [EMBEDDED_METADATA.md](EMBEDDED_METADATA.md)。
- 本阶段当时未接入的 FLAC／Vorbis comment、SYLT 已在上述后续源码接入；NOT_RUN：本阶段真机 UI、真实平台链路及长期性能。
  完整移植保持 IN_PROGRESS，本阶段不生成新 IPA。

## mobile.19：半透明与动态背景跟随（历史候选，当前仍沿用其外观）

2026-10-11 已原位安装并启动于 iPhone XS Max／iOS18.7.10，设备回读 build 19。
源码 `634e2b8550b943ef700f3aba450c7e8acbe095c9`，
[准确源码 CI](https://github.com/Kun686/folia-Player/actions/runs/38139061876) PASS。
用户要求“需要半透明，跟随背景的变化”。控制器底色从58%降至18%，弱化高光和阴影，
以18px模糊直接采样画面；文字和图标增加局部阴影，保留原布局、点按／自动隐藏及实色辅助功能替代。

- PASS：类型检查；最终 `npm run test:mobile:ui -- material.spec chrome.spec layout.spec`
  29项通过、7项跳过（4项重复尺寸矩阵、3项Playwright WebKit合成器不能渲染独立模糊探针）。
  背景变色与同一控制器节点连续显示3项通过，但该浏览器结果只能证明透色，不能证明原生模糊实时刷新。
- 原生对照发现并修复：iPhone 17 Pro模拟器／iOS26.5的Safari加载生产材质CSS，
  未修复时背景由蓝变暖、顶部和底部磨砂仍保留初始蓝色；仅取消isolation仍失败。
  给画面加 `translateZ(0)` 后，两层控制器在同页冷／暖两帧均跟随背景变色；保留原isolation混色边界。
  此为原生Safari合成样例的对照证据，不等同于完整Folia容器、物理iPhone/iPad或长期性能验收。
- PASS：资源构建与同步、个人真机clean Release签名；2964项冻结输入、119项生成资源一致，
  签名证书／描述文件／设备授权及IPA逐文件核验通过，无XCTest残留。
  指纹 `5054ffab08b5c3bf65c1fecef28a823c94c394b2e21bc886394579caf2c7189a`。
- 交付：`移动端交付/Folia-0.7.16-mobile.19-5054ffab-development.ipa`，7,858,287字节，
  SHA256 `47cfd9cadd0b48a306f0994ada5eeb7691db2c4b578e9383b388b8bbfa649df3`。
  个人App未卸载，mobile.18回退包摘要复核未变。BUILD_RECORD绑定构建源码；无新依赖及Swift播放修改。
- 用户反馈：“先这样吧”，当前外观按此保留；未逐项确认动态材质、旋转或全部交互。
- NOT_RUN：物理iPad和长期性能；mobile.19材质阶段未重跑原生XCTest。
  完整移植仍IN_PROGRESS。后续内嵌多标签源码与测试不包含于本包，分别记录。

证据：`.mobile-test-results/mobile19-*`；私人交付目录含安装包、源码／构建JSON、说明与原生冷暖对照截图。
测试HTTP服务已停止，任务启动的模拟器已关闭，任务构建与测试进程已清理。

## mobile.18：磨砂气泡与空白轻点控制（历史候选）

2026-10-11 已原位安装并启动于 iPhone XS Max／iOS18.7.10，设备回读 build 18。
源码 `09cb338e052d459f2b49cec87d9d5714e51a330b`，
[准确源码 CI](https://github.com/Kun686/folia-Player/actions/runs/38138128518) PASS。
按mobile.17追加反馈，将控制层改为透色磨砂气泡，空白轻点立即隐藏／再次轻点唤回，保留播放闲置三秒自动隐藏。
暂停也可主动隐藏；拖动、歌词跳转、按钮和弹窗保持原行为。复用原活动计时及Motion弹簧，无新依赖或Swift播放改动。

- PASS：`npm run typecheck`；`npm run test:mobile:ui -- chrome.spec layout.spec lyric-timing.spec`
  共35项通过、4项跳过（iPad重复布局矩阵）。覆盖手动隐藏、再次唤回、暂停、外部状态／错误唤回、
  拖动／取消、旋转、键盘、减弱动画和原Monet歌词跳转。原生桥为受控样本，不能算真实平台验收。
- PASS／SKIP：`npm run test:mobile:ui -- material.spec` 的增强对比度实色替代3项通过，材质像素3项跳过。
  初始材质像素测试3项失败，改成有窗口模式的1项重试仍失败；独立内联模糊样例同样不渲染，确定该测试引擎合成能力受限。
  测试现先运行独立能力探针，不能模糊时明确SKIP；具备能力的引擎仍检查真实控制器开启／关闭模糊的像素差异。
  不将CSS属性存在或跳过项目计作磨砂通过。
- PASS（原生材质短测）：iPhone 17 Pro模拟器／iOS26.5的原生Safari加载相同生产CSS，
  对照截图可见开启模糊后条纹柔化，关闭后清晰透出。这是合成材质样例，不是Folia容器或物理iPhone验收。
- PASS：`npm run ios:sync`、个人真机clean Release开发签名构建；签名证书／描述文件／设备授权一致，无XCTest残留。
  冻结2964项源码输入、119项生成资源核验一致；Capacitor同步另含两份空文件，IPA逐文件匹配签名App。
  指纹 `00fd1d7c607bb2ca4774a4bb56a0bad75e23f34f613a0a7473389d3482cc381a`。
- 交付：`移动端交付/Folia-0.7.16-mobile.18-00fd1d7c-development.ipa`，7,858,138字节，
  SHA256 `233dd5df802d479378cd3625d709474d2f96329e2f4dfe0ad3abdb6ec5260ddb`。
  个人App未卸载，mobile.17回退包摘要复核未变。BUILD_RECORD绑定构建源码，不绑定后续文档提交。
- 用户反馈：需要半透明、跟随背景变化，已在mobile.19进一步调整；没有单独确认点按项目。
  物理iPad、长期锁屏／外设／性能及歌词精度仍NOT_RUN。
  无Swift播放变更，本轮不重跑原生XCTest；历史平台验收不迁移为新版完整验收。完整移植仍IN_PROGRESS。

本地证据：`.mobile-test-results/mobile18-*`；安装包、源码和验证JSON、使用说明、原生材质对照截图已存入`移动端交付`。
测试HTTP服务已终止，任务启动的模拟器已关闭，无任务构建／测试进程遗留。Automix兼容性阻塞保持原状。

## mobile.17：全屏画面与自动隐藏控制器（历史候选）

2026-10-11 已原位安装并启动于 iPhone XS Max／iOS18.7.10，设备回读 build 17。
源码 `7fb7067b1c4ab10e84b09c74bcad978afbea08c6`，
[准确源码 CI](https://github.com/Kun686/folia-Player/actions/runs/38135581923) PASS。
依据用户对 mobile.16 的真机反馈，所有移动窗口改用完整画布，曲库独立；竖屏为顶部歌曲信息及底部悬浮控制，
低高度横屏缩为浅条。播放闲置三秒后控制层缩小淡出，首次触摸仅唤回，暂停／拖动／弹窗保持显示。
复用原视觉渲染器与桌面活动计时；原设置收进更多选项，无新依赖和播放规则变更。
详细行为见 [FULLSCREEN_LAYOUT.md](FULLSCREEN_LAYOUT.md)。

- PASS：本地类型检查及准确源码 CI；移动 WebKit 原流程首轮130项通过、2项跳过、12项失败。
  12项均为 Partita 测试使用了旧标题选择器，修正后全部通过。
  后续 `partita-fit.spec chrome.spec layout.spec local-import.spec` 为29项通过、4项跳过、3项失败；
  3项来自新增减少动态效果用例。改用真实时钟检查合成器动画后发现键盘唤回缺失，补充窗口 Tab 监听，
  最终 `chrome.spec` 在手机／宽iPad／窄iPad共12项全部通过（46.9秒）。
  布局矩阵在phone项目执行，4项跳过为iPad重复矩阵；另2项为仅适用phone的分词用例。
  以上为分阶段回归，不是一次全绿全套运行。原生桥为受控样本，不代表在线平台或真机验收。
- PASS／KNOWN_FAILURE（桌面活动计时）：2项正常通过，1项预期失败。
  React StrictMode 恢复保存的隐藏偏好时有原有问题，已在未改动的 `958c89c` 复现；本次保持原桌面偏好策略。
  Playwright 输出的“3 passed”包含 `test.fail`，不能将该项计作功能通过。
- PASS（iPad实际模拟器短测）：iPad Pro 11-inch (M5)／iPadOS26.5，合成音频竖屏全屏播放、控制自动隐藏、
  自动跨曲、触摸唤回／暂停、旋转保留歌曲与暂停位置，以及更多选项／原均衡器打开关闭。
  该组音频无歌词，不计作iPad歌词真机验收。
- PARTIAL（iPhone实际模拟器短测）：iPhone 17 Pro／iOS26.5，打开既有合成音频，观察全屏竖屏、横屏及返回竖屏。
  坐标点击工具报 `windowNotFoundAtPosition`，刷新窗口／缩放后仍失败，未完成后续拖动及暂停触摸检查。
  原生容器本轮歌词视觉与全部主题动效没有完整验证。
- PASS：`ios:sync`、模拟器Release与个人真机clean Release开发签名构建，签名证书／描述文件／设备授权一致，无XCTest残留。
  共2962个冻结源码输入、119个生成资源一致；同步资源另含Capacitor两份空文件，IPA逐文件匹配签名App。
  指纹 `d3e027450440ba618c35a32e27222f0b57a08253afccb319bffbccfb1fa4aca7`。
  曾在模拟器安装前并行clean共用DerivedData，导致其产物不存在；改为依次构建／安装后成功。
- 交付：`移动端交付/Folia-0.7.16-mobile.17-d3e02745-development.ipa`，7,857,587字节，
  SHA256 `c7ae779f82d29b239e72dfda87e9d46c423eafe90dd495a2d84c80e6785baebe`。
  个人App未卸载；mobile.16回退包SHA256复核未变。`BUILD_RECORD.json`绑定上述构建源码，不绑定后续文档提交。
- 修正缺歌手元数据时共用提示的翻译键，改用已有 `localMusic.unknownArtist`。
- 用户反馈：mobile.17布局“看着还可以”，并要求磨砂气泡材质和空白轻点隐藏／唤回，已进入mobile.18。
  此反馈未分别确认平台、旋转、长期性能；物理iPad、长期锁屏／外设／性能和歌词精度仍NOT_RUN。
  本轮没有Swift播放实现变更，未重跑原生XCTest；历史真机结果保留原版本边界。完整移植仍 IN_PROGRESS。

本地证据：`.mobile-test-results/mobile17-*`，包含各阶段原始日志、CI、签名资源检查、安装／启动／回读、
模拟器截图与最终交付记录。独立Automix的htdemucs／Apple ORT兼容性阻塞保持原状，未加入生产依赖或修改模型。

## mobile.16：布局、旋转与安全区（历史候选，布局已被用户要求替换）

2026-10-11 已原位安装并启动于 iPhone XS Max／iOS18.7.10，设备回读 build 16。
源码 `28449046a4a32db4eed665914455c38fe1d1c839`，
[准确源码 CI](https://github.com/Kun686/folia-Player/actions/runs/38131736888) PASS。
按 Apple Design 原则整理字号、留白、按钮层级与触摸区域；复用原 `useMediaQuery`、播放器、歌词和动画组件，未新增依赖。
宽度至少850且高度至少600时显示曲库／播放器双栏；低高度手机横屏为动画／控件分栏，控件独立滚动。
旋转不卸载播放器；紧凑模式展开播放器时，底层曲库不可误触。暂无歌词提示移入动画区，避免异步加载导致控件位移。
音频增益折叠后仍保留全部选项；本地移除入口归入原歌曲菜单并保留确认流程。

- PASS：`npm run typecheck`；`npm run test:mobile:ui -- layout.spec mobile.spec` 最终53项通过、4项跳过（2.2分钟）。
  明暗主题下8种窗口尺寸、长标题、模拟安全区、44px触摸区域、按钮中心命中、无横向溢出、旋转不发播放指令及设置弹窗均覆盖。
  4项是iPad项目内跳过重复运行的尺寸矩阵；完整矩阵在phone项目执行。桥接使用fixture，不代表真实平台验收。
  首次用例的设置名称错误及后续2个真实控件位移失败分别修正，最终通过；模式切换仍有既有`useInsertionEffect`警告，不宣称全套日志无警告。
- PASS（实际模拟器界面短测）：iPhone 17 Pro／iOS26.5，系统选择器导入合成WAV和LRC，拖动、播放及左右横屏／返回竖屏；
  iPad Pro 11-inch (M5)／iPadOS26.5，保留既有4首合成音频、竖屏展开和横屏双栏，暂停位置保留，播放后可继续自动跨曲。
  原生容器截图为`mobile16-{iphone,ipad}-{portrait,landscape}.png`。不代表真机旋转、多任务键盘、逐帧性能或全部动画验收。
  模拟器首次禁用签名导致Keychain启动失败，已改用Xcode标准模拟器签名；iPad首次安装60秒超时，确认启动完成后重试一次成功。
- PASS：`ios:sync`、模拟器Release及真机clean Release开发签名构建；签名证书／描述文件／设备授权一致，无XCTest残留。
  2956个源码输入、119个资源文件一致，IPA逐文件匹配签名App；指纹`d6a065dc1c8e9974593061c8144a0cd46b478ae69d5764115137c83a4fb1a9be`。
- 交付：`移动端交付/Folia-0.7.16-mobile.16-d6a065dc-development.ipa`，7,933,513字节，
  SHA256 `fdc7a4a08d5b03132cb0430390879fa056c61052d5fb8aea2a745747c2bb3a4c`。
  个人App未卸载；mobile.15回退包SHA256复核未变。`BUILD_RECORD.json`绑定构建源码，不绑定后续文档提交。
- 包含此前`38bf11a`的旧歌词缓存身份按歌曲读取恢复；该阶段9项iPhone QA测试通过，未计作此次布局改动的新测试。
- 已知遗留显示问题：缺歌手元数据时，原共用切歌提示会显示`ui.unknownArtist`；实际模拟器已观察，未在本次布局移植中改动该组件。
- FAIL_USER_REPORTED（布局方向）：用户要求“跟桌面端的一样”“全屏覆盖”“控制器自动缩小隐藏”，明确拒绝半画面半控制区。
  该反馈取代本版分栏方案，修正见mobile.17；不据此推断具体平台、旋转稳定性或长期性能已通过。
  物理iPad、完整键盘／多任务矩阵、歌词误差与温升／长期内存测量仍NOT_RUN。完整移植仍IN_PROGRESS。

独立Automix验证：原Beat This!单样本输出与Node参考相等；htdemucs被固定Apple ORT1.24.2的DFT形状检查拒绝，
完整接入BLOCKED，未加入个人App依赖或修改模型。macOS内存结果不能外推到iPhone，详见[AUTOMIX_RUNTIME_DECISION.md](AUTOMIX_RUNTIME_DECISION.md)。
本地证据：`.mobile-test-results/mobile16-*`及`automix-probe/`。

## mobile.15：原版批量歌词导出（历史候选）

2026-10-11 已原位安装并启动于 iPhone XS Max／iOS18.7.10，设备回读 build 15。
源码 `1fc4c216b5ab713459f6c2c19bb51010ae57dd01`，
[准确源码 CI](https://github.com/Kun686/folia-Player/actions/runs/38129261338) PASS。
复用原批量导出界面、缓存筛选、歌词调整与 ZIP 流程；增加原生缓存枚举和系统 ZIP 分享。
设置入口不要求正在播放；单曲导出弹窗也接入原批量入口。无新依赖，无播放或动画参数变更。
范围、旧缓存兼容和限制见 [BATCH_LYRIC_EXPORT.md](BATCH_LYRIC_EXPORT.md)。

- PASS：类型检查、43 项逻辑／6 文件、12 项三视口 WebKit。首次类型检查缺测试样本字段，补齐后通过。
- PASS：独立 QA 包在同一 iPhone 执行10项原生测试，0失败，3.822秒。已卸载 QA 并回读确认不存在。
  覆盖缓存身份、失效撤销、旧记录恢复、损坏／非法输入、UTF-8 与 ZIP 字节，以及既有缓存回归。
- PASS：clean Release 个人签名构建；签名证书匹配描述文件，设备授权有效，无 XCTest 残留。
  包检查首次假设描述文件必须精确 Bundle ID；实际为合法 Team wildcard，改为校验其授权范围，
  同时要求 App 的签名 entitlement 为精确 `app.folia.personal` 后通过，未放宽团队或设备验证。
- PASS：2953个冻结源码输入一致，119个打包／同步／签名资源一致；IPA逐文件匹配签名 App。
  指纹 `5bb9d06f3ab433db2446f35fce931b9a48d7c569ed562d80481edd60aa31f67f`。
- 交付：`移动端交付/Folia-0.7.16-mobile.15-5bb9d06f-development.ipa`，8,068,760字节，
  SHA256 `77297ae591d3c1c7cdcd90d0e202747f35af1f1b01f6bcad62f6a96986c3aee9`。
  原位安装／启动成功；个人 App 未卸载；保留 mobile.14 且校验哈希未变。
- PASS_USER_CONFIRMED：用户提供导出清单（18首、两种格式、2首跳过）并反馈「歌词可以导入显示」。
  清单有9首旧缓存身份缺失警示；没有独立读取 ZIP 字节、逐首内容或测量时序。物理 iPad、长期性能等保持原状态。
  批量实测证据为 `mobile15-device-manual.json`；mobile.14 单曲回导单独记录。完整移植仍 IN_PROGRESS。

证据位于 `.mobile-test-results/batch-*` 与 `mobile15-*`，包括原生 xcresult、签名资源检查、
安装／启动／设备版本回读及 CI。BUILD_RECORD.json 绑定实际构建源码，不绑定后续文档提交。

## mobile.14：在线歌词文件置灰修复（历史候选）

2026-10-11 已原位安装并启动于 iPhone XS Max／iOS18.7.10，设备回读 build 14。
源码 `a5de02f0a28f31dc9ceda443e7e22babc169087a`，
[对应 CI](https://github.com/Kun686/folia-Player/actions/runs/38127928420) PASS。
依据用户在 mobile.13 的实际反馈：在线歌曲文件选择器打开，但 `.fia`／`.lrc` 灰色不可选。
移动在线导入移除 HTML `accept` 扩展名过滤，避免 WebKit 的文档类型映射禁选歌词文件；
文件内容及大小继续由已有 `importMobileOnlineLyrics` 和原解析器校验。没有新增依赖、原生接口或存储迁移。

- PASS：类型检查、13 项导入／导出逻辑测试（2 文件）。
- PASS：6 项 WebKit 测试（手机、宽 iPad、窄 iPad）。覆盖触摸发起选择、无类型过滤、
  实际导出的 FIA／LRC 经原解析器回导、空文件失败保留原歌词，以及播放状态不变。
  使用受控原生桥；`setFiles` 绕过系统选择器，不能验证 iOS 文件是否置灰。
- PASS：clean Release 个人签名构建、签名校验、证书与描述文件匹配、设备授权和有效期；无 XCTest 残留。
  本次没有 Swift 实现变更，未重复运行原生专项；此前 mobile.13 的 2 项输入检查保留其版本边界。
- PASS：2,948 个冻结源码输入一致；119 个打包、同步和签名 App 资源逐文件一致，IPA 与签名 App 一致。
  指纹 `b58b898cab83825da91e282a5ac9f5eaa6fb4906052a3b1ee494c7519d3b3928`。
- 交付：`移动端交付/Folia-0.7.16-mobile.14-b58b898c-development.ipa`，8,046,225 字节，
  SHA256 `a4822dd624ac79b4feb65373e5b7a90fb5ecc78ac44724fe87e5e28cfd6360ce`。
  BUILD_RECORD.json 保存准确源码；mobile.13 安装包哈希复核未变，保留回退。个人 App 未卸载。
- PASS_USER_CONFIRMED：用户在 mobile.14 反馈「两种文件都能选择，导入后歌词正常」，
  覆盖在线歌曲的系统选择器、FIA／LRC 导入及显示；这是用户真机反馈，没有独立检查文件或测量时序。
  mobile.13 的会话、播放及导出反馈不自动视为 mobile.14 的新版用户确认。
  完整移植和其他长期、硬件、精确时序验收继续保留原状态。

本地证据前缀 `.mobile-test-results/mobile14-`：`test-evidence.json`、`source-record.json`、
`package-check.json`、`device-install.json`、`device-launch.json`、`device-app.json`、`source-ci.json`、`device-manual.json`。
回退可使用保留的 mobile.13 原位安装；该版仍有已知的在线歌词选择置灰问题，无需卸载或清除数据。

## mobile.13：歌词显示、分词及文件导出（历史候选）

2026-10-11 已在 iPhone XS Max／iOS18.7.10 原位安装并启动，设备回读 build 13。
源码 `82fb471fa8abad391f1171aae53d12ad140f87b0`，
[对应 CI](https://github.com/Kun686/folia-Player/actions/runs/38126948291) PASS。
本包汇入原歌词过滤／制作人员策略／时间线、分词编辑／系统复制，以及单曲 `.fia`／LRC 文件分享。
没有新增依赖或更改音频与动画参数。用户随后确认「两平台登录都保留，播放正常」及「导出没什么问题」。
在线歌曲回导失败：系统文件列表打开，但 `.fia`／`.lrc` 灰色不可选，记为 FAIL_USER_REPORTED。
本地证据 `mobile13-device-manual.json` 保留原反馈；没有把导出成功计作回导通过。

- PASS：导出阶段类型检查、32 项逻辑／4 文件、3 个 WebKit 视口。此前显示和分词回归按各自阶段独立记录。
- PASS：独立 QA 包在同一 iPhone 执行 2 项原生导出输入检查，0 失败，0.119 秒。
  覆盖 UTF-8 字节、两种文件扩展名、路径／控制字符／超长正文拒绝；不等于系统分享操作验收。
- PASS：测试宿主及测试包签名身份已核对，QA 包卸载并回读确认不存在；个人 App 从未卸载。
- PASS：clean Release 个人签名构建；证书与描述文件匹配，设备授权有效，App 中无 XCTest 包残留。
  首次证书提取因可选参数写法失败，改用 `--extract-certificates=PREFIX` 后完成比对，未跳过校验。
- PASS：2,948 个冻结源码输入及 119 个打包／同步／App 资源一致；IPA 逐文件与签名 App 一致。
  指纹 `36e29a5659c53f7775e90cd67c273b2a8e40e331e7a45befa8bfee1ecafd632e`。
- 交付：`移动端交付/Folia-0.7.16-mobile.13-36e29a56-development.ipa`，8,039,460 字节，
  SHA256 `d4436aaf073b89a2e2b61cdf7acfdfa597d5f0d5af433a9702119126747e220b`。
  mobile.12 IPA 保留；BUILD_RECORD.json 更新为本版源码，旧记录另存本地证据。
- PASS_USER_CONFIRMED：升级后两平台会话保留、播放正常，以及歌词导出。未独立检查文件内容。
- FAIL_USER_REPORTED：在线歌词系统选择器禁选 `.fia`／`.lrc`，回导没有完成。
- NOT_RUN：分词／剪贴板原生操作；
  网易云长时间锁屏、真实耳机／蓝牙／网络变化、物理 iPad、歌词误差和性能仍未完成。
  mobile.12 的下述用户反馈保留版本边界，不因本次安装直接记作新版通过。

## QQ 真机用户实测与后续开发源码

2026-10-11，`https://music.nb686.cn` 已接通，详见 [SERVER_VALIDATION.md](SERVER_VALIDATION.md)。
用户在 iPhone XS Max / iOS18.7.10 的 mobile.12 上确认：QQ 登录成功、可见账号或歌单，
并进一步反馈「有声音、歌词正常，拖动和切歌可用」。这些是用户在实际 App 中的反馈，非模拟样本。
歌单完整性、精确歌词误差仍未测量。对于「锁屏至少 30 分钟、自动跨过至少三首」测试请求，
用户随后反馈「已完成，锁屏持续播放并自动跨曲」，记为 PASS（用户真机反馈）。
未独立计时或采集曲目事件，不从提问后经过的时间推算时长；测试期间未更新或重启个人 App。
网易云登录、歌单、声音、歌词、拖动和切歌获用户确认；QQ／网易云同队列手动切换、
锁屏／控制中心暂停／继续／上一首／下一首／拖动及回 App 状态同步也获确认。
网易云长时间锁屏则被用户明确说明「没有长时间测试」，保持 NOT_RUN。
本地 `.mobile-test-results/online-device-manual.json` 保存原反馈及证据边界，无账号或会话。
下方各历史阶段的网关 BLOCKED 记录保留当时状态，以本节为当前进展。

开发源码 `152b2eba90794f5f61e43d1bd2e9dc2a10168966` 已接入原精细分词编辑器，
并修复窄窗口低高度时控制区裁切；类型检查、针对性回归及准确源码 CI 通过。
通用 iOS Release 编译通过，3,045 个冻结输入和 115 个资源核对一致；
没有启动模拟器、没有安装或重启手机。系统剪贴板与分词编辑的真机交互 NOT_RUN，
完整证据及各批测试范围见 [LYRIC_SEGMENTATION.md](LYRIC_SEGMENTATION.md)。
后续源码 `e11a083` 接入原单曲歌词导出，32 项逻辑、3 个 WebKit 视口和准确源码 CI 通过。
通用 iOS Release 编译通过，3,052 个冻结输入、119 个资源核对一致；未签名、未安装或启动，
系统分享实际操作尚未验证，详见 [LYRIC_EXPORT.md](LYRIC_EXPORT.md)。


## 后续开发源码：原版歌词显示规则与时间线（未更新个人 iPhone）

2026-10-11，源码 `593615f7f4ccba43a183f0c746303eaffb997223`，
[CI 38121956388](https://github.com/Kun686/folia-Player/actions/runs/38121956388) PASS。
复用原显示处理、过滤编辑器和时间线，补齐制作人员策略、纯音乐归一化与副歌效果。
原始歌词与显示结果分离；不改原动画参数、Swift 音频、依赖或服务器。

- PASS：类型检查、186 项逻辑／29 文件、39 项三视口 WebKit、9 项原桌面组件回归。
- PASS：固定源码资源同步、2,938 个输入哈希一致、Release 模拟器构建与独立 QA App 安装启动。
- PASS（短测）：iPad 实际容器暂停高亮、点击第二句跳到原生 10 秒、制作人员策略预览／保存、
  终止重启后恢复；原始歌词正文及音频哈希不变。样本预置，不计作系统文件导入或真实平台验收。
- 测试 App、日志辅助进程与模拟器已清理，个人模拟器 App 保留。
  没有新 IPA；个人 iPhone 仍为下述 mobile.12，BUILD_RECORD 未修改。
- NOT_RUN：本阶段真机 UI、真实在线 App 链路、长期播放、150ms 显示误差与持续性能。
  完整移植保持 IN_PROGRESS；失败修复、证据及回退见 [LYRIC_DISPLAY.md](LYRIC_DISPLAY.md)。

## mobile.12：歌词管理、完整本地匹配与 Partita 适配（历史候选）

2026-10-11 已在 iPhone XS Max／iOS18.7.10 原位安装并启动，设备回读 build 12。
源码 `17cb06a1fb325b1b3478a0371e18d823935cf558`，
[对应 CI](https://github.com/Kun686/folia-Player/actions/runs/38120270782) PASS。
此包汇集下述五个开发阶段：原歌词时间校准、GBK／KRC 导入、内嵌／导入来源管理、
本地歌曲完整匹配与 Partita 长词适配。未新增依赖，未修改服务器或原版动画参数。

- 本轮 PASS：固定 vendor 校验、类型检查、142 项移动逻辑／25 文件、资源构建与同步。
- 本轮 PASS：独立 QA 包在 iPhone 执行 17 项原生专项，0 失败，5.792 秒。
  覆盖歌词解析、原子保存、来源恢复、过期／删除／并发写入拒绝、后台歌词读取与规划，
  以及实际双声道播放期间保存匹配信息后解码器及进度保持。样本受控，不是线上平台验收。
- QA 的签名、宿主与测试包身份均核对；生成的 xctestrun 宿主标识从 personal 修正为 validation 后才运行。
  QA 包随后卸载并确认不存在，个人 App 一直保留，更新前回读仍为 build 11。
- 本轮 PASS：独立 clean Release 个人签名构建、签名证书与描述文件匹配、设备授权、
  无 XCTest 残留、115 个 dist-mobile 资源及同步资源逐字节核对、IPA 与签名 App 字节一致。
- 2,935 个源码输入均与冻结记录一致，指纹
  `d07e5ff69f5ad048598e711bf2ad571012f59ac24ab3ececdcf509ea480a89b3`。
  `BUILD_RECORD.json` 与交付目录 `Folia-mobile12-source.json` 保存来源摘要。
- 私有安装包 `Folia-0.7.16-mobile.12-d07e5ff6-development.ipa`，7,948,333 字节，SHA256
  `73c1aae04bb3afbbae12819075845893362aa38083dad04a6f8763c9924229b1`。
  比 mobile.11 增加 56,789 字节，是源码、资源和签名的总包差值，不是依赖单独成本。
  mobile.11 安装包重新校验未变，保留用于回退；IPA 和设备／签名资料不上传仓库。
- 界面证据沿用下述各功能对应提交；仅提升构建号的本轮未重复运行 WebKit。
  Partita 最终 12 项 WebKit 通过，但其原生容器视觉复核仍为 NOT_RUN。
- 本地证据：`.mobile-test-results/mobile12-*`（sync、device-qa、identity、package-check、
  install、launch、app、source-ci）；`Folia-mobile12-build.json` 保存交付检查结果。
- BLOCKED：当前 App 网关链路未接通，真实网易云／QQ App 端到端未验收。
  NOT_RUN：iPhone 系统歌词选择器手工验收、实体 iPad、30 分钟锁屏、耳机／蓝牙、
  ≤150ms 视觉误差及持续性能。完整 Automix 与其余原版编辑工具仍待移植，整体 IN_PROGRESS。

以下 mobile.11 之后的“未更新个人 iPhone”描述保留各阶段当时的状态；这些源码现已收入 mobile.12，
安装状态以上节为准，历史测试次数不计作本轮重跑。

## 后续开发源码：Partita 长词显示区适配（未更新个人 iPhone）

2026-10-11，源码 `763d42f3d8db3c540d71c0d4f966ef7589971504`，
[CI 38119700775](https://github.com/Kun686/folia-Player/actions/runs/38119700775) PASS。
复现正文约 240px 溢出后，为移动宿主按实际显示区适配整组歌词尺寸，保留原分词、时序与动画参数。
桌面默认不启用；没有新增依赖，没有修改原生音频。

- PASS：类型检查、25 项原逻辑＋3 项新隔离／边界逻辑；最终 12 项三视口 WebKit 专项。
- PASS：6 项相邻 UI 回归覆盖模式注册表及暂停／拖动；资源同步、Release 模拟器构建和独立测试包启动。
- NOT_RUN：原生容器 Partita 触摸复核，界面控制工具连接 Simulator 超时；启动截图不作为动效验收。
  实体设备和持续性能也未跑。测试包与样本已清理，手机仍为 mobile.11。
- 范围、失败记录和回退见 [PARTITA_FIT.md](PARTITA_FIT.md)。完整移植仍为 IN_PROGRESS。

## 后续开发源码：本地歌曲完整匹配（未更新个人 iPhone）

2026-10-11，源码 `375f50a1b946ac47445c1246041c90fb89eb6bd3`，
[CI 38118565476](https://github.com/Kun686/folia-Player/actions/runs/38118565476) PASS。
复用原完整匹配弹窗、元数据选择、Omni、歌词解析和封面缓存，原子保存并保持真实播放进度。
没有新增依赖，完整移植保持 IN_PROGRESS。

- PASS：169 项逻辑基线；QQ 错误传播修正后，最终类型检查、75 项逻辑专项及资源构建／同步通过。
- PASS：手机／宽 iPad／窄 iPad 最终 12 项 WebKit 匹配流程；相邻导入／来源用例分开验证。
- PASS：32 项 Release 原生专项，包含实际双声道播放期间保存、后台歌词选择、并发与失效写入、
  重开存储及封面缓存；最终 Release 模拟器构建通过。本轮未运行全部原生测试。
- PASS（短测）：iPad 实际系统选择器导入合成 WAV，「不使用在线数据」保存成功，原音频字节保持。
  已清理样本、核对原 14 个文件哈希并恢复偏好设置。
- BLOCKED：真实网易云／QQ 匹配缺少可用 App 网关链路；已修正 QQ 把网络错误显示成空结果的问题。
  受控 UI 测试不能代替真实候选保存。实体设备、长期锁屏、声画误差和性能为 NOT_RUN。
- 详细证据及回退见 [LOCAL_MATCH.md](LOCAL_MATCH.md)。个人 iPhone 仍为 mobile.11，BUILD_RECORD 未更新。

## 后续开发源码：导入／内嵌歌词来源（未更新个人 iPhone）

2026-10-11，源码 `49ef998c299a6ba3c36d0e7ad24550c880b92a75`，
[CI 38115822415](https://github.com/Kun686/folia-Player/actions/runs/38115822415) PASS。
原来源选择、内嵌准备与控件共用；原生独立保存两份正文、原子切换及旧数据迁移，无新增依赖。

- PASS：类型检查、146 项逻辑／26 文件、资源构建／同步；最终前端专项 15 项通过。
- PASS：21 项 WebKit 回归；选中轮廓补齐后，三视口来源流程再跑 3 项通过。
- PASS：218 项 Release 原生基线（排除既有三个独立 HTTP 服务器用例）；兼容正文复核 11 项，
  最终异常标签隔离复核 12 项通过。后两次是专项，未重复执行整组 218 项。
- PASS（短测）：iPad 模拟器系统选择器导入 M4A／LRC，内嵌↔导入来源独立保存，切回内嵌后重启恢复。
  文件逐字核对及清理完成；异常标签补丁另由最终 12 项原生专项覆盖。
- 证据与边界见 [LOCAL_LYRIC_SOURCES.md](LOCAL_LYRIC_SOURCES.md)。该阶段尚未接入的本地在线匹配、
  元数据／封面已由上节后续源码接入；完整 Automix 与长期真机验收仍待完成。个人手机仍为 mobile.11。

## 后续开发源码：本地 GBK／加密 KRC 导入（未更新个人 iPhone）

2026-10-11，源码 `f270ceb2279836f7eb5be9910bbfff07cb96877b`，
[CI 38113676108](https://github.com/Kun686/folia-Player/actions/runs/38113676108) PASS。
系统选择器返回原始字节后复用原解码／解析，再由原生校验与原子保存；无新增依赖。

- PASS：类型检查、128 项逻辑／23 文件、资源构建／同步、215 项 Release 原生测试。
  原生沿用既有三个独立 HTTP 样本用例的排除范围，详见记录。
- PASS：WebKit 所选 33 个不同用例分两次覆盖；初次 31 通过、1 失败、1 未执行，
  修正旧迟到匹配测试的加载等待后，三视口专项 6 项通过。失败日志保留。
- PASS（短测）：iPad 模拟器真实系统选择器导入合成 KRC，正文／文件名核对与终止重启恢复；
  原 Partita 长词裁切另记布局待查，未将它列为动画完整验收。
- 证据、已知限制及回退见 [LOCAL_LYRIC_IMPORT.md](LOCAL_LYRIC_IMPORT.md)。
  本地完整来源管理、Automix 和长期真机测试仍待完成；没有新个人 IPA，手机仍为 mobile.11。

## 后续开发源码：原版歌词时间校准（未更新个人 iPhone）

2026-10-11，源码 `f0e38d471864d6171b122a3c2c88b5c5fddd5580`，
[CI 38111816022](https://github.com/Kun686/folia-Player/actions/runs/38111816022) PASS。
复用原单曲偏移、全局校准弹窗和存储，接入原生歌词时钟；修复过早打开工具会取消未完成歌词加载的问题。

- PASS：类型检查、131 项逻辑／23 文件、27 项 WebKit UI（手机／宽 iPad／窄窗口）、资源构建与同步。
- PASS：iPad Pro 11-inch (M5)／iOS26.5 Release 构建，实际容器单曲 +250ms／全局 +50ms 应用后重启恢复。
  仅使用合成短曲，启动保持暂停；测试偏移已恢复零，App、日志辅助进程与本轮启动的模拟器已停止。
- 证据及失败修复详见 [LYRIC_TIMING.md](LYRIC_TIMING.md) 和 `.mobile-test-results/lyric-timing-*`。
- 本阶段未修改 Swift、依赖或服务器，没有新个人 IPA；iPhone 仍为下述 mobile.11，
  `BUILD_RECORD.json` 仍只描述该已安装版本。模拟器开发产物虽然带 build 11，但源码更新，不能视为同一包。
- NOT_RUN：本阶段真机校准、真实平台 App 联机、实体 iPad、30 分钟锁屏、蓝牙、150ms 显示误差及持续性能。

## mobile.11：歌词操作、共用资源缓存与后续播放移植（上一安装候选）

2026-10-11 已完成 Release 开发签名构建、安装和启动，iPhone XS Max／iOS18.7.10 回读 build 11。
本候选汇集 mobile.10 后的原版过渡执行／歌词规划、ReplayGain、共用封面与完整歌词缓存，以及在线歌曲
导入歌词、网易云／QQ 匹配、来源切换和恢复入口。复用和功能边界见 [LYRIC_TOOLS.md](LYRIC_TOOLS.md)、
[LYRIC_CACHE.md](LYRIC_CACHE.md)、[COVERS.md](COVERS.md)、[REPLAYGAIN.md](REPLAYGAIN.md)。

- 源码：`5742c7080db908922ceff34f7d6cfee6eb007fc0`；[对应 CI](https://github.com/Kun686/folia-Player/actions/runs/38110304508) PASS。
- 最终类型检查、136 项逻辑、资源构建和同步 PASS：`lyric-tools-final-sync.log`。
- WebKit 手机／宽 iPad／窄 iPad 15 项 PASS，39.8 秒：`lyric-tools-final-ui.log`，包含真实 Worker 的文件解析
  和原 QQ QRC 解密。网络和原生桥接为受控响应；不是 App 到真实平台的验收。
- iPhone 独立 QA 宿主原生 15 项 PASS，11.256 秒：`lyric-tools-device.log`／`.xcresult`。
  完整歌词缓存、取消／来源优先级、本地／在线解析和实际双解码衔接。QA 签名及 xctestrun 独立核对，已卸载。
- 前一源码阶段的模拟器 212 项、iPhone 23 项回归见 LYRIC_CACHE.md；本阶段没有改动 Swift 播放实现，
  不把该历史全量数量计作再次运行。
- 2900 个源码输入，指纹 `37ed3c1bc48a94548db5a0a3a4d86ccb537771f43abd6c5b7b5e3f90211633ff`。
  本次覆盖所有已跟踪的普通文件，排除文档目录与 Markdown；相比旧记录扩大了来源核对范围。
  `BUILD_RECORD.json` 及交付目录的 `Folia-mobile11-source.json` 保存完整输入摘要。
- 安装包 `Folia-0.7.16-mobile.11-37ed3c1b-development.ipa`，7,891,544 字节，SHA256
  `54e1041f220df7a3a47ad114598ec44e9ee81cf3622d9bee8c0a5ef6a6c27f0a`。
  App 普通文件 16,813,363 字节；IPA 比 mobile.10 增加 303,010 字节，包含多个阶段的代码、资源与签名变化。
- `mobile11-package-check.json`：个人签名、设备授权、iPhone／iPad target、后台音频、全部源码输入、
  117 项前端资源和 ZIP 字节一致性均 PASS，不含 XCTest。前端及原生版本均为 mobile.11／build 11。
- `mobile11-device-{install,launch,app}.json` 记录安装、启动和设备版本；更新保留 App 数据，没有卸载个人 App。
  mobile.10 安装包已复核原 SHA256，继续保留用于回退。
- **NOT_RUN**：新歌词入口的真实账号 App 联机、系统文件选择器手动验收、实体 iPad、30 分钟锁屏、耳机／蓝牙、
  150ms 歌词视觉误差、持续温升和内存。完整 Automix、模型分轨／表现手势及剩余原版编辑工具仍未完成。
  mobile.11 是个人开发候选，不是完整移植已验收的最终版；可信 HTTPS 入口仍按用户选择暂缓。

## mobile.10：原版音频缓存（已保留的上一候选）

沿用原开关（默认关闭）、5GB 默认上限、0 无上限及 LRU。原生自然 EOF 或完成交叉淡化后缓存，
手动跳过不缓存；启用时原过渡分析可以提前下载完整音频。完整缓存优先于网关解析，缓存与
当前解码器独立持有文件，清空／容量淘汰不打断当前播放与拖动。退出仅清理对应平台的缓存与任务。
设置控件从原存储页抽出共用，原文案、选项及 settings-media-cache 命令锚点保留，未新增依赖。

- PASS：移动逻辑 51 项，`media-cache-unit.log`。
- PASS：最终原生 Release 全量 142 项，63.424 秒，`media-cache-final-regression.{log,xcresult}`。
  同既有基线排除需要独立 HTTP 服务器的 3 项；包含通知主线程收紧及完整缓存队列测试。
  此前一轮 141 项、61.746 秒也通过，见 `media-cache-regression.{log,xcresult}`。
- PASS：iPhone XS Max / iOS18.7.10 / Release，13 项，15.313 秒，`media-cache-device.{log,xcresult}`。
  12 项缓存专项 + 原在线前缀队列回归。完整下载→原分析→Crossfade→缓存重播没有新增网关解析／网络请求。
  测试包与 xctestrun 均核对为 app.folia.validation.App，完成后已卸载，个人安装未被测试包覆盖。
- PASS：3 个视口现有 UI 24 项；新增缓存 UI 3 项，`media-cache-ui-final.log`。覆盖容量“不限制”、
  失败设置回退、离线曲目入口、清理时播放保持、无横向溢出。截图 `cache-settings-{phone,ipad,ipad-narrow}.png`。
- PASS：TypeScript、前端资源构建／Capacitor 同步、差异空白检查。见 `media-cache-typecheck-reviewed.log`、
  `media-cache-final-sync.log`。
- 失败记录：第一次 native 命令错用了 NativeTests target（实际为 FoliaNativeTests），无测试执行；
  改正 target 后测试通过。首次 UI 新用例把“服务器与外观”“返回音乐库”误写为“设置”“返回”，
  24 项原用例通过、3 项新增定位失败；修正定位并增加容量选择后，3 个尺寸全部通过。
- 边界：下载／HTTP 用范围受限的 URLProtocol 样本，实际走 URLSessionDownloadTask 和原生解码，
  不等于真实 QQ／网易 API、CDN 或 TLS 验收。音频之外的封面／歌词缓存移植、完整 Automix、长时间锁屏、
  物理耳机／蓝牙、歌词精度与性能仍未完成。详见 [MEDIA_CACHE.md](MEDIA_CACHE.md)。
- 2026-10-11 已完成干净 Release 开发签名构建、安装和启动，iPhone 回读 build 10。
  源码 `6bfd8ca9e1588e0d5af0d1d42b00442176eb748d`，309 个输入，指纹
  `369906aed00305f0834fa37c74ac9fd2c3b17cfe706329b5d67fa31e4bb38723`。
  包 `Folia-0.7.16-mobile.10-369906ae-development.ipa`，7,588,534 字节，SHA256
  `090b8b16a9ab814db977210e3c5e5f971b54dfcf641e93f69bd11130b59ea60a`。
  App 普通文件 15,828,781 字节，比 mobile.9 增加 275,660；IPA 增加 85,746 字节，包含代码、资源与签名变化。
  `mobile10-package-check.json` 核对签名、设备授权、102 个资源、全部源码输入与 ZIP 字节一致；不含 XCTest。
  校验脚本最初错误假设 profile 必须精确授权及前端版本等于营销版本；实际为通配符 profile，
  App 签名 entitlement 精确为个人 Bundle ID，前端身份为 0.7.16-mobile.10，修正核对依据后全部通过。
  `mobile10-device-{install,launch,app}.json` 为设备证据；BUILD_RECORD.json 与交付目录两份 sidecar 绑定源码。
  mobile.9 IPA 哈希复核未变，保留用于回退。
- [源码 CI 38081687736](https://github.com/Kun686/folia-Player/actions/runs/38081687736) PASS：
  vendor 完整性、固定依赖安装、TypeScript、移动逻辑、前端构建。后续文档提交不改变已安装 App 的源码提交。

## mobile.9：原 Crossfade、设置与歌曲分析（已安装的上一候选）

本轮候选包含原 Crossfade 队列、原过渡设置、本地完整／在线前缀分析与启动延迟修正；
默认仍关闭过渡，完整 Automix 未完成。源代码增加可选网络配置以验证流式解码与分析的完整链路，
生产网络策略未改变；修复拖动同一歌曲时取消分析导致额外前缀下载的问题。

- PASS：iPad Pro 11-inch (M5) / iOS26.5 / Release，130 项，59.925 秒，`online-transport-seek-full.{log,xcresult}`。
- PASS：iPhone XS Max / iOS18.7.10 / Release，12 项，16.976 秒，`online-transport-device.{log,xcresult}`。
  受控在线队列两次平台解析、两次前缀请求；过渡后只剩一条输出，双声道回调 RMS 0.124827。
  原本地缓存／静音边界及退出／取消回归通过；独立 QA 包测试完成后已移除。
- PASS：AudioStreaming 固定源码的 59 文件／两处适配及完整补丁与上游 checkout 核对。
  未新增依赖或修改固定版本；补丁保留上游空白，不按普通源代码格式化补丁正文。
- 失败记录：`online-transport-full` 为 129/130 通过，额外前缀请求断言失败；修复 seek 的取消范围后，
  保持原断言并增加过渡后真实输出测量，最终完整回归通过。详见 AUTOMIX_PORT.md。
- NOT_RUN：本版本真实 QQ／网易 API、CDN／TLS、长时间锁屏、物理耳机／蓝牙、歌词精度与持续性能。
- NOT_IMPLEMENTED：完整媒体缓存、完整 Automix 的实时分析／响度／频带／回声／伸缩及原过渡动画。

下列 mobile.8 及之前记录保留其历史验证范围。安装包身份仍以 BUILD_RECORD.json 为准。

2026-10-11 已完成 clean Release 开发签名构建、安装与启动，iPhone 回读 build 9。
源码提交 `32fd1a4a708118a9cf05b2e564050bed32d87db3`，295 个输入文件，指纹
`888524df32249442af603a1f48ad011cf7d90a5cb5273cd1fd1f7e30f00b8277`。
安装包 `Folia-0.7.16-mobile.9-888524df-development.ipa`，7,502,788 字节，SHA256
`9f003ec73b65b0a1d099bbdb38b375c33f761950b37e75950ec531cd452e36d5`。
App 普通文件合计 15,553,121 字节，比 mobile.8 增加 424,318 字节；IPA 增加 148,082 字节，
包含代码、资源、签名与归档元数据变化，不作为依赖单独增量结论。未新增依赖，mobile.8 包哈希复核未变。

- `mobile9-sync.log`、`mobile9-device-build.log`：资源构建／同步和干净 Release 签名构建通过。
  102 个前端／原生 JS 资源及两份许可证逐字节核对；版本／提交／仓库身份一致，无 XCTest 插件或链接。
- `mobile9-package-check.json`：严格签名、目标设备 provisioning、源码文件与 IPA 全部内容核对通过。
  首次 ditto 归档包含额外 AppleDouble 元数据条目，清单检查拒绝；改为只归档已签名普通文件后通过，
  签名 App 本体不变，原失败包仅保留在忽略的证据目录。
- `mobile9-device-install.json`、`mobile9-device-launch.json`、`mobile9-device-app.json`：安装、启动及 build 9 回读成功。
- `BUILD_RECORD.json` 与本机 `移动端交付/Folia-mobile9-build.json`、`Folia-mobile9-source.json` 对应该安装包；
  mobile.8 IPA 和元数据保留。安装启动不等于完整界面、物理听感或真实平台验收。
- 源码 [CI 38078062107](https://github.com/Kun686/folia-Player/actions/runs/38078062107) 通过：vendor 完整性、
  锁定依赖安装、TypeScript、移动逻辑及移动资源构建。

## 先前开发源码：在线歌曲前缀分析

当时未发布新 IPA；个人 iPhone 为 mobile.8。沿用原版关闭媒体缓存时的策略，在线分析仅请求
当前／待播地址的前 1,572,864 字节，要求 206，拒绝完整响应；原分析得到 `partial: true`，不推测未读尾部。
歌曲来源标识参与缓存键，临时播放 URL 不落盘；退出该平台后取消分析并清理其记录。

- PASS：iPad Pro 11-inch (M5) / iOS26.5 / Release，129 项原生回归，54.321 秒，
  `online-profile-full.{log,xcresult}`。本轮新增 8 项覆盖下载边界、无认证头、重定向回调、取消释放、
  原分析处理截断 WAV、平台／版本缓存隔离和退出竞态。依赖 vendor 逐文件／补丁核对通过，未改版本。
- PASS：iPhone XS Max / iOS18.7.10 / Release，11 项专项，12.204 秒，`online-profile-device.{log,xcresult}`。
  包括上述 8 项及本地缓存、范围取消、实测静音边界的真实解码队列；QA 包签名／宿主身份已核对，测试后移除。
- 未通过：在线前缀与真实流式解码队列的集成测试。全局 URLProtocol 注册未拦截 AudioStreaming 请求，
  改为单独注入分析网络配置后仍未进入播放；原日志 `online-profile-queue`、`online-profile-queue-config` 保留。
  该试验没有形成有效的回归用例，未纳入上述 129 项；没有降低断言或将失败标记为通过。
- NOT_RUN：真实 QQ／网易云 API、CDN／TLS、在线 Crossfade、锁屏长时间播放、网络切换与歌词精度。
  受控 URLSession 数据与原分析测试不替代真实平台或真机联网验收。
- NOT_IMPLEMENTED：完整媒体缓存、完整 Automix 的实时分析／响度／频带／回声／伸缩及原过渡动画接线。

## 先前开发源码：Crossfade、原设置与本地歌曲分析

当时没有发布新 IPA，个人 iPhone 为下述 mobile.8。开发源码已修正外部解码输出的 TimePitch
启动延迟和末尾丢帧，并将原 Crossfade 规则、原设置面板／store 接入原生队列；默认仍关闭。
本地导入歌曲现可通过原版无模型分析得到首尾静音边界，进入原生 Crossfade；具备版本缓存和任务取消。
当时在线分析、完整 Automix 与原过渡动画接线未完成；后续前缀分析进展见上节。

- PASS：本轮移动逻辑 48 项；连同原 Automix 相关回归共 462 项。TypeScript、移动资源打包及 iOS 同步通过；vendor 无改动。
- PASS：手机／iPad／窄窗口设置及音效回归 9 项，按钮样式隔离后三尺寸专项 3 项。
- PASS：本轮最终 iPad 模拟器 Release 全量原生 121 项，52.841 秒，`profile-fft-full.{log,xcresult}`。
- PASS：本轮 iPhone XS Max / iOS18.7.10 / Release 独立 QA 包 9 项，20.874 秒，`profile-fft-device.{log,xcresult}`。
  原分析接系统双精度 FFT 后，同样 8 组数值对照从 29.460 秒降至 3.982 秒，保持 1e-6 容差；QA 包已卸载。
- NOT_RUN：本次改动的长时间锁屏、真实平台音乐、物理音频听感／设备切换、性能与歌词精度验收。

完整证据、失败修正与尚未实现的边界见 [AUTOMIX_PORT.md](AUTOMIX_PORT.md) 的开发阶段记录。

## mobile.8：共享输出接入（上一版开发候选）

原生队列已接到同一个系统混音／整体音效输出。待播只缓冲；删除、自动切歌、暂停、拖动、配置变化
与资源释放均保持原队列语义。未新增依赖或改变主题、动效、音效参数。

- `shared-queue-first`：7 项专项通过。
- `shared-queue-full`：iPad / iOS26.5 / Release 完整 100 项通过，43.681 秒。
- `shared-queue-http`：1 项受控 HTTP Range 队列测试通过；边下载边播放、取消缓冲和自动切歌；服务已关闭。
- `shared-queue-device`：iPhone XS Max / iOS18.7.10 / Release 7 项关键测试通过，8.906 秒。

以上证据均位于 `.mobile-test-results/`，保留 `.log` 和 `.xcresult`。配置变化与中断采用通知注入，
不代表真实蓝牙／耳机操作通过。完整 Automix、真实 QQ／网易 App 在线验收、30 分钟锁屏、性能与歌词
精度仍未完成。详见 [AUTOMIX_PORT.md](AUTOMIX_PORT.md)。

2026-10-11 已完成 clean Release 开发签名包安装并启动，设备回读 build 8。源码
`47102ed5f431f9ca408aafdeba9af4ceab895b3b`，268 个输入文件指纹
`b064167b5ba521558880971cc39f8351ef5c4702efe72d88f4229951a057ec67`。
安装包 `Folia-0.7.16-mobile.8-b064167b-development.ipa`，7,354,706 字节，SHA256
`57540cfa750ae5c415597acc43028e50685012c438c3e79338e356b1f9f94515`。
App 普通文件合计 15,128,803 字节，比 mobile.7 增加 134,766 字节；压缩包小 20,615 字节，
受压缩／签名影响，不能解释为功能或依赖体积减少。没有新增依赖。mobile.7 包及旁置元数据原样保留。

- `mobile8-sync.log`：移动资源与 iOS 同步通过，随包版本、仓库与提交身份一致。
- `mobile8-device-build.log`：clean Release 构建通过，严格 codesign 校验通过；100 个前端资源、
  两份完整许可证与源码输出逐字节一致，IPA 内容也与签名 App 逐字节核对，无测试插件。
- `mobile8-device-install.json`、`mobile8-device-launch.json`、`mobile8-device-app.json`：安装、启动、build 8 回读成功。
- `BUILD_RECORD.json` 和本机 `移动端交付/Folia-mobile8-build.json` 标识此包；安装启动不是完整界面或听感验收。
- 源码提交的 [CI 38068139710](https://github.com/Kun686/folia-Player/actions/runs/38068139710) 通过：
  固定 vendor 清单、npm 锁定安装、TypeScript、移动逻辑与移动构建。

## mobile.7 之后：原版过渡规划（仅源码）

原版 Automix／crossfade 规则已能在系统 JavaScriptCore 中执行，无 WKWebView 参与。
相关 Vitest 78 项、iPad Release 原生 4 项通过，覆盖 80 方案、36 曲线及取消／并发／错误恢复。
这部分尚未接入实际过渡播放，完整 Automix 未完成；详情和证据见 [AUTOMIX_PORT.md](AUTOMIX_PORT.md)。
另修正三种语言中已过时的“附加音效需要立体声音源”提示。已安装 mobile.7 和 BUILD_RECORD.json 不变。

随后验证两个获批解码器汇入同一系统混音／音效输出。iPad Release 最终完整 98 项原生测试通过，
证据 `shared-output-system-conversion.{log,xcresult}`；包含实际音频回调、声道、暂停拖动和最终静音。
此新输出能力尚未切换为 App 默认，也未安装至真机；原失败及修复见上述 Automix 记录。

## mobile.7 双声道输出接入（上一版开发候选）

已安装iPhone XS Max / iOS18.7.10并启动，设备回读build 7；开发候选仍不代表完整移植验收通过。
源码`f303ada6bae36e1547f2d9d19e384cc0887d5e05`，258个输入文件指纹
`ab2cb085e8eec2f1aff19ca6a4991b0a349d0bc79ee016ee4713e94355befd44`。
安装包`Folia-0.7.16-mobile.7-ab2cb085-development.ipa`，7,375,321字节，
SHA256 `0daab3726abe21c8f88d9bd4009e0e43f7a8e0524df49dc5f52455e032b285bb`。
较同为Release的mobile.6增加484,525字节（约473KiB）；这是完整集成差值，不是单独依赖开销。
App普通文件合计14,994,037字节。mobile.6旧包及其元数据保持原样用于回退。

已按用户批准接入固定AudioStreaming 1.4.5及Ogg／Vorbis 0.1.2，保留原界面、音效预设和DSP参数。
上游队列不适合原删除语义，改为当前／下一项独立解码器；固定源码、两文件补丁与校验清单见
[AUDIO_OUTPUT_DECISION.md](AUDIO_OUTPUT_DECISION.md)。本节优先于下面的历史状态。

- `stereo-output-full.{log,xcresult}`：iPhone 17 Pro / iOS26.5 Simulator / Release，89项完整原生回归通过。
  包含WAV、AAC/M4A单声道的实际双声道音效，队列删除、相同URL不同播放项、快速切歌、静音、
  刷新／网络恢复、中断／暂停拖动、账户退出与既有DSP数值参考。未放宽原一致性阈值。
- `independent-preload-first`：本地及HTTP静默预加载、取消释放、保留当前播放通过；预加载输出帧数为0。
- `stereo-native-queue-closure`：5项通过；初次测试helper捕获非escaping闭包的编译错误已修复，
  失败记录`stereo-native-queue-first`保留。`stereo-recovery-first`新增2项通过。
- iPad Pro 11-inch (M5) / iOS26.5实际App播放验收音1后自动推进到4并结束；原音效面板可打开。
  截图`stereo-ipad-effects.png`、`stereo-ipad-queue-completed.png`。该次容器仍带旧前端版本标签，
  仅作为新后端的运行证据；新候选将从Xcode版本及当前Git身份生成标签。
- vendor原始59文件、当前哈希、两文件完整补丁校验通过；CI加入离线校验。
- `stereo-http-native-queue.{log,xcresult}`：3项通过。受控HTTP单声道实际音效、静默预载取消、
  完整PlaybackEngine删除缓冲曲目并独立切至下一首；没有WebView或真实平台参与。
  5,292,044字节音频在只读取部分字节时已播放，seek产生Range请求；测试服务结束后关闭。
- `mobile7-final-device-build.log`：clean Release构建通过；严格codesign校验、99个前端资源、
  两份完整许可证、随包版本／仓库／提交来源核对通过，最终包无测试插件。
  `mobile7-device-install.json`、`mobile7-device-launch.json`、`mobile7-device-app.json`确认安装启动及build 7。
- 最终源码的GitHub CI [38064957037](https://github.com/Kun686/folia-Player/actions/runs/38064957037)通过：
  vendor清单、依赖安装、TypeScript、移动逻辑和前端构建。
- `mobile7-device-native.{log,xcresult}`：iPhone XS Max / iOS18.7.10 / Release，6项真机原生测试全部通过。
  WAV／AAC真实Mono双声道PCM、低通衰减、左右噪声／混响差异、seek／暂停恢复、最终静音、
  中断恢复／账户退出、四曲自动推进及删除已缓冲下一首；16.498秒测试，不等于30分钟锁屏或听感验收。
- 首次包体核对发现Git常量被优化移除，补充随包`build-identity.json`后来源核对通过。
  首次远端CI `38064829732`失败：既有`models/`忽略规则漏掉4个已纳入本地校验的Swift文件；
  补充窄范围例外并提交原文件，校验器现在同时核对Git清单，避免本地未提交文件掩盖缺失。

真实QQ／网易App在线验收、真机锁屏／蓝牙／性能、歌词≤150ms、无缝间隔定量测量仍为NOT_RUN。
暂停时关闭效果分支的立即回收待测，Ogg不支持拖动；Automix及完整编辑工具仍未移植。

## mobile.6及其后续历史记录

mobile.5之后的附加音效开发单独记录在 [EFFECT_PARITY.md](EFFECT_PARITY.md)：32项相关原生测试通过，
包含固定WebKit过采样、压缩器、噪声／混响、组合链、线程交接及tap格式探测；Debug全部70项、Release相关8项回归通过。
随后实际tap接线9项、iPad Release内部链路14项通过；公开设置接入后的7项原生测试及6项界面测试通过。
当前mobile.6已开放立体声音效，Mono暂仅EQ并提示。

## 已批准的双声道流式输出首次验证（接入前历史）

AudioStreaming 1.4.5及Ogg／Vorbis 0.1.2已固定安装、校验并保留许可证。
新增AU音效适配复用现有DSP：本地／HTTP Mono实际双声道、可听滤波、左右噪声／混响差异、
拖动与暂停恢复通过；完整Release原生回归79项通过，见`streaming-native-standard-format`。
初轮AU交错格式测试失败，修正为SDK支持的标准格式及显式拒绝断言后通过，原记录保留。

上游队列另有真实复现的限制：初始化期间紧接入队可能丢项；删除已缓冲下一首无效。
能力探针确认缺陷不代表队列验收通过。因此实际播放器及已安装mobile.6未切换，Mono功能缺口尚未关闭。
详情、证据及复现命令见[AUDIO_OUTPUT_DECISION.md](AUDIO_OUTPUT_DECISION.md)。
新后端的完整App增量、真机和在线平台验收仍为NOT_RUN；本轮无界面变更，不重复跑UI套件。

## mobile.6之后的音效资源修复（仅源码）

- 噪声、混响与未改变的波形曲线复用；已准备但尚未播放的图同样复用素材。
- 分支淡出结束后由后续音频回调交接到控制线程释放，无需再次操作界面；
  失效分支会使借用旧素材的构造结果过期，避免重新启用旧卷积历史。
- iPhone 17 Pro / iOS 26.5 Simulator / Release：74项原生测试全部通过，
  证据effect-resource-final.{log,xcresult}。连续40次调参输出与独立参考图对照通过，
  噪声和混响各只构造一次；未播放图20次调参也只各构造一次。
- 首轮实际PCM测试把启动静音误当作音量基准而失败；加入播放时钟就绪条件和基准非静音断言后通过，
  原衰减／恢复断言未放宽。失败日志effect-resource-reuse保留，定向复测effect-resource-ready为8项通过。
- 后续测试确认当前模拟器的AVPlayer暂停后仍调用tap，关闭音效可完成淡出退役；
  中断／后台挂起时无回调的资源释放及真机性能仍为NOT_RUN。
- 此源码修复尚未打入交付IPA或安装至iPhone。BUILD_RECORD.json继续标识已交付的mobile.6，不代表修复后的源码。

## mobile.6 原音效与原生播放链

2026-10-10，0.7.16 / build 6，Release开发签名；源码身份见BUILD_RECORD.json。
复用原音效面板、六个音色预设、两个自定义栏位；非中性效果按需准备，原生EQ之后处理PCM，独立于WebView和FFT读取。
单声道附加音效尚未支持，继续EQ并明确提示。参数、主题和动效设计未更改，无新增生产依赖。

- TypeScript通过，移动逻辑38项通过；针对音效的三种尺寸WebKit界面6项通过。
- iPad模拟器Release全部71项原生测试通过，包含公开设置→实际PCM、预加载、持久化、Mono格式提示和既有队列／会话回归。
- 完整界面首轮20/21通过，iPad暂停检查失败；等待歌词加载完成以稳定控件布局后，失败单项复测通过。
  原始失败保留在mobile6-ui.log，复测与trace保存在mobile6-ui-retry.log及同名目录；没有提高断言容差。
- 原有Lumiere/Pixi滤镜诊断、Three弃用和React更新警告仍出现；模式可选择和挂载不等于所有动画已完整验收。
- mobile6-device-build.log构建通过，codesign严格校验通过；98个前端文件和完整DSP许可证与构建输入相同。
- iPhone XS Max / iOS 18.7.10安装、进程启动通过，设备回读为build 6。
  证据：mobile6-device-install.json、mobile6-device-launch.json、mobile6-device-app.json。
- 真机听感、30分钟锁屏、温升／内存、暂停资源释放、单声道立体声输出与App→网关真实在线验收仍未完成。

以下为mobile.5历史证据，其旧交付包与旁置元数据保持不变。

日期：2026-10-10。当前候选 **0.7.16-mobile.5 / build 5**，基于 mobile-main 的 4bfa668 继续移植。
当前源码指纹见 BUILD_RECORD.json。上游基线 d824c0b854e54d5411cb072092999823e9bd7071。
本轮校正原生频谱输入、恢复原版暂停呼吸，没有更改服务器、平台规则、主题／动效参数或生产依赖。
**本地工程验证通过，不代表真实在线账户／两台真机完整功能已验收。**

## mobile.5 原版音频动效输入

| 层级 | 结果 | 证据与边界 |
|---|---|---|
| TypeScript | PASS | spectrum-typecheck.log |
| 移动及声音逻辑 | PASS | 6文件49项，包含6项新增的原频段公式、Nyquist边界、暂停呼吸、并发请求、隐藏清理与错误恢复；npm run test:mobile -- test/unit/utils/audioEqualizer.test.ts |
| 原生完整回归 | PASS | 40项，spectrum-native-fixed.{log,xcresult}；含真实tap静音恢复及全部队列回归 |
| 频谱扩展对照 | PASS | 60组 × 3时间点 × 交错／分离格式；spectrum-native-layout-fixed.{log,xcresult} |
| 最终频谱格式UI回归 | PASS | WebKit手机／宽iPad／窄窗口共18项，spectrum-ui.log |

原生沿用原版2048点Blackman窗、0.6幅值平滑、−100至−30dB字节量程；
频谱按Web Audio规则下混，音量／静音只作用于分析副本，实际PCM不会被重复衰减。
FFT从音频回调移到按需快照：没有前台请求便没有FFT，400ms后停止采集。
音频回调只尝试锁；争用后重新建立完整窗口，不把不连续片段拼成伪频谱。
模式参数和动画组件未改变；原五频段响应及暂停呼吸提取为共同函数，
桌面保留原21.5Hz分箱边界，移动使用真实采样率；连续信号仍使用MotionValue。

独立参考由WebKit OfflineAudioContext生成，保存于SpectrumReference.json：
8／22.05／44.1／48／96kHz，单声道、右声道、反相抵消、四声道、5.1单独声道和离散布局；
音量1／0.25／0及信号转静音后的衰减。每个字节误差≤1（0–255），同一PCM重复读取不再次平滑。
此处验证的是分析算法和标准声道顺序，不代表所有文件编码或特殊声道布局已经实机通过。
重新生成：FOLIA_SPECTRUM_REFERENCE=1 npm run test:mobile:ui -- spectrum-reference.spec.ts --project=phone。

首轮完整回归39/40：静音并停止读取后，恢复第一帧残留99而非0；
原因是采集时间晚于上次请求，单独检查采集时间漏掉旧平滑历史。
恢复时按请求间隔清除旧窗口后，原断言和40项回归通过，未放宽静音断言。
扩展多声道测试首次因AVAudioFormat简便构造器不支持>2声道而退出；
按SDK要求传入显式声道布局后，60组对照全部通过。
扩展期间其余4个频谱／实际tap用例通过，证据在spectrum-native-multichannel.log；
该次整轮结果仍记FAILED，不能用部分成功替代完整结果。
最初一次测试命令用错target名NativeTests，纠正为scheme中的FoliaNativeTests后执行。
既有Pixi／Three弃用及React useInsertionEffect警告仍存在；没有把它们当作性能通过。

完整附加音效、Automix和桌面编辑功能仍未全部移植。
App到网易云／QQ网关真实账户、真机30分钟锁屏、网络／蓝牙切换、
全部模式性能及歌词≤150ms仍为NOT_RUN；历史平台记录不替代这些验收。

### mobile.5 安装与包校验

- 最终资源、Simulator及开发签名设备构建PASS：mobile5-resources.log、mobile5-sim-build.log、mobile5-device-build.log。
- codesign --verify --deep --strict PASS。两种App包各98个前端文件逐字节匹配dist-mobile，
  另有Capacitor自动生成的cordova.js／cordova_plugins.js两个空兼容文件，无XCTest或参考样本。
  首次校验把这两个生成文件当作差异；核对为空且没有其余额外文件后通过，未修改构建产物。
  结构化证据：mobile5-package-verification.json。
- build5已在iPhone XS Max／iOS18.7.10覆盖安装并启动，未卸载原App；
  mobile5-final-install.json与mobile5-final-launch.json的outcome均为success。
- 最终包在iPad Pro 11-inch (M5)／iPadOS26.5 Simulator启动，保留4个本地验收音频、
  队列外当前歌曲、暂停位置、27%音量及静音；展开Partita显示原有歌词。
  截图mobile5-ipad-paused-partita.png；此项仅证明安装／恢复和界面显示，不是性能或听感验收。
- 开发IPA、SHA256与私有构建记录在上级「移动端交付」，旧包保留。候选未完成全功能／真机验收。
- BUILD_RECORD.json的buildNumber同步为5；mobile.4旧记录误留3，不改变其实际App的build4身份。

## mobile.4 声音控制与均衡器

| 层级 | 结果 | 证据与边界 |
|---|---|---|
| TypeScript | PASS | mobile4-typecheck-final.log |
| 逻辑 | PASS | 43项；移动逻辑及原audioEqualizer设置；audio-unit.log |
| 原生 | PASS | 全部36项，audio-native.{log,xcresult}；追加实际tap测试单项PASS，audio-native-tap-signal.{log,xcresult}；共37个不同用例 |
| 原WebKit输出参考 | PASS | audio-webkit-reference.log；5种采样率×3组增益，保存原Web Audio图的冲激采样和能量供原生独立比较 |
| UI | PASS | 18项，手机／宽iPad／窄窗口各6项；audio-ui-final.log；平台和原生传输为fixture |

原生测试覆盖左右声道隔离、平面／交错浮点PCM、零增益精确旁路、关闭后的平滑回落、
流不连续时清除滤波历史、格式能力检测、无效与不支持参数原子拒绝、保存恢复、静音下调音量、
当前／预加载曲目接收新参数。追加测试播放合成1kHz WAV，在停止FFT轮询后设置−12dB，
恢复读取时观察到真实解码PCM的频谱下降；不涉及真实在线歌曲或设备锁屏。
稳态采样绝对误差阈值2e-5（单位幅度），能量相对阈值2e-4；动态15ms平滑按32帧更新，
不宣称与Web Audio自动化逐采样完全一致。

前端复用原设置store与对话框，桌面默认行为不变。移动桥串行合并连续编辑、保留最新意图，
原生拒绝后回填最后确认值。原版复合音色仍需移植额外音效，因此置灰并解释原因。
新增音量输出是单独的status区域，目录加载断言已限定在目录内。
首轮UI因新增测试选择器、歌词加载时序和对话框零尺寸语义容器失败，修正后通过；
测试时原生资源同步曾触发Vite重载，移动dev watcher现忽略ios／dist-mobile／证据目录。
实际tap测试首次抓到播放初始静音缓冲，改为等待合成信号后通过，没有放宽−12dB响应断言。
iPad实际容器随后复现触摸滑块数值变动但未保存：音量／静音可恢复，EQ仍为旧值。
新增事件顺序回归先失败（audio-touch-order-red.log，预期7实为0）；移动对话框改为从input事件提交，
桌面仍按原方式提交，3种窗口定向复测通过（audio-touch-order-green.log）。最终修改后没有重跑无关原生逻辑。
Pixi／Three弃用及既有React useInsertionEffect警告仍存在，不代表性能验收。

### mobile.4 安装与验收边界

- 最终资源同步、Simulator及开发签名设备构建PASS：mobile4-resources-touch.log、mobile4-sim-touch.log、mobile4-device-touch.log。
- codesign --verify --deep --strict PASS；设备包98个前端文件逐字节对应dist-mobile，无XCTest／参考音频样本；mobile4-package-verification.json。
- 最终build4已覆盖安装并成功启动于已连接iPhone XS Max／iOS18.7.10，未卸载用户App；mobile4-final-install.json、mobile4-final-launch.json为success。
- iPad Pro 11-inch (M5)／iPadOS26.5 Simulator实际触摸调节后，保存的原生设置及杀进程重启后的界面均为音量27%、静音、1kHz −8dB、EQ启用、自定义1。
  mobile4-ipad-audio-saved.json及mobile4-ipad-eq-restored.png记录此闭环；此前导入的4个合成音频仍保留。
- IPA、SHA256和构建记录存放于上级「移动端交付」。旧包保留；本版本仍是开发候选。
混响／饱和等附加效果、Automix、完整桌面编辑功能仍未完成。
App到网关网易云／QQ真实账户验证、两台真机30分钟锁屏、耳机／蓝牙／网络切换、
歌词≤150ms及温升／内存测试仍为 NOT_RUN。既有服务器记录是历史证据。

## mobile.3 队列与播放器回归

| 层级 | 结果 | 证据与边界 |
|---|---|---|
| TypeScript | PASS | npm run typecheck；queue-typecheck-fixed.log |
| 逻辑测试 | PASS | 移动逻辑及原 queueAddBehavior／queueBatchOperations，34 项；queue-unit.log |
| 原生 XCTest | PASS | 29 项，含全部21项既有回归；mobile3-native-final.{log,xcresult} |
| UI | PASS | 15 项，WebKit 手机／宽iPad／窄窗口各5项；queue-ui.log |

新增原生用例证明队列编辑保留实际 AVPlayerItem、位置与暂停状态；拒绝跨平台同ID替换当前项；
原生已自动前进但KVO回调未处理时，先校准再拒绝旧版本操作；清空后保持当前歌曲及暂停恢复；
注销清除队列外的当前歌曲；手动切歌、边界和脱离队列后的前后导航符合既定行为。
移动逻辑用例覆盖原工具函数复用、重复歌曲 occurrence、跨平台身份、仅身份式加入可有限重试。
UI新增触摸菜单、下一首、移除当前项、过期操作提示、打乱和清空后保留当前信息。

初次TypeScript检查发现nullable输入及联合类型收窄问题，修正后通过。首轮原生28项和UI15项均单次通过。随后在实际iPad容器发现恢复时长未加载导致进度条显示不准，
补上元数据时长与恢复状态拖动逻辑后，最终29项原生回归通过；没有更改前端代码。
iPad实际容器使用上轮导入的4个合成WAV，验证队列触摸菜单、下一首插入、选曲、暂停，
移除当前项／清空队列后保留当前曲目、歌词和播放位置。
截图：mobile3-ipad-detached-current.png、mobile3-ipad-empty-queue.png。

测试中的音频和平台响应为标注样本，不替代实际账户播放与真机长时间测试。
原有Pixi／Three弃用及React useInsertionEffect警告仍存在；没有新增未捕获pageerror证据。

### mobile.3 最终包与设备

- npm run ios:sync PASS；mobile3-resources.log。
- 最终 iOS 签名构建与 Simulator 构建 PASS；mobile3-device-final.log、mobile3-sim-final.log。
- codesign --verify --deep --strict PASS；设备包98个前端资源逐字节对应 dist-mobile；无测试插件。
- build3 最终包已覆盖安装并启动于已连接的 iPhone XS Max / iOS18.7.10；
  mobile3-final-install.json、mobile3-final-launch.json 均 success，未卸载用户App。
- 最终包在 iPad Pro 11-inch (M5) / iPadOS26.5 Simulator 重启后保持空队列及队列外当前歌曲；
  暂停时进度正确，拖动校准原 Partita 歌词，再从新位置播放／暂停；
  mobile3-ipad-restored-seek.png 为最终构建证据。
- 开发签名IPA、SHA256与构建记录存放于工作区上级「移动端交付」；文件名使用当前源码指纹前8位。
  旧mobile.1／mobile.2包保留。凭据、音频样本和测试代码不进入交付App。
- 真机实际音乐播放／30分钟锁屏与蓝牙／网络切换未在本轮执行；App在线真实账户验证仍为 NOT_RUN。

## mobile.2 历史验证（非本次重新执行的项目保留原边界）

| 层级 | 结果 | 证据与边界 |
|---|---|---|
| TypeScript | PASS | npm run typecheck；mobile2-typecheck-final.log |
| 移动逻辑 | PASS | npm run test:mobile，19 项；local-unit-tests.log |
| 原生 XCTest | PASS | 21 项；mobile2-native.{log,xcresult}；默认模拟器签名 |
| UI | PASS | npm run test:mobile:ui，12 项，WebKit；手机／宽 iPad／窄窗口各4项；mobile2-ui-import-stable.log |
| 系统文件导入 | PASS | iPad Pro 11-inch (M5) / iPadOS26.5 Simulator；真实 UIDocumentPicker 多选4个合成 WAV，无服务器 |
| 原生本地播放／LRC | PASS | iPad 模拟器实际播放、自动跨曲，系统选择器导入 LRC 并显示 Classic 动画；暂停、拖动、横竖屏 |
| 14 模式接入与外观配置 | PASS（接入） | 原注册表、参数和背景组件；UI fixture 挂载与短码回读；不是14种效果的完整视觉或性能验收 |
| 真实解码音频频谱 | PASS（本地 PCM） | 原生测试440Hz输入对应FFT峰值、停止读取后不再分析；在线流编码支持未全部验证 |
| iPhone 安装／启动 | PASS | build2 开发签名覆盖安装并启动，devicectl结构化结果success；未卸载用户App |
| App 内网易云／QQ完整在线流程 | NOT_RUN | 接口和账户历史证据在 SERVER_VALIDATION.md；本次没有重新扫码或App到网关端到端测试 |
| iPad实体设备、两机30分钟锁屏 | NOT_RUN | 模拟器不能替代真机长期验收 |
| 蓝牙／耳机／网络切换／歌词≤150ms／温升内存 | NOT_RUN | 没有对应的真机与仪器化证据 |

原生新增用例包括：导入后删除来源仍能播放、重建库后读取、拒绝路径遍历、歌词持久化、
损坏文件清理、断网下四首本地音频自动跨过三个边界且没有网关请求、退出在线平台保留本地播放、
恢复的暂停队列不会因预加载自行选曲，以及真实PCM频谱。21项包含全部15项既有回归。
这些测试不使用WebView，但只证明短时本地播放，不证明真机挂起时远程地址刷新。

UI使用专用原生桥fixture和平台样本；测试包含登录、歌单、搜索、播放控制、网络错误、本地导入／移除、
14模式挂载、外观短码和暂停时Partita切换／跳转。测试文件与样本没有进入App资源。
Partita暂停挂载时主歌词透明的问题先复现失败，再修正初始离散状态读取当前时钟；
保留原动画参数和视觉设计。证据为mobile2-partita-red.log和最终UI报告。
中间一次UI运行因初始歌词加载改变按钮位置，歌词导入点击未生效；修正测试等待初始加载完成并确认导入调用，
随后12项一次通过，没有放宽歌词内容断言。

开发环境仍有继承的Pixi／Three弃用警告和React useInsertionEffect警告；最终没有未捕获pageerror。
不能将Pixi打印的弃用调用栈当成已证实的渲染器崩溃，也不能将无pageerror当成性能合格。
原生频谱首轮测试读取到启动静音，改为等到实际非零信号后仍断言频率峰值；未改成虚假信号。

实际iPad截图：.mobile-test-results/mobile2-ipad-native-lyrics-{portrait,landscape}.png。
其中音乐和歌词明确标注为验收用合成内容，不是真实平台账户数据。最终资源及设备构建见文末更新。

## mobile.1 历史验证（非本次重新执行）

以下保留既有工程、服务器和设备证据；旧版启动服务器设置页的行为已经由mobile.2的本地曲库入口替换。

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

mobile.1交付了源码、Xcode工程、配置模板、构建说明与分层证据。QQ／网易内部服务与真实账户接口已验证，
开发签名包已安装iPhone，未做真机后台验收。当前mobile.2的本地使用无需HTTPS；在线网关连接与真机验收条件见ACCEPTANCE.md。

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

## mobile.2 最终设备更新

2026-10-10：npm run ios:sync、generic iOS开发签名构建、Simulator构建均通过，资源约11 MiB。
codesign --verify --deep --strict通过；设备包public下资源与本次dist-mobile逐字节一致。
最终构建证据：mobile2-resources-verified.log、mobile2-device-verified.log、mobile2-sim-verified.log。

已在连接的 iPhone XS Max / iOS18.7.10 上覆盖安装并启动 build2；
mobile2-verified-{install,launch}.json均为success。iPad模拟器也安装最终包，保留导入曲库、歌词和设置；
重新打开队列为暂停状态，Partita暂停后关闭／打开设置仍显示主歌词，
截图mobile2-ipad-native-paused-partita.png。该检查只验证状态恢复和显示，不证明长期性能。

本地交付文件：移动端交付/Folia-0.7.16-mobile.2-3b71ed27-development.ipa，6,938,977 bytes。
源码指纹：3b71ed2786ef7f4a89fa585e90562e7e6e4a5834f1c59a8f169b71f0ec18fb73。
IPA SHA256：5f6af233f15ebd067c3c7c6ff8f0a2a6554fd7f70158727f0a70605670d22d8d。
旧mobile.1包仍保留；IPA不含验收音频，也不上传仓库。只适用于开发描述文件允许的设备。
本次没有修改服务器部署、网关HTTPS规则、线上账号或生产依赖。
