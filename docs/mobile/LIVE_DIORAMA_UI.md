<!-- LIVE_DIORAMA_UI.md — bounded actual-account Diorama observations; no PCM or memory acceptance. -->
# 两平台真实歌曲的镜台与设置恢复

2026-10-14。直接操作已登录的独立 iPhone 模拟器，补充此前尚未完成的真实歌曲镜台检查。
网易云《莫愁乡》和 QQ《我怀念的》均进入原版镜台舞台，实际播放时间和歌词推进，
设置打开／关闭后恢复；网易云播放中检查了横屏及返回正常竖屏。
这是短时手动界面证据，不代表音频连续性、内存泄漏、全部模式或物理设备验收通过。

## 环境与复用

- iPhone 17 Pro / iOS 26.5 Simulator，`9213032A-657A-40CD-BD2A-A3065ACCC8EC`。
- `app.folia.validation.App`，沿用歌曲菜单修复包，主进程42634；本批没有构建、安装或更换前端资源。
- 主二进制SHA-256仍为 `77e16508514b817670a3e574c3dabd80968d519205e9bece5f2611e9285eacd0`。
- 复用原队列、真实平台会话、原版Diorama、现有设置页、serve-sim 0.1.48及simctl录屏。
  没有模拟歌曲、播放URL、平台响应或注入fixture；没有新增依赖或修改生产代码。
- 开始前只读保存当前音效、动画模式、队列摘要与位置，见 `baseline.json`。
  本批仅通过界面切换模式、播放、旋转和选择原队列歌曲，没有修改平台收藏或队列内容。

## 实际操作与证据

本地目录：`.mobile-test-results/live-diorama-review/`。

| 场景 | 已观察结果 | 证据 |
| --- | --- | --- |
| 明确选择镜台 | 原生选择器显示“镜台”，关闭后完成3D舞台加载 | `mode-selected.png`、`netease-paused-before.png` |
| 网易云播放与横屏 | 《莫愁乡》从19.7秒继续，镜头／歌词推进，横屏控制器可唤回 | `netease-diorama.mp4`、`netease-landscape-playing.png` |
| 网易云横屏设置恢复 | 设置中保持镜台选项，关闭后回到当前进度的舞台 | `netease-settings-landscape.png`；关闭时界面显示约2:07 |
| 自然跨曲与返回竖屏 | 未调用下一首，随后出现《记忆回溯》，原生只读记录为网易云、index1／25.6秒；正常竖屏恢复 | `netease-portrait-return.png`；操作记录中的原生状态输出 |
| QQ真实原队列歌曲 | 选择已有《我怀念的》，原生状态为QQ、index4，位置10.304秒 | `qq-selected.json`、`qq-portrait-playing.png` |
| QQ设置恢复 | 关闭设置后镜台歌词继续推进，原生位置102.56秒，队列与音效未变 | `qq-settings-portrait.png`、`qq-stage-restored.png`、`qq-after-settings.json` |
| 收尾 | 恢复绘光，QQ《我怀念的》暂停122.688秒；51首队列内容／顺序及音效设置与本轮基线相同 | `lumiere-restored.png`、`final-state.json`、`final-paused-player.jpg` |

录像通过系统simctl在12秒墙钟窗口内录制，再发送SIGINT完成文件，退出码0；
没有音频采样，不能把录像或进度推进当作PCM／听感证明。
队列摘要使用 `json.dumps(queue, sort_keys=True, ensure_ascii=False)`，与前批一致为
`1f998b3011006ac3da86fe822a7e5fbd3897fb38fd48f029ed13f44fdbd4bbae`。
本次改变了当前歌曲与播放位置；保留的是队列内容和顺序，并非当前曲目完全不变。

## 操作偏差与未覆盖项

- 镜像旋转按钮按90度循环，第二次进入倒置竖屏时App仍保持允许的横屏方向；继续转到正常竖屏后恢复。
  快速连续两次点击仅送达一次，按稳定画面补足方向。未将中间旋转动画或镜像外框作为App布局失败。
- 原队列滚动存在惯性，改为小幅拖动并等待画面稳定后选中QQ歌曲。镜像文字输入／粘贴及原生模拟器粘贴未送达，
  未据此宣称App搜索失败；最后通过已有列表触摸选择，原生来源已核对为QQ。
- 本轮过程中网易云队列继续自然播放，随后界面出现《玻璃》《陪我吃饭》；没有据此追加连续跨曲次数验收。
- 首次内存采样准备因同一模拟器存在多组WebContent／GPU进程而停止，未能确定目标归属；
  没有输出不确定的内存数值，也没有重跑此前失败的LLDB或后台测试。
- 镜像两段分别到600秒、300秒上限退出；均确认原会话终止，随后清理指定设备助手和临时页面。
  第二段用于完成QQ观察及恢复；不是后台测试重试。最终原生截图确认已暂停。

**本批NOT_RUN：**PCM／听感、后台解析与WebView挂起、地址失效恢复、真机／iPad真实账号、
30分钟锁屏、耳机／蓝牙／网络切换、歌词≤150ms、内存／GPU资源归属与长期稳定性、全部动画及完整UI。
先前iPad音频断言失败和镜台资源增长的结论没有被本次改写。
后台额外执行仍待用户单独确认。个人mobile.28、服务器、平台歌单均未更新。
