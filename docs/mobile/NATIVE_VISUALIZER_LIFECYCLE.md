<!-- NATIVE_VISUALIZER_LIFECYCLE.md — packaged renderer/PCM checks; short simulator samples are not full animation acceptance. -->
# 原生容器中的动效与播放

2026-10-14，生产源码及前端内嵌基线 `6ca10efc9e24b363c2b4f86ca94dad18b73d15f7`。
按 [CURRENT_SCOPE.md](CURRENT_SCOPE.md) 补充动效证据，不扩展其他功能。
本批仅新增 QA 用例、共享测试辅助与采样参数；生产播放器、原版渲染器、设置 UI 和依赖未改。
个人 App 仍为 mobile.28，服务器未更新。

## 验证方式

使用独立 `app.folia.validation.App`、Release／arm64、iOS 26.5（23F77）。
`npm run build:mobile` → Capacitor copy → `xcodebuild build-for-testing`；128 个打包资源逐文件一致。
QA 副本沿用离线首页，将未改动的生产首页映射到 `mobile.html`，重新签名并通过签名校验。
最终包的源码、资源与两个二进制摘要见 `.mobile-test-results/native-visualizer-lifecycle/package.json`。

`VisualizerContainerTests.swift` 复用原生 PlaybackEngine、StreamMixOutput、Capacitor、NativeLyricCache
及已有 `profileAudio`／`OutputMeasurement`。它将插件的播放器临时指向使用受控 GatewayClient 的真实引擎，
QQ／网易云歌曲身份解析到本地生成的 120 秒音频；缓存写入固定在线歌词。账户、服务地址必须为空。
这验证真实解码、桥接、缓存与 renderer 接线，不是登录、CDN 或音乐平台接口验收，也没有开展本地曲库功能。

通过页面原有按钮和 select 的事件处理器，依次检查 Classic、Diorama、Lumiere、Sonnet；
两种歌曲身份各四模式，每种反复打开／关闭设置两次，每台记录 32 个阶段。
这是程序触发真实设置处理器，不代表手指命中、VoiceOver 或键盘操作验收。

页面诊断只保存字符串、计数和快照，不拦截 getContext／绘制方法，不持有画布、GL 上下文或程序引用。
复用 `jointProcessCheckpoint` 与系统 `footprint`，分别测量明确对应此 QA 的 App、WebContent、GPU 进程。
`sample-joint-processes.py` 新增可选 `expected-phases.json` 参数；旧 Automix 默认阶段集合保持原样，
本批未运行 Automix。仍有 60 秒无输出、540 秒总时长和子进程清理限制。

## 结果

| 检查 | iPhone 17 Pro 模拟器 | iPad Pro 11-inch M5 模拟器 |
| --- | --- | --- |
| XCTest | 1 PASS，0 FAIL／SKIPPED | 同一用例 1 PASS，0 FAIL／SKIPPED |
| 页面／播放阶段 | 32 阶段；设置内画布移除、关闭后恢复 | 同样 32 阶段 |
| 实际音频 | 每阶段至少 19200 帧、双声道，RMS 约0.12483 | 同样通过 |
| 原生位置与队列 | 观察窗内至少推进0.447秒；平台索引／两首队列保持一致 | 同样通过 |
| 事后检查 UI 歌名与模式 | 全32阶段与所测身份／模式对应 | 同样通过 |
| 页面错误／仍挂载画布的 context lost | 0／0 | 0／0 |
| 外部进程采样 | 37 次，要求的8个恢复阶段全部覆盖 | 36 次，同样覆盖8阶段 |

只有 **1 个唯一 XCTest 用例，在两台模拟器执行两次**；64 个阶段不是64个独立测试。
每个普通观察窗约450ms，每个第二次恢复窗约3秒；整例为短时检查。
没有以音频位置或 playing 布尔量代替 PCM，也没有测量音频全程逐样本的断流率。
保存每台8张 WKWebView 恢复截图，已查看手机的三个 GPU 模式及平板 Diorama／Lumiere；
原有全屏画面与半透明控制器保留。三维镜头的画外文字不作为这一生命周期检查的通用裁切失败条件。

### 系统进程占用

下表为采样中的最小／最大 footprint（MiB），不是堆对象数或真机预算，三个进程不做简单加总：

| 设备 | App | WebContent | GPU |
| --- | --- | --- | --- |
| iPhone 模拟器 | 84.13–91.85 | 120.64–262.35 | 17.28–63.75 |
| iPad 模拟器 | 88.03–93.97 | 133.17–354.21 | 19.22–99.61 |

WebContent 末次占用仍高于首次（手机123.61→239.91MiB，平板135.02→258.66MiB）；
期间首次加载了多个惰性模块、字体和纹理，不能据此直接断言泄漏，也不能宣称长期内存稳定。
4条 THREE.Clock 弃用警告分别保留；系统日志另含 AVIF／WEBP 解码报告，未把本批结果当作这些格式的专项验收。

## 证据与未完成项

证据目录 `.mobile-test-results/native-visualizer-lifecycle/`：
`*-command.json`、`*.xcresult`、`*-summary.json`、`*-attachments/`、`*-processes/`、`metrics.json`。
采样器同时核对进程身份、单次 footprint 的三个 PID、测试最终退出码和必需阶段。
两次 native build 均成功；第一次之后增加恢复阶段的采样等待时间，第二次才生成实际执行包，没有重跑失败命令。
测试结束关闭两台模拟器，临时音频／缓存由测试清理，进程检查见 `cleanup.json`。

上一批 [WebKit 探针](VISUALIZER_LIFECYCLE.md) 的失败和最终探针 NOT_RUN 保持不变；
本次是原生容器的独立证据，不能据此改写那组报告。它没有复现对应的可见画布上下文丢失，
但不同 WebKit 环境的差异与旧探针干扰仍需分开对照。

剩余10个模式的同类原生检查、原生旋转／后台实际挂起、真实账号／CDN、物理设备、
长期帧率／内存／温升、歌词误差≤150ms与网易云30分钟锁屏仍待验收。
本批不构成新个人安装包发布或完整移植验收。
