<!-- VISUALIZER_LIFECYCLE.md — partial offline lifecycle evidence; probe correction is not a product or device acceptance. -->
# 动效反复挂载检查

2026-10-14，生产源码基线 `936f38233d726111bcbbb62d43ddf3512b746126`。
按 [CURRENT_SCOPE.md](CURRENT_SCOPE.md) 继续原版动效检查。本批只新增测试与记录，没有修改播放器、
动画算法、设置、缓存、依赖或构建版本；个人 App 仍为 mobile.28，服务器未更新。

## 复用与检查范围

复用原 `VisualizerRenderer`、`useNativeAudio`、`online-visualizer-fixture.ts`、移动 Playwright 配置与触摸入口。
14 个原模式分别使用 QQ 或网易云歌曲身份、固定在线歌词样本，规划手机、iPad、窄窗口三种视口。
平台身份是受控样本，不是实际账号、接口或音频解码验证。

`visualizer-lifecycle.spec.ts` 每项包含两次打开／关闭歌词动效设置、两次模拟隐藏／恢复页面、
一次收起／展开播放器。检查画布移除、尺寸监听解除、WebGL 程序释放、频谱桥采样与绘制停止，
恢复后继续采样，歌曲、队列和播放命令不被界面操作改变。停止状态各观察 350ms，不是长期性能测量。

`visualizer-lifecycle-probe.ts` 只装入测试页面，记录 WebGL 程序创建／删除、drawArrays／drawElements
和 ResizeObserver 观察目标。它不度量堆或 GPU 字节数，不覆盖所有扩展绘制入口、所有纹理／缓冲和帧循环，
也不能把合成的 visibilitychange 当作系统实际挂起。

## 实际结果与探针修正

| 检查 | 结果 | 本地证据 |
| --- | --- | --- |
| 首次生命周期矩阵 | FAIL：1 失败，41 未运行 | `ui.json`、`ui.log` |
| 修正后一次重试 | 8 PASS、3 FAIL、31 未运行；无自动重试 | `verified.json`、`verified.log` |
| 原生频谱桥与原版音频响应逻辑 | PASS：6 项，1 文件 | `unit.log` |
| 最终弱引用探针类型检查 | PASS | `typecheck-weakref.log` |
| 最终弱引用探针 WebKit 矩阵 | NOT_RUN | 已达到本轮失败命令的一次重试上限 |
| 本批原生模拟器、真实账号、物理设备 | NOT_RUN | 未运行 |

证据目录：`.mobile-test-results/visualizer-lifecycle/`。文件名 `verified.json` 是运行输出名，
其真实状态仍为失败，不能据名称当作通过；`executed-probe/` 保留该次实际执行的测试源文件。

首次断言要求移除画布后所有 WebGL 上下文立即丢失，因此 Cadenza 失败。源码核对发现默认 Latent
使用的已安装 `@paper-design/shaders` 在 dispose 时停止 RAF、删除程序和纹理、断开监听、移除画布，
但不强制 loseContext；上下文仍存在不等于它仍在绘制。故一次重试改为检查程序释放与实际绘制计数停止。
首次类型检查另发现测试包装器的 getContext 重载声明问题，已修正；不涉及生产实现。

重试中，手机视口 Cadenza、Cappella、Claddagh、Classic、Fume、Monet、Partita、Pendolo 共 8 项通过。
Diorama、Lumiere、Sonnet 的 11 个阶段均已采集，五次停止阶段的程序与观察目标均归零，
采样／绘制计数停止、恢复和歌曲状态断言通过；但最终捕获到 `too many active WebGL contexts`
及 `loseContext: context already lost`，所以这三项整体仍为 FAIL，不能只取其中通过的断言宣称验收完成。
其余三个手机模式及全部平板视口因达到失败上限而未运行。

这次探针把已移除画布和上下文放在强引用 Map 中，会阻止其按正常生命周期回收，因此结果受到测试工具干扰。
最终探针改用 WeakRef／WeakSet 和数值计数，不再为了统计保留画布、上下文和程序对象。
尚未重新运行，不能断言这已消除所有上下文错误，更不能据受干扰的结果修改原版背景或宣布产品泄漏。
遵守用户 AGENTS 中“Retry a failed command at most once”，本轮没有第三次运行这组矩阵。

已查看 Cadenza 与 Sonnet 恢复截图，确认保留全屏舞台和原控制器；截图只是对应瞬间的观察，
不改变 Sonnet 的失败判定。已知 THREE.Clock 弃用警告单独保留，未升级依赖。

## 后续验收边界

本步未达到 14 模式三视口完整通过。下一次允许执行时，应先验证最终探针，并以不保留 GL 引用的对照
区分工具干扰与真实资源问题；只有复现产品问题后再改生产代码。仍按两平台核心、原版动效、设置 UI 顺序推进。
真实系统挂起、原生磨砂合成、歌词误差 ≤150ms、长时间内存／卡顿／温升和物理 iPad 仍待验收。
本批不重新构建或安装 App，也不把上一批移动构建或 CI 算作新探针的 WebKit 通过证据。

后续独立证据见 [原生容器动效检查](NATIVE_VISUALIZER_LIFECYCLE.md)：四模式在两台模拟器完成真实PCM与设置恢复。
它使用系统侧进程采样，不拦截GL方法；不更改本页的WebKit失败与最终探针未运行状态。
