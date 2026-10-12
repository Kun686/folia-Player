# 原版歌词分词编辑移植

2026-10-11，开发源码 `152b2eba90794f5f61e43d1bd2e9dc2a10168966`。
复用原精细分词编辑器、解析与持久化，仅为移动宿主增加触摸输入和系统剪贴板桥接。
该源码阶段个人 iPhone 为 mobile.12，未安装、未重启手机，也未启动 iOS Simulator。
后续已随 mobile.13 原位安装到个人 iPhone；本功能的原生交互仍待验证，见 VALIDATION.md。
完整移植保持 **IN_PROGRESS**。

## 实现与复用

- `LyricSegmentationEditor.tsx` 包装原 `LyricSegmentationSurfaceView`，提供粘贴编辑、复制结果、
  复制提示词、保存和恢复默认。打开时保留原始歌词快照；切歌关闭旧草稿。
- 复用 `lyricSegmentationRecord.ts`、`wordSegmentation.ts`、原 `lyricSeg_` IndexedDB 存储键。
  `useMobileSegmentation.ts` 按原播放身份隔离本地、QQ 和网易云记录，忽略迟到的旧歌曲读取结果。
  不重写歌词正文、音频或逐字时间。普通歌词缓存清理不删除这个独立前缀。
- 存储服务增加可选严格模式，移动编辑器通过原 cache repository 接收读写失败；
  未改变桌面默认调用方式。保存失败保留草稿，重置失败保留原记录，读取失败可重试。
- 原歌词处理器允许移动宿主显式传入记录；桌面继续使用原有全局记录。
  显示派生只在歌词、记录或设置变化时执行，不增加音频时钟驱动的 React 更新。
- 原编辑器增加可选触摸输入及剪贴板注入，原桌面调用兼容。
  并发保存、恢复与 AI 操作互斥；异步复制或错误在卸载后不再更新界面。
- Swift `copyText` 复用现有主线程及可信页面检查，限制 2MB UTF-8 文本，通过 `UIPasteboard` 写入。
  没有新增 npm、SPM、音频依赖或自行实现分词算法。
- 本批初始版本仅支持复制原模型提示词、粘贴结果；后续开发源码已补齐 App 内 AI 调用、原生取消与事务保护，见 [AI_SEGMENTATION.md](AI_SEGMENTATION.md)。真实模型与个人 App 仍待验证。

## 窄窗口修复

原移动 CSS 仅根据高度小于 500px 切到左右布局，导致 390×400 的窄窗口控件缩窄并越出可视区。
现在左右布局同时要求宽度至少 600px，低高度时允许播放器或控制区纵向滚动。
保留原界面元素及动画参数，没有改动音频引擎或当前真机安装包。

## 验证证据

以下是分批结果，不将重叠测试次数累加。本地日志位于 `.mobile-test-results/`。

| 检查 | 结果 | 证据及范围 |
|---|---|---|
| 最终类型检查 | PASS | `segmentation-typecheck-source.log` |
| 原歌词与移动逻辑 | PASS | `segmentation-logic.log`：30 文件、273 项；后续 `segmentation-logic-recheck.log`：2 文件、17 项，包含语义布局和修正后的测试策略 |
| 分词与显示 WebKit | PASS | `segmentation-ui-verified.log`：33 项，手机、宽 iPad、窄 iPad；此批在最后窄窗口 CSS 修复前运行 |
| 最后布局修复 | PASS | `segmentation-short-ui-fixed.log`：1 项覆盖 844×390、390×400；`segmentation-controls-regression.log`：正常三视口 3 项 |
| 原桌面编辑器 | PASS | `segmentation-desktop.log`：原 6 项组件回归，使用本机 Chrome |
| 资源同步与 iOS 编译 | PASS | `segmentation-source-sync.log`、`segmentation-device-build.log`；通用 iOS 设备 Release 编译，不连接设备执行 |
| 固定输入与资源 | PASS | `segmentation-source.json`、`segmentation-build-record.json`：3,045 个输入未变，115 个资源与同步目录及 App 一致 |
| 对应源码 CI | PASS | [38125147088](https://github.com/Kun686/folia-Player/actions/runs/38125147088)，准确提交 `152b2eb` |

WebKit 使用真实编辑器、parser、IndexedDB 和 Partita，原生桥接与歌曲数据受控。
覆盖保存／重载／重置、错误输入、存储读写／删除失败与重试、来源隔离、迟到读取、原始歌词和播放位置不变。
Partita 断言同时检查新的布局分组和保留的逐字绘制，不把语义分组误当作合并逐字时间。

通用 iOS 构建为未签名 `app.folia.validation.segmentation`，没有生成新个人 IPA。
编译通过仅证明原生桥接可构建；系统剪贴板实际操作、iOS 容器内分词保存恢复、真实键盘遮挡、
这项功能的物理设备交互均为 **NOT_RUN**。缩小 WebKit viewport 不能替代系统键盘验收。
用户要求优先真实 QQ 测试后，原计划的独立模拟器交互验证没有继续执行。

## 失败与修正

- 初次类型检查暴露翻译函数签名差异，改为适配原组件参数；最终类型检查通过。
- 原生桥接 fixture 起初缺少 `copyText` 方法注册，补齐注册与实现后复制用例通过。
- Partita 最初断言预期把「一句」合成一个字块。原实现明确保留组内逐字 timing，
  因此改为检查布局 chunk 的组合和每个 parser word；没有为测试改动原版 renderer。
- 低高度专项真实暴露播放器控件无法点击，修正上述 CSS 后通过，失败日志保留在
  `segmentation-short-ui.log`。这一修复没有掩盖为断言放宽。
- 首次 CI 查询误选上游仓库；明确指定 `Kun686/folia-Player` 后确认准确源码运行成功。

回退本源码提交即可撤销移动接线；无需迁移或删除曲库、原始歌词及已有分词记录。
该源码阶段未替换 mobile.12 的交付记录；后续 mobile.13 安装后，`BUILD_RECORD.json` 已更新为新候选。
