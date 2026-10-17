<!-- VISUAL_SETTINGS_RESET.md — desktop reset parity, scoped UI verification, and simulator cleanup. -->
# 原版动画与背景重置入口

2026-10-15：移动端补齐桌面已有的当前动画／背景参数重置，并透传两处图片加载状态。
六项 WebKit 行为与布局回归通过；独立 iPhone 模拟器实际操作通过。
这不是完整特效验收，前批群唱素材的自动 WebKit 保存失败仍保留。

## 修复与复用

- `src/mobile/VisualSettings.tsx`：通过当前 registry entry 的 `resetSettings` 调用现有 store reset handlers。
  不复制默认参数，不另建存储，不修改桌面端；仅当前模式具有原版 reset 能力时显示按钮。
- 同一背景 actions 对象用于设置面板与重置，保持参数修改和默认恢复使用同一业务路径。
- 补传 `isLoadingMonetPortraitImage` 和背景 `customImage.isLoading`，恢复原版图片加载期间的控件状态。
- `src/mobile/mobile-settings.css`：重置按钮沿用现有设置页色彩、圆角和字号，最小44px触摸高度。
  初次截图发现按钮显示为普通文字后补齐样式，并重新验证；未将最初包安装到模拟器。
- 视觉配置导入导出继续使用原有 store 和 codec；没有新设置键、生产依赖或自研默认值逻辑。

对照入口为 `src/components/visualizer/VisPlayground.tsx` 的 `handleResetVisualizerTuning`、
`VisPlaygroundSettingsPanel.tsx` 的面板参数，以及 `backgrounds/definition.ts` 的共享 actions。
桌面滑块回调负责暂存 draft；移动端既有 setter 直接更新 store，本批没有复制桌面 draft 机制。

| 范围 | 本批核对 |
| --- | --- |
| classic、partita、fume、claddagh、cappella、tilt、diorama、monet、pendolo、sonnet、tempera、lumiere | 使用原版12个动画 reset，逐项验证仅当前 tuning 恢复默认 |
| cadenza、still | 原 entry 没有设置重置入口，移动端不显示重置按钮 |
| common、monet、nomand、latent、sora 背景 | 使用原版5个背景 reset；通用背景重置其4个原版参数 |
| URL 背景 | 原 entry 没有 reset，移动端不显示按钮 |
| 莫奈图片加载状态 | 已补齐接线、类型及构建通过；真实延迟加载／并发导入场景本批 NOT_RUN |

## 自动验证

`test/mobile-ui/visual-reset.spec.ts` 使用已有原生桥接 fixture 和空播放队列，不使用示例歌曲作为平台证据。
每种动画／背景先准备非默认参数，通过 UI 点击重置后逐值检查：当前项为桌面默认值，其他模式、字号等保持。
另检查无重置能力时隐藏按钮、刷新持久化、背景横竖屏切换、至少44px触摸高度，以及未发送播放命令。

- `./node_modules/.bin/tsc --noEmit`：**PASS**。
- `npm run test:mobile:ui -- test/mobile-ui/visual-reset.spec.ts --output=.mobile-test-results/visual-reset/webkit`：**6 PASS，23.5秒**。
- 加按钮样式及尺寸断言后同一文件、输出目录 `styled`：**6 PASS，24.8秒**；phone／ipad／ipad-narrow各两项。
- `npm run build:mobile`、`./node_modules/.bin/cap copy ios`、独立包 Xcode Release build：**PASS**；最终样式后重新构建。
- 独立签名、128个Web资源及2个空Cordova文件：**PASS**，安装后再次核对一致。

上述不是上一批 `cappella-assets.spec.ts` 的重跑；该批失败证据与重试限制不变。

## 实际模拟器

环境：iPhone 17 Pro／iOS 26.5，`9213032A-657A-40CD-BD2A-A3065ACCC8EC`。
Bundle `app.folia.validation.App`；版本字段0.7.16／28；主二进制 SHA256：
`00acd6d18d719962f6010db2c4512d63fd7d1cefb2500027ff66f8fa60161c6b`。
个人手机 mobile.28、服务器和实际 iPad 未更新。

真实 QQ《我不难过》始终停在276.4506575963719秒。本批没有播放音频、切歌或修改队列。

1. 更新后 QQ／网易云账号及歌单入口可见；这只证明本批登录状态和入口保留，不代替完整接口回归。
2. 使用原生菜单切到流光，真实触摸滚动设置页，关闭逐字旋转；点击重置后恢复为默认启用。
3. 展开通用背景并启用禁用暗角，点击背景默认按钮后恢复关闭；流光参数保持。
4. 停止并重新启动 App，只读核对25个采集设置与重置后的值一致，完整队列及音效保持。

结论：流光／通用背景 **PASS（实际UI与持久化）**；其余模式本批仅 WebKit 自动验证。
真机、实际iPad、音频、锁屏连续播放、全部动画性能 **NOT_RUN**。

## 恢复与证据

停止独立 App 后，仅恢复本轮涉及的6个外观键：模式、classic tuning及通用背景4个参数；
修改前确认仍为本轮重置结果，事务中确认其他条目未变。
这是测试收尾，不算产品自动恢复；未写队列、音效、账号、资产库或Keychain。
再次启动后，25个采集设置与基线一致、原50首队列／音效和04:36暂停位置保持，镜台已恢复。

证据目录 `.mobile-test-results/visual-reset/`：

- `webkit.log`、`styled.log` 及对应截图目录：自动行为、布局和尺寸结果。
- `typecheck.log`、`mobile-build.log`、`cap-copy.log`、`native-build.log`：最终构建。
- `manifest.json`、`installed-manifest.json`、`installed-paths.json`：候选身份与资源。
- `qq-after-install.png`、`netease-after-install.png`：真实账号入口。
- `classic-before-reset.png`／`classic-after-reset.png`、`background-before-reset.png`／`background-after-reset.png`、`reset-live-mirror.png`：实际操作。
- `capture-state.json`、`verify-state.json`、`restore-state.json`、`final-state.json`：设置、队列及包核对。
- `restored-player.png`、`cleanup.json`：原暂停画面及助手清理，3200／9222／4179无监听。

原候选保留在 `.mobile-test-results/live-mode-settings/VerifiedValidation.app` 供回退，未执行回退。
当前 App 留在独立模拟器供用户使用；QQ偶发空搜索、群唱自动WebKit素材保存、完整特效／设置UI和真机长播仍未完成。
