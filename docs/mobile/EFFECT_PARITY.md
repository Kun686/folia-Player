# 原版附加音效移植记录

日期：2026-10-10。基于 mobile.5 / 9f9a347 继续开发。
本文记录音效基础模块，**尚未接入 PlaybackEngine / AudioMeter 的实际播放链**。
用户已安装的 mobile.5 和 BUILD_RECORD.json 对应的交付包不包含本次变更；没有生成新的 IPA。
播放器继续只启用已验收的十段 EQ，不提前开放复合音色预设。

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

渲染用历史缓冲预分配；参数和DSP历史由单一渲染调用方拥有。
曲线／随机素材应在控制线程生成。后续整合需要提供可靠的控制线程交接与回收，
不能直接让界面线程并发修改这些模块，也不能在实时音频回调里生成素材。
波形整形的升／降采样即使曲线为空也保留，与原版相同，基础采样率延迟为192帧。
分块长度不增加额外延迟，回调切分不会改变滤波历史。

混响使用已有Accelerate DFT和向量运算。前128点直接卷积，128至2047点以128帧分段，
2048点之后以1024帧分段；各段按脉冲自身位置输出，不另加块延迟。
频域历史只存非负频率，DC/Nyquist分别保存，逆变换前恢复共轭对称。
所有FFT设置和缓冲在构造时分配；分支渲染不生成随机素材或分配FFT缓冲。
素材和卷积对象由控制侧预建并保留至渲染侧退役，接入时必须实现控制侧回收，不能让大对象在回调中析构。
噪声／混响关闭后保留800ms的渲染帧数再退役，快速重新开启保留相位／尾音；暂停期间的墙钟退役由后续控制层处理。

## 已查明的WebKit差异

`delay-channel-diagnostic.spec.ts` 在本机Playwright WebKit中复现：同一DelayNode输入两份相同信号，
左右声道产生不同延迟。8000Hz、0.012秒目标、0.08秒时间常数的线性测试信号在第128帧：
单声道输出0.1080060，立体声左0.0941908、右0.0827815。
核查固定版本的DelayDSPKernel，每个声道内核分别请求共享delayTime的自动化值，
与观察到的参数重复推进相符。这是上游实现差异，不是原版配置中设定的左右调制差异。

原生抖晃保持左右共用同一条调制时间线。数值参考使用原版单声道wowBranch分别处理两个输入；
另有原生回归断言两个相同声道在开关和重启调制后始终相等。
**不能声称与该WebKit立体声缺陷逐采样相同。** 旧立体声参考和失败日志保留在本地证据目录。

另一个差异来自渐变收尾：Web Audio在128帧边界检查接近目标的程度，
约e^-10的绝对／相对剩余值或十个时间常数后收敛；更换目标前也需结算旧渐变。
原生补齐该行为，避免小幅残余LFO继续改变延迟。没有提高测试误差阈值。

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
| 固定源码哈希与App内完整许可证 | PASS | 按WEBKIT_DSP_SOURCES.json逐项校验；Debug模拟器包与源码许可证逐字节一致 |
| 实际音效链、真机听感／性能、二进制增量 | NOT_RUN | 未接入播放器；不是音效交付验收 |

采样对照阈值为绝对误差0.00002，能量误差为0.02%或0.00001中的较大者。
截止滤波、宽度与抖晃覆盖8000、22050、44100、48000、96000Hz，且比较左右声道／不同缓冲布局。
饱和曲线逐点容差0.0000001，低位深曲线逐点精确比较。
随机素材使用相同确定性随机输入作参考；生产仍使用系统随机源。
这些是合成PCM测试，不是真实网易云／QQ音频，也不等于锁屏、温升或实际音质验收。

初始抖晃参考测试因WebKit多声道问题失败；改用单声道参考后暴露收敛规则遗漏。
最终修正前另有一次Swift `exp` 重载编译失败，改为明确的常数表示后编译和测试通过。
未删除原始失败日志：modulation-primitives、effect-primitives-linked、effect-primitives-convergence。
压缩器初始两轮自动化数值失败保留在compressor-native和compressor-k-rate；静态包络两轮均通过。

## 复用与待办边界

用户已明确批准 [DSP源码复用](DSP_SOURCE_REUSE.md)。WebKit固定提交为
9c50e091cb1b47fddb7afa7ffec7f9f22c0ee38b；逐文件来源与哈希见 WEBKIT_DSP_SOURCES.json。
已适配UpSampler、DownSampler、WaveShaperDSPKernel、DynamicsCompressorKernel；完整许可证保留在Swift源文件及
App资源WEBKIT_DSP_LICENSES.txt中。

目前累计21项音效模块／格式探测原生测试通过。仍需完成控制线程交接、单声道立体声输出方案、
当前和预加载曲目的完整效果链、后台与暂停时的分支释放、持久化与复合预设接入。
单声道输入需要验证真实原生tap格式及显式立体声处理能力，不能默认具备双声道噪声／混响输出。
后续交付时更新构建指纹并测量设备二进制增量；本记录不替代整体移植验收表。
