<!-- PORT_STATUS.md — current source entry points and evidence boundaries, not release acceptance. -->
# 移植功能核对索引

当前按 [CURRENT_SCOPE.md](CURRENT_SCOPE.md) 执行：完成启动续播后，依次收敛 QQ／网易云核心功能、
特效动画、设置 UI。本地音乐及其他功能暂缓；下表中本地、Navidrome、同步、AI、完整 Automix 的记录仅作历史索引。

2026-10-13。本表用于把现有源码、分批测试记录与个人安装包分开查看；不是原版所有功能已经等价的声明。
个人 App 仍为 mobile.28。本轮仅核对源码和执行受控自动测试，没有连接物理设备或部署服务器。
完整移植与完整 Automix 的最终验收仍未完成。下表的“已接入”只表示代码存在并装配，不代表真机通过。

2026-10-14 [播放恢复原生补验](NATIVE_PLAYBACK_RECOVERY.md)：同一唯一XCTest在iPhone／iPad模拟器各PASS，
两平台受控身份下共20个最终恢复检查点，实际PCM、跨入口重试、迟到错误不闪现及真实页面重载恢复通过。
128个资源一致；本批只补QA，没有生产变更。真实账号／真机／系统挂起／长播及长期性能NOT_RUN，
个人mobile.28和服务器未更新，不重复累计初版与加强断言后的执行次数。

2026-10-14 [回前台状态恢复](PLAYBACK_STATE_RECOVERY.md)：修复迟到读取失败覆盖新播放状态或原生认证错误，
淘汰旧前台请求并保留原生版本过滤；当前失败仍提示，成功恢复后清除。132项WebKit、类型检查和移动构建PASS。
本批仅改状态同步hook，原生容器／真实账号／物理设备NOT_RUN，个人App和服务器未更新。

2026-10-14 [迷你播放器反馈恢复](MINI_PLAYER_FEEDBACK.md)：音乐库底部与展开播放器共享现有命令反馈，
成功重试清除旧提示，跨入口迟到失败不覆盖新操作，原生错误仍保留优先级。
108项WebKit、类型检查与移动资源构建PASS；原生／真实账号／物理设备本批NOT_RUN。
未改变原版动效、布局或依赖，个人mobile.28和服务器未更新。

2026-10-14 [浮层截图对照](NATIVE_OVERLAY_COMPOSITION.md)：同一原生QA用例在iPhone／iPad各1次PASS，
共16组状态／网页快照／整屏截图。稳定状态未复现空白卡片；iPad两种截图的磨砂呈现不同，
旧空白根因未确认。Cappella与手机Monet装饰在隐藏控制器后可见，保留原全屏布局；
本批仅改QA，真实账号／真机与完整视觉验收未完成，个人App及服务器未更新。

2026-10-14 [剩余10模式原生补验](NATIVE_VISUALIZER_LIFECYCLE.md#剩余10模式补验2026-10-14)：新增同一用例在手机／平板
各1次PASS，每台80阶段真实PCM、歌曲／模式与设置恢复通过；两批现覆盖14模式的短时挂载恢复。
截图控制栏重叠和WKSnapshot空白卡片待独立对照，不能据自动测试标为视觉整体验收通过。
长期性能、真实账号／物理设备仍NOT_RUN；生产代码、依赖、个人App和服务器均未改。

2026-10-14 [原生动效与播放补验](NATIVE_VISUALIZER_LIFECYCLE.md)：同一独立QA用例在iPhone／iPad均通过，
覆盖两平台受控身份与Classic／Diorama／Lumiere／Sonnet，共64个阶段、真实双声道PCM及原设置恢复。
App／WebContent／GPU短时进程采样完成；不是14模式全覆盖、长期性能或真实平台验收，生产代码与个人App未变。

2026-10-14 [动效反复挂载检查](VISUALIZER_LIFECYCLE.md)：新增测试，生产代码未改。
手机 WebKit 8通过／3失败／31未运行，失败受探针保留 GL 引用干扰；最终弱引用探针类型检查通过、矩阵 NOT_RUN。
本轮已用完一次重试，不标为动效完整通过；6项采样逻辑通过，个人 App／服务器未更新。

2026-10-14 [播放器反馈恢复](PLAYER_FEEDBACK.md)：复用原命令桥，修复成功重试后错误与控制器阻塞残留，
隔离迟到命令失败；平台登录、服务认证、网络等错误改为恢复提示。84项 WebKit、16项逻辑与类型检查 PASS。
原生／真实账号／物理设备本批 NOT_RUN；未新增依赖、修改原动效或更新个人 App／服务器。

2026-10-14 [连接恢复原生补验](NATIVE_CONNECTION_RECOVERY.md)：独立 iPad QA 两平台共2项 PASS，
完整 React 页面经真实桥接／Keychain／URLSession 恢复账号与歌单，使用受控响应。iPhone 的两次测试工具
失败保留，最终截图修正版在 iPhone NOT_RUN；本批无音频或真实账号验证，个人 App／服务器未更新。

2026-10-14 [启动连接恢复](CONNECTION_RECOVERY.md)：补齐首次服务检查失败后的重试与前台／online 恢复，
沿用原生检查、Omni 账号读取及现有界面，检查期间不重复发送。63 项 WebKit、74 项逻辑、类型检查 PASS；
真实网络／账号、原生容器、物理设备仍 NOT_RUN，个人 App 和服务器未更新。

原版可选启动续播已接入：默认关闭，原生恢复一次，用户／系统取消优先。
763 项移动逻辑、171 个唯一 WebKit 场景（含两平台核心回归）、41 项原生模拟器测试通过。
真实平台冷启动与真机 NOT_RUN；见 [LAUNCH_PLAYBACK.md](LAUNCH_PLAYBACK.md)。

2026-10-14 设置 UI 增量：常用入口分组，设置／歌词动效／播放工具标题保持可见，子页返回保留滚动，键盘按内容区避让。
152 个唯一 WebKit 用例 PASS、7 项有条件跳过；包含原 14 个 renderer 与控制器、设置回归，见 [SETTINGS_LAYOUT.md](SETTINGS_LAYOUT.md)。
本批没有重跑原生模拟器或真实账号，也没有更新个人 App；真机观感和长期动画性能仍待验收。

本轮动效增量见 [VISUALIZER_ROTATION.md](VISUALIZER_ROTATION.md)：修复 Tilt 暂停旋转后的旧宽度排版，
以及 Tempera 尺寸改变时复用已销毁的 Pixi 滤镜纹理。51 项 WebKit（48 项原模式旋转／模拟前后台及 3 项最小复现）
和 1014 项视觉逻辑通过，
1 项可选测量跳过，类型检查与移动资源构建通过。未改原动画算法、依赖或平台播放链；本批真机／真实账号 NOT_RUN。

设置原生巡检后续见 [SETTINGS_NATIVE_KEYBOARD.md](SETTINGS_NATIVE_KEYBOARD.md)：修复实际 iPhone 横屏键盘
仅留 130px 可视高度时的输入框裁切，保留触摸尺寸。34 项 WebKit 回归通过、2 项平板重复场景跳过，
独立 Release QA 的 iPhone 模拟器键盘／旋转／子页返回已观察通过；iPad 原生键盘、真机和真实账号本批 NOT_RUN。
未更新个人 mobile.28 或服务器。

随后在源码 `3164837` 补齐 [iPad 原生键盘与旋转](SETTINGS_IPAD_KEYBOARD.md)：实际软件键盘输入、
横屏地址／凭据切换、收起键盘恢复和子页返回位置观察通过，128 个前端资源比对与签名校验通过。
本批没有生产改动，不增加自动测试数量；iPad 多任务、VoiceOver、真机、真实账号和长期性能仍待验收。

## 本轮核对的集合与队列行为

QQ 搜索异常响应见 [QQ_SEARCH_RESPONSE.md](QQ_SEARCH_RESPONSE.md)：共享解析器拒绝缺失／非数组列表，
移动页面保留失败页重试；有效数组、桌面原回退和搜索点播保持原行为。
311 项相关逻辑、30 项 WebKit、类型检查和移动构建通过；Mac 匿名查询业务码 2001，
真实成功／空搜索本批 BLOCKED_UPSTREAM，真实账号和物理设备 NOT_RUN，个人 mobile.28 未更新。

扫码通道与请求时序见 [LOGIN_INTENT.md](LOGIN_INTENT.md)：QQ 在声明通道返回后才要码，
晚到的旧取消不能覆盖最新登录方式，准备新码时隐藏旧码。397 项逻辑、51 项 WebKit 和类型检查通过；
保留修复前两项失败及关闭／旧后端兼容回归。本批真实扫码／原生容器／物理设备 NOT_RUN，个人 mobile.28 未更新。

扫码弹窗重试恢复见 [LOGIN_RECOVERY.md](LOGIN_RECOVERY.md)：重新生成／分享成功后旧错误消失，
旧分享迟到失败不能污染新二维码，仍保留本轮失败与共享扫码状态。349 项相关逻辑、84 个唯一 WebKit
用例、类型检查和移动构建通过；原生／系统分享／真实账号／真机本批 NOT_RUN，个人 mobile.28 未更新。

退出的原生整合补验见 [NATIVE_LOGOUT_INTEGRATION.md](NATIVE_LOGOUT_INTEGRATION.md)：生产 runtime 通过真实
Capacitor／Keychain 和原生三类缓存，iPhone 新增 4 项及既有 6 项回归、iPad 相同 4 项全部通过，
合计 10 个唯一用例。验证取消桥失败后仍清理该平台、保留另一平台并拒绝旧响应；本批只新增 QA 测试。
网络与取消失败为受控注入，未执行完整 React 页面或真实平台／物理设备验收，个人 mobile.28 和服务器未更新。

两平台退出清理见 [LOGOUT_CANCELLATION.md](LOGOUT_CANCELLATION.md)：取消请求失败时仍尝试原生凭据清理，
等待已排队保存，防止旧凭据随后写回；错误仍进入原重试入口。772 项移动逻辑、69 项 WebKit 和类型检查通过。
这是受控桥接故障验证，本批原生／Keychain 故障／真实账号／物理设备 NOT_RUN，个人 mobile.28 未更新。

移动网络旧响应修复见 [SESSION_RESPONSE_REVISION.md](SESSION_RESPONSE_REVISION.md)：凭据替换后拒绝旧响应，
防止 QQ 旧 401／803 清除或覆盖新登录，以及两平台旧歌单继续显示。770 项移动逻辑、96 项 WebKit、
类型检查与移动构建通过；原生、真实账号与真机本批 NOT_RUN。

此前基线的原生整合结果见 [NATIVE_CORE_INTEGRATION.md](NATIVE_CORE_INTEGRATION.md)：
独立 Release QA 的 iPhone 模拟器88项、iPad16项子集通过，资源一致性、真实PCM和生产首页启动通过。
保留首轮87通过／1失败及暂停淡出测试修正；未更新个人 App 或服务器，不替代真实平台及真机验收。

QQ 歌单响应校验见 [PLAYLIST_RESPONSE.md](PLAYLIST_RESPONSE.md)：个人歌单、自建及公开歌单曲目缺少数组时抛出原错误类型，
不再当作成功空页结束分页；真正空数组仍正常。网易云原实现保持不变，加入同场景回归；未新增依赖或修改服务。

歌单播放的账号时序修复见 [COLLECTION_PLAYBACK_SESSION.md](COLLECTION_PLAYBACK_SESSION.md)：
点歌后若在等待凭据保存期间退出、切换平台或替换凭据，旧操作不再继续提交队列。
复用已有会话代次校验，搜索／队列选曲保持原语义；受控测试与真机验收分别记录。

| 原版行为／复用入口 | 移动入口 | 当前验证边界 |
| --- | --- | --- |
| 集合当前范围加入队列：`useCollectionActions.enqueueScope` → `port.enqueueAll(view.contextTracks)` | `CollectionQueueActions`；主曲库、在线目录、每日推荐、Navidrome | 本轮新增；逻辑／WebKit 结果见 [COLLECTION_QUEUE.md](COLLECTION_QUEUE.md) |
| 可播放范围：`derivePlayableTracks`；批量去重／下一首或队尾：`applyQueueAddBehavior` | `enqueueMobileSongs` → `addMobileSongs` → 既有原生 `editQueue` | 本轮验证不可用项、跨平台身份、当前歌曲跳过、已存在项移动、容量与会话取消 |
| 歌手热门歌曲批量加入：`selectQueueableTopSongs`／`addArtistTopSongsToQueue` | `OnlineCatalogContent` 的热门歌曲页 | 使用同一可用性与播放身份规则；目录中的专辑列表不批量拉取全部专辑歌曲 |
| 本地集合的筛选／排序范围 | `MobileApp` 传入已筛选排序的 `songs` | 本轮验证过滤／排序结果与入队顺序一致；不会重排正在播放的队列 |
| 搜索选曲保留已有队列 | `playMobileSearchSong` | 既有实现，本轮重跑 [SEARCH_PLAYBACK.md](SEARCH_PLAYBACK.md) 对应界面测试；搜索页继续使用单曲入口 |
| 队列搜索与匹配项批量操作 | `QueueBrowser`、`editMobileQueue` | 既有实现与证据见 [QUEUE_SEARCH.md](QUEUE_SEARCH.md)；本轮逻辑回归不等同重跑该批所有界面测试 |
| 默认加入位置 | `QueuePreference`、原 `useAudioSettingsStore` | 本轮验证单曲／批量沿用偏好，操作等待中修改偏好不改变已发起操作 |

原版入口位于 `src/library/core/bindings/useCollectionActions.ts`、`useCollectionView.ts`、`useArtistView.ts`，
以及 `src/utils/queueAddBehavior.ts`、`artistTopSongsQueue.ts`。移动入口位于 `src/mobile/`。
这些新增入口使用现有触摸列表与主题，不调整用户已接受的全屏播放器、控制器或动画。

## 其他功能的源码与既有证据入口

以下条目是后续核对的导航。本轮未重新执行对应真机／原生验收，也不把早期文档中的通过自动算作新版本通过。

| 功能 | 当前源码入口 | 既有记录与未完成边界 |
| --- | --- | --- |
| 原生队列、后台及系统控制 | `ios/App/App/PlaybackEngine.swift`、`PlaybackQueue.swift`、`PlaybackSystem.swift`；`src/mobile/usePlayback.ts` | [ACCEPTANCE.md](ACCEPTANCE.md)；QQ／网易云历史用户反馈与新版长播、物理 iPad 验收分开 |
| 原歌词动画与全屏控制器 | `src/mobile/PlayerPanel.tsx` 直接复用 `VisualizerRenderer`；`PlayerChrome.tsx` | [FULLSCREEN_LAYOUT.md](FULLSCREEN_LAYOUT.md)、[VISUALIZER_RUNTIME.md](VISUALIZER_RUNTIME.md)；真机长期温升／帧率待验收 |
| 歌词导入、来源切换、批量导出 | `src/mobile/useMobileLyrics.ts`、`LocalLyricTools.tsx`、`BatchLyricExportDialog.tsx` | [LYRIC_TOOLS.md](LYRIC_TOOLS.md)、[BATCH_LYRIC_EXPORT.md](BATCH_LYRIC_EXPORT.md)、[LYRIC_PRIORITY.md](LYRIC_PRIORITY.md)；历史反馈不替代新版本 Files／系统挂起验证 |
| 本地曲库、文件夹、实体与歌单 | `src/mobile/useLocalCatalog.ts`、`LocalFolderTools.tsx`、`LocalMetadataManager.tsx`、`useLocalPlaylists.ts` | [LOCAL_ENTITIES.md](LOCAL_ENTITIES.md)、[LOCAL_FOLDER_RESCAN.md](LOCAL_FOLDER_RESCAN.md)、[LOCAL_PLAYLIST_FILES.md](LOCAL_PLAYLIST_FILES.md) |
| 在线账号、歌单、专辑、推荐与收藏 | `src/mobile/catalogSession.ts`、`OnlineCatalogSheet.tsx`、`DailyRecommendations.tsx`；原 Omni | [ACCOUNT_LIBRARY.md](ACCOUNT_LIBRARY.md)、[ONLINE_PLAYLIST_EDITS.md](ONLINE_PLAYLIST_EDITS.md)、[COLLECTION_SUBSCRIPTIONS.md](COLLECTION_SUBSCRIPTIONS.md)；受控写入测试不等于真实平台写入成功 |
| Navidrome 独立连接、浏览与播放 | `src/mobile/NavidromeBrowser.tsx`、`navidromeRuntime.ts`；原生 Navidrome 服务 | [NAVIDROME_LIBRARY.md](NAVIDROME_LIBRARY.md)、[NAVIDROME_SCROBBLE.md](NAVIDROME_SCROBBLE.md)；真实服务器／真机待验收 |
| 界面语言、睡眠、输出选择等设置 | `src/mobile/SettingsSheet.tsx`、`PlayerPanel.tsx` 的设置入口 | [LANGUAGE_SETTINGS.md](LANGUAGE_SETTINGS.md)、[SLEEP_TIMER.md](SLEEP_TIMER.md)、[AUDIO_ROUTE.md](AUDIO_ROUTE.md)；实际蓝牙／AirPlay 尚需设备 |
| 可选数据同步 | `src/mobile/SyncSettingsSheet.tsx`、`nativeSync.ts` | [SYNC.md](SYNC.md)；独立于音乐网关，默认关闭，不是本地播放器必需项 |
| 完整 Automix | `ios/App/App/NativeCrossfade.swift`、`NativeModelStore.swift`；`src/mobile/ModelControls.tsx` | QA 已接原模型和混音链，见 [ONLINE_AUTOMIX.md](ONLINE_AUTOMIX.md)、[AUTOMIX_PROCESS_MEMORY.md](AUTOMIX_PROCESS_MEMORY.md)；公开 `PlaybackModels.swift` 的 `stems/full` 仍为 false，设备热保护／长期资源与听感验收未通过 |

仍需保留的边界：真实平台和原生系统验证、完整 Automix 的真机联合负载、歌词精度与长期内存／温升、
物理 iPad 验收、[线程检查记录](PLAYBACK_THREAD_SAFETY.md)中的旧 AVPlayer tap 未决报告。
酷狗按后续范围延后；桌面模组、外部播放器接入、桌面窗口／托盘和 App Store 发布不在当前个人移动交付范围内。
其他尚未逐项核对的原版功能不得仅因已有界面或本文未列出而标记完成。
