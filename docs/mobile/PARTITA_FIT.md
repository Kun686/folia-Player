# Partita 移动显示区适配

2026-10-11，源码 `763d42f3d8db3c540d71c0d4f966ef7589971504`。
本阶段修正移动端 Partita 的长词正文裁切，不改变原分词、歌词时间、错落参数或动画配置。
完整移植仍为 **IN_PROGRESS**；个人 iPhone 保持 mobile.11，没有新 IPA，BUILD_RECORD 未改变。

## 复现与原因

此前 iPad 实际 App 的 KRC 样本将「合成加密歌词导入验收」作为一个定时词，显示时两端被裁掉。
本轮用原 KRC 解析器和实际 Partita 渲染路径重现：手机显示区内正文溢出约 240px，
`partita-fit-red.log` 的边界断言失败。测试检查文字真实绘制矩形，不仅检查文字是否存在于 DOM。

诊断逐一对比自然尺寸和变换后尺寸。原布局以窗口高度和 `vw` 定字号、行数，词随后还有放大、
旋转和偏移。手机和 iPad 分栏里的歌词显示区小于整个窗口，因此即使自然尺寸接近可用宽度，
动画后的正文仍会越界。去掉变换的诊断只作用于测试页面，没有提交到产品。

## 最小改动与范围

- 移动 PlayerPanel 显式启用 `constrainLyricsToStage`，Partita 才加入整组缩放层；
  桌面／Web 默认不启用，隔离测试确认不增加 DOM 包装。其他动效没有使用这层缩放。
- 保留原 layout units、display words、时序、字体、行／词相对布局和进入／退出动画。
  读取实际 DOM 自然尺寸并结合原词／行变换范围计算可用比例；只等比缩小，不放大或删除文字。
  空间足够的短句保持原尺寸，背景和共享字幕不随正文缩放。
- 使用标准 ResizeObserver 和字体完成事件处理窗口、分栏与字体变化。布局变化时计算一次，
  不订阅播放时间、不添加 RAF、不逐帧写 React state；监听器和过期回调在卸载时清理。
- 原文本测量／渲染继续复用。已有标题适配器会截断文本，Ponder 适配器有不适用的最小缩放约束，
  因此只新增与 Partita 动作对应的边界计算，不复制文本测量、分词或解析器；没有新增依赖。
- 新增几何模块和缩放组件，原大组件只接线；原动画的 1.4 倍目标值提取为共用常量，数值不变。
  正文边界保留弹簧、整行退出与漂浮空间；光晕和装饰涟漪仍按原设计渲染。

## 验证与证据

本地证据为 `.mobile-test-results/partita-fit-*`，SHA256 清单见 `partita-fit-final-evidence.json`。

| 检查 | 结果 | 范围与记录 |
|---|---|---|
| 原问题回归 | PASS | 最初手机断言约 240px 溢出；修正后的手机／宽 iPad／窄 iPad 原用例均通过 |
| 最终 WebKit 专项 | PASS | `partita-fit-final-ui.log`：12 项，43.8 秒。中文长定时词、英文长词、组合字符与家庭 emoji、多词／多行、往返拖动、844×390 横屏及恢复，正文连续 40 帧边界测量；大字号、激烈主题与短句原尺寸 |
| 相邻 UI 回归 | PASS | `partita-fit-regression.log`：6 项，29.6 秒；每视口遍历 14 模式并检查挂载、暂停后切换 Partita 与拖动显示。不是每个模式全部动画的验收；在最终缩放包装居中样式修正之前执行 |
| 类型与原逻辑 | PASS | `partita-fit-final-sync.log`：25 项／4 文件，原布局缓存、注册表、主题与语义分组；类型检查、资源构建／同步通过 |
| 新增隔离与边界逻辑 | PASS | `partita-fit-unit.log`：3 项，默认宿主不增加包装、长词带偏移约束、不放大／隐藏区域／空行恢复；最终类型检查通过 |
| 固定源码资源同步 | PASS | `partita-fit-source-sync.log`：提交后重新生成身份，原生资源中的 commit 与本页源码一致 |
| Release 模拟器构建／启动 | PASS（启动范围） | `partita-fit-simulator-build.log`；iPad Pro 11-inch (M5)／iOS26.5，独立 `app.folia.validation.partitafit`，启动 PID 64497。截图确认曲库读取一首预置合成样本 |
| GitHub Mobile checks | PASS | [run 38119700775](https://github.com/Kun686/folia-Player/actions/runs/38119700775)，准确源码 `763d42f`，vendor 校验、固定依赖安装、类型检查、移动逻辑、资源构建 |

原生容器的触摸与 Partita 实际显示复核 **NOT_RUN**：CUA 按名称／完整路径连接 Simulator 窗口超时，
中间 bundle ID 选择也因两个应用路径产生歧义；没有以启动成功替代实际歌词显示验收。
模拟器库通过预置原生记录提供 WAV／KRC，未声称本轮重新验证系统文件选择器。
`partita-fit-simulator-record.json` 保存样本和构建身份；`partita-fit-simulator-launch.png` 仅是启动证据。
测试包及其数据已卸载，模拟器已关闭，见 `partita-fit-cleanup.json`。个人手机和个人模拟器 App 数据未修改。

失败与修正记录：初次类型检查发现大小写近似的 `.ts`／`.tsx` 模块解析冲突，改为明确区分的文件名；
首次扩展 UI 断言没有等待原退出动画移除旧行，修正为完整节点数组等待；
最初新增单测使用 `.tsx`，现有 Vitest 只收集 `.ts`，更名并实际执行 3 项后才列为 PASS。
原有 npm 配置、Vite 大块和注册表切换的 `useInsertionEffect` 警告仍存在。

## 未完成项目与回退

**NOT_RUN**：本修正的实体 iPhone／iPad、原生容器歌词视觉复核、150ms 歌词误差、长时间温升／内存。
WebKit 受控原生桥接测试覆盖前端实际解析与绘制，不代表音频播放或真实音乐平台验收。
本轮没有修改 Swift 播放器、服务器、凭据或依赖，也未重跑原生播放测试。

关闭移动宿主的适配参数或回退源码提交即可撤销，不迁移任何曲库／歌词数据。
完整 Automix、剩余原版工具、真实在线 App 链路与长期真机验收仍待完成。
