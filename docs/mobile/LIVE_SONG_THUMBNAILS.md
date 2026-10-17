<!-- LIVE_SONG_THUMBNAILS.md — bounded real-account cover presentation checks, not search stability or device acceptance. -->
# 两平台歌曲缩略图

2026-10-15：在已登录独立iPhone模拟器补齐QQ／网易云列表和底部播放条的真实封面。
此前`SongList`固定绘制音符，根本没有图片请求；这不是已修复的原生大图下载问题再次发生。

## 最小改动与复用

- `src/mobile/SongThumbnail.tsx`复用`getSizedCoverUrl`：40 CSS像素按3倍分辨率请求120px，QQ由已有规则取300px档，网易云取120px。
- 使用标准`img`的lazy／async加载与WebKit HTTP缓存；虚拟列表只挂载可见及邻近行。不增加原生封面任务，避免争用现有4任务上限。
- 图片为平台元数据中的公开CDN封面，不带网关认证头，关闭Referer。失败回到音符；URL变化重新建立图片状态。
- `SongList.tsx`与`MobileApp.tsx`复用组件，`mobile-shell.css`沿用40px圆角容器并裁切封面。本地曲目编号保持原样。
- 不新增依赖、不改平台协议、队列逻辑、原生播放、歌词或动效。浏览器HTTP缓存不等于承诺离线封面可用。

## 证据与边界

相对证据位于`.mobile-test-results/live-song-thumbnails/`。

| 项目 | 实际结果 |
| --- | --- |
| 类型检查 | 首次发现当前歌曲可为null；组件补齐可空输入后单次重跑PASS。`typecheck.log`／`typecheck-fixed.log` |
| 已有封面URL逻辑 | 19 PASS，`unit.log`；是受控逻辑测试，不是真实平台结果 |
| 已有WebKit旋转布局回归 | 手机深／浅2 PASS，另外4项由原用例跳过；`ui.log`。不计为平板验收 |
| 构建与安装 | 移动及原生Release构建PASS，独立签名、128应用资源和2空Cordova文件一致。`build.log`／`native-build.log`／两份manifest |
| 网易云真实歌单 | 50首加载；《莫愁乡》《记忆回溯》《玻璃》可见封面，底部原QQ歌曲封面显示。`netease-library.png` |
| QQ真实搜索 | 本批为封面检查执行1次Power回车，50首；G-DRAGON与Little Mix等结果封面可见。`qq-search-power.png`；不计为搜索稳定性修复 |
| 真实横竖屏 | 两平台首行封面、播放条及菜单按钮可见，转回正常竖屏；`netease-landscape.png`／`qq-search-landscape.png`及工具截图。完整长列表触摸滚动没有通过本批验收 |
| 状态恢复 | 原51首队列／音效完整JSON相等；QQ《我怀念的》122.68798185941043秒暂停，网易云曲库选择恢复。`app-final.json`／`restored-netease.png`／`restored-player.png` |
| 清理 | 测试端口4179无监听，无新留存测试／构建／SSH助手。`cleanup.json` |

模拟器的横屏滚动尝试被识别成点歌，《莫愁乡》实际播放，队列换为50首歌单。
已暂停；这次只观察到真实歌词／绘光推进，没有PCM、听感、连续播放或滚动PASS声明。
`interaction-state.json`保存变更状态。关闭独立App后，仅通过模拟器defaults把`folia.queue`恢复为本批保存的原值；
不改会话和音效。重开后核对完整队列／音效JSON及实际2:02暂停界面。不是对真实搜索或封面响应的注入。

独立Bundle ID仍为`app.folia.validation.App`，模拟器`9213032A-657A-40CD-BD2A-A3065ACCC8EC`。
新二进制SHA256为`4fd81f10da6d964268fcc5832d78f04cc95a6f3449f935b0ad8aa2f0cc8d9f17`。
个人iPhone仍mobile.28，服务器和iPad本批未更新。QQ偶发空搜索仍未解决。

## 仍待验收与回退

真实快速滚动／图片失败／离线表现、完整UI／设置／特效、真机和iPad、长播、歌词计时及长期性能仍未完成。
本批只改善两平台歌曲封面呈现，不是完整移动版交付或发布。

上一独立包为`.mobile-test-results/live-motion-settings/VerifiedValidation.app`，摘要`b7b39a6cf9d0efe5eb437558faf1cb31879816e1cc5c0fc5af9eebc0c4d81dee`；
如需回退，原位安装该包，保留数据与账号，不卸载／重置。
