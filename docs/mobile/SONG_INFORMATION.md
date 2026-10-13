# 原版歌曲信息复制与平台页面入口

2026-10-13。移动歌曲操作菜单补齐原 CoverTab 的复制歌曲信息与打开平台歌曲页能力；
当前播放的「更多播放选项」可展开「当前歌曲信息」查看完整歌名、歌手和专辑。
本批仅本地代码与受控验证，个人 mobile.28、物理设备、真实账号和服务器未操作。

## 复用与行为

- 从原 `CoverTab` 提取纯 `formatSongInfoText`，桌面与移动共用原格式：
  `歌名 - 歌手甲, 歌手乙 - 专辑`，有平台页面时另起一行附加页面 URL。
  空字段分隔、多歌手顺序和普通文本保持原样。桌面原点击／Ctrl+点击行为不改写。
- `mobileSongInfo` 复用原 provider 元数据规范化，平台页面通过同步 `omni.getSongPageUrl` 查询能力。
  不获取播放地址，不查询账号，不从 `providerData`、歌词缓存或音频缓存拼接分享数据。
  本地歌曲不查在线页面；没有页面能力或解析失败仍可复制元数据。
- 原版当前仅网易云实现歌曲页面，QQ 按原能力提供歌曲信息复制，**不新增或猜测 QQ 网页地址**。
  外链只接受不含用户名／密码的 HTTPS URL，拒绝相对地址、HTTP、data、javascript 等输入。
- 移动复制使用已有 `native.copyText` → `UIPasteboard`；失败显示原错误提示，可重试。
  同一复制动作不能重复提交；提示按来源身份与实际文本隔离，切歌后旧回执不能更新新歌曲界面。
  用户点击时的复制内容立即交给原生接口；迟到的是回执，不宣称可以撤回已经发生的剪贴板写入。
- 页面入口为显式触摸链接，使用 `target=_blank` 与 `rel=noopener noreferrer`。
  已核对固定 Capacitor 的 `WebViewDelegationHandler` 和空 `allowNavigation`：外部页面交给系统打开，
  `FoliaViewController` 不覆盖此策略。没有新增原生方法或 Browser／Share 依赖。
- 歌曲列表、搜索、在线目录和混合队列共用 `SongList` 入口；复制所选歌曲不会选择、播放或重新排列它。
  当前播放信息默认折叠；保留全屏歌词、玻璃控制器、背景动画及现有工具菜单布局。
  链接／按钮至少44px，长文字换行，新增操作文案包含中／英／印尼文。

## 验证

证据目录：`.mobile-test-results/song-info/`；基线 `5b213fe46e18932885ee1c86d0dd2e7d4e2ed84d`。
`source.json` 标识源码、固定框架相关源码及个人包记录，`*-command.json` 保存确切运行参数。

| 项目 | 结果 | 证据与范围 |
|---|---|---|
| TypeScript | PASS | `typecheck.log` |
| 逻辑与 provider | 219 PASS / 4文件 | 公共格式、三来源能力、错误／非法 URL、元数据隐私边界，原 QQ／网易云适配器回归 |
| 新 WebKit 场景 | 12 PASS | `ui.log`：phone、ipad、ipad-narrow 各4项 |
| 原搜索／目录 WebKit 回归 | 36 PASS | `regression.log`：两平台目录、分页、错误、队列身份与迟到请求 |
| 原生容器／真机／真实平台页面 | NOT_RUN | 本批没有安装或运行原生包 |

共48个不同 WebKit 场景。新场景验证复制失败与恢复、多来源同 ID、快速重复点击、切歌后的迟到回执、
队列中的非当前歌曲复制、长文本／HTML字符作为纯文本展示、旋转无横向溢出和44px操作区域。
已检查手机横屏及 iPad 竖屏截图。新入口没有额外播放命令，也没有改变队列内容。

官方链接测试由 Playwright 拦截并返回固定页面，检查独立上下文、原 App 页面保留、无来源 referrer，
以及该受控请求无认证头、Cookie或私有占位值。**未访问真实官方页面，未证明 iOS 系统浏览器／官方 App 的跳转结果**；
系统浏览器自身已有账号 Cookie 属于其独立会话，不应把本测试解释为清除或禁止这些 Cookie。
剪贴板为原生桥 fixture；系统 `UIPasteboard` 行为只做当前源码核对，不虚构本批原生测试结果。
QQ 歌词受控样本仍出现既有 `DecompressionStream` 警告后由原路径解析，界面测试通过。

```sh
npm run typecheck
npm run test:unit -- test/unit/utils/songMetadata.test.ts test/unit/mobile/songInfo.test.ts test/unit/onlineMusic/neteaseProvider.test.ts test/unit/onlineMusic/qqProvider.test.ts
npm run test:mobile:ui -- song-info.spec.ts search-playback.spec.ts online-catalog.spec.ts
```

实际命令使用有界 runner，保存 PID 和日志，60秒无输出终止进程组。
最终提交 CI 执行 vendor 校验、TypeScript、移动逻辑及前端构建，状态见本地 `ci.json`。
`cleanup.json` 与 `completion.json` 记录临时服务清理及提交核对。

## 交付边界与回退

无新增依赖、凭据存储、数据迁移或服务器接口；撤销本批提交即可回退。
个人 `BUILD_RECORD.json` SHA256 保持
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。
原生升级／系统剪贴板／实际官方页面跳转仍待验收；完整 Automix 与整体移植目标尚未完成。
