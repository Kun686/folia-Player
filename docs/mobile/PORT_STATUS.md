<!-- PORT_STATUS.md — current source entry points and evidence boundaries, not release acceptance. -->
# 移植功能核对索引

2026-10-14 当前 [真实网络后台切歌](LIVE_BACKGROUND_PLAYBACK.md)：新增真实队列/空缓存/无WebView桥的原生验收用例。
构建PASS，两次执行分别在前台seek等待及切后台等待超时，后台解析/跨曲/PCM仍NOT_RUN。
修正后的就绪协调候选已构建和暂存，执行待授权；正常独立包、账号和原51首队列已恢复，产品播放代码未改。

2026-10-14 当前 [歌曲菜单异步位移](SONG_MENU_STABILITY.md)：复用现有收藏组件固定按钮与提示槽位置，
全局alert间距局部补正；首次36PASS／6FAIL保留，用户批准的最终12项定向回归PASS（50.7秒）。
类型／移动与原生构建、128资源／签名PASS；独立iPhone真实两平台菜单加载、旋转／关闭通过。
两账号与51首队列完整保留且暂停；个人mobile.28、服务器未更新，本批真机／音频／长播与完整UI未验收。

2026-10-14 最新 [真实目录入队与暂停预加载](LIVE_CATALOG_PLAYBACK.md)：原生预加载补齐元数据后
复用queueDirty／persist／publish推送队列版本，修复暂停点歌误报。新增用例先RED，修复后7项原生PASS；
独立iPhone真实QQ专辑／网易云歌手歌曲入队、修复后点歌／歌词／绘光已观察，128资源／签名一致。
原51首队列内容／顺序恢复，两账号保持且暂停；个人mobile.28和服务器未更新，新PCM／真机／长播与完整UI未验收。

2026-10-14 最新 [网易云真实歌曲喜欢与取消](LIVE_ONLINE_LIKES.md)：已部署原网易云喜欢路由，QQ保持只读。
真实歌曲写入／回读及最终取消后歌单自动刷新已观察通过，测试收藏已恢复。
最终39项相关逻辑、菜单修正30项WebKit与时间戳3视口回归、类型／构建／128资源签名通过。
个人mobile.28未更新；歌单编辑、完整设置与特效UI、物理设备及长播未完成验收。

2026-10-14 最新 [真实专辑与歌手浏览](LIVE_ONLINE_CATALOG.md)：目录专用网关补丁已上线，七条正式HTTPS真实接口通过。
178项单元、110条部署补丁断言、18项WebKit及类型／构建／128资源签名PASS；修复返回歌手页丢失标签。
独立iPhone真实QQ／网易云目录、修复后返回和QQ旋转已观察；两账号／51首队列保留且暂停。
个人mobile.28未更新，本批播放／账户写入／真机／长播NOT_RUN；现有代码与完整交付仍须区分。

2026-10-14 最新 [真实歌曲主题与字体设置对齐](LIVE_VISUAL_SETTINGS.md)：两行样式接入复用现有分组与按钮。
45 项 WebKit PASS、3 项实际字体检查 SKIP；类型／构建、128资源及签名 PASS。
独立 iPhone 的实际字号、旋转、文件选择／取消和绘光恢复已观察；账号／51首队列保留且暂停。
个人包和服务器未更新，完整 UI／真机／长播未验收；模拟器关键词着色初值缺证据，收尾设为默认开启。

2026-10-14 最新 [两平台真实分页与曲库工具栏](LIVE_LIBRARY_PAGINATION.md)：复用当前范围工具栏移动分页入口，
短横屏并排原有控件，歌曲列表保持整行。51 项 WebKit、类型／构建、128资源和签名身份 PASS；
独立 iPhone 真实歌单／搜索分页、横屏点击与竖屏恢复已观察，账号／51首队列保持且暂停。
个人 mobile.28、服务器本批未更新；完整设置／特效 UI、真机／长播仍待验收，iPad 暂缓。

2026-10-14 最新 [QQ 搜索业务状态校验](QQ_SEARCH_STATUS.md)：真实 UI 捕获 50／50／50／0 首响应，
排除重复提交；已补正文业务码校验并仅上线 QQ 镜像。160 项逻辑、正式 HTTPS 分页及独立 iPhone
四次真实 UI 搜索复验 PASS，账号／原51首队列保持且暂停。偶发空结果根因仍未确认，稳定性待验收；
个人 mobile.28 未更新，真机／长播 NOT_RUN，iPad 暂缓。

2026-10-14 最新 [QQ 大封面缓存修复](QQ_NATIVE_COVER.md)：原生适配既有800像素 CDN 规则，修复实际超限原图占位。
9 项原生检查（含真实 CDN）、构建与128资源／签名 PASS；独立 iPhone 真实 QQ／网易云封面和歌词更新已观察。
两账号、原51首队列保留且暂停。首次空搜索原因仍未定位；个人包／服务器未更新，真机／长播／新PCM未验收。

当前按 [CURRENT_SCOPE.md](CURRENT_SCOPE.md) 执行：完成启动续播后，依次收敛 QQ／网易云核心功能、
特效动画、设置 UI。本地音乐及其他功能暂缓；下表中本地、Navidrome、同步、AI、完整 Automix 的记录仅作历史索引。

2026-10-13。本表用于把现有源码、分批测试记录与个人安装包分开查看；不是原版所有功能已经等价的声明。
个人 App 仍为 mobile.28。本轮仅核对源码和执行受控自动测试，没有连接物理设备或部署服务器。
完整移植与完整 Automix 的最终验收仍未完成。下表的“已接入”只表示代码存在并装配，不代表真机通过。

2026-10-14 最新 [真实歌曲触摸进度补验](LIVE_SEEK_TOUCH.md)：两平台竖屏暂停拖动、网易云播放中拖动及歌词更新已观察，
128 资源与签名复核 PASS；两平台账号、原 51 首队列保留，结束暂停。横屏触摸不判通过；
QQ 首次回车空结果和搜索歌曲封面占位仍待定位。仅补证据，无生产修改／新安装／服务器变更，真机与长播 NOT_RUN。

2026-10-14 [QQ 认证搜索](QQ_AUTHENTICATED_SEARCH.md)：228 项逻辑、类型／移动构建 PASS，
候选与正式 HTTPS 的中文／英文分页、会话恢复／保留、访问认证通过；已上线，仅更换 QQ／backend 镜像。
独立 iPhone 128 资源与签名匹配，真实搜索后播放器／歌词／点击跳转和网易云回归已观察，原 51 首队列恢复并暂停。
本批无新 PCM 或真机长播证据，拖动未得到有效操作证据；个人 mobile.28 不变，整套 UI 和整体移植仍未验收。

2026-10-14 [真实歌曲与绘光并行验收](REAL_ACCOUNT_VISUAL_PCM.md)：独立 iPhone 原生用例 1 PASS，0 失败／跳过。
两平台各 8 个一秒窗口同时有双声道 PCM、3 个画布和推进时钟，实际快照及 rAF 记录确认前台舞台变化。
队列／凭据／绘光模式保持；重开两平台登录、51 首队列可见，已暂停。仅测试代码改变、主程序签名重签，128 资源保持。
少量大于 50ms 帧间隔、完整 UI、其他模式、真机／长播未解决；个人包及生产服务未更新，iPad 暂缓。

历史候选（认证方案已取代）：2026-10-14 [QQ 搜索移动网关适配](QQ_SEARCH_DESKTOP_ADAPTER.md)：112 项相关测试、类型检查和本机网关真实
中文／英文分页 PASS；沿用 App 合同与歌曲解析，不新增依赖。随后 SSH 恢复并构建服务器候选，
实际搜索仍返回 2001，独立旧 CGI 纠正请求返回 HTTP 500；上线 BLOCKED_UPSTREAM，App 修复后验收 NOT_RUN。
个人 App、模拟器及线上运行镜像／容器均未更新，临时容器已清理，整体搜索稳定性尚未通过。

2026-10-14 [真实歌曲短时音频验证](REAL_ACCOUNT_PCM.md)：获准额外一次执行后，原生 iPhone 模拟器 1 项 PASS；
网易云《莫愁乡》与 QQ《我怀念的》各 8 个窗口都有非零双声道输出和推进时钟，暂停／队列／凭据断言通过。
重开后两平台账号、51 首队列保留，App 已暂停；当前候选 128 资源及签名身份一致，无生产功能变更。
画布未挂载且允许正常缓存，因此动效与音频并行、绕过缓存的网络播放、真机及长播仍未验收；iPad 暂缓。

2026-10-14 [真实播放动效与浅色界面](LIVE_PLAYING_UI.md)：已安装独立iPhone候选128资源及原生签名哈希匹配；
真实QQ／网易云切歌、歌词／封面、播放中旋转、暂停拖动、浅色主要首屏已观察。恢复深色、暂停，账号／51首队列保留。
本批没有生产改动、音频测量或真机／长播验收；完整UI与移植仍未完成，iPad按用户选择暂缓。

2026-10-14 [播放工具入口固定](PLAYER_TOOLS_SHORTCUTS.md)：收藏读取后的导航位移已复现并修复，
54项三视口WebKit、类型／移动构建和128资源一致性PASS。独立iPhone真实歌曲滚动、横屏入口／竖屏恢复、
QQ／网易云登录和51首队列保持已观察；本批无PCM、真机或服务器变更，完整移植仍未验收。

2026-10-14 [真实歌曲绘光资源检查](LIVE_LUMIERE_RESOURCES.md)：已登录iPhone模拟器的暂停歌曲完成8轮展开／收起，
歌词／控制器恢复、两平台账号及51首队列保留；128资源与已签名候选一致。WebContent有回落，不证明长期稳定。
本批无生产修改或音频验收；镜台、PCM、真机仍待验收，iPad按用户选择暂缓。

2026-10-14 [动效设置文字与卡片背景](VISUAL_SETTINGS_CONTRAST.md)：实际绘光标签低对比及无效背景参数已修复，
21项三视口WebKit、类型／移动构建和128资源一致性PASS；同包QQ缺失列表错误分类117项相关逻辑PASS。
独立iPhone两平台会话／51首队列保留，深色设置与横竖屏已观察；真实QQ搜索稳定性、iPad／真机／长播仍待验收。

2026-10-14 [均衡器移动布局](EQUALIZER_MOBILE_LAYOUT.md)：复用原组件，十段频率按面板宽度排成两行或一行，
解决手机后四段需要横向寻找的问题；不改音效参数、DSP或桌面布局。3项既有WebKit、类型／构建和128资源一致性PASS。
独立iPhone实际横竖屏、真实歌曲歌词恢复及网易云会话／51首队列保留已观察；iPad连接待用户填写，完整验收仍未完成。

2026-10-14 [曲库搜索键盘修复](LIBRARY_KEYBOARD.md)：复用设置页可视区域，修复搜索时页面进入状态栏，
为结果腾出键盘上方空间。39个唯一WebKit用例、类型／移动／原生构建与128资源一致性PASS。
独立iPhone模拟器真实队列输入、横竖屏、清除筛选恢复与QQ曲库键盘已观察；两账号／51首队列保留。
本批未播放音频，iPad原生／真机／完整UI仍待验收，个人包／服务器未更新。

2026-10-14 [启动资源生命周期修复](STARTUP_PLAYER_LIFETIME.md)：连接就绪／曲库切换不再误取消播放器歌词和封面，
真正退出／换连接的取消保留。45项逻辑／48个唯一WebKit用例、类型、移动／原生构建与128资源一致性PASS。
独立模拟器网易云《陪我吃饭》与QQ《我怀念的》分别重开后自动恢复歌词／封面，登录及51首队列保留；
QQ绘光横竖屏恢复已观察。未执行PCM、真机／长播或完整UI验收，个人包／服务器未更新。

此前 [真实播放与歌词重试](LIVE_PLAYBACK_FOLLOWUP.md)：补足网易云可见滑块拖动，
歌词失败新增明确提示和重试，真实歌曲点击后恢复且暂停位置保留。45项三视口WebKit、类型、
移动／原生构建与128资源一致性PASS，已安装独立模拟器。当时启动歌词失败根因未解决，后续见上文；
真实PCM测试两次入口检查失败，测量NOT_RUN，修正源码只编译未再次执行。个人包／服务器未更新。

2026-10-14 [网易云真实账号与曲库界面](NETEASE_LIVE_UI_ALIGNMENT.md)：真实歌单50首、歌词／进度、
点按跳转、下一首、QQ／网易云双向切歌和Power搜索已观察。辅助入口默认收拢，最终包保留两平台登录。
46项既有手机WebKit、类型／移动／原生构建与128资源一致性PASS；iPad设置仅部分巡检，无本批PCM或真机／长播证据。
QQ搜索间歇失败、既有iPad音频及WebContent增长问题保留；个人App与服务器未更新。

2026-10-14 [真实 QQ 搜索诊断](QQ_SEARCH_LIVE_DIAGNOSIS.md)：个人网关和 Mac 直连均复现业务码2001，
一次 search_id 对照只在网关成功，旧接口返回空列表，未找到可靠修复。保留原协议，仅区分歌曲加载错误类型，
不把匿名业务失败提示成登录失效；116项逻辑、类型／移动／原生构建与128资源一致性PASS。
当前生产模拟器搜索 Power 成功且QQ登录／队列保留，新错误界面及搜索稳定性未验收；个人App和服务器未更新。

2026-10-14 [移动UI对齐与真实QQ](UI_ALIGNMENT_LIVE_QQ.md)：复用公共sheet与原组件，统一曲库／设置／工具
的边距、字号、卡片及复选框触摸区域，QQ／网易云入口前置，搜索标题纠正。独立模拟器保留用户QQ登录，
已观察真实歌单和歌曲播放／歌词／拖动／跨曲；搜索有成功也有失败，后续网关诊断业务码2001，未判为稳定通过。
最终类型检查、移动／原生构建、128资源一致性PASS；主要深浅UI已观察，整套UI／iPad／真机仍待验收。
本批未更新个人mobile.28或服务器，未新增依赖、修改原歌词／动画算法。

2026-10-14 [生产动效帧引用修复](VISUALIZER_FRAME_LIFETIME.md)：已定位并消除Three Fiber最后卸载场景的模块强引用，
移动构建专用，无依赖升级。4项逻辑、7项生产WebKit和Chrome堆对照PASS；原生同一QA手机PASS、平板FAIL，
平板3阶段音频异常及WebContent持续增长仍待排查。用户已要求转入真实QQ账号／歌曲验收，个人mobile.28已打开，
该阶段独立模拟器尚待登录，后续真实QQ观察见上文；未将旧离线样本结果当成真实平台通过。

2026-10-14 [动效对象回收诊断](VISUALIZER_COLLECTION_DIAGNOSTIC.md)：独立WebKit中完整页面两平台回收断言FAIL，
最小对照将旧画布／渲染器保留缩小到Three Fiber根节点路径。5项最小场景执行通过仅证明绘制／卸载动作完成，
不代表回收通过；持有链、生产打包／原生关联及长期性能仍待验证。本批无生产变更，个人App和服务器未更新。

2026-10-14 [同一动效重复资源检查](WARMED_VISUALIZER_RESOURCES.md)：预热后固定Diorama重复开关设置，
同一原生QA在手机／平板各1项PASS，每端64阶段有真实PCM及页面恢复。WebContent仍增长约12–37MiB，
本批未判定泄漏或宣称长期稳定；只扩展QA，生产功能、个人App与服务器未更新，真实账号／真机NOT_RUN。

2026-10-14 [设置背景交互隔离](SETTINGS_MODAL_ISOLATION.md)：设置与子页打开期间，背景曲库／播放器控件不再接受焦点。
60项WebKit、类型检查与移动构建PASS；同一原生QA在iPhone／iPad各1项PASS，每端8个焦点隔离阶段与10个PCM检查点。
未改样式、原动效或默认值；VoiceOver／硬件键盘／真机／真实账号／长期性能NOT_RUN，个人App与服务器未更新。

2026-10-14 [手动重试保留播放位置](MANUAL_PLAYBACK_RECOVERY.md)：断网后手动继续使用当前进度或拖动目标，自然播完后从0秒重播。
原代码2项位置复现失败，修复后同一12项在iPhone／iPad原生模拟器均PASS，含真实PCM与缓存／切歌／错误策略回归。
实际网络／真实账号／物理设备／长播NOT_RUN；个人mobile.28、服务器、原动画与设置UI未更新。

2026-10-14 [缓存歌曲断网连续播放](CACHED_NETWORK_RECOVERY.md)：完整缓存的QQ／网易云歌曲收到断网通知后继续使用当前解码器，
清空缓存列表仍保留正在播放的文件；未缓存歌曲保持原重连流程。同一11项在手机／平板原生模拟器均PASS，含真实PCM。
本批真实网络／账号／物理设备／长播NOT_RUN；个人mobile.28、服务器、原版动画与设置UI未更新。

2026-10-14 [会话与设置恢复原生补验](NATIVE_SETTINGS_RECOVERY.md)：当前生产基线在iPhone／iPad模拟器同一8项均PASS，
含原生保存拒绝隔离、Keychain重新读取、设置返回与缓存重试、真实PCM和既有播放／退出回归。
128个前端资源一致；仅新增QA，真实账号／物理设备／长播／长期性能NOT_RUN，个人App与服务器未更新。

2026-10-14 [动效设置返回恢复](VISUAL_SETTINGS_RETURN.md)：修复进入主题编辑再返回时丢失未应用的外观草稿与展开分组。
保留原设置表单与渲染器，48项WebKit及类型检查PASS；原生／真实账号／物理设备本批NOT_RUN，
个人mobile.28和服务器未更新，原全屏布局、控制器材质及动画算法不变。

2026-10-14 [凭据保存错误隔离](SESSION_PERSISTENCE_ISOLATION.md)：按操作涉及的平台检查保存结果，
保留串行写入和失败平台自己的错误；单曲只依赖目标平台，整组队列检查所有相关平台。
776项移动逻辑、最终96项WebKit、类型检查PASS；原生／真实账号／物理设备本批NOT_RUN，个人App和服务器未更新。

2026-10-14 [在线缓存恢复](CACHE_RECOVERY.md)：修复缓存列表恢复后残留错误及就绪时无重试入口；
手动重读保留正在保存的设置，成功列表读取不掩盖设置错误。最终39项WebKit、27项相关逻辑、类型检查PASS。
仅两处移动端生产修改，原缓存策略及动画不变；原生／真实账号／物理设备本批NOT_RUN，个人App和服务器未更新。

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
