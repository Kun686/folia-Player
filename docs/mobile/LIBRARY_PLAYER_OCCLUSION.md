<!-- LIBRARY_PLAYER_OCCLUSION.md — scrollport occlusion regression and independent simulator verification. -->
# 曲库滚动区域与底部播放条

2026-10-15补验：用户批准两项各追加一次后，最终定向回归 **2 PASS／10.9秒**。
最新曲库、主题编辑器与会话保护修复已合并构建并原位安装到独立iPhone模拟器；个人mobile.28、服务器和iPad均未更新。
安装、真实歌单观察及状态保持证据见[合并验证记录](COMBINED_UI_VERIFICATION.md)。以下保留原失败过程。

## 缺陷与最小修正

曲库使用全屏高度的固定滚动容器，在底部留padding；底部播放条另行固定定位。
浏览器将最后一行scrollIntoView时，padding并不能阻止滚动内容进入播放条覆盖区域。
新用例复用既有搜索与原生桥fixture，在真实React／WebKit渲染中检查行底边和中心命中：
横屏首轮实际行底355px，播放条顶307px，48px被覆盖。该数据为受控布局复现，不是平台搜索结果。

`src/mobile/mobile-shell.css`仅将正常曲库滚动区域高度减去播放条的80px预留及max(10px, safe-bottom)，
底部内边距改为16px，保持相同内容空间。键盘出现且播放条隐藏时恢复完整可用高度。
不改原生播放、虚拟列表、手势／点击处理、歌曲数据或桌面布局，无新依赖。

## 当前验证状态

| 层次 | 结果 |
| --- | --- |
| 定向首次复现 | **1 FAIL／1 NOT_RUN**；失败后按max-failures停止。`red.log`／`red/` |
| 初步修正后重测 | **1 PASS／1 FAIL**；网易云通过，QQ横屏行底329px、播放条顶307px。`fixed.log`／`fixed/` |
| 失败截图分析 | QQ截图中曲库已裁在301px，播放条从307px开始，但目标行未滚到位；怀疑旋转的rAF布局尚未完成就执行scrollIntoView，不将其写成已证实的唯一原因 |
| 最终定向回归 | 增加实际scrollport高度等待；CSS使用与播放条一致的max(10px, safe-bottom)，并增加无底部安全区检查。用户追加授权后 **2 PASS／10.9秒**，`final/`；两平台受控布局，非真实搜索验收 |
| 独立键盘回归 | 现有catalog／queue安全视口用例×3视口，**6 PASS／17.7秒**。`keyboard.log`；不替代上述失败用例 |
| 类型及构建 | typecheck、移动资源及原生Release构建PASS；128应用资源、2空Cordova文件和独立签名核对通过。`typecheck.log`／`build.log`／`native-build.log`／`manifest.json` |
| 原安装包真实触摸 | 使用已安装版本和已登录网易云账号，在serve-sim镜像中一次拖动成功滚动歌单，未点歌；封面随实际行更新。`native-before-scroll.png`／`native-after-scroll.png`。仅一次手势，不是快速滚动或完整列表验收 |
| 状态与清理 | 完整原51首队列／音效JSON及已安装二进制保持；QQ《我怀念的》122.68798185941043秒暂停。`final-state.json`／`restored-player.png`；镜像页、助手和4179／3200监听已关闭，`cleanup.json` |

所有相对证据均位于`.mobile-test-results/live-list-viewport/`。
原生窗口工具此前把拖动识别为点歌，而镜像手势成功；没有据此添加自定义防误触或改动产品点击语义。
本批没有播放音频，没有真实QQ重新登录或搜索稳定性新增结论；完整UI／动效、真机和长播仍未完成。

## 候选与补验

候选`.mobile-test-results/live-list-viewport/VerifiedValidation.app`，Bundle ID `app.folia.validation.App`，
主二进制SHA256 `97e2a83324af08628296023a30ef997ab6e0a4a4963ee15405ef0c28c4d62571`。
该旧候选已由包含后续会话／主题修复的合并包取代，不能安装旧候选覆盖后续修复。
最新已安装独立包位于`.mobile-test-results/combined-ui-verification/VerifiedValidation.app`，
主二进制SHA256 `bf8510575caad59d42054fe60c2ee25dc5170aa6518d2b75750127de268e0d88`。

用户在本对话提供的AGENTS.md规定“Retry a failed command at most once”。
此前已完成复现和一次修正后重测；用户回复“两项均允许”后，追加一次最多3分钟的用例已执行并通过。
随后独立模拟器真实网易云歌单可滚动，两平台菜单、横屏及竖屏恢复已观察；原51首队列、音效及外观保持。
保留此前失败证据，不以6项键盘通过或构建成功替代定向验收；快速滚动、真机及完整UI仍待验收。

    "$HOME/.local/bin/codex-bounded" 180 -- npm run test:mobile:ui -- test/mobile-ui/library-player-occlusion.spec.ts --project=phone --output=.mobile-test-results/live-list-viewport/final

修正涉及一处CSS区域及一个回归文件；无需服务器部署。上一安装包保留于`live-song-thumbnails/VerifiedValidation.app`，
后续若需回退应原位安装，不卸载或清除账户。
