<!-- VISUALIZER_COLLECTION_DIAGNOSTIC.md — isolated WebKit reachability evidence, not a proven native leak or a production fix. -->
# 动效对象回收诊断

2026-10-14，源码基线 `68f725aebae73d667181767b10a0e3d1312d3c07`。
接续 [预热后资源采样](WARMED_VISUALIZER_RESOURCES.md)，进一步区分对象保留与进程缓存。
本批只保存诊断和记录，**没有修改生产代码、原版动画、设置、依赖、个人mobile.28或服务器**。

结论：在独立 Playwright WebKit 中，Folia 的 Diorama 每次卸载后有一个旧画布对象继续存活；
去掉 Folia 页面、歌词、设置与 React DOM，直接使用已安装 Three Fiber 的根节点也可观察到保留。
直接 WebGL／Three.js 的对照没有同样现象。范围已缩小到此环境下的 Three Fiber 路径，
但尚未取得具体持有链，不能认定这解释了原生模拟器的全部内存增长，也没有完成泄漏修复。

## 方式与限制

此前 `leaks --outputGraph` 两次在系统符号解析中崩溃，见 [工具限制](AUTOMIX_MEMORY.md#内存图工具限制与复现)。
本批未再次运行该命令，未抓取宿主App的memgraph来代替WebContent分析。

复用已安装 Playwright 1.63.0 的公开 `page.requestGC()` 与标准 `WeakRef`。
其类型文档明确写明“不保证所有不可达对象均被收集”；因此存活信号需进一步追踪，不能单独宣告泄漏。
显式GC只存在于独立诊断，不作为运行中的App策略，也不证明自然回收、帧率、温升或后台播放稳定。

使用既有 Vite 移动配置、WebKit手机视口390×844；完整页面复用QQ／网易云受控歌曲、歌词缓存与设置触摸入口。
播放状态为样本，不解码音频、不访问真实账号。只记录弱引用与标量，不包装GL绘制／释放、RAF或ResizeObserver。
加入强引用存活、无强引用对象回收两个控制，防止把无效探针当成产品结论。

固定依赖由当前安装包读取：React／React DOM 19.3.0、Three Fiber 9.8.1、Three.js 0.185.1、
its-fine 2.1.1、react-use-measure 2.1.7。没有安装、升级或修改任何依赖。
这是Vite开发环境的WebKit证据，尚未运行同一最小场景的生产打包对照、原生WKWebView或物理设备。

## 完整页面：失败保留

每轮等待三个画布出现，通过原触摸入口打开歌词／动效设置，等待画布移除，再等1200ms。
首次QQ检查单次GC后仍剩一个已脱离文档的画布，因此为 **1 FAIL、1 NOT_RUN**。

一次诊断修正增加第二次GC、继续采集四轮，用软断言保留每轮失败而不中断采样；
同时移到独立诊断目录，避免把未经证实的回收假设加入正常回归门禁。
修正了初稿对R3F“500ms清理”的旧注释：当前9.8.1是reconciler清理回调，1200ms等待并不是释放保证。
此次为 **2 FAIL、0跳过**，两平台都得到相同结果：

| 周期 | 已观察过的画布总数 | 第一次GC前存活 | 第二次GC后存活 |
| --- | --- | --- | --- |
| 0 | 3 | 3 | 1 |
| 1 | 6 | 4 | 2 |
| 2 | 9 | 5 | 3 |
| 3 | 12 | 6 | 4 |

剩余对象全部 `isConnected=false`；新一轮不会替换掉上一轮的存活对象。
强／弱控制均符合预期，页面错误为空，设置关闭后画布恢复；这些通过项不改变回收断言的失败状态。
没有第三次执行此完整页面诊断，也未重跑旧 [多模式生命周期矩阵](VISUALIZER_LIFECYCLE.md)。

## 最小对照

去掉平台、歌词和Folia页面后逐层比较，每个场景四次创建／移除，等待1200ms、请求两次GC。
Three Fiber每轮必须实际创建新渲染器并至少绘制一帧，再观察卸载；根节点登记表必须归零。
仅诊断读取该固定版本导出的 `_roots.size`，生产代码不依赖此内部入口。

| 场景 | 四轮后存活对象 | 说明 |
| --- | --- | --- |
| React DOM普通canvas | 画布0 | 无GL、无Three Fiber |
| 原生WebGL2 canvas | 画布0、上下文0 | 清屏后显式loseContext并移除 |
| 直接Three.js渲染器 | 画布0、上下文0、渲染器0 | 真实绘制；正常dispose及forceContextLoss |
| Three Fiber `<Canvas>` | 画布4、渲染器4、捕获的状态对象4 | 根登记表0；无Folia、歌词或设置 |
| Three Fiber `createRoot` | 画布4、渲染器4、捕获的状态对象0 | 根登记表0；无React DOM、Canvas测量或上下文桥 |

状态对象仅指 `onCreated` 当时的对象；不能据其回收断言所有内部状态对象都已回收。
两种Three Fiber路径中，画布／渲染器均呈1→2→3→4保留。直接根节点对照进一步排除了
Folia业务代码、Canvas外壳的尺寸测量和React DOM作为这一保留现象的必要条件。

初版最小对照虽然返回2 PASS，但“已有任意状态对象”条件让后续轮次可能在创建渲染器前就卸载，
只有第一轮有创建证据；保留为弱证据，不采纳其后续循环结论。
加强为“当前轮创建计数＋实际首帧”后的2项、直接WebGL／Three.js的2项、直接R3F根节点的1项均执行通过。
这里的 **5项PASS只证明最小场景确实绘制并完成卸载动作**，其对象保留结果仍按表记录，不能读成无泄漏通过。
没有把初版重复执行累加为更多独立用例。

## 下一步与证据

尚缺两类证据：相同最小场景在生产打包／原生WKWebView中的对照，以及真正持有旧渲染器的对象路径。
取得这些证据后再决定修复位置；不依据当前结果给App添加强制GC、降低画质、替换渲染器或升级依赖。
原生模拟器的约12–37MiB增长、GPU缓存、长期稳定性及真机性能仍未解释完成。

本地 `.mobile-test-results/visualizer-collection/` 保留：

- 完整页面：`first-probe.spec.ts.txt`、`phone.json`、`first-canvas-collection.json`、`probe.spec.ts`、`retry.json`。
- 最小React对照：`minimal.*`、初稿 `*.first.txt`、`minimal-complete.json`；初稿结果为 `minimal.json`。
- 直接渲染器：`renderer.html`、`renderer.ts`、`renderer.spec.ts`、`renderer.config.ts`、`renderer.json`。
- 直接Three Fiber根节点：`core.html`、`core.tsx`、`core.spec.ts`、`core.config.ts`、`core.json`。
- 合并数据／身份：`metrics.json`、`versions.json`、各次日志与附件、`cleanup.json`。

这些是隔离的诊断材料，不进入移动打包或常规测试入口。真实账号、原生音频、iPad、物理设备及长期性能本批 `NOT_RUN`。
所有测试／浏览器进程已结束，本地4179端口释放。当前优先级仍为两平台核心、原版动效和设置UI。
