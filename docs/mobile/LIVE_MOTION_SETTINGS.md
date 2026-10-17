<!-- LIVE_MOTION_SETTINGS.md — native simulator readability evidence and restoration boundaries. -->
# 动态效果设置说明文字

2026-10-15：完成移动端三处系统限制提示的可读性修正，并在已登录的独立 iPhone 模拟器检查实际安装包。

## 问题与最小改动

真实 QQ《我怀念的》暂停界面中，打开「歌词与动效 → 降低动态效果」，临时开启系统 Reduce Motion 和 App「跟随系统设置」后，三处「当前正被上面的系统设置压低。」只有 11px、opacity 0.4，明显弱于相邻说明。

复用移动端现有 `--muted` 和 `--mobile-caption`，只在 `src/mobile/mobile-settings.css` 覆盖该面板的状态说明：opacity 1、现有说明字号和 1.5 行高。未修改共享桌面组件、动画实现、开关语义或默认值，没有新增依赖。原版默认不跟随系统仍然保留。

`test/mobile-ui/settings-contrast.spec.ts` 扩展现有用例，启用系统减弱动效和 App 跟随系统后，对三处说明检查对比度至少 4.5、字号至少 13px，且面板没有横向溢出。

## 已验证与边界

| 层次 | 结果与证据 |
| --- | --- |
| WebKit 受控回归 | **6 PASS / 20.8s**；深浅主题 × 手机、平板、窄平板视口。仅样式回归，不是平台歌曲验收。`ui.log` 与 `ui/` |
| 构建 | **PASS**；移动构建、Capacitor 资源复制及原生 Release 构建。`build.log`、`native-build.log` |
| 安装包 | **PASS**；独立 Bundle ID、签名、128 个应用资源和 2 个空 Cordova 文件一致。`manifest.json`、`installed-manifest.json` |
| 原生模拟器界面 | **已观察通过**；真实 QQ 歌曲上下文中，三处提示可读、横屏内容可滚动、固定关闭按钮可见，转回正常竖屏后可关闭设置。`forced-after-native.jpg`、`forced-after.jpg`、`landscape-after.jpg` |
| 状态恢复 | **PASS**；两平台账号／个人歌单入口仍可见；完整原生队列和音效 JSON 与基线一致，51 首、index 4、122.68798185941043 秒暂停。深色／绘光保留；跟随系统及三个减弱动效项恢复为 false，系统 Reduce Motion 恢复关闭。`final-state.json`、`final-check.json` |
| 清理 | 临时镜像及浏览器页已关闭；保留已授权的模拟器 App，处于暂停状态。`cleanup.json` |
| 尚未验收 | 本批未播放音频；真机、iPad 真实账号、长播、全部动效／设置、长期性能及歌词计时均 **NOT_RUN**。QQ 偶发空搜索仍未解决。 |

以上相对证据路径均位于 `.mobile-test-results/live-motion-settings/`。基线中缺失的 `reduce_motion_follow_system`，恢复后持久化为字符串 `false`，语义相同，不声明 WebKit 存储字节完全不变。

模拟器：iPhone 17 Pro / iOS 26.5，`9213032A-657A-40CD-BD2A-A3065ACCC8EC`。
Bundle ID：`app.folia.validation.App`；主二进制 SHA256：`b7b39a6cf9d0efe5eb437558faf1cb31879816e1cc5c0fc5af9eebc0c4d81dee`。
个人 iPhone 仍为 mobile.28，本批未更新；服务器没有变更。

## 回退

前一独立模拟器包保留在 `.mobile-test-results/live-audio-settings/final/VerifiedValidation.app`，主二进制 SHA256 为 `5b16d5f670bf205e873d96293d395ee0045f2c38fe05c4c180a0cbc39d907311`。如需回退，应原位安装，保留账户及数据；不卸载或重置模拟器。
