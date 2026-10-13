# 真实服务与真机验收表

当前验收优先级为 QQ／网易云核心功能、特效动画、设置 UI，见 [CURRENT_SCOPE.md](CURRENT_SCOPE.md)。
本地音乐、其他平台、同步、AI 和完整 Automix 扩展暂缓；历史自动测试不自动替代当前两平台真机验收。

2026-10-14 QQ 歌单响应：个人歌单、自建／公开歌单曲目缺少数组时不再被当作成功空页，沿用原失败提示及重试。
267 项两平台 provider／transport／会话逻辑、138 项 WebKit（新增异常／空页 30 项及既有回归 108 项）、类型检查与移动构建 PASS。
真实账号、原生容器和物理设备本批 NOT_RUN；个人 mobile.28 和服务器未更新，见 [PLAYLIST_RESPONSE.md](PLAYLIST_RESPONSE.md)。

2026-10-14 歌单播放账号时序：修复等待凭据保存时退出／切换后，旧点歌操作仍提交队列的问题。
763 项移动逻辑、135 项 WebKit（两平台、三视口及原搜索／目录／队列／替代歌曲回归）、类型检查与移动构建 PASS。
受控桥证明前端阻止过期提交，真实账号、Keychain、原生音频／物理设备 NOT_RUN；个人 mobile.28 和服务器未更新。
见 [COLLECTION_PLAYBACK_SESSION.md](COLLECTION_PLAYBACK_SESSION.md)。

2026-10-14 原动效旋转：Tilt 旧排版、Tempera 失效滤镜纹理已有失败复现及修复，
51 项 WebKit（48 项窗口／模拟前后台及 3 项最小复现）、1014 项视觉逻辑通过，
1 项可选测量 SKIPPED，类型检查与移动构建 PASS。
见 [VISUALIZER_ROTATION.md](VISUALIZER_ROTATION.md)。测试使用受控在线缓存，真实账号、物理设备、实际系统挂起、
长期动画性能 NOT_RUN；个人 mobile.28 和服务器未更新。

2026-10-14 设置布局与动效回归：固定标题、分组、子页返回、短窗口键盘避让和三语言小屏检查已通过，
合计 152 个唯一 WebKit 用例 PASS、7 SKIPPED，详见 [SETTINGS_LAYOUT.md](SETTINGS_LAYOUT.md)。
7 项跳过不计通过：4 个重复布局矩阵、3 个当前合成器不支持的独立背景模糊探针。
本批原生／物理设备／真实账号 NOT_RUN；个人 mobile.28 和服务器未更新，实际观感／手感与长期性能待验收。

本轮可选启动续播与核心回归：763 项移动逻辑、171 个唯一 WebKit 场景、41 项原生模拟器测试通过。
保留首轮失败及样本／定位器修正记录，见 [LAUNCH_PLAYBACK.md](LAUNCH_PLAYBACK.md)。
个人 mobile.28、真实账号和服务器未操作；新版两平台真机、设置 UI 美化与长期动画性能仍待验收。

集合范围入队的 775 项逻辑、111 个 WebKit 场景和本地完整快照 3 项复测通过。
覆盖当前范围、不可用项／重复项、默认位置、队列容量与账号取消；个人 mobile.28 未更新，本批原生／真机／真实服务 NOT_RUN。
完整交付仍未完成；见 [COLLECTION_QUEUE.md](COLLECTION_QUEUE.md) 与 [PORT_STATUS.md](PORT_STATUS.md)。

原界面语言设置已通过 976 项逻辑、33 个 WebKit 场景和最后 3 项旋转／触摸复测，类型检查与移动构建通过。
保留旧语言缓存问题、旧回归定位歧义及其修复证据；个人 mobile.28 未更新，本批原生／实际系统语言／真机 NOT_RUN。
完整交付和 Automix 长期验收仍未完成，见 [LANGUAGE_SETTINGS.md](LANGUAGE_SETTINGS.md)。

移动队列搜索与批量操作通过 769 项逻辑、72 个 WebKit 场景、类型检查和移动构建；保留原搜索排名、批量顺序及当前重复项身份。
首轮下拉框 23px 触摸高度问题已修复并复测；个人 mobile.28 未更新，本批原生／真机／真实平台 NOT_RUN。
完整移植与 Automix 长期验收仍未完成，见 [QUEUE_SEARCH.md](QUEUE_SEARCH.md)。

Navidrome 原生播放上报通过 797 项逻辑与 60 项原生模拟器回归，包含三首实际解码的短音频及网易云既有听歌记录回归。
首轮账号切换的槽位释放竞争已修复并用相同选择器复测；个人 mobile.28 未更新，真实服务器记录／物理设备／系统挂起 NOT_RUN。
完整移植与长期性能验收仍未完成，见 [NAVIDROME_SCROBBLE.md](NAVIDROME_SCROBBLE.md)。

Navidrome 歌单编辑与收藏已完成受控验证：1,427 项逻辑、27 项 Navidrome WebKit 场景、21 项既有在线收藏回归及 35 项原生模拟器测试通过。
涵盖未知写入结果、重复歌曲位置、账号变更取消和原生桥接；Subsonic 不支持条件写入，不能保证跨客户端的位置移除原子性。
个人 mobile.28 未更新；真实服务器写入／物理设备／系统挂起 NOT_RUN，完整交付仍未完成，见 [NAVIDROME_EDITS.md](NAVIDROME_EDITS.md)。

Navidrome 设置、浏览、搜索与既有原生播放已接通：1,418 项逻辑、32 项 WebKit 及 31 项原生模拟器测试通过。
旋转测试在 phone 项目覆盖 8 种尺寸和深浅主题，另 4 个重复实例按原规则跳过；真实服务／物理设备／系统挂起仍 NOT_RUN。
该浏览阶段个人 mobile.28 未更新；后续歌单编辑与收藏见上文，完整交付仍未完成，见 [NAVIDROME_LIBRARY.md](NAVIDROME_LIBRARY.md)。

Navidrome 封面和歌词已接入原生播放器，复用原解析器与缓存，支持已有歌词导入、来源切换和导出工具。
1,451 项逻辑、9 项 WebKit 界面及 87 项原生模拟器回归通过；真实 Navidrome／真机／系统挂起仍 NOT_RUN。
该资源阶段个人 mobile.28、界面布局、动效、音频算法和依赖版本保持不变；后续设置／浏览装配见上文，见 [NAVIDROME_RESOURCES.md](NAVIDROME_RESOURCES.md)。

Navidrome 原生播放在受控 Subsonic 响应下完成三曲实际 PCM 输出、拖动／断网恢复、缓存／账号隔离和重定向保护。
51 项原生模拟器与 1,443 项逻辑回归通过；该播放阶段未装配设置／浏览与封面／歌词，后续资源接入见上文；真实服务／物理设备／系统挂起 NOT_RUN。
个人 mobile.28、真实账户和服务器未操作，完整移植仍未完成，见 [NAVIDROME_PLAYBACK.md](NAVIDROME_PLAYBACK.md)。

Navidrome 共享解析、并发排队、会话取消与歌曲身份隔离通过 1,451 项逻辑和 14 项原生模拟器测试。
新增原生用例实际运行打包 JS，经 Capacitor 连接 Keychain／URLSession；响应为受控样本。
该批移动浏览／原生播放未交付，后续原生播放见上文；真实服务／真机 NOT_RUN，见 [NAVIDROME_SHARED.md](NAVIDROME_SHARED.md)。

Navidrome 原生连接层已通过 60 项原版逻辑与 30 项原生模拟器测试，包含真实 Keychain、URLSession 和 Capacitor 桥接。
仅完成凭据与只读请求，移动浏览／原生播放尚未接入；真实服务器和物理设备 NOT_RUN。
个人 mobile.28／服务器未更新，见 [NAVIDROME_TRANSPORT.md](NAVIDROME_TRANSPORT.md)。

定位状态竞争已用真实解码与最小并发程序复现并修复；iPad 模拟器 26 项流式路径 Thread Sanitizer、
iPhone 模拟器普通 Release 39 项回归通过。旧 AVPlayer 的系统 tap 交接诊断仍未定论，未把完整插桩组标为通过。
物理设备／真实平台／长期性能 NOT_RUN，个人 App／服务器未更新，见 [PLAYBACK_THREAD_SAFETY.md](PLAYBACK_THREAD_SAFETY.md)。

「播放时阻止休眠」已接入原设置与 UIKit，默认关闭，原生管理前台播放及暂停／离开释放。
14 项逻辑、15 个 WebKit 场景、iPhone／iPad 模拟器各 17 项原生测试通过，包含真实打包页面与 PCM 输出。
真实锁屏／温升 NOT_RUN，个人 mobile.28／服务器未更新；首轮线程问题、失败与复测证据见 [DISPLAY_SLEEP.md](DISPLAY_SLEEP.md)。

原版「播放设备」已接入移动音频设置与系统 AVRoutePickerView；26 项逻辑、9 个 WebKit 场景和两种模拟器各 5 项原生测试通过。
覆盖面板生命周期、PCM 连续输出和明暗主题；模拟器未显示可选设备列表，真实蓝牙／AirPlay 切换 NOT_RUN。
个人 mobile.28／服务器未更新，完整移植与 Automix 真机验收仍未完成，见 [AUDIO_ROUTE.md](AUDIO_ROUTE.md)。

原版视频层已接入移动画布与触摸设置，保留静音、循环、原参数和本地文件优先规则。
687 项逻辑、24 项 WebKit（另 3 项旧字体用例跳过）、1 项打包后 iOS 模拟器 PCM／视频共存检查通过。
桌面 Chromium UI 受缺少运行文件阻塞；真机／长期性能 NOT_RUN，个人 App／服务器未更新，见 [VIDEO_LAYER.md](VIDEO_LAYER.md)。

本地 Ogg / Vorbis 离线增量（2026-10-13）：

- PASS：复用已批准库的实际 Vorbis 解码、原版标签／歌词、拖动与跨格式本地队列、重启与文件夹重扫；129 文件／1380 项逻辑、25 项原生模拟器测试、类型检查和移动／原生 QA 构建。
- NOT_RUN：实际 Files 选择、物理设备、大文件性能、真实平台；完整 Automix 真机验收仍未完成。
- 个人 mobile.28、账户与服务器未操作；格式／存储限制及证据见 [LOCAL_VORBIS.md](LOCAL_VORBIS.md)。

本地歌曲排序移植通过 1376 项逻辑、57 个 WebKit 场景、23 项原生模拟器测试，真实 MP3／M4A／FLAC 样本与桌面解析一致。
覆盖保留文件升级、歌词／人工匹配保留、排序偏好与播放队列一致性；本批实际 Files 提供方／真机／真实平台 NOT_RUN。
个人 mobile.28／服务器未更新，大规模旧曲库性能待验，见 [LOCAL_TRACK_ORDER.md](LOCAL_TRACK_ORDER.md)。

本地歌曲批量信息整理复用原版界面与匹配规则，提供全部歌曲／实际文件夹入口，歌曲与会话版本校验保护并发保存。
709 项逻辑、45 个 WebKit 场景、19 项原生模拟器测试通过；本批真实平台／真机／系统挂起 NOT_RUN。
个人 mobile.28／服务器未更新，见 [LOCAL_METADATA_MATCH.md](LOCAL_METADATA_MATCH.md)。

本地歌曲自动匹配已接入原生当前／下一首队列，沿用原版歌词、封面和歌曲信息匹配规则。
69 文件／640 项移动逻辑、70 项原本地库回归及 17 项原生模拟器测试通过；
涵盖同一解码器连续播放、并发保存、明确文件来源及迟到结果保护。
真实平台／真机／系统挂起 NOT_RUN，个人 mobile.28／服务器未更新，见 [LOCAL_AUTOMATIC_MATCH.md](LOCAL_AUTOMATIC_MATCH.md)。

原版最佳歌词现已接入原生当前／下一首队列、原设置同步、带会话与选择版本校验的共享缓存，
并支持前台恢复显示。70 文件／664 项逻辑、会话保护补测 37 项、33 项 WebKit、
Mac 裸 JavaScriptCore 8 项及独立模拟器 24 项通过；分批统计不相加为不同用例总数。
真实平台／真机 NOT_RUN，个人 App／服务器未更新，见 [LYRIC_QUEUE_INTEGRATION.md](LYRIC_QUEUE_INTEGRATION.md)。

自动歌词更新撤销已锁定 Automix 计划的问题已复现并修复，手动选择也会等缓存重读后再规划。
18 项原生回归及 1 项原模型模拟器用例通过；受控在线与离线两次分轨交接均在静音预播放期间更新歌词，
保留同一下一首、计划和音频调度。真实服务／物理设备／系统挂起 NOT_RUN，公开完整能力仍关闭，
个人 mobile.28／服务器未更新，见 [LYRIC_HANDOVER.md](LYRIC_HANDOVER.md)。

Automix 三进程内存测量通过：独立模拟器 1 个用例内三轮真实分轨交接，0 FAIL／0 SKIP；
187 次原始快照中 185 次覆盖 15 个有效阶段。最高同次物理账本之和约 1.38GiB，
清理后约 259／260／246MiB，未见逐轮累积；未证明整 App 去重内存或真机／长期达标。
个人 App／服务器未更新，公开完整能力仍关闭，见 [AUTOMIX_PROCESS_MEMORY.md](AUTOMIX_PROCESS_MEMORY.md)。

不可播放歌曲的原版替代版本流程通过140项逻辑与87个不同 WebKit 场景，覆盖明确确认、取消、
退出／导航后的迟到响应、原生队列版本冲突及手机／平板旋转。均为受控请求和桥；真实网易云、
原生容器、真机及服务部署 NOT_RUN，个人 App／服务器未更新，见 [SONG_REPLACEMENT.md](SONG_REPLACEMENT.md)。

原模型 Automix 的跨进程离线恢复通过独立模拟器验证：7个不同原生用例、8次执行，无失败或跳过。
包含实际原分轨交接及循环下一首预加载；不代表系统强杀／WebView 挂起／真机／真实平台验收。
个人 App／服务器未更新，见 [AUTOMIX_RESTART.md](AUTOMIX_RESTART.md)。

歌曲信息触摸复制、错误恢复、跨来源隔离及显式页面链接通过219项逻辑／provider与48个 WebKit 场景。
外部网页和剪贴板均为受控测试，真实跳转／原生剪贴板／真机 NOT_RUN；个人 App／服务器未更新，
见 [SONG_INFORMATION.md](SONG_INFORMATION.md)。

原版动效偏好通过42项逻辑、33个 WebKit 场景与类型检查，覆盖触摸、旋转、重载、失败恢复及实际动画行为。
桥接使用受控数据，原生容器／真实系统事件／真机 NOT_RUN；个人 App／服务器未更新，
见 [MOTION_PREFERENCES.md](MOTION_PREFERENCES.md)。

受控在线原模型 Automix、同进程离线队列重播、缓存退出隔离和流式凭据清理通过11项原生模拟器测试及构建。
传输使用 URLProtocol，不代表真实 QQ／网易云或 CDN；真机、系统挂起、温升及人工听感仍 NOT_RUN。
个人 mobile.28／服务器未更新，公开完整能力继续关闭，见 [ONLINE_AUTOMIX.md](ONLINE_AUTOMIX.md)。

在线歌词偏好通过 56 项逻辑、30 个 WebKit 场景及类型检查，覆盖两平台已选来源保护、
真实匹配器与受控 QQ 样本、切换偏好时的旧结果隔离。本批原生容器／真实平台／真机 NOT_RUN；
该阶段尚未接通后台队列与缓存合并，后续已由上述 LYRIC_QUEUE_INTEGRATION 完成；
个人 App／服务器未更新，见 [ONLINE_LYRIC_PREFERENCE.md](ONLINE_LYRIC_PREFERENCE.md)。

歌词格式排序、持久化与重扫设置通过 28 项逻辑、27 个 WebKit 场景及类型检查。
测试涵盖原批次协议及取消／失败边界，受控桥不代表实际目录授权、文件覆盖或真机验收。
个人 App／服务器未更新，本批原生容器和真机 NOT_RUN，见 [LYRIC_FORMAT_ORDER.md](LYRIC_FORMAT_ORDER.md)。

默认加入位置与明确下一首／末尾操作通过 27 项逻辑、33 项 WebKit 及类型检查，包含偏好恢复、
存储失败、等待中的选择与跨来源队列；两个偏好选择器达到 44px。受控响应／桥证据不代表真实平台。
个人 App／服务器未更新，本批真机和原生容器 NOT_RUN，见 [QUEUE_PREFERENCE.md](QUEUE_PREFERENCE.md)。

本地歌词优先级的设置、来源选择、导出及后台解析通过 45 项逻辑、33 项 WebKit 和 8 项原生模拟器回归。
原生证据覆盖真实本地文件／解析器和已打包桥；不代表完整 Automix 发声或系统挂起后的验收。
个人 App／服务器未更新，真实平台与真机 NOT_RUN；本地类型检查修正记录见 [LYRIC_PRIORITY.md](LYRIC_PRIORITY.md)。

Automix「表现模式」的原生设置接线通过 40 项逻辑、12 项 WebKit 和 8 项原生模拟器回归。
受控分轨确实经过生产混音队列；本批未重新执行原模型、真实音源或真机验收。
公开分轨能力仍关闭，个人 App／服务器未更新，见 [AUTOMIX_SETTINGS.md](AUTOMIX_SETTINGS.md)。

移动弹窗键盘避让及旋转修复：6 项新增、27 项原有 WebKit 回归通过；6 项原有重复场景按规则跳过。
独立 iPhone／iPad 模拟器实际软键盘检查通过，包括 iPad 分词输入和滚到保存位置。
个人 App／服务器未更新，物理设备、完整键盘矩阵和原生分词保存恢复仍待验收，见 [SHEET_KEYBOARD.md](SHEET_KEYBOARD.md)。

服务器设置已修复「保存失败却清除三平台登录」的问题；原生原子保存并隔离旧请求，
Keychain 迁移失败可恢复，退出后的缓存清理错误也会恢复真实账号状态。82 项逻辑、18 项 WebKit、
19 项原生模拟器测试及构建通过，无新依赖或播放器界面调整。
个人 App／服务器未更新，真实账号升级迁移 NOT_RUN；格式迁移及回滚限制见 [GATEWAY_SETTINGS.md](GATEWAY_SETTINGS.md)。

原版暂停／恢复淡入淡出已接入移动原生输出，复用原控制器，频谱随声音淡出；音量与 Automix 增益独立。
58 项逻辑、9 项 WebKit 和最终 14 项原生模拟器测试通过，构建与资源核对通过。
本批真机、真实音源听感及系统挂起验收 NOT_RUN，个人 App 与服务器未更新，见 [PLAYBACK_FADE.md](PLAYBACK_FADE.md)。

听歌打卡的生产队列接线、后台请求、取消与原版开关通过 286 项逻辑、21 项 WebKit 和 15 项原生模拟器测试；
布局修正后 6 项受影响 WebKit 再次通过。生成 WAV 经真实解码、生产计时器和自然 EOF 切歌向受控 transport 上报。
真实网易云接受记录、系统挂起／真机验收 NOT_RUN；个人 App 与服务器未更新，见 [LISTENING_REPORT.md](LISTENING_REPORT.md)。

原版「每首歌随机歌词动画」的移动接入与配置往返修正已通过 215 项逻辑及 75 项 WebKit 检查。
网络与原生快照为受控数据；本批真实平台／原生容器／真机均 NOT_RUN，个人 App 与服务器未更新。
行为边界与证据见 [RANDOM_VISUALIZER.md](RANDOM_VISUALIZER.md)。

Automix 已补充调用线程存活期间的内存回归，修正前失败，最终 13 项原生回归通过，含三轮原模型联合交接。
推理任务在线程结束后返回，保留原串行调度与算法；真机及完整内存验收仍未完成，
见 [AUTOMIX_THREAD_MEMORY.md](AUTOMIX_THREAD_MEMORY.md)。个人 App 与服务器未更新。

前阶段新增清理后弱引用／分配区诊断，内存增长在包含原拍点模型的独立路径复现。
固定 ORT 的默认遥测已在 Session 创建前关闭；原测试退出后的遥测线程崩溃与数值断言分开记录。
内存稳定、真机及长期运行不据此通过，见 [AUTOMIX_MEMORY.md](AUTOMIX_MEMORY.md)。个人 App 与服务器未更新。

Automix 时钟配对回退已通过实际PCM消费到共享输出时间的映射修复；17项原生回归和三轮连续原模型交接通过。
短回归与完整三轮有独立xcresult，不把普通淡化视作分轨通过。重复轮次内存增长仍需分析，
真实设备、在线Automix和完整稳定性验收未完成；个人mobile.28及服务器未更新，见 [PREPLAY_CLOCK.md](PREPLAY_CLOCK.md)。

开发源码修复 Tilt 生命周期错误与绘光纹理池调用警告；WebKit 使用真实 renderer 和受控播放状态，
本批原生容器／物理设备／性能验收均 NOT_RUN，见 [VISUALIZER_RUNTIME.md](VISUALIZER_RUNTIME.md)。

开发源码已对齐 QQ／网易云搜索点播的原版队列行为，并修复网易云搜索失败被当作空结果的问题。
受控界面／逻辑验证与真实平台、原生容器及物理设备分开记录；个人 App 未更新，
本批验收范围见 [SEARCH_PLAYBACK.md](SEARCH_PLAYBACK.md)。

开发源码新增网易云推荐歌单入口，接通原目录分页、播放队列及收藏，先确认创建者再开放操作。
受控数据已用于验证原推荐流程；真实平台／原生容器／物理设备均 NOT_RUN，
个人 App 与服务器未更新，见 [RECOMMENDED_PLAYLISTS.md](RECOMMENDED_PLAYLISTS.md)。

开发源码新增网易云歌单／专辑收藏与取消收藏，复用原权限、控制器和会话写入锁。
受控响应验证不等于真实收藏成功；本批真实账号读写／原生容器／真机均 NOT_RUN，
服务器与个人 mobile.28 未更新，见 [COLLECTION_SUBSCRIPTIONS.md](COLLECTION_SUBSCRIPTIONS.md)。

当前开发源码新增 QQ／网易云收藏专辑和网易云云盘入口，复用原 Omni、分页资源和曲目身份。
真实账号库／新入口真机尚未验收，服务器与个人 mobile.28 未更新，见 [ACCOUNT_LIBRARY.md](ACCOUNT_LIBRARY.md)。

当前开发源码新增原版网易云私人 FM，复用模式／场景目录与歌曲解析，原生队列负责 WebView 挂起后的连续补曲。
暂停、账号变化、普通播放及手动切歌隔离迟到请求；模式失败保留原队列。无新增依赖。
当前为不依赖真机的开发与验证，服务器、个人 mobile.28 未更新，见 [PERSONAL_FM.md](PERSONAL_FM.md)。

当前开发源码补齐网易云每日／历史推荐、刷新和确认后不喜欢换歌，复用原 Omni、集合资源与控制器。
保留失败时的列表、日期及限额语义，关闭重开不重复提交。无新依赖；本轮不依赖真机，
线上网关与个人 mobile.28 未更新，真实推荐权限／写入尚未验收，见 [DAILY_RECOMMENDATIONS.md](DAILY_RECOMMENDATIONS.md)。

当前开发源码补齐网易云自有歌单的添加／移除入口，复用原 Omni、权限与集合控制器；QQ 沿用原只读能力。
失败不当成成功，支持关闭后的请求收尾和大歌单分页位置改变后的重读；未增加依赖或调整播放器外观。
本轮仅做不依赖真机的代码与受控测试，服务器和个人 mobile.28 未更新，见 [ONLINE_PLAYLIST_EDITS.md](ONLINE_PLAYLIST_EDITS.md)。

当前开发源码已接入在线专辑／歌手触摸浏览，复用原 Omni 与 Library Core；网关增加可选能力及只读路由。
本轮按用户要求仅做不依赖真机的工作，个人 mobile.28 与线上服务器均未更新。
实现范围、自动测试与未执行项见 [ONLINE_CATALOG.md](ONLINE_CATALOG.md)。

Automix 当前独立 QA 已完成原模型准备、真实分轨／扩展混音及队列交接的模拟器验证；
手机联合负载／温升仍未通过，详见 [MEL_PREPARATION.md](MEL_PREPARATION.md) 与 [ANALYSIS_SCHEDULING.md](ANALYSIS_SCHEDULING.md)。
下文保留分阶段历史记录；其中早期“尚未接入模型／用户队列”的描述不代表当前 QA 源码状态，
也不表示个人安装包已获得完整 Automix。

后续开发源码已接入 AI／封面主题生成：92 项相关逻辑、48 项 WebKit、10 项独立 iPad 原生 XCTest 通过。
独立 iPad QA 配置／主题保存和重启恢复及准确源码 CI 已通过；横屏滚动仍 UNVERIFIED。
尚未调用真实 AI 服务或更新个人 App，见 [AI_THEMES.md](AI_THEMES.md)。

当前个人候选为 mobile.28，已原位安装、启动并回读；签名、源码／资源与准确源码 CI 已核验，详见 [VALIDATION.md](VALIDATION.md)。
文件夹导入／管理已随该版本加入；后续全目录重扫仅完成独立 QA 验证，详见 [LOCAL_FOLDER_RESCAN.md](LOCAL_FOLDER_RESCAN.md)。
本版真实本地曲库及手机在线复测仍 NOT_RUN，历史反馈不自动算作新版本验收。

后续 Theme Park 自定义主题编辑已在独立 QA 验证，个人 mobile.28 未更新：
14 项逻辑、15 项移动 WebKit、1 项桌面组件与 iPad 模拟器触摸／旋转／保存／重启恢复通过，
真实设备新入口及自动 AI 生成功能未验收，见 [THEME_PARK.md](THEME_PARK.md)。

歌曲主题保存／恢复和自动／手动切换随后在独立 QA 通过，个人包仍未更新：
29 项缓存与偏好逻辑、21 项歌曲主题 WebKit、4 项设置回归及 iPad 模拟器双歌曲编辑、
切换和重启恢复，见 [SONG_THEMES.md](SONG_THEMES.md)。不包含自动 AI 请求或真实平台主题验收。

mobile.26 接入 M3U 导入／系统分享，28 项逻辑、33 项独立 WebKit、3 项原生模拟器测试通过；
最终 iPad 模拟器已实际完成系统分享存储、文件选择、导入及终止重启恢复。使用合成音频和旧本机 ID 引用，
不代表跨设备文件或手机新功能验收，见 [LOCAL_PLAYLIST_FILES.md](LOCAL_PLAYLIST_FILES.md)。

后续源码补齐本地歌单／收藏，94 项逻辑、72 项 WebKit、3 项原生模拟器测试通过；
新功能真机仍 NOT_RUN，范围与存储保护见 [LOCAL_PLAYLISTS.md](LOCAL_PLAYLISTS.md)。

后续开发源码补齐本地专辑／歌手浏览，17 项逻辑、78 项 WebKit 回归及 15 项导入专项通过（部分重复），
新入口真机验收仍为 NOT_RUN；范围与切歌取消修复见 [LOCAL_BROWSING.md](LOCAL_BROWSING.md)。

后续开发源码补齐原版字体与字幕控件，修复上传字体在 WebKit 的持久化和取消竞态；
64 项逻辑、12 项新功能 WebKit 与 12 项回归通过，iPad 模拟器系统文件导入／重启恢复已操作验证。
这些设置已随 mobile.22 原位安装个人 iPhone；用户反馈心象字号滑块拖不动（FAIL_USER_REPORTED），
没有字体文件，真机字体导入保持 NOT_RUN。后续触摸修复通过干净 iPad 容器拖动／重启恢复及 18 项 WebKit 回归，
详见 [TYPOGRAPHY.md](TYPOGRAPHY.md)。

开发源码音质设置已通过 123 项逻辑／provider、9 项 WebKit、11 项 iPhone QA 自动测试；
保留当前播放、暂停、本地预加载、缓存及正在交叉淡化的曲目，详见 [AUDIO_QUALITY.md](AUDIO_QUALITY.md)。
真实 QQ／网易云各档返回音质与权限回退仍为 NOT_RUN；本版基础播放用户反馈另列如下。

开发源码的个人歌单分页已通过受控第 101 个歌单、失败重试、搜索并发及平台切换测试，
共 114 项逻辑／provider 与 12 项 WebKit；真实账户歌单完整性仍为 NOT_RUN。
没有把受控数据当作上游验收，详见 [CATALOG_PAGING.md](CATALOG_PAGING.md)。

后续睡眠定时开发源码已通过独立 iPhone QA 自动测试，现已汇入 mobile.21；
实际解码输出暂停、期限／恢复竞态覆盖见 [SLEEP_TIMER.md](SLEEP_TIMER.md)。
mobile.21 的 1 分钟锁屏定时暂停及手动继续获用户确认；未区分具体音源，
逐平台定时矩阵、其他时长和物理 iPad 保持 NOT_RUN。

此前 mobile.26 的安装证据：2026-10-12 已原位更新、启动并回读构建号。
准确源码 `4b6d81ad6e7dc575c36cbe19ccdeee73c6e77233` 的 CI、签名、资源和 IPA 核验通过；
iPad 模拟器系统 M3U 分享／选择及重启恢复证据见 VALIDATION.md，mobile.25 安装包保留。
本版手机登录／在线播放没有复测，本地新功能真机 NOT_RUN；物理 iPad 和长期验收未覆盖。

此前 mobile.25 的证据：
准确源码 `12f83db4f9ead5fa7c9d5c5888f7073d8092f1ec` 的 CI、签名、资源和 IPA 核验通过，已原位安装；
iPad 模拟器完成歌单新建、添加／收藏、终止重启恢复及歌单范围播放，横竖屏检查见 VALIDATION.md。
当时手机登录／在线播放没有复测，本地新功能真机 NOT_RUN；物理 iPad 和长期验收未覆盖。

此前 mobile.24 的证据：
准确源码、签名、资源与 IPA、CI 通过；最终 iPad 模拟器已实际操作本地分类、搜索、播放及队列范围。
用户反馈「在线播放正常，暂无本地歌曲可测」：仅在线播放记为 PASS_USER_CONFIRMED；
没有单独确认登录状态，本地分类真机操作保持 NOT_RUN，不将此前候选证据自动升级。

此前 mobile.23 的证据：
准确源码、签名、资源和 IPA 校验、CI 均通过；mobile.22 字号拖动的修复已通过干净模拟器交互，
mobile.23 用户已确认心象字号能拖动且歌词大小随之变化（PASS_USER_CONFIRMED）。其他新设置与在线播放未复测。

以下为此前 mobile.21 的证据：
本版汇集睡眠定时、歌单分页及音质设置；签名、源码／资源／IPA 核验、准确源码 CI 均通过。
iPad 模拟器已实际操作定时编辑／开关、音质选择及重启恢复；该证据不包含真实平台或完整计时验收。
用户已确认本版 QQ／网易云登录保留，声音、歌词、拖动、切歌正常；
1 分钟锁屏定时到期暂停及手动继续正常。mobile.20 的用户通过记录保留为历史证据。
mobile.17已按用户要求改为全屏画布；mobile.18加入磨砂和空白轻点隐藏／唤回，mobile.19进一步半透明并修正背景跟随。
用户对mobile.19回复“先这样吧”，当前外观按此保留；不视为完整旋转、材质及性能矩阵通过。
mobile.20汇集多标签歌词、独立翻译与FLAC／SYLT适配，格式专项和签名／资源／IPA验证见VALIDATION.md；
用户已确认升级后“两平台登录保留，播放正常”；新格式界面操作仍待验收。
独立Automix候选1.30.0已解除旧DFT阻塞，完成Mac及iPhone原模型单样本推理；完整功能尚未加入App，见VALIDATION.md。
mobile.13 用户确认两平台登录保留、播放正常、导出可用；在线歌曲导入 `.fia`／`.lrc` 时文件被置灰，
mobile.14 已修复且用户确认两种文件可选择、导入显示正常。mobile.15 批量 ZIP 用户提供清单并确认回导显示正常，
分别记为 PASS_USER_CONFIRMED；文件字节与每首歌词未独立检查。
以下真实平台基础操作反馈来自 mobile.12，不自动升级为后续候选的复测结果。
按用户最新要求，先保持原播放器和动效，支持本地导入与网易云／QQ；
本地使用不以域名、HTTPS 或同步服务为前提。服务端已执行项见 SERVER_VALIDATION.md。
2026-10-11 已接通 `https://music.nb686.cn`，证书校验与网关认证通过，用户已确认 mobile.12 的真实 QQ 登录成功。
用户反馈可见账号或歌单，且声音、歌词、拖动和切歌正常；随后反馈已完成所要求的锁屏持续播放与自动跨曲。
锁屏项目按用户反馈记为 PASS，未独立计时或采集切歌事件，不代表完整后台矩阵通过。
网易云登录、歌单和基础播放操作、QQ／网易云手动切换及锁屏／控制中心操作也已获用户确认。
用户明确「没有长时间测试」网易云，该平台 30 分钟锁屏保持 NOT_RUN。
历史服务账户测试仍不等于本次 App 登录或播放验收。
下表逐项区分用户真机反馈、自动测试和待执行项目。测试日期、构建指纹、镜像 digest、设备型号／系统版本必须随结果记录。
账号、Cookie、访问令牌、签名音频 URL 不进入证据文件。

2026-10-10后续源码已接入获批的AudioStreaming 1.4.5与Ogg／Vorbis 0.1.2，
使用当前／下一项独立解码器保持原队列删除语义；固定源码适配限制在 AudioPlayer 和 Package 两个文件。
完整Release原生回归89项通过；WAV、AAC/M4A Mono→双声道及原音效有实际PCM证据。
mobile.7已安装启动，iPhone XS Max / iOS18.7.10关键原生测试6项通过；结果见BUILD_RECORD.json和VALIDATION.md，
不代表真机30分钟锁屏、听感或歌词延迟验收。
详见[AUDIO_OUTPUT_DECISION.md](AUDIO_OUTPUT_DECISION.md)。

后续 mobile.9 已安装启动并回读 build 9；原 Crossfade 设置、本地完整／在线前缀分析已随包接入。
130 项模拟器原生回归和 12 项真机专项通过，包含受控 HTTP 响应下的实际流式解码、分析、过渡与双声道输出。
这些新证据仍不包含真实平台 App 在线链路、完整媒体缓存、完整 Automix 或长时间物理设备验收。
历史服务与 UI 项不因本轮源码测试自动升级为当前版本的完整验收。

mobile.10 已安装并启动，设备回读 build 10。已接入原版音频缓存：默认关闭，原容量设置，完整缓存离线播放与分析，
退出／清理取消和当前文件引用隔离。142 项原生回归与 13 项真机专项通过，仍属于受控数据证据。
后续开发源码已补齐共用封面缓存和完整在线歌词持久存储，见 COVERS.md、LYRIC_CACHE.md；
随后 mobile.11 汇集上述缓存、ReplayGain 和在线歌词操作入口，已安装启动并回读 build 11。
本轮 136 项逻辑、15 项界面和 15 项 iPhone 原生专项 PASS，详见 LYRIC_TOOLS.md、VALIDATION.md。
真实平台 App 链路和长期真机项目仍须单独验收，没有把源码测试视为完成这些项目。

mobile.11 之后的开发源码已接入原单曲／全局歌词校准，131 项逻辑和 27 项 WebKit 回归通过，
iPad 模拟器实际容器确认应用偏移后重启恢复；见 LYRIC_TIMING.md。
上述开发功能随后汇入 mobile.12，已原位更新个人 iPhone 并启动、回读 build 12。
本轮 142 项移动逻辑、17 项独立 QA 真机原生专项通过；未测真机声画误差。
下表分别记录源码自动测试、原生专项和实际操作的范围，安装不会自动补足未跑的验收。

## 本地播放器与原有动效

| 检查 | 结果 | 证据边界 |
|---|---|---|
| QQ 真实账户登录、播放、歌词、拖动与切歌 | PASS（用户真机反馈） | mobile.12／iPhone XS Max／iOS18.7.10；连接 music.nb686.cn 后用户确认。歌单完整性和精确同步误差仍未确认；见 SERVER_VALIDATION.md |
| QQ 锁屏持续播放与自动跨曲 | PASS（用户真机反馈） | 请求至少 30 分钟、自动跨过至少三首，用户反馈「已完成，锁屏持续播放并自动跨曲」；未独立计时或采集曲目事件。不替代 WebView 显式挂起、URL 失效恢复、耳机／蓝牙或 iPad 验收 |
| 网易云真实登录、歌单、声音、歌词、拖动和切歌 | PASS（用户真机反馈） | mobile.12；用户确认这些操作正常，未验证歌单完整性和精确歌词误差 |
| 网易云 30 分钟锁屏与自动跨曲 | NOT_RUN | 用户明确反馈「应该没什么问题 没有长时间测试」，不以推测判定通过 |
| QQ／网易云同一队列手动切换 | PASS（用户真机反馈） | 用户确认来回切换正常，声音、歌名和歌词对应；不等于后台自动跨平台切换 |
| mobile.20 原位升级后登录与播放 | PASS_USER_CONFIRMED | 用户反馈“两平台登录保留，播放正常”；不自动复核历史锁屏、全部交互及新内嵌格式 |
| mobile.21 原位升级后登录与播放 | PASS_USER_CONFIRMED | 用户确认 QQ／网易云登录保留，声音、歌词、拖动与切歌正常；不扩展为各档音质或长期播放验收 |
| 原版睡眠定时 | PASS_USER_CONFIRMED（1 分钟锁屏暂停／手动继续）；另有自动测试 | 用户回复“到期暂停，手动继续正常”，未区分具体音源或独立测量时间；逐平台、其他时长、物理 iPad 待测。7 项逻辑、6 项 WebKit、10 项 iPhone 自动测试见 SLEEP_TIMER.md |
| 在线个人歌单分页 | PASS（受控逻辑与 WebKit）；真实大歌单账户 NOT_RUN | 114 项逻辑／provider、12 项 WebKit；超过 100 个歌单的加载、重试与并发隔离；已随 mobile.21 安装，见 CATALOG_PAGING.md |
| 原版四档音质偏好 | PASS（逻辑、WebKit、iPhone QA 及 iPad 设置恢复）；实际音质／权限回退 NOT_RUN | 123 项逻辑／provider、9 项 WebKit、11 项 iPhone 自动测试；当前播放与缓存优先语义保持，已随 mobile.21 安装，见 AUDIO_QUALITY.md |
| 锁屏／控制中心控制及前台同步 | PASS（用户真机反馈） | 暂停、继续、上一首、下一首、拖动和回 App 状态同步；未区分锁屏与控制中心具体使用面，不包括物理耳机或蓝牙 |
| 不配置服务器进入曲库 | PASS | 浏览器样本及 iPad 模拟器实际启动 |
| 系统文件选择器多选音频并导入 | PASS | iPad Pro 11-inch (M5) / iPadOS 26.5 Simulator，4 个明确标注的合成 WAV |
| 本地原生播放与自动跨曲 | PASS | iPad 模拟器实际界面观察；另有独立原生四曲队列测试，无 WebView／网关 |
| 文件夹系统导入、浏览及单目录管理 | PASS（逻辑、WebKit、两端原生 QA 及模拟器系统选择器）；真实曲库 NOT_RUN | 已随 mobile.28 安装；原生每端 57 项、真实系统选择器导入生成样本，见 LOCAL_FOLDER_FLOW.md |
| 全部根目录顺序重扫 | PASS（23 项相关逻辑、18 项 WebKit、独立 iPad QA）；个人包尚未接入 | 实际两个目录更新歌词／新增歌曲、重启再重扫与稳定身份通过；失败／取消在受控测试覆盖，见 LOCAL_FOLDER_RESCAN.md |
| 本地专辑／艺术家浏览与组内搜索播放 | PASS（逻辑、WebKit、最终 iPad 模拟器容器）；真机 NOT_RUN | mobile.24 复用原分组／排序，保留原生歌曲身份；实时元数据变化、长名称及虚拟列表已测，见 LOCAL_BROWSING.md。稳定实体编辑与本地歌单不在本批交付内 |
| LRC 导入与原歌词渲染 | PASS | 系统选择器实际导入，Classic 歌词与动效展示、Partita 播放态展示 |
| iPhone／iPad 横竖屏切换 | PASS（mobile.17／18 界面回归及部分实际模拟器）；完整真机矩阵 NOT_RUN | mobile.16分栏已被用户反馈替换，当前为全屏画布及悬浮控制。mobile.17用户反馈“看着还可以”，mobile.19外观暂定保留；不等于逐项旋转和物理iPad、键盘／多任务验收，见 FULLSCREEN_LAYOUT.md |
| 14 模式、背景、参数与外观短码 | PASS（接入） | 复用原注册表和组件；UI fixture 检查选择、挂载及短码回读，不等于所有动画效果和性能已逐项验收 |
| Partita 移动端长词正文适配 | PASS（开发源码 WebKit）；原生容器及真机视觉复核 NOT_RUN | 原约 240px 溢出已复现并修正；12 项三视口、旋转、多词、Unicode 与原尺寸专项通过。保留原动画参数，见 PARTITA_FIT.md |
| 原生音频频谱 | PASS（本地 PCM） | WebKit频谱参考、440Hz实际解码信号、静音恢复和停止读取后的停止分析；未覆盖每种在线流编码 |
| 实际 iPhone 本地播放、锁屏、耳机／蓝牙 | PASS（原生短测）；长期／耳机／蓝牙 NOT_RUN | 6项真机测试覆盖实际Mono PCM音效、四曲自动推进、拖动、模拟中断恢复等；未测30分钟锁屏或真实硬件中断 |
| 队列触摸编辑与原版播放导航 | PASS（自动测试及iPad模拟器） | 29项原生、34项逻辑、15项UI；编辑保留当前项／进度，原生拒绝过期索引；实际容器重启、拖动恢复与播放通过 |
| 音量／静音／十段EQ | PASS（自动测试及iPad模拟器）；真机听感 NOT_RUN | WebKit参考输出15组；原生解码PCM及停止FFT后处理、持久化、声道隔离、顺序提交与失败恢复；实际触摸−8dB后重启恢复 |
| 原版混响等附加音效与音色预设 | PASS（Mono／立体声自动测试及iPad设置接入）；真机听感 NOT_RUN | 新输出链89项完整原生回归；实际PCM、最终静音、删除预载等通过；暂停资源释放、全格式及真机性能仍待验收；见AUDIO_OUTPUT_DECISION.md |
| 原版音频缓存 | PASS（原生逻辑、实际解码及 UI）；真实平台长期验证 NOT_RUN | 5GB／无限、LRU、自然 EOF／手动跳过、离线重播、清理后拖动、完整分析与 Crossfade；见 MEDIA_CACHE.md |
| 共用封面／锁屏封面缓存 | PASS（源码自动测试及真机专项）；真实平台矩阵 NOT_RUN | 前台和锁屏共用、请求取消、独立分类清理；见 COVERS.md |
| 完整在线歌词与来源选择持久存储 | PASS（源码自动测试及真机专项）；真实平台 App 验收 NOT_RUN | 原解析与选择复用、断网恢复、无 WebView 的原生队列读取、清除及退出隔离；见 LYRIC_CACHE.md |
| 在线歌词导入、匹配与来源切换 | FIA／LRC 导入 PASS_USER_CONFIRMED（mobile.14）；其他操作保留原自动测试边界 | 用户确认两种文件都可选择、导入并正常显示；不扩展为真实在线匹配或精确时序验收，见 LYRIC_TOOLS.md、VALIDATION.md |
| 单曲／全局歌词时间校准 | PASS（WebKit 及 iPad 模拟器设置恢复）；真机校准 NOT_RUN | 原控件、预览／应用／取消、来源隔离、歌词点击反向映射、迟到加载；已随 mobile.12 安装，见 LYRIC_TIMING.md |
| 原歌词过滤、制作人员策略与时间线 | PASS（开发源码自动测试及 iPad 模拟器短测）；真机及真实平台 NOT_RUN | 186 项逻辑、39 项移动 WebKit、9 项桌面组件；实际容器预览／保存／重启恢复与原生 10 秒跳转，原始正文及音频不变。已随 mobile.13 安装，见 LYRIC_DISPLAY.md |
| 原精细分词编辑与布局接线 | PASS（开发源码回归及编译）；原生交互 NOT_RUN | 复用原编辑器／存储／分词，补移动输入、复制、失败重试和迟到隔离；Partita 保留逐字 timing。已随 mobile.13 安装，见 LYRIC_SEGMENTATION.md |
| App 内 AI 精细分词 | PASS（逻辑／WebKit／桌面组件／签名 QA 构建）；真实 AI／真机 NOT_RUN | 原提示词与批处理、原生凭据、取消及存储回滚；136 项逻辑、73 项移动及6 项桌面回归。iPad 模拟器实测入口、设置导航、缺少密钥及竖／横屏可见性；源码 CI 与125 个资源一致性已核验，个人 App 未更新，见 AI_SEGMENTATION.md |
| 原单曲 `.fia`／LRC 导出 | PASS（用户真机反馈及自动验证）；回导 PASS_USER_CONFIRMED（mobile.14） | mobile.13 导出反馈与 mobile.14 选择器／回导反馈分开记录；未逐文件校验，见 LYRIC_EXPORT.md |
| 原版批量歌词 ZIP 导出 | PASS_USER_CONFIRMED（mobile.15）；43 项逻辑、12 项 WebKit、10 项 iPhone 原生 PASS | 清单18首导出、2首跳过、9首旧缓存身份缺失警示；用户确认回导显示正常，未独立检查 ZIP 字节及每首内容，见 BATCH_LYRIC_EXPORT.md |
| 本地 GBK／加密 KRC 文件导入 | PASS（自动测试、iPad 模拟器实际选择器／重启及 iPhone 原生专项）；iPhone 选择器手工验收 NOT_RUN | 原解码、失败保留、编辑令牌与原子保存；历史 UI／原生及本轮 17 项中的对应测试见 VALIDATION.md。Partita 裁切已在 WebKit 修正，原生视觉待验；见 LOCAL_LYRIC_IMPORT.md |
| 本地导入／内嵌歌词来源切换 | PASS（自动测试、iPad 模拟器短测及 iPhone 原生专项）；真机界面操作 NOT_RUN | 独立正文、标签迁移、来源恢复、失败保留；历史基线与后续专项分别记录。多标签和独立翻译已随mobile.20安装，见 LOCAL_LYRIC_SOURCES.md、EMBEDDED_METADATA.md |
| FLAC／SYLT 内嵌歌词和独立翻译 | PASS（源码逻辑、实际文件原生专项）；真机选择器／显示 NOT_RUN | 43项逻辑、iOS26.5修正前41项原生、iOS18.7.10修正后10项专项；同一10个实际音频样本与桌面结果对照，系统无Vorbis标签仍读取文件。已随mobile.20安装；不代表Ogg导入或全部编码，见 EMBEDDED_FORMATS.md |
| 本地歌曲完整匹配与元数据／封面选择 | PASS（自动测试及 iPhone 原生专项）；真实平台 NOT_RUN | 原完整弹窗与共享规则；iPhone 测试覆盖实际播放期间保存、并发／删除／过期拒绝和后台歌词。HTTPS 阻塞已解除，但尚未执行真实在线候选保存；iPad 历史短测仅覆盖导入与「不使用在线数据」，见 LOCAL_MATCH.md |
| 完整 Automix | IN_PROGRESS；尚未接入用户队列 | 官方Apple1.30.0已解除DFT阻塞；真实人声30秒片段iPhone数值通过，退出点同为23.65秒、PCM最大差1单位；耗时41.4秒／峰值1.08GiB。原近静音样本相对误差FAIL保留。原手势桥接93项逻辑／7项原生通过，见STEM_GESTURE.md；四轨PCM总线90项逻辑／6项原生通过，最大误差9.536743e-7，见STEM_MIX.md；共同音频时钟24项原生通过，见[STEM_CLOCK.md](STEM_CLOCK.md)；后续16位缓存／媒体对齐90项逻辑／35项原生通过，见[STEM_STORAGE.md](STEM_STORAGE.md)；原表演重触发／倒放99项逻辑／43项原生通过，12个渲染声道摘要相同，见[EXPANSION.md](EXPANSION.md)；PCM测量到计划138项逻辑／46项原生通过，见[STEM_ANALYSIS.md](STEM_ANALYSIS.md)。模型／用户队列接入、实际听感、播放争用及长期性能待测；未改模型／个人App依赖，见AUTOMIX_MUSIC.md |
| 完整媒体到原版分轨素材 | PASS（51 项原生模拟器测试）；模型／用户队列／真机 NOT_RUN | 本地与完整缓存快照摘要、首尾 30 秒、单／双／四声道及连续重采样；15,894,152 个生成 WAV 采样逐值一致。保留首轮崩溃与修复证据，压缩编码／WebKit 解码对照待测，见 [STEM_MEDIA.md](STEM_MEDIA.md) |
| 分轨素材压缩解码对齐 | PASS（原WebKit／53项原生模拟器回归）；真实音乐／真机 NOT_RUN | 修复48 kHz的分步解码／重采样尾部差异，AAC／ALAC／FLAC生成样本16个完整声道摘要相同；保留51/1初次失败，中途取消及恢复通过。MP3等矩阵待测，见 [STEM_CODEC.md](STEM_CODEC.md) |
| 原 Theme Park 全局自定义编辑 | PASS（自动检查及独立 iPad 模拟器 QA）；个人 App NOT_RUN | 原配色／信息／内容／手动 JSON、触摸预览、失败重试及保存恢复；见 THEME_PARK.md |
| 原版歌曲主题缓存与自动／手动切换 | PASS（自动检查及独立 iPad 模拟器 QA）；个人 App NOT_RUN | 复用原缓存和偏好，事务保存、迟到隔离、错误重试、外观开关导入导出；见 SONG_THEMES.md |
| AI／封面主题生成 | PASS（逻辑／WebKit／原生 fixture）；真实服务和个人 App NOT_RUN | 原版提示词／解析／取色、Keychain 配置、取消和自动偏好已接入，见 AI_THEMES.md |
| 主题生成区域纵向触摸滚动 | PASS（12 项 WebKit 回归及最终 iPad QA）；真机 NOT_RUN | `ffdd06a` 局部 CSS；原失败路径、横竖屏、进度拖动和控制器点按通过。其他区域和键盘矩阵未扩展验收，见 SHEET_TOUCH.md |
| 原版可选同步服务 | PASS（逻辑／WebKit／原生 fixture／独立 iPad 页面短测）；真实服务／真机 NOT_RUN | 启动／手动主题、视觉设置、ZIP 及保存单曲后上传已接入；57 项逻辑、18 项同步 UI 及48 项主题／AI回归；原生关闭配置保存／重启恢复、旋转与空白区滚动通过。软件键盘及多任务矩阵未验收，见 SYNC.md |
| 其余桌面工具 | NOT_IMPLEMENTED | 仍待移植，完整移植目标未完成 |
| 在线歌曲收藏状态与原版写入能力 | PASS（逻辑／受控 WebKit）；部署／真实平台／真机 NOT_RUN | 网易云收藏写入与 QQ 只读状态、旧网关能力降级、错误回读与会话隔离；202 项相关逻辑及51 项 WebKit 通过。个人 App 和网关未更新，见 ONLINE_LIKES.md |

音频格式由AudioStreaming、系统AudioToolbox及获批的Ogg／Vorbis决定；Ogg目前不支持拖动。
实际支持情况需按设备和编码测试，不能仅凭文件扩展名判定。
不支持或无权限的音频明确失败，没有模拟歌曲或虚假频谱兜底。

## 三平台服务基线

| 平台 | 扫码／退出 | 搜索 | 个人歌单／曲目 | 歌词 | 标准音质地址 |
|---|---|---|---|---|---|
| 网易云 | 扫码 PASS；退出旧 Cookie 撤销未通过 | PASS | PASS | PASS | PASS（含 CDN Range） |
| QQ | PASS | PASS | PASS | PASS | PASS（含 CDN Range） |
| 酷狗 | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |

上表为 2026-10-10 的内部服务测试，不能代替当前 App 验收；酷狗按用户最新范围延后。
2026-10-11 已接通 HTTPS，用户已确认 QQ 在 mobile.12 内登录和基础播放成功；
网易云基础 App 流程也已获用户确认；两平台完整矩阵仍未验收。当前网关连接规则要求可信 HTTPS；
网关可运行于 Mac、NAS 或服务器，与可选的配置同步服务不同，本地播放器不需要它。
平台自身失败单独记录 HTTP/业务错误码、时间、
账号权限条件和脱敏说明；不能用 fixture 或另一平台的音乐把失败项改成 PASS。

## 每台真机各做一次

设备必须为 iOS/iPadOS 17+，签名安装后记录：

- 每平台锁屏持续至少 30 分钟，自动跨过至少三首；记录曲目身份、切歌与锁屏时间。
- 再用跨平台队列完成自动切换；包括每平台一首无播放权限歌曲、过期会话以及网络错误。
- 明确暂停 WebView 的 JavaScript 执行，保留原生进程运行：下一首仍可独立解析并播放；
  用受控服务先返回过期 URL 再返回有效 URL，验证只刷新一次。
- 连续失败三首停止；认证错误立即停止并提示登录；限流不触发无限跳歌。
- 锁屏／控制中心／耳机上一首、下一首、播放、暂停、拖动；来电中断及恢复、蓝牙断开暂停。
- Wi-Fi ↔ 蜂窝、断网和恢复、快速连点切歌；旧地址结果不得覆盖新意图。
- 退出一个平台：相关请求取消、Keychain 会话删除、账户缓存清空，其他平台会话保留。
- 杀掉并重新启动 App：恢复身份队列但不自动响起；首次解锁后再锁屏仍可读取播放所需会话。
- 手机横竖屏、iPad 全屏／分屏／窄窗口、键盘与安全区、触摸操作、分享 QR 再回前台。
- 首次打开、服务器错误、证书错误、QR 过期、用户取消、QQ 登录渠道、同平台重复启动登录。

iPhone 开发签名与安装、原生短测及 QQ 基础操作已通过（iOS18.7.10），各自证据范围见上表。
QQ 30 分钟锁屏项目为 PASS（用户真机反馈）；用户确认已完成要求，未独立核实开始时间、持续时长和跨曲数量，
不能按提问后经过的时间推算实测时长。真实耳机／蓝牙、其余交互和性能验收仍为 NOT_RUN；
iPad 实体设备尚未连接，模拟器验证见上表。

## 歌词、性能与可靠性

- 固定可合法使用的测试音频与对应时间标记歌词，以同一时间基准测量视觉高亮；
  暂停、拖动、切歌、回前台后，校准显示误差目标 ≤150ms。记录最大误差与测量方法。
- 前台连续使用至少 30 分钟，记录卡顿、热状态／温升、内存趋势；后台应停止视觉渲染。
- Instruments／真机日志只记录状态与匿名标识，不抓取真实认证请求正文。
- Docker 重启恢复、QQ 持久卷文件保持、旧镜像归档校验与恢复：PASS，详见 SERVER_VALIDATION.md。
- QQ 真实账户会话跨重启、证书更新、实际运行版本回滚：NOT_RUN。

本节歌词误差、性能与可靠性检查除明确标注 PASS 的项目外，均为 NOT_RUN。模拟器的短音频自动换曲测试不能替代
30 分钟锁屏测试或歌词误差测量。
# AMLL 后续开发验证

原版 AMLL 匹配已开放；54项逻辑、24项WebKit界面和1项真实公开API测试通过，
测试修正与证据边界见 [AMLL_MATCH.md](AMLL_MATCH.md)。个人App未更新，新入口真机 **NOT_RUN**。

## ORT 工程接入后续验证

固定ORT1.30.0已按批准范围接入实际Folia独立QA；8项原生模拟器通过，最后取消处理调整后重跑其中4项通过，
均0跳过。原拍点／单段分轨输出逐字节一致，运行中取消与后续恢复通过。完整窗口和用户队列尚未接入，
本次真机联合播放／动画／性能仍 **NOT_RUN**，见 [ORT_INTEGRATION.md](ORT_INTEGRATION.md)。
