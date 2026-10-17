<!-- SONG_MENU_STABILITY.md — asynchronous song-menu layout fix and bounded regression evidence. -->
# 歌曲菜单加载时的触摸位置

2026-10-14，继续 QQ／网易云核心使用与移动 UI 对齐。实际独立 iPhone 模拟器中，
收藏状态从“正在加载”变为按钮时，居中的歌曲菜单整体移动；QQ 只读说明使位移更大。
本批修改已完成，用户批准的最后12项定向回归全部通过（50.7秒）。
已原位更新独立iPhone模拟器并检查真实两平台歌曲菜单；个人mobile.28及服务器未更新。

## 最简修正

复用 `OnlineSongLike`、原有文案／按钮样式、`createMobileSongLikes` 的 Omni 请求及权限判断：

- 加载、保存、已读取、未登录、错误重试共用同一按钮位置。
- 提示区域用 CSS grid 叠放三种现有文案，隐藏项仅用于按实际文字／窗口宽度保留空间，
  同时设置 `aria-hidden` 与 `visibility:hidden`。错误仍有 alert，加载／保存仍有 status。
- 重试只重新读取；未知状态不展示已收藏／未收藏判断，QQ 仍只读。
- 局部提示区域清除全局 `[role=alert]` 的额外 padding，间距由原 grid gap 负责。

生产改动仅 `src/mobile/OnlineSongLike.tsx`、`src/mobile/mobile.css`。
回归复用 `test/mobile-ui/online-likes.spec.ts` 的受控传输，补 QQ 延迟／失败响应。
无新依赖，不改音乐规则、平台权限或音效动画。

## 当前证据

| 验证 | 状态 | 边界 |
| --- | --- | --- |
| 真实旧包菜单 | 已观察 | 已登录网易云《莫愁乡》加载前后按钮移动；只开关菜单，没有收藏、入队或播放 |
| 原代码定向复现 | RED | 手机 4 项失败；两平台成功／错误返回后按钮分别位移约 11.59／38／26／38 CSS px |
| 第一版修正回归 | 36 PASS／6 FAIL | 手机、宽平板、窄平板共 42 项；成功返回及既有收藏行为通过，错误返回仍移动 12px |
| 第二处原因及修正 | PASS | 全局 alert 的上下 padding 共24px，导致居中菜单移动12px；局部 padding:0 后相关12项全部通过 |
| 类型检查 | PASS | `node node_modules/typescript/bin/tsc --noEmit`；后续仅 CSS padding 修正 |
| 最终移动构建 | PASS | `npm run build:mobile`，含最后的 padding 修正 |
| 最终12项定向回归 | PASS，50.7秒 | 用户批准额外一次、最多3分钟；两平台成功／失败 × 手机／宽平板／窄平板；触摸目标位置偏移小于1 CSS px，无收藏写入 |
| 原生构建／资源／签名 | PASS | Release独立包，128前端资源及2个空Cordova文件一致，安装前后签名和manifest核对一致 |
| 修复后真实两平台菜单 | 已观察通过 | QQ《我怀念的》、网易云《莫愁乡》加载到收藏状态位置保持；横竖屏、网易云菜单滑动到底部、QQ横屏关闭正常 |
| 登录／队列保留 | PASS | 两平台账户仍登录；51首队列完整JSON及顺序哈希一致，《莫愁乡》19.7秒暂停；没有点击收藏写入或队列修改 |
| 物理设备／长播／完整UI | NOT_RUN | 个人mobile.28未更新；本批不代表整套界面完成 |

错误失败保留，不以36项通过掩盖6项失败。最终校验只重跑相关12项，不重复已通过的30项行为检查。
真实平台检查复用了已登录账号与现有歌曲，没有模拟歌曲替代真实平台证据；
错误返回只在受控WebKit传输中验证，没有故意破坏正式平台连接。横屏采用现有可滚动菜单，
本批没有修改菜单结构、平台权限、歌曲数据或播放行为。

最终回归命令（已执行一次，不需重复）：

```sh
"$HOME/.local/bin/codex-bounded" 180 -- node node_modules/@playwright/test/cli.js test \
  -c playwright.mobile.config.ts test/mobile-ui/online-likes.spec.ts \
  --grep "song menu targets stay fixed"
```

独立包身份 `app.folia.validation.App`，应用标识 `33GAKXJHL3.app.folia.validation.App`，
版本0.7.16／构建28；这不是个人新版本发布。可执行文件SHA-256：
`77e16508514b817670a3e574c3dabd80968d519205e9bece5f2611e9285eacd0`。

## 复核与回滚

证据目录 `.mobile-test-results/song-menu-stability/`：

- `red-ui.log`、`red-artifacts/`：原始4项失败。
- `green-ui.log`、`first-fix-artifacts/`：第一版36通过／6失败，文件名不代表全绿。
- `typecheck.log`、`build.log`、`final-source.json`：静态检查、最终构建和源码摘要。
- `approved-ui.log`、`approved-artifacts/`：用户批准后的12项PASS。
- `capacitor-copy.log`、`xcode-build.log`、`manifest.json`、`installed-manifest.json`：独立包构建、资源及身份核对。
- `live-before-loading.png`、`live-before-ready.png`：真实旧包异步布局。
- `live-unchanged-queue.png`：操作后仍51首、暂停，没有修改账户或队列。
- `netease-portrait-first.png`、`netease-portrait-restored.png`：新包真实网易云加载与旋转恢复。
- `qq-portrait-first.png`、`qq-portrait-ready.png`：新包真实QQ加载前后。
- `netease-landscape.png`、`netease-landscape-bottom.png`、`qq-landscape.png`：横屏显示与滚动。
- `installed-final-state.json`、`live-final-queue.png`：安装后队列内容与顺序核对、暂停状态。

如需撤回本批，只恢复 `OnlineSongLike` 原分支渲染和收藏提示的三条 CSS 规则；
不能整体还原已有其他改动的 `mobile.css` 或测试文件。需要回滚独立模拟器时，原位安装
`.mobile-test-results/live-catalog-playback/VerifiedValidation.app`；保留数据容器，不卸载App。
本批不代表物理设备、音频输出、长播、全部特效或完整设置UI验收完成。
