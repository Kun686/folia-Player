<!-- SETTINGS_IPAD_KEYBOARD.md — actual iPad simulator interaction, not physical-device acceptance. -->
# iPad 设置键盘与旋转补验

2026-10-14，验证源码与前端内嵌提交均为 `31648379b4614827128736968578d4cb8f75292a`。
按 [CURRENT_SCOPE.md](CURRENT_SCOPE.md) 补齐 [iPhone 键盘记录](SETTINGS_NATIVE_KEYBOARD.md) 的平板缺口。
本轮没有复现新的产品问题，仅补充证据；没有修改生产代码、布局、默认值或依赖。

## 环境与复用

- iPad Pro 11-inch (M5)，iOS 26.5 模拟器；逻辑尺寸 834×1210，横屏 1210×834。
- 独立 Release QA，Bundle ID `app.folia.validation.App`。版本标签仍为 `0.7.16-mobile.28`；
  当前源码 QA 与用户已安装的个人 mobile.28 不是同一个构建。
- `git diff 6b5fe22 HEAD -- ios/App/App ios/App/CapApp-SPM capacitor.config.ts` 为空，
  复用此前成功编译的原生包，重新构建前端并仅替换证据目录 QA 包内的 `public/`。
  128 个资源逐文件与 `dist-mobile` 一致，无诊断探针；重新临时签名并通过深度签名校验。
- 复用 XcodeBuildMCP 和已缓存的 serve-sim 0.1.48；未安装新依赖。
  镜像绑定本次 iPad UDID，只监听 127.0.0.1:3200，并实际观察到原生 App 画面。

## 已验证

本地证据目录：`.mobile-test-results/native-ipad-settings/`。

| 操作 | 结果 | 证据 |
| --- | --- | --- |
| 打开设置、触摸滚动至连接／缓存分组 | PASS（模拟器观察） | `ipad-keyboard-portrait.jpg`、`ipad-before-subpage.jpg` |
| 聚焦地址，软件键盘保持显示期间点击 q、a 两键 | PASS；字段显示 qa，完整输入框与关闭按钮可见 | `ipad-keyboard-typed.jpg` |
| 保持焦点旋转横屏 | PASS；qa 保留，地址输入框位于键盘上方 | `ipad-keyboard-landscape.jpg` |
| 键盘下一项切换到访问凭据 | PASS；空凭据字段完整显示且获得焦点 | `ipad-keyboard-next.jpg` |
| 旋转至另一竖屏、收起键盘、恢复原始方向 | PASS；输入保留，设置恢复完整高度 | `ipad-keyboard-portrait-return.jpg`、`ipad-settings-restored.jpg` |
| 从滚动后的设置进入睡眠定时，再关闭子页 | PASS；返回原滚动位置，未保存的 qa 仍保留 | `ipad-before-subpage.jpg`、`ipad-sleep-subpage.jpg`、`ipad-after-subpage.jpg` |
| 关闭设置回到曲库 | PASS；没有保存连接 | `ipad-library-return.jpg` |
| 移动资源构建、资源比对、签名校验 | PASS | `web-build.log`、`package.json`、`sign.log` |

这是人工操作模拟器的观察矩阵，不计作新增 XCTest 或 WebKit 自动用例。
本轮只补验未覆盖的原生交互，没有生产改动，未重复运行此前通过的逻辑／WebKit 回归。

原生截图采用设备自然方向，横屏及倒置竖屏截图保留原方向；镜像显示为当前阅读方向。
XcodeBuildMCP 在横屏点击“下一项”时命中位置不符，先造成键盘收起；
`ipad-tool-tap-missed.jpg` 保留该工具偏差，不作为成功证据。
随后在镜像可见键盘上点击下一项，实际看到凭据字段获得焦点，才记录该项 PASS。

仅在地址字段输入无效示例 qa，未保存连接；凭据始终为空，未登录平台、开启定时或触发播放。
曲库中原有 QA 音频保留，未开展本地曲库工作。

## 仍待验收

iPad 原生多任务／窄窗口、浮动键盘／硬件键盘、VoiceOver、物理 iPhone／iPad、真实 QQ／网易云账号、
网易云 30 分钟锁屏、耳机／蓝牙／网络切换、歌词精度及长期动画性能均为本批 `NOT_RUN`。
此设置补验不证明近期扫码修复已通过真实扫码，也不扩大历史平台或动画验收结论。

个人 App mobile.28、服务器、签名配置、依赖锁文件及根 README 未更新。
测试结束已停止 QA App、镜像与日志助手，关闭临时浏览器页并关闭本次模拟器；进程和端口复核见 `cleanup.json`。
最终源码、资源、截图及记录摘要见 `delivery.json`。本轮只有文档记录，无数据迁移或产品行为回滚。
