<!-- VISUALIZER_FRAME_LIFETIME.md — production retaining-path fix and bounded evidence, not long-run acceptance. -->
# 移动动效帧循环引用释放

2026-10-14，源码基线 `7d51e6ee50868e45031e8c9222c5223f3413fa0b` 加本次补丁。
沿用 [CURRENT_SCOPE.md](CURRENT_SCOPE.md)，完成手头的动效资源诊断。
只调整移动生产构建中的 Three Fiber 临时引用寿命，原动画、歌词算法、设置样式、播放器和默认值不变。
没有新增／升级依赖，未修改 `node_modules`、根 README、个人 mobile.28 或服务器。

**结论：已找到生产构建中最后一个已卸载渲染器的强引用路径，并用最小作用域修复消除它。
同场景 WebKit 回收断言、Chrome 堆快照分别证实修复；这不证明所有 WebContent 增长已解决或长期内存稳定。**

## 原因与最小方案

复用已安装 `@react-three/fiber` 9.8.1、原 Diorama、Vite 插件接口、Node 标准库和已有测试工具。
未替换渲染器、降低画质、修改原算法或给 App 添加强制 GC。

当前 vendor 的 `dist/events-9ce18a08.esm.js` 把三项帧临时变量声明在模块作用域：

- `state`：最近一轮渲染根的状态，含 `gl`。
- `subscribers`、`subscription`：当前帧订阅者集合与其中一项，可持有场景回调。

根节点正常卸载、登记表归零之后，模块仍存活，因此最近一轮状态仍可保留渲染器和画布。
Chrome 堆快照的非弱引用最短路径为：模块 context 变量 `wn` → 状态对象 → `gl`（WebGLRenderer）
→ `domElement`（已卸载画布）。原生产 bundle 的 sourcemap 将 `wn` 的赋值定位到该 vendor 文件17442行，
即 `state = root.store.getState()`。未把弱边作为强持有证据，也没有由诊断程序保存强画布引用。

`dev/mobile/r3fLoopLifetime.ts` 仅在移动 Vite **build** 阶段把 `state` 移入 `loop()`，
把两个订阅临时变量移入 `update()`。函数返回后这些临时引用不再由模块永久保留。
原回调顺序、时钟、渲染条件、失效帧数、手动渲染和循环取消逻辑保持原样。

作用范围由 `vite.mobile.config.ts` 决定，桌面／Web 构建和开发服务器没有接入此补丁。
保留原 vendor 注释与许可。依赖版本必须为9.8.1，原文件 SHA-256 必须为：

```text
0f2563472e4f3c6a4691e01d22358f15db9adeb750c366ab53ed84989ecec755
```

源文件漂移、重复应用、未找到渲染器入口均使构建失败，避免升级后静默失效。
升级 Three Fiber 时须审查上游是否已修复，再调整或删除本插件；不应简单绕过校验。
回退只需撤销移动配置注册和此插件，不涉及凭据／数据迁移或服务器。
变换保持总行数，但不生成额外 sourcemap；移动生产构建默认不开 sourcemap。
诊断补丁附近的变量声明行不能作为逐列精确映射，修复前的持有链定位使用未变换 bundle 的原始映射。

## 同源生产对照

复用 [前批诊断](VISUALIZER_COLLECTION_DIAGNOSTIC.md) 的10份源码、相同断言、四轮挂载／卸载，
每轮真实创建渲染器并至少绘制一帧，卸载后等待1200ms并请求两次GC。
原 production bundle 与修复后 bundle 分目录保存；QQ／网易云均为离线受控身份，不访问真实账号。

必须区分开发和生产：前批开发环境是每轮多留一个画布，四轮后4个；
本次未修复的生产环境只保留最近1个，下一轮会替换前一轮。
本补丁仅修复已证实的生产持有路径，未宣称旧开发矩阵变为通过。

| 场景 | 未修复生产构建：四轮后 | 修复后生产构建：四轮后 |
| --- | --- | --- |
| QQ 完整 Diorama 页面 | 画布1，回收断言FAIL | 画布0，PASS |
| 网易云完整 Diorama 页面 | 画布1，回收断言FAIL | 画布0，PASS |
| Three Fiber `<Canvas>` | 画布／渲染器各1 | 均0 |
| Three Fiber `createRoot` | 画布／渲染器各1 | 均0 |
| 普通canvas、原生WebGL2、直接Three.js | 画布／相关渲染对象均0 | 仍为0 |

WebKit 版本为已安装 Playwright1.63.0、WebKit revision2359，手机视口390×844。
修复后7项执行全部通过；其中两个完整页面用例有零存活断言，另五个最小用例断言绘制／卸载动作，
其零存活结论来自逐轮诊断附件，不把“动作PASS”单独解释为回收PASS。
强引用／弱引用控制符合预期。每轮修复后的对象数组为空，不只检查最后一轮。

堆检查用已安装系统 Chrome、Playwright 新建临时隔离 profile，未访问个人浏览数据。
相同直接根节点流程修复前后各执行1次；修复前发现最后一轮标记画布，修复后所有标记画布均消失，
堆分析排除弱边。Chrome 的对象路径与 WebKit 的回收结果分开保存，不将 Chrome 堆当作原生 WKWebView 堆。
浏览器显式 GC 是诊断手段，不代表正常运行中的回收频率、长期帧率或设备温升。

## 逻辑、构建与工具记录

`test/unit/mobile/r3fLoopLifetime.test.ts` 最终4项PASS：实际vendor变量作用域、源漂移拒绝、
重复应用拒绝，以及原／修改后真实帧函数在多根节点、按需帧、手动渲染、XR／非活动跳过、时钟和回调顺序上的等价结果。
类型检查、移动资源构建、Capacitor复制与原生 `build-for-testing` 均通过。

保留失败而不重写历史：

- 首次生产诊断3项执行PASS、QQ回收FAIL、2项工具FAIL、1项NOT_RUN。
  原因是证据目录里的 `package.json` 遮蔽了仓库的ESM配置；改名为 `bundle-manifest.json` 后，
  仅重跑受影响三项：网易云回收仍FAIL、两个直接渲染器执行PASS。未重跑已确定的QQ失败。
- 初次单测尝试使用当前TypeScript包不提供的编译器API，1失败／2通过、类型检查失败。
  改为已安装Babel解析器后原3项通过，再补真实帧执行回归后最终4项通过；未安装任何包。
- 先前系统 `leaks --outputGraph` 的两次崩溃未再次重试。
- 一次只读摘要核对误把诊断目录内的文件名当作仓库相对路径；修正目录后核对通过，未重跑测试。

可重复的源码检查：

```sh
"$HOME/.local/bin/codex-bounded" 600 -- npm run test:unit -- test/unit/mobile/r3fLoopLifetime.test.ts
"$HOME/.local/bin/codex-bounded" 600 -- npm run typecheck
"$HOME/.local/bin/codex-bounded" 600 -- npm run build:mobile
```

本地隔离诊断的 `after.config.ts` 和 `heap-after.config.ts` 分别用于WebKit与Chrome，
读取已保存的 `patched-dist/`。未修复 `dist/` 的218份文件及10份原场景源码摘要已重新校验不变。
不要使用当前带补丁的移动配置覆盖未修复bundle；重建RED需要先恢复上述基线配置。

## 原生模拟器：手机通过，平板失败保留

独立 `app.folia.validation.App`，Release／arm64，iOS Simulator26.5（23F77）。
128份前端资源在dist、Capacitor、Xcode产物和QA副本逐文件一致；272份原生输入未修改。
内嵌版本仍为mobile.28／基线提交号，精确源码差异由 `source-and-bundle-check.json` 记录，
不把它当作个人手机安装包已更新。原有Diorama用例不改断言，QQ／网易云各16轮设置开关，共64阶段。

| 检查 | iPhone 17 Pro | iPad Pro 11-inch M5 |
| --- | --- | --- |
| 同一个XCTest | 1 PASS | 1 FAIL，6条断言失败 |
| 播放／设置阶段 | 64阶段均有真实双声道PCM及位置推进 | 64阶段已记录；3阶段播放状态为false，其中1阶段PCM和推进均为0 |
| 页面异常、挂载画布上下文丢失 | 0／0 | 无对应页面断言失败；不能抵消音频失败 |
| 系统footprint采样 | 132次，118次同阶段有效 | 132次；播放中断，不纳入正常连续负载比较 |

iPhone沿用前批的同阶段算法，周期2–4与13–15中位footprint比较（MiB）：

| 歌曲身份 | App | WebContent | GPU |
| --- | --- | --- | --- |
| QQ | 91.71→91.55 | 193.33→228.66 | 46.78→68.68 |
| 网易云 | 86.86→86.85 | 234.75→241.73 | 69.43→68.72 |

WebContent仍增长，不能宣称本补丁解决了原生全部资源增长。
iPad失败发生在网易云周期11-settings、12-restored、13-settings；后者PCM为0、位置无推进，随后有恢复。
失败前日志出现系统 `HALC_ProxyIOContext ... skipping cycle due to overload`，这是线索，
尚未证明是系统负载、采样扰动、音频路由或产品问题，也未建立与本补丁的因果关系。
不放宽断言，不因随后恢复而判为通过，不据此移植或修改音频算法。

用户随后明确要求切换真实QQ账号／真实歌曲验收，本批未再重跑样本用例；
平板原生联合负载与长期资源验收保持未完成。`native/analyze.py` 保留两端均需通过的条件，
没有为失败数据修改分析门槛；手机单独分析见 `native/iphone-metrics.json`。

## 证据与验收边界

本地 `.mobile-test-results/visualizer-collection-production/` 保存：

- 原场景源码摘要 `preflight.json`；未修复bundle `dist/`、`bundle-manifest.json`；修复后 `patched-dist/`。
- 原WebKit结果 `phone.json`、`remaining.json` 与修复后 `after.json`，对应日志与附件。
- `heap.json`／`heap-after.json`、两份堆快照、`heap-paths.json`／`heap-after-paths.json`、`heap-symbol.json`。
- `unit*.log`、`typecheck*.log`、`mobile-build.log`、`cap-copy.log`；原生记录见 `native/`。
- `source-and-bundle-check.json` 关联未提交构建时的精确源码摘要、补丁后资源以及受保护文件。

真实平台、物理iPhone／iPad、系统后台挂起、网易云30分钟锁屏、歌词≤150ms误差、长期帧率／温升／内存仍待验收。
保留旧生命周期矩阵失败记录，不把此批局部回收修复当作全产品完成。
后续继续按两平台核心、原版特效、设置UI推进；本地音乐只保留两平台必要缓存。
