# 原版附加音效移植记录

日期：2026-10-10。基于 mobile.5 / 9f9a347 继续开发。
本文记录音效基础模块、组合链、AudioMeter接线和原声音设置入口。
**当前开发源码已开放立体声音频的原版复合预设与自定义效果**，通过公开setAudioSettings测试实际AVPlayer解码音频。
单声道暂保留EQ，界面显示附加音效不可用；单声道转立体声支持仍未完成。
mobile.6使用Release构建，已开发签名安装并启动于iPhone XS Max / iOS 18.7.10；设备确认build 6。
源码身份与交付包校验见BUILD_RECORD.json和相邻交付元数据；旧mobile.5包保留以便回退。
下述资源复用／主动回收修复晚于mobile.6，尚未包含在已安装的build 6或其构建指纹中。
原Web／Electron效果参数、默认值、预设和主题未更改，没有新增生产依赖。

## 已实现并验证的模块

| 模块 | 原版依据 | 当前结果 |
|---|---|---|
| AudioEffectSources | effectSources.ts | 饱和1024点、低位深8192点曲线；3秒双声道噪声、2.2秒混响脉冲素材。全部曲线点及固定随机输入素材与原版对照通过 |
| AudioCutoffFilters | effectNodes.ts / effectParams.ts | 原版HP→LP、Q=0.7dB、低通采样率限制、0.03秒参数渐变；五种采样率及分离／交错缓冲通过 |
| AudioWowDelay | wowBranch.ts | 12ms基准延迟、0.7/6.8Hz调制、0.08秒参数渐变、800ms延后释放、再次启用取消释放、跳转清除历史 |
| AudioStereoWidth | effectNodes.ts | 原版左右直达／交叉矩阵及0.03秒渐变；需要显式立体声输入，不把单声道当作已完成的立体声处理 |
| WebAudioOversampling | 固定WebKit UpSampler/DownSampler | 两级2倍升采样和降采样、128/256点半带核；现有Accelerate卷积，无新增运行库 |
| WebAudioWaveShaper | 固定WebKit WaveShaperDSPKernel | Float32曲线插值、输入限幅及非有限样本处理，供饱和和低位深复用 |
| WebAudioCompressor / AudioPunch | 固定WebKit DynamicsCompressorKernel + effectNodes.ts | 6ms前瞻、32帧包络、双声道联动、原版punch参数与增益；静态及动态调节对照通过 |
| AudioNoise | noiseBranch.ts / effectSources.ts | 原版3秒双声道循环、2600Hz/Q0.5带通、0.12秒增益渐变；循环边界及开关对照通过 |
| AudioConvolution / AudioReverb | reverbBranch.ts / effectSources.ts + Accelerate | 原版2.2秒双声道脉冲、0.08秒湿干增益渐变；完整尾音、直接卷积对照及分段边界通过 |
| AudioEffectGraph / AudioEffectProgram | effectChain.ts / audioPresets.ts | 原顺序组合截止滤波、4倍过采样饱和、低位深、抖晃、宽度、压缩、混响和噪声；设置预建、跳转清除历史 |
| AudioEffectController | 原生控制／渲染交接 | 快速调参合并、旧采样格式请求失效、准备失败反馈；渲染侧只尝试锁，准备与大对象回收在串行控制线程 |

渲染用历史缓冲预分配；参数和DSP历史由单一渲染调用方拥有。
曲线／随机素材在控制线程生成。AudioEffectController已实现控制／渲染交接与回收，
已接入真实音频tap，位于EQ之后、频谱采样之前；不能直接让界面线程并发修改这些模块。
波形整形的升／降采样即使曲线为空也保留，与原版相同，基础采样率延迟为192帧。
分块长度不增加额外延迟，回调切分不会改变滤波历史。

混响使用已有Accelerate DFT和向量运算。前128点直接卷积，128至2047点以128帧分段，
2048点之后以1024帧分段；各段按脉冲自身位置输出，不另加块延迟。
频域历史只存非负频率，DC/Nyquist分别保存，逆变换前恢复共轭对称。
所有FFT设置和缓冲在构造时分配；分支渲染不生成随机素材或分配FFT缓冲。
素材和卷积对象由控制侧预建并保留至渲染侧退役，接入时必须实现控制侧回收，不能让大对象在回调中析构。
噪声／混响关闭后保留800ms的渲染帧数再退役，快速重新开启保留相位／尾音；暂停期间的墙钟退役由后续控制层处理。

控制器用格式代次和设置版本丢弃旧准备结果；ready/active/retired槽位有固定上限，另有一个正在构造的候选。
切换时保留活跃滤波历史，当前program持有淡出中的分支资源。回收由控制线程执行，无常驻轮询计时器。
mobile.6之后的源码复用活跃噪声／混响和未改变的波形曲线；尚未播放的ready图也复用素材，
连续调参不再重复生成随机素材或卷积历史。生成器只借用资源引用，不修改活跃卷积状态。
渲染确认分支已退役时使旧准备版本失效，避免迟到结果重新启用已经过期的混响历史。
预建的DispatchSource合并交接通知，控制线程准备不含过期资源的program，后续音频回调接收后在控制线程回收；
不再需要另一次界面设置或快照。相同参数的清理交接不重新启动渐变。
本项目回调路径不为通知新建async闭包／work item；这不等于证明系统调度器内部无分配或硬实时。
暂停而无音频回调时，活跃图仍保留素材。原版800ms墙钟释放尚未移植，不能把播放中的释放测试视为暂停验收。

AudioMeter按需启用附加链：未请求非中性效果时不分配组合图，PCM保持既有EQ路径，
首次效果请求由控制线程准备并在回调中接收。关闭后渐变回中性，保留既有图与尾音；
新曲目／新格式若保持中性则恢复无需效果图的路径。效果处理不依赖频谱读取或WebView执行。
PlaybackEngine当前及预加载meter均接收原设置，UserDefaults持久保存并回填原store。
只在原值域验证通过后提交设置；非法值不部分应用。控制器发布准备中／格式不支持／准备失败状态，
准备失败可用关闭再开启重试。Mono格式错误不会被后来的设置请求误清除；EQ仍继续工作。

界面复用原AudioEqualizerDialog、AudioEffectGrid、六组内置音色、两个自定义栏位及既有命令动作。
移动布局独立于EQ-only能力开关，保持原桌面对话框默认行为；效果推子提供44px触摸区域，
参数从实际input事件提交，复用串行合并、错误回填与自定义栏位逻辑。

## 已查明的WebKit差异

`delay-channel-diagnostic.spec.ts` 在本机Playwright WebKit中复现：同一DelayNode输入两份相同信号，
左右声道产生不同延迟。8000Hz、0.012秒目标、0.08秒时间常数的线性测试信号在第128帧：
单声道输出0.1080060，立体声左0.0941908、右0.0827815。
核查固定版本的DelayDSPKernel，每个声道内核分别请求共享delayTime的自动化值，
与观察到的参数重复推进相符。这是上游实现差异，不是原版配置中设定的左右调制差异。

原生抖晃保持左右共用同一条调制时间线。数值参考使用原版单声道wowBranch分别处理两个输入；
另有原生回归断言两个相同声道在开关和重启调制后始终相等。
**不能声称与该WebKit立体声缺陷逐采样相同。** 旧立体声参考和失败日志保留在本地证据目录。

截止滤波也复现同类问题：相同双声道输入在截止频率自动化期间产生最大0.00939790的左右差值；
独立检查饱和、压缩器没有该差值。固定BiquadDSPKernel源码显示逐声道读取共享AudioParam。
组合参考继续运行原版effectChain和预设，仅把两个截止滤波节点拆成显式单声道节点后合成立体声；
抖晃在组合参考中设为0，另外的单声道抖晃参考和双声道联动测试负责覆盖它。
这20组组合参考覆盖五种采样率及flat/lofi/hall/bass起点，并在播放中切换lofi、关闭、vocal。
它证明其余组合链与原版规则一致，不代表包含上游缺陷的原始立体声图逐样本等价。

另一个差异来自渐变收尾：Web Audio在128帧边界检查接近目标的程度，
约e^-10的绝对／相对剩余值或十个时间常数后收敛；更换目标前也需结算旧渐变。
原生补齐该行为，避免小幅残余LFO继续改变延迟。没有提高测试误差阈值。

音频速率渐变使用Float32四样本递推，45组独立GainNode参考以2 ULP容差验证。
截止滤波自动化时反馈历史必须舍入到Float32；常量系数时在128帧边界保存Float32输出历史。
此前Double反馈造成约7e-6的滤波误差，被低位深放大到约1e-4；修正后组合测试通过原定阈值。
分阶段断言可定位误差，Release优化编译也通过；没有扩大PCM或能量阈值。

压缩器的threshold/knee/ratio为128帧更新一次的k-rate参数。逐量子记录原版参数后查明：
Float32融合乘加以及新事件起点的`target + Float32(value - target)`舍入必须保留。
仅用数学等价的Double逐样本渐变会影响膝点搜索。修正后三个参数在20组自动化场景中逐量子精确相等，
最终PCM也通过原定阈值；没有放宽误差。压缩器重置保留本采样率的6ms前瞻，
不复刻上游reset将读写间隔恢复为固定256帧的内部实现细节。

实际AVPlayer音频tap已测试48kHz单／双声道WAV：输入单声道时tap仍为1声道，立体声为2声道。
不能假设tap会自动升为立体声，也不能修改prepare回调中的只读格式来改变输出声道数。
单声道的双声道噪声／混响接入方案仍未完成。

混响归一化核对了[Web Audio规范](https://webaudio.github.io/web-audio-api/#ConvolverNode-normalization)和固定版本的
[WebKit Reverb.cpp](https://github.com/WebKit/WebKit/blob/9c50e091cb1b47fddb7afa7ffec7f9f22c0ee38b/Source/WebCore/platform/audio/Reverb.cpp)。
规范示例增益校正常数为0.00125，原版WebKit实现实际使用`10^(-58/20)`。
原生采用后者，结合双声道RMS、最小RMS 0.000125和44100/Fs校正，独立WebKit参考通过。
卷积调度由本项目实现，FFT运算使用系统Accelerate；研究记录中的Reverb.cpp仅用于核对归一化数值。

## 测试证据

证据位于被Git忽略的 `.mobile-test-results/`。参考JSON和再生成脚本提交到仓库。

| 检查 | 状态 | 证据 |
|---|---|---|
| 原始曲线、素材及截止滤波参考生成 | PASS | effect-reference.log；EffectReference.json |
| 原始抖晃与宽度参考生成 | PASS | modulation-mono-reference.log；ModulationReference.json；30组 |
| WebKit多声道延迟诊断 | 已复现上游差异 | delay-channel-diagnostic.{log,json} |
| 基础原生DSP | PASS | effect-primitives-fixed.{log,xcresult}；8项 |
| 原始过采样／低位深参考生成 | PASS | oversampling-reference.log；OversamplingReference.json；30组 |
| 过采样／低位深原生DSP | PASS | oversampling-native.{log,xcresult}；2项；1/73/128帧回调；空曲线、运行中更换曲线、重置和非法输入 |
| 原始压缩器与参数参考生成 | PASS | compressor-parameter-reference.log；CompressorReference.json；40组，含20组逐量子参数快照 |
| 压缩器原生DSP | PASS | compressor-rounding.{log,xcresult}；4项；分离／交错布局、73/257帧回调 |
| 实际AVPlayer tap声道格式 | PASS（格式探测） | compressor-k-rate.log；AudioFormatTests；1项；不等于完整效果链验收 |
| 原始噪声／混响参考生成 | PASS | noise-reference.log、reverb-reference.log；各五种采样率 |
| 噪声与共用滤波回归 | PASS | noise-native.{log,xcresult}；4项，其中2项是已有截止滤波回归 |
| 分段卷积与混响 | PASS | reverb-native.{log,xcresult}；4项；含全尾音、直接求和独立参考、DC/Nyquist、无额外延迟、重置 |
| 噪声／混响最终回归 | PASS | effect-branches-final.{log,xcresult}；4项；补充单声道拒绝和非有限／极大输入检查 |
| TypeScript | PASS | effect-branches-typecheck.log |
| 原版组合链／逐阶段参考生成 | PASS | effect-graph-stage-reference.log；EffectGraphReference.json；20组，含一组逐阶段采样 |
| WebKit多声道截止滤波诊断 | 已复现上游差异 | effect-channel-diagnostic.{log,json}；原始立体声参考另存EffectGraphRawStereoWebKitReference.json |
| 音频速率渐变参考 | PASS | EffectRampReference.json；45组；五采样率、三时间常数、频率及增益目标切换 |
| 原生完整回归（Debug） | PASS | effect-control-final.{log,xcresult}；70项，其中30项音效模块／组合／控制器／tap格式测试 |
| 优化编译下组合链与线程交接（Release） | PASS | effect-control-release.{log,xcresult}；8项；没有DEBUG阶段探针 |
| 最新TypeScript | PASS | effect-control-final-typecheck.log |
| iPhone模拟器实际音频tap接线 | PASS | effect-tap-native.{log,xcresult}；9项；含停止频谱读取后的实际立体声低通、恢复中性、按需启动及既有EQ／队列／设置拒绝回归 |
| iPad模拟器Release内部tap与组合链 | PASS | effect-tap-ipad-release.{log,xcresult}；14项；此阶段尚未开放公共设置 |
| 公开音效设置与实际PCM | PASS | effect-settings-native.{log,xcresult}；7项；含公开设置→真实立体声PCM、关闭恢复、持久化、自定义栏位、预加载继承和Mono状态 |
| 移动音效设置类型／逻辑／界面 | PASS | effect-settings-web.log；TypeScript、38项逻辑测试、6项WebKit界面测试；覆盖手机、iPad、窄窗口，使用桥接样本而非真机 |
| mobile.6 iPad Release完整原生套件 | PASS | mobile6-ipad-release.{log,xcresult}；71项（不含DEBUG独有的逐阶段诊断断言） |
| mobile.6界面完整回归 | 20/21首次通过；剩余1项调整等待后复测通过 | mobile6-ui.log、mobile6-ui-retry.log；iPad暂停检查在歌词加载期间未通过，等待加载完成后单项复测；初始失败保留 |
| mobile.6资源与设备构建 | PASS | effect-settings-sync.log、mobile6-device-build.log；98个前端文件及完整DSP许可证逐字节核对，codesign严格校验通过 |
| mobile.6 iPhone安装／启动／身份 | PASS | mobile6-device-install.json、mobile6-device-launch.json、mobile6-device-app.json；build 6；不是听感或持续播放验收 |
| mobile.6之后资源复用／退役定向回归 | PASS | effect-resource-ready.{log,xcresult}；8项；连续40次调参、未播放图20次调参、晚到构造结果、无需UI更新的回收及实际PCM |
| 资源修复后iPhone模拟器Release完整套件 | PASS | effect-resource-final.{log,xcresult}；74项；连续调参新增独立图PCM对照，绝对误差低于0.000001，噪声／混响各仅构造一次 |
| 固定源码哈希与App内完整许可证 | PASS | 按WEBKIT_DSP_SOURCES.json逐项校验；Debug模拟器包与源码许可证逐字节一致 |
| 真机听感／性能、单独DSP二进制增量 | NOT_RUN | 模拟器与界面样本不等于真机音效验收；mobile.5是Debug而mobile.6是Release，不用两者差值声称纯DSP增量 |

采样对照阈值为绝对误差0.00002，能量误差为0.02%或0.00001中的较大者。
截止滤波、宽度与抖晃覆盖8000、22050、44100、48000、96000Hz，且比较左右声道／不同缓冲布局。
饱和曲线逐点容差0.0000001，低位深曲线逐点精确比较。
随机素材使用相同确定性随机输入作参考；生产仍使用系统随机源。
这些是合成PCM测试，不是真实网易云／QQ音频，也不等于锁屏、温升或实际音质验收。

初始抖晃参考测试因WebKit多声道问题失败；改用单声道参考后暴露收敛规则遗漏。
最终修正前另有一次Swift `exp` 重载编译失败，改为明确的常数表示后编译和测试通过。
未删除原始失败日志：modulation-primitives、effect-primitives-linked、effect-primitives-convergence。
压缩器初始两轮自动化数值失败保留在compressor-native和compressor-k-rate；静态包络两轮均通过。
资源修复首轮effect-resource-reuse有1项失败：实际tap测试把AVPlayer启动时的静音缓冲当成基准，
before=0、滤波后75、恢复162。测试现在先等播放时钟至少0.2秒，并明确要求基准峰值>100；
原衰减和恢复容差未改变。原始失败保留，修正后定向8项及完整74项通过。

## 复用与待办边界

用户已明确批准 [DSP源码复用](DSP_SOURCE_REUSE.md)。WebKit固定提交为
9c50e091cb1b47fddb7afa7ffec7f9f22c0ee38b；逐文件来源与哈希见 WEBKIT_DSP_SOURCES.json。
已适配UpSampler、DownSampler、WaveShaperDSPKernel、DynamicsCompressorKernel；完整许可证保留在Swift源文件及
App资源WEBKIT_DSP_LICENSES.txt中。

仍需完成单声道立体声输出方案、暂停期间的墙钟分支释放、真实后台运行和完整真机听感／性能。
单声道输入需要验证真实原生tap格式及显式立体声处理能力，不能默认具备双声道噪声／混响输出。
后续交付时更新构建指纹并测量设备二进制增量；本记录不替代整体移植验收表。
