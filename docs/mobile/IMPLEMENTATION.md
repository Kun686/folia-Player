# Folia iPhone / iPad 实现与安装

文件夹移植已接通系统目录选择、导入／取消、子目录浏览、重扫、忽略／恢复和移除，
沿用原扫描规则、字节解码及原生原子事务；同目录歌词／翻译／封面一并保留。
27 项相关逻辑、15 项 WebKit（最后界面调整另重跑其中 6 项）、模拟器与 iPhone QA 各 57 项原生测试通过。
iPad 模拟器系统选择器实际导入生成 WAV／LRC，播放、翻译、横屏和重启重扫通过；
真实文件提供器授权恢复、大曲库和真机手动目录导入仍未验收。
已汇入 mobile.28 并原位安装于个人 iPhone，启动并回读 build28；详见 [LOCAL_FOLDER_FLOW.md](LOCAL_FOLDER_FLOW.md)。

实体编辑已接通原版面板、原生曲库、匹配保护与队列，已汇入 mobile.27 并原位安装；
92 项逻辑、33 项独立 WebKit（最终布局另重跑其中 12 项）、模拟器与 iPhone 各 14 项原生测试通过。
iPad 模拟器实际导入合成 M4A、改名、拆分、旋转及重启恢复通过，详见 [LOCAL_ENTITIES.md](LOCAL_ENTITIES.md)。
个人 iPhone 已启动并回读 build27，mobile.26 原包保留。

后续源码补齐本地歌单／收藏，复用原业务规则、已安装 Dexie 和原生歌曲身份；
94 项逻辑、72 项 WebKit 和 3 项原生模拟器测试通过，见 [LOCAL_PLAYLISTS.md](LOCAL_PLAYLISTS.md)。
mobile.26 已加入手机 M3U 文件流程，28 项逻辑、33 项独立 WebKit、3 项原生模拟器测试通过；
iPad 模拟器实际完成系统分享保存、选择文件、导入及重启恢复，手机新功能仍待验收，
见 [LOCAL_PLAYLIST_FILES.md](LOCAL_PLAYLIST_FILES.md)。完整 Automix 的生产接入仍未完成。

2026-10-12 后续源码已接通原版四档音质偏好与原生播放地址请求，保留当前播放、缓存优先及原平台回退规则。
123 项逻辑／provider、9 项 WebKit、11 项 iPhone QA 自动测试通过；已汇入 mobile.21，真实平台音质仍待验证，
见 [AUDIO_QUALITY.md](AUDIO_QUALITY.md)。

2026-10-12 后续源码已补齐超过 100 个个人歌单的分页入口，隔离账户刷新与搜索请求，
并修正网易云错误响应被当成空歌单的问题。114 项相关逻辑／provider、12 项 WebKit 通过；
已汇入 mobile.21，真实大歌单账户待验，见 [CATALOG_PAGING.md](CATALOG_PAGING.md)。

后续开发源码已补齐原版睡眠定时：复用原控件，由原生持有期限，到期暂停并保留队列；
7 项逻辑、6 项 WebKit 和 10 项 iPhone 原生自动测试通过，无新依赖。
已汇入 mobile.21；用户确认 1 分钟锁屏到期暂停、手动继续正常，
未区分具体音源，逐平台及其他时长待验收，见 [SLEEP_TIMER.md](SLEEP_TIMER.md)。

后续开发源码补齐本地专辑／歌手只读浏览，复用原分组与排序，播放保留原生歌曲身份；
另修复切歌后旧歌词文件选择结果提交的竞态。17 项逻辑、78 项 WebKit 回归及 15 项补充导入专项通过，
专项包含重复回归；该阶段记录见 [LOCAL_BROWSING.md](LOCAL_BROWSING.md)，后续歌单与实体编辑见上文。

当前交付是 **0.7.16-mobile.28 开发候选**，支持 iOS/iPadOS 17+。
准确源码 `25e69b409b30ac9bebcadb8ed179c8d281c226e8`；2026-10-12 原位更新个人 iPhone，启动并回读 build28。
3,079 项源码输入、122 项资源、签名／IPA 和准确源码 CI 核验通过；164 项已测原生输入中仅构建号发生变化。
本版接入系统目录导入与管理，保留已接受的播放器与动效；真实文件提供器、实际曲库和本版手机在线复测仍 NOT_RUN。
mobile.27 原包保留且摘要未变；完整移植仍 IN_PROGRESS。详见 [VALIDATION.md](VALIDATION.md)。

此前 **mobile.27** 的证据：
准确源码 `e98b13e8671ff6c9afd9db3b014f49e4a425b706`；2026-10-12 原位更新个人 iPhone，启动并回读 build27。
3,043 项源码输入、121 项资源、签名／IPA、准确源码 CI 通过。原本地实体编辑现已接入原生曲库与队列；
本版手机在线复测、用户本地曲库、物理 iPad、大曲库与长期测试仍 NOT_RUN，完整移植仍 IN_PROGRESS。
mobile.26 原包保留且摘要未变；回退原位覆盖，不卸载个人 App。详见 [VALIDATION.md](VALIDATION.md)。

此前 **mobile.26** 的证据：
准确源码 `4b6d81ad6e7dc575c36cbe19ccdeee73c6e77233`；2026-10-12 原位更新个人 iPhone，启动并回读 build26。
3,026 项源码输入、120 项资源、签名／IPA、准确源码 CI 通过；iPad 模拟器实际完成 M3U 系统分享、
文件选择、导入与终止重启恢复。本版手机在线回归和本地新功能仍 NOT_RUN；mobile.25 原包保留。
完整移植仍 IN_PROGRESS，详见 [VALIDATION.md](VALIDATION.md)。

此前 **mobile.25** 的证据：
准确源码 `12f83db4f9ead5fa7c9d5c5888f7073d8092f1ec`；2026-10-12 原位更新个人 iPhone，启动并回读 build25。
3,020 项源码输入、120 项资源、签名／IPA、准确源码 CI 通过；iPad 模拟器实际完成歌单／收藏写入、
终止重启恢复与歌单范围播放。本版手机在线回归和本地新功能仍 NOT_RUN；mobile.24 原包保留，
完整移植仍 IN_PROGRESS，详见 [VALIDATION.md](VALIDATION.md)。

此前 **mobile.24** 的证据：
准确源码 `e2ba4becc33d6a7bb0ae30a6dc0a989dfab0d0ba`；2026-10-12 原位更新个人 iPhone、启动并回读 build24。
3,009 项源码输入、120 项资源、签名／IPA 和准确源码 CI 已核验；最终 iPad 模拟器容器已实际操作分类、搜索、播放并确认队列范围。
用户已确认本版在线播放正常；手机暂无本地歌曲，本地分类真机验收仍为 NOT_RUN，登录保留未单独确认。
mobile.23 安装包保留，没有存储格式迁移，详见 [VALIDATION.md](VALIDATION.md)。

此前 **mobile.23** 的证据：
准确源码 `169d0618c33cab4b14a37dee0df9df75d1582c4e`；2026-10-12 原位更新个人 iPhone、启动并回读 build23。
本版修复 mobile.22 用户报告的心象字号拖不动：仅调整字体／字幕滑块触摸处理，保留原字号范围、存储和 mobile.19 外观。
3,003 项源码输入、120 项资源、签名／IPA 和准确源码 CI 已核验；
修复通过干净 iPad 容器拖动／滚动／重启恢复及 18 项 WebKit 回归；用户已确认 mobile.23 心象字号可拖且歌词大小变化。
真机字体导入因无文件保持 NOT_RUN。详见 [TYPOGRAPHY.md](TYPOGRAPHY.md) 和 [VALIDATION.md](VALIDATION.md)，
上一版 mobile.22 及更早包保留。

此前 **mobile.21** 的证据：
准确源码 `6bc2bc6156c144df8b934187133ee522988a2978`；2026-10-12 原位安装、启动并回读 build21。
2,994 项源码输入、120 项生成资源、签名与 IPA 逐文件核验及准确源码 CI 通过。
iPad 模拟器实际容器已验证定时编辑／开关、音质选择／重启恢复及原音效设置保持；
用户已确认个人 iPhone 本版两平台登录保留，声音、歌词、拖动和切歌正常；
另确认 1 分钟锁屏定时暂停与手动继续正常，未扩展为完整平台／后台验收。上游源码基线为
d824c0b854e54d5411cb072092999823e9bd7071；移动分支发布到 Kun686/folia-Player，服务器部署记录见 SERVER_VALIDATION.md。
2026-10-11 已按用户指定接通 `https://music.nb686.cn`，在 mobile.12 中完成以下用户实测：
HTTPS 与网关认证已验证；用户已确认 iPhone 的真实 QQ 登录成功、可见账号或歌单。
用户进一步确认 QQ 声音、歌词、拖动和切歌正常，并反馈已完成所要求的锁屏持续播放与自动跨曲。
锁屏项目记为用户确认通过，未独立计时或采集曲目事件。网易云登录、歌单、声音、歌词、拖动和切歌
也已获用户确认；跨 QQ／网易云手动切换及锁屏／控制中心操作、回前台同步均获确认。
用户明确未做网易云长时间锁屏测试，该项保持 NOT_RUN。
开发源码 `152b2eb` 已接入原精细分词编辑与系统剪贴板桥接，并修复低高度窄窗口控件裁切。
相关开发阶段自动回归与通用 iOS 编译通过；分词原生交互尚未验证，见 [LYRIC_SEGMENTATION.md](LYRIC_SEGMENTATION.md)。
上述显示、分词及单曲 `.fia`／LRC 导出已汇入 mobile.13，2026-10-11 原位安装并启动于个人 iPhone，
设备回读 build 13；准确源码为 `82fb471fa8abad391f1171aae53d12ad140f87b0`。
原生导出输入检查 2 项通过；用户确认升级后两平台登录保留、播放及导出正常。
在线歌词导入文件被置灰为已确认问题；mobile.14 取消移动在线导入的扩展名过滤，保留原解析器、
大小限制及存储逻辑。源码 `a5de02f0a28f31dc9ceda443e7e22babc169087a` 已原位安装、启动并回读 build 14。
类型检查、13 项逻辑、6 项 WebKit、签名构建和准确源码 CI 通过；用户已确认两种文件均可选择、导入并正常显示，
见 [LYRIC_EXPORT.md](LYRIC_EXPORT.md)。
mobile.15 接入原版批量歌词导出，已原位安装并回读 build 15。用户提供清单（18 首导出、2 首跳过）并确认回导显示正常；
9 首旧缓存缺歌曲身份，导出正文但标注分词／校准不可恢复。详见 [BATCH_LYRIC_EXPORT.md](BATCH_LYRIC_EXPORT.md)。
mobile.16的分栏布局被用户真机反馈要求替换。mobile.17已原位安装、启动并回读build17：
手机／iPad播放页均为原版全屏画布，曲库独立；顶部歌曲信息、底部悬浮控制，低高度横屏缩成浅条。
播放闲置三秒后控制缩小淡出，首次触摸只唤回，暂停／拖动／弹窗保持显示；复用原动画、歌词及桌面计时，不新增依赖。
mobile.17自动回归及iPad实际模拟器操作通过；iPhone模拟器部分触摸检查受工具错误限制。
用户反馈布局“看着还可以”，追加磨砂气泡及空白轻点隐藏／唤回要求。mobile.18已原位安装、启动并回读build18：
控制器与顶部信息透色磨砂，轻点空白立即隐藏、再次唤回，保留自动隐藏及原歌词跳转行为。
交互回归35项、增强对比度3项通过；Playwright材质合成限制下3项像素测试明确跳过，原生Safari模拟器独立对照确认模糊。
签名、资源和准确源码CI通过。用户要求进一步半透明、跟随背景变化；mobile.19已原位安装并回读build19：
底色降至18%，减弱高光与阴影；原生对照发现的磨砂旧帧问题通过画面合成层修正。
最终29项界面回归通过、7项明确跳过；原生Safari冷暖背景对照通过。用户回复“先这样吧”，当前外观按此保留；
该反馈不等于全部动态材质、旋转或长期性能验收。
测试次数、分阶段修正和桌面已知预期失败见 [VALIDATION.md](VALIDATION.md)，布局见 [FULLSCREEN_LAYOUT.md](FULLSCREEN_LAYOUT.md)。
包含旧缓存身份随歌曲读取恢复。独立Automix旧候选1.24.2的htdemucs兼容性失败见[AUTOMIX_RUNTIME_DECISION.md](AUTOMIX_RUNTIME_DECISION.md)。
用户单独批准的官方Apple1.30.0已解除该失败，并完成Mac／iPhone两原模型单样本推理和参考对照；
后续原30秒窗口Mac拼接对照逐字节相等，iPhone约33.1秒、峰值1.08GiB；近静音vocals相对误差诊断未通过，
原16位存储最大差1单位，保留失败。真实分轨听感、播放器争用及长期性能待测，尚未接入个人App。
后续真实人声30秒片段在iPhone通过相同数值门槛，退出点与参考同为23.65秒；耗时41.4秒、峰值约1.08GiB，
真实分轨听感、播放争用及长期性能仍待测，见[AUTOMIX_MUSIC.md](AUTOMIX_MUSIC.md)。
详见[AUTOMIX_RUNTIME_130.md](AUTOMIX_RUNTIME_130.md)、[AUTOMIX_WINDOW.md](AUTOMIX_WINDOW.md)；
生产依赖与接入方案待批准，见[AUTOMIX_INTEGRATION_DECISION.md](AUTOMIX_INTEGRATION_DECISION.md)。
按用户最新要求优先移植原播放器、歌词和动效，同时支持本地导入与网易云／QQ。
服务器配置不再是使用 App 的前提。真实平台与真机完整验收尚未完成，不能作为已验收安装包发布。

历史 mobile.12 已原位安装并启动于 iPhone XS Max / iOS18.7.10，其源码提交及安装包摘要见
VALIDATION.md；BUILD_RECORD.json 现描述 mobile.26；mobile.25 及更早安装包保留用于回退。
新增包含原歌词时间校准、GBK／KRC 导入、内嵌／导入歌词来源管理、本地完整匹配及 Partita 长词适配。
本轮 142 项移动逻辑与 17 项 iPhone 原生专项通过；界面结果沿用各功能阶段证据，
不代表真实平台 App 链路、全部原生动画表现或长期真机验收已完成。
后续开发源码 `593615f` 已复用原版歌词过滤、制作人员策略、纯音乐／副歌处理与时间线。
186 项逻辑、39 项移动 WebKit、9 项原桌面组件，以及 iPad 容器预览／保存／重启短测通过；
详见 [LYRIC_DISPLAY.md](LYRIC_DISPLAY.md)。该源码阶段当时未更新个人 iPhone，随后已汇入 mobile.13。
当前原生队列使用一个共享系统输出，整体音效和最终音量只处理一次，待播仍独立解析／缓冲。
原 Crossfade 调度、设置和歌曲分析已接入，默认仍关闭。原音频缓存现已接入，默认关闭、5GB 上限；
开启时完整缓存用于原分析和离线播放，关闭且没有缓存时保持原在线前缀策略。
mobile.10 阶段的 142 项模拟器原生回归、13 项真机专项、51 项逻辑和 27 项 UI 证据见 VALIDATION.md；
这些历史次数不计入 mobile.12 的本轮结果。音频缓存边界见 [MEDIA_CACHE.md](MEDIA_CACHE.md)。

2026-10-11 后续开发源码已接入原版 ReplayGain、共用封面缓存和完整在线歌词持久存储，分别见
[REPLAYGAIN.md](REPLAYGAIN.md)、[COVERS.md](COVERS.md)、[LYRIC_CACHE.md](LYRIC_CACHE.md)。
歌词阶段最终通过 148 项逻辑、9 项 WebKit 界面、212 项模拟器原生及 23 项 iPhone 专项；
这些功能现已包含在 mobile.11。新增的在线歌词操作见 [LYRIC_TOOLS.md](LYRIC_TOOLS.md)，
其最终回归为 136 项逻辑、15 项 WebKit 界面、15 项 iPhone 原生专项。
完整 Automix、原版其余编辑工具、真实平台长期测试与性能验收仍待完成。

mobile.19 之后的开发源码已补齐本地多 USLT／iTunes 歌词择优、独立翻译保存／显示／导出及旧扫描升级。
复用原桌面选择规则，无新依赖；类型检查、28 项相关逻辑、7 项导出复核、3 项 WebKit 和 23 项原生专项通过，
测试次数不重复相加，见 [EMBEDDED_METADATA.md](EMBEDDED_METADATA.md)。
后续已复用既有 music-metadata 接入 FLAC／Vorbis comment 与 SYLT，扫描版本升至 3；
43 项逻辑、41 项模拟器原生通过，随后修正 iOS 18 系统不暴露普通 FLAC 歌词的问题，最终 iPhone 专项 10 项通过。
独立 QA 已清理；范围及失败记录见 [EMBEDDED_FORMATS.md](EMBEDDED_FORMATS.md)。
上述两阶段已汇入 mobile.20，2026-10-11 原位安装并启动，个人 iPhone 回读 build20。
准确源码 `9f87ef458f01cf54e0b82ec090daea68b5c8e54d`；2,975 项源码输入、120 项生成资源、签名和 IPA 逐文件核验通过，
[准确源码 CI](https://github.com/Kun686/folia-Player/actions/runs/38144231076) PASS。
界面保留 mobile.19；用户已确认 mobile.20 升级后“两平台登录保留，播放正常”。
该反馈记为本版用户实测，不扩展为新歌词格式、后台完整矩阵或性能验收。

此前附加音效开发见 [EFFECT_PARITY.md](EFFECT_PARITY.md)：DSP、组合链、线程交接和tap共32项测试通过；
组合阶段Debug全部70项、Release相关8项回归通过，随后实际tap接线9项通过。
开发源码已接回原复合预设、自定义栏位、持久化和当前／预加载曲目的立体声音效；公开设置7项原生测试、6项界面测试通过。
mobile.7已通过开发签名安装并启动于iPhone XS Max / iOS18.7.10，设备回读确认build 7；
6项真机原生关键测试通过，30分钟锁屏与听感验收仍未完成。
WebKit源码复用已获用户批准；暂停资源释放及真机性能仍待验收。
mobile.6之后的源码已优化连续调参的素材复用和播放中的分支回收，74项Release原生测试通过；
此修复未打入mobile.6交付包。mobile.7源码已接入获批的AudioStreaming 1.4.5独立双声道输出，
完整Release原生回归89项及HTTP实际队列3项通过，支持WAV／AAC Mono的原版完整音效。
本次iPad实际容器完成四曲顺序播放及音效面板检查；包体、签名与安装结果见VALIDATION.md。

## 已实现

原版 Automix 移植进度独立记录于 [AUTOMIX_PORT.md](AUTOMIX_PORT.md)：原规划和曲线的 JavaScriptCore 执行
以及共享输出已验证，共享输出、Crossfade 调度和前台设置已接入实际播放器；不计为完整 Automix 功能。

- 独立 React 移动入口，音乐库／底部播放条／展开全屏歌词；所有窗口的播放页使用完整画布与自动隐藏控制层。
- 通过 Omni 复用网易云、QQ、酷狗登录、搜索、歌单和歌词；列表采用现有 react-window。
- 复用扫码状态机，支持平台登录渠道、分享 QR 图片、过期／取消／回前台立即检查；请求代次隔离。
- Keychain 保存服务器凭据与各平台会话，使用 AfterFirstUnlockThisDeviceOnly；WebView 仅恢复会话内存镜像。
  localStorage 只保存非敏感的主题、动效、外观及声音设置。退出取消平台请求、清除对应凭据、账户缓存和队列中对应平台歌曲。
- 系统「文件」选择器导入音频；副本保存在 App Application Support，以 UUID 的 local sourceRef 入队。
  AVFoundation 读取曲名、歌手、专辑、时长、封面和内嵌歌词；支持 UTF-8／UTF-16／GBK 及加密 KRC 歌词导入。
  歌词通过原 LocalFileLyricAdapter／worker 解码解析；支持独立内嵌／导入来源、原完整匹配弹窗，
  元数据／封面／歌词分别选择，原子保存后保持当前音频及进度。支持本地搜索、移除副本和队列混合。
  无服务器时默认打开本地库；断网或退出在线账户不会暂停其他本地歌曲。
- Folia原生层管理身份队列，AudioStreaming独立解码当前与下一首，待播项静默缓冲、可独立取消；
  原生网络请求不需要 JavaScript。URL 播放失败重新解析一次，连续失败三首停止，认证／限流错误直接停止。
- 队列触摸菜单：下一首播放、移到队尾、移除、打乱与清空。复用原版去重、插入与打乱规则，
  Native 原子校验队列版本；锁屏切歌后的过期行操作会明确失败，按歌曲身份加入可重取状态一次。
  调整队列保留当前解码器、进度和暂停状态；移除当前项／清空只修改队列，当前歌曲继续播放，
  也能以暂停状态恢复。退出账户或删除媒体则同时清除队列外仍在播放的对应歌曲。
  手动上一首直接切歌，队列边界不意外暂停；从暂停状态手动切歌会开始播放，与原版一致。
- 原生锁屏／耳机命令、音频中断、旧输出设备断开、网络不可用与恢复、代次保护、暂停恢复和身份队列持久化。
  网关 Authorization 不送往 CDN。
- 原生快照驱动前台 MotionValue 歌词时钟；隐藏／后台不挂载歌词视觉层，回前台读取原生状态。
  默认 Classic；复用原 VisualizerRenderer、14 模式注册表、背景注册表、参数面板和资产恢复。
  使用现有外观短码／JSON 编解码器导入、导出和应用自定义主题，不需要配置同步服务器。
  开发源码补齐原字体／字幕控件、字号字重、备用字体与透明度；复用原偏好恢复和 FontFace 加载器，
  WebKit 上传字体保存为字节并兼容旧 Blob。取消与存储失败不会替换当前字体，详见 TYPOGRAPHY.md。
  AUAudioUnit + Accelerate处理双声道解码PCM，向原渲染器提供5个频段和频谱；旧AVQueuePlayer/tap路径保留作回退。
  频谱沿用原版2048点Blackman窗、0.6幅值平滑、−100至−30dB量程和声道下混规则；
  按原生音量／静音修正分析副本，不重复衰减实际音频。FFT仅在界面请求新数据时运行，
  停止读取400ms后连PCM采集也停止；恢复、跳转或采集中断清除旧窗口。
  前台通过RAF读取，最多一个请求在途；隐藏后停止，旧响应不得恢复动画。
  原版五频段响应与暂停呼吸逻辑提取为两端共用，保持桌面频段边界及所有模式参数。
  无法读取 PCM 的流格式保留歌词时钟，不能宣称音频响应等价。
  修复 Partita 在暂停时挂载／切到新歌词行后不显示的问题：初始离散状态读取当前时钟，原动画参数不变。
  后续开发源码共用原歌词显示处理链，按来源／设置变化处理，原始缓存不写入过滤结果。
  原过滤弹窗支持预览与保存失败重试；原时间线在暂停时正确高亮、点击按偏移映射到原生位置。
  Automix、原桌面全部编辑工具尚未完成移植；所有复杂动画的真机性能也未验收。
- 音量／静音在最终混音节点应用，修改音量保持静音；复用原 useAudioSettingsStore 及已有命令动作。
  十段均衡器复用原对话框、频段、±12 dB 范围、两个自定义栏位和重置操作。
  原生 Accelerate biquad 按原 Web Audio 低架／峰值 Q=1.4／高架滤波计算，频率同样限于采样率的0.475倍。
  参数采用15ms时间常数、每32帧更新，稳态与原 WebKit输出作数值对照；不声称动态自动化逐采样完全相同。
  音频处理始终运行，FFT继续按前台需求停启；当前与预加载曲目都接收最新参数，调节不替换当前项。
  声音设置保存到原生 UserDefaults，启动回填原 store；快速操作串行合并，失败回到最后确认值。
  移动触摸从实际input事件提交，避免WKWebView的最终值晚于pointerup而丢失；桌面保持原提交时机。
  当前开发源码开放原版六种音色预设、两个自定义栏位及全套效果推子，立体声通过原生组合链播放。
  新输出链将Mono转换到双声道后处理，效果准备失败／准备中状态由原生发布。mobile.6旧安装包Mono仍只有EQ。
  WAV／AAC和受控HTTP已测，全部在线编码、Ogg拖动及真机音质尚未验收；Ogg当前不支持拖动。
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
| 原生播放 | PlaybackEngine.swift、PlaybackQueue.swift、PlaybackSystem.swift、PlaybackStreaming.swift、StreamOccurrence.swift |
| 本地媒体与音频分析 | LocalMediaLibrary.swift、LocalImportPicker.swift、AudioMeter.swift、AudioSpectrum.swift |
| 网关与部署 | deploy/mobile/ |
| 自动测试 | test/unit/mobile/、test/mobile-ui/、ios/App/NativeTests/ |

桌面/Web 播放行为保持原状；打乱函数提取为共同 helper，原逻辑不变；公共 provider 仅抽取播放解析并增加可选移动传输，不全局替换 fetch。

## 复用与依赖决定

复用 React、Omni/provider、登录状态机、歌词解析器、完整视觉注册表、现有主题、react-window、Vitest、
Playwright、Express 和各 API 服务。凭据使用Apple标准框架，歌词与UI不新增库。
已批准的 Capacitor core/ios/cli 8.5.3（MIT）；core 依赖 tslib，ios 原生部分由 SPM 精确锁定
8.5.3，revision 4c7f346d16196e21fbe23d4a7a6fc7af62af6742。CLI 仅开发使用。
音频新增用户已批准的AudioStreaming 1.4.5（MIT）、Ogg／Vorbis 0.1.2（BSD）。AudioStreaming固定源码
及最小适配随仓库保存于ios/Vendor；其余SwiftPM提交仍由Package.resolved精确锁定。
构建前执行`python3 dev/mobile/verify-audio-vendor.py`核对源码清单；补丁、来源及许可见AUDIO_OUTPUT_DECISION.md。
不新增npm生产依赖。所有渲染器与资源随App打包；最终资源大小以构建记录为准。

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

服务器内部部署、QQ／网易真实账户接口验证、可信 HTTPS 入口和 iPhone 开发签名安装已经完成。
当前 mobile.12 的 QQ 登录、声音、歌词、拖动、切歌和锁屏自动跨曲已获用户真机确认；
网易云相同基础操作、跨平台手动切歌及锁屏／控制中心操作也已获用户确认。
QQ 锁屏结果未独立计时，网易云长时间锁屏未执行；搜索、歌单完整性及后台异常矩阵仍待验证。此前服务器测试会话已清理，
不代表本次手机 QQ 会话已退出；后续测试保留手机上的现有登录态。本地播放器可独立使用与验收。
iPad 真机安装和两台真机的长期后台／性能验收仍待完成，模拟器结果独立记录。
酷狗按最新范围延后。配置与凭据不写入源码。
按 VALIDATION.md 和 ACCEPTANCE.md 逐项完成真实测试后，才能把状态改为首版交付完成。

## Fork 来源与自动化

本移动分支保留原项目 AGPL-3.0 许可、作者信息及源码。上游为 https://github.com/chthollyphile/folia-major ，基线提交见上文。
首次导入新仓库采用该基线加移动改动的源码快照；原始历史在上游可查。继承的桌面发版、定时发布与 issue 自动化移到 .github/upstream-workflows/ 保存，不在本仓库执行。
当前仅启用移动端类型检查、逻辑测试与资源构建 CI。
