<!-- SETTINGS_NATIVE_KEYBOARD.md — actual simulator keyboard evidence; not physical-device acceptance. -->
# 横屏软件键盘下的设置输入框

后续 iPad 实际软件键盘／旋转／子页返回已补验，见 [SETTINGS_IPAD_KEYBOARD.md](SETTINGS_IPAD_KEYBOARD.md)。
下文保留本次 iPhone 修复当时的测试范围，不将两批证据混为一次验收。

2026-10-14，源码父提交 `accb042313a35a5e8457a433edc428a1d516b58b`。
按 [CURRENT_SCOPE.md](CURRENT_SCOPE.md) 收尾设置 UI 巡检；本批没有扩展功能。

## 问题与修复

独立 Release QA 在 iPhone 17 Pro／iOS 26.5 模拟器打开设置、聚焦 HTTPS 地址后旋转横屏：
实际布局为 874×402，URL 软件键盘把可视高度压到 130px。
原面板外留白、固定标题和内容留白使内容区只剩 32px，50px 高的输入框无法完整显示。
此前 240px 的受控键盘测试没有覆盖这个条件。

复用 `useSheetViewport.ts` 的 visualViewport 监听和合并到单帧的更新，
仅当可视高度低于 200px 且小于布局高度时启用紧凑留白。
`mobile-settings.css` 减少面板上下及固定标题的留白，保留左右安全区和原输入框／按钮尺寸。
关闭键盘、恢复正常尺寸或卸载时移除标记。没有新增轮询、React 高频状态或生产依赖。
原播放、歌词动画、全屏控制器与设置存储语义未修改。

## 验证结果

本地证据目录：`.mobile-test-results/native-settings-interaction/`。

| 检查 | 结果与边界 |
| --- | --- |
| 修复前最小复现 | `viewport-red.json`：1 FAIL，完整输入框不能容纳于内容区 |
| 修复后定向用例 | `viewport-fixed.json`：1 PASS；与下行重叠，不重复计数 |
| WebKit 回归 | `regression.json`：34 PASS、2 SKIPPED、0 失败／重试；两个跳过项为平板项目重复执行精确 iPhone 尺寸的实例 |
| 类型检查、移动资源构建 | PASS；`typecheck.log`、`web-build-fixed.log` |
| 原生 Release 基线构建 | PASS；`native-build.log`。修复仅涉及前端，替换 QA 包内资源后重新临时签名并通过签名校验 |
| 打包资源 | 修复包 `QA-fixed.app` 的 128 个前端资源与 `dist-mobile` 一致，且不含诊断探针；哈希见 `package-fixed.json` |
| 实际 iPhone 模拟器交互 | 设置触摸打开／滚动、子页返回位置、竖屏软件键盘、横屏完整地址输入框、键盘 Next／Done、回竖屏恢复均观察通过 |

回归命令（由 `codex-bounded` 限时）：

```sh
npm run test:mobile:ui -- sheet-viewport.spec.ts settings-layout.spec.ts gateway-settings.spec.ts
npm run typecheck
npm run build:mobile
```

新增回归同时检查完整地址及访问凭据字段、至少 44px 的输入框和关闭按钮、回竖屏后恢复高度与输入内容。
实际模拟器用临时镜像工具 serve-sim 0.1.48 配合 XcodeBuildMCP 操作；工具只在 npm 临时缓存执行，未加入项目依赖。
截图 `iphone-keyboard-landscape-red.jpg` 与 `iphone-keyboard-landscape-fixed.jpg` 保留修复前后软件键盘状态。
`iphone-geometry-red.jpg` 是仅用于测量几何的临时 QA 探针，探针没有进入最终 QA 包。
`iphone-settings-restored.jpg` 记录结束时恢复完整竖屏设置面板。
原生截图按自然方向保存，横屏图像需要旋转查看，不代表 App 布局方向错误。

输入过无效示例地址 `https://fixture.invalid`，未保存连接、未提供凭据、未登录账号。
工具输入文本时软件键盘收起，因此不把该操作声称为“软件键盘持续显示期间完成文字输入”；
字段内容保持由 WebKit 回归断言，原生交互另保留观察边界。

## 身份与剩余验收

QA Bundle ID 为 `app.folia.validation.App`；前端内嵌版本为 `0.7.16-mobile.28`，
内嵌提交仍是上述父提交，资源包含此次未提交修复。后续源码提交与内嵌身份分别记录，不冒充相同 SHA。
`package-fixed.json` 的 `binarySha256` 是重新签名前的原生可执行文件摘要；
签名后的文件摘要、最终源码提交、报告及截图摘要和对应提交 CI 另存本地 `delivery.json`。

本批 iPad 原生键盘、VoiceOver、物理 iPhone／iPad、真实服务／账号、长期播放与动画性能 `NOT_RUN`。
此前模拟器输入工具限制已在上述 iPhone 设置流程解除，不能扩大为所有原生交互均已验收。
个人安装包 mobile.28、服务器、依赖锁文件和签名配置未更新。整体交付仍未完成。
回退本次源码提交即可，无数据迁移。测试结束后停止 QA App、模拟器镜像和日志助手，并关闭模拟器及临时浏览器页。
