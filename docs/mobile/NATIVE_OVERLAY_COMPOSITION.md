<!-- NATIVE_OVERLAY_COMPOSITION.md — paired display/WKSnapshot evidence, not full visual acceptance. -->
# 播放器浮层与截图对照

2026-10-14，基于 `0d71e8ab534a72bd3eac4999dcfb62f74f238cb9`，收尾
[原生动效检查](NATIVE_VISUALIZER_LIFECYCLE.md) 中的空白卡片与顶部重叠观察。
本批只扩展 QA：生产界面、原版动画、平台能力和依赖没有改变，个人 App 仍为 mobile.28，服务器未更新。

## 结论

- 本轮稳定的控制器显示／隐藏状态下，所查看的整屏截图和网页快照都能显示“正在播放”卡片的图标、歌名与歌手；
  全16份 DOM 记录也都有文字，卡片位于窗口内。**先前的空白卡片未复现，根因未确认，不能写成已修复。**
- iPad 的配对图中，整屏截图保留顶部浮层的磨砂模糊，WKSnapshot 部分位置接近透明、能看清后方图案。
  这证明本环境的两种截图对合成效果呈现不同，但不能据此认定此前空白卡片必然也是截图问题。
- Cappella 的标题气泡在控制器展开时确实会被顶部浮层部分遮挡；手机 Monet 的歌手装饰也有此现象。
  隐藏控制器后可完整看到这些内容；本轮 iPad Monet 装饰没有与顶部浮层重叠。
  按已接受的全屏覆盖设计保留现状，真实歌曲、其他字号和真机观感继续待验收。

没有足够证据支持为这几张快照改动原版布局或动画算法。后续检查磨砂、透明与画布合成时，
同时保留系统整屏截图、WKSnapshot 和界面状态；不能单凭网页快照判定真实画面缺失。

## 方法与结果

复用 `VisualizerContainerTests.checkPackagedVisualizers` 的真实原生播放器、打包 React 页面和固定歌词，
只增加可选恢复回调及 `OverlayCompositionTests.testPackagedPlayerOverlayComposition`。
两个受控歌曲身份为 QQ／网易云，音源是生成的双声道音频，没有真实账号或平台请求。

测试通过现有键盘焦点逻辑保持控制器展开，再程序触发原舞台点击处理器隐藏控制器；
每种状态记录 DOM 标量、WKSnapshot 与进程阶段标记，并保留4秒供外部采样器截图。
采样器的 `--screenshots` 参数只在要求的阶段执行 `simctl io … screenshot`，检查截图没有跨阶段，
测试也检查等待前后控制器状态一致。没有绘图 API 拦截、GL 强引用或产品专用测试分支。
这些程序事件不代表实际手指命中测试；两张截图有时间差，不作动画逐像素一致断言。

独立包 `app.folia.validation.App`，Release／arm64，iOS 26.5（23F77）。
原生 build-for-testing 成功；128个前端资源与上一批一致，内嵌 Web commit 为 `6ca10ef`、版本为 mobile.28。
267份原生／测试源码及签名后的 App／测试二进制摘要与 `package.json` 一致。

| 检查 | iPhone 17 Pro 模拟器 | iPad Pro 11-inch M5 模拟器 |
| --- | --- | --- |
| XCTest | 1 PASS，0 FAIL／SKIPPED | 同一用例1 PASS，0 FAIL／SKIPPED |
| 原生播放与设置恢复 | 16个检查点；每点至少19200帧双声道PCM、RMS≥0.12482、位置推进≥0.44798秒 | 同样通过 |
| Cappella／Monet × 两平台 × 显示／隐藏 | 8组 DOM／网页快照／整屏截图齐全 | 8组齐全 |
| 页面错误／警告／挂载中画布上下文丢失 | 0／0／0 | 0／0／0 |
| 卡片几何 | 402×874窗口；显示时y=622、隐藏时y=778，高62 | 834×1210窗口；y=972／1128，高62 |
| 三进程短时采样 | 50次 | 49次 |

只有**1个唯一新 XCTest，在两台模拟器各执行一次**。检查点和截图数量不能当作独立测试数。
没有失败重试，也没有重跑此前14模式矩阵。iPad系统日志有一次音频I/O overload跳周期信息，
观察窗PCM断言通过，但本例没有测量全程断流率，不能宣称零音频丢帧或长期性能稳定。

人工查看了手机 QQ Cappella 的显示／隐藏配对图、Monet的显示与隐藏画面，
以及平板 QQ Cappella、网易云 Monet 的显示／隐藏配对图；没有把其余图片的自动保存视为人工视觉通过。
固定样本没有真实封面，音乐图标是正常回退；这不构成真实封面加载验收。

## 证据与边界

目录 `.mobile-test-results/native-overlay-composition/`：`baseline.json`、`native-build.log`、`package.json`、
`*-command.json`、`*.xcresult`、`*-summary.json`、`*-attachments/`、`*-processes/`、
`capture-pairs.json`、`metrics.json`、`visual-review.json`、`cleanup.json`、`delivery.json`。
`capture-pairs.json` 将每个状态对应到实际文件；原始截图未加工。
两个模拟器已关闭，所跟踪的10个采样器／测试／App／WebContent／GPU PID均退出。

旧 WebKit 矩阵的失败及最终弱引用探针 NOT_RUN 原样保留。本轮仅完成上述定向对照，
横屏／多任务、真实触摸／系统挂起、真实账号、物理设备、歌词≤150ms、长期帧率／内存／温升、
网易云30分钟锁屏仍待验收。完整产品与全部动效视觉验收尚未完成。
