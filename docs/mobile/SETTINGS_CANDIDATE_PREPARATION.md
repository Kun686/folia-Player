<!-- SETTINGS_CANDIDATE_PREPARATION.md — native candidate preflight failures and bounded next action. -->
# 设置候选包与原生补验

2026-10-15：图片存储45项、群唱WebKit六项，以及通用／字幕重置的27项单测和三项WebKit均通过。
移动Web、Capacitor复制、Xcode Release构建通过，已原位更新独立iPhone模拟器。
实际通用／字幕默认操作与持久化、群唱原生素材导入／选择／重启恢复／清空均PASS。
个人iPhone mobile.28、服务器及实际iPad未更新；本批没有播放音频。

## 候选与验收结果

- iPhone 17 Pro／iOS 26.5，UDID `9213032A-657A-40CD-BD2A-A3065ACCC8EC`。
- Bundle `app.folia.validation.App`，内嵌身份 `33GAKXJHL3.app.folia.validation.App`。
- 版本字段仍0.7.16／28，以内容摘要区分：主二进制SHA256为
  `e30c76c705d7e039ce63406aa73b3e50751f86f0cc0d4cdf228fc5e1d79cd0bd`。
- 证据与候选位于 `.mobile-test-results/settings-candidate-20261015/`。
- 回退包 `.mobile-test-results/visual-reset/VerifiedValidation.app` 保留，未卸载App或清Keychain。

复用现有validation xcconfig和verify-package流程，没有新增或升级生产依赖。
安装前后严格签名、Bundle ID、Mach-O内嵌权限和Xcode xcent核对通过；
128个前端资源在dist、Capacitor目录、安装包逐个SHA256一致，仅额外2个空Cordova文件。
锁文件记录在manifest，构建禁用自动包解析，未使用CODE_SIGNING_ALLOWED=NO。

| 项目 | 结果与边界 |
| --- | --- |
| QQ／网易云账号保留 | PASS（界面）：账号、退出按钮和个人歌单入口出现，不代替完整接口／播放回归 |
| 通用默认 | PASS：触摸调至字号130%、透明度60%，点击默认恢复100%；只读确认全部通用默认值，字幕及其他采集设置不变 |
| 字幕默认 | PASS：关闭背景、透明度调至30%，点击默认恢复背景和60%；全部字幕默认值正确，通用及其他采集设置不变 |
| 设置重启 | PASS：停止重开App，两组默认值及素材来源选择保持 |
| 群唱头像／表情包 | PASS：通过系统Choose Files分别导入仓库图标、选择自定义，重启后预览及真实歌曲歌词画面恢复 |
| 素材清空 | PASS：App内分别清空，预览消失，选择／清空禁用并回退内置；只读确认两条IndexedDB记录删除，重开仍不存在 |
| 队列与音效 | PASS（保持性）：完整50首队列、index 2、276.4506575963719秒暂停位置、音效与基线逐值相同 |
| 本批横屏／实际iPad／真机 | NOT_RUN：原生操作仅iPhone模拟器竖屏，三窗口及旋转证据来自此前WebKit |
| 本批音频／长播／性能 | NOT_RUN：真实QQ《我不难过》全程暂停；歌词渲染不是音频验收 |

自动45＋6及27＋3项已经通过，本次没有重复执行。WebKit为空队列，原生界面沿用真实歌曲。
证据：manifest／installed-manifest、native-build.log、common-reset.json、typography-reset-values.json、
restart-state.json、restoration.json、after-relaunch.json；截图包括common-reset.png、subtitle-reset.png、
both-assets-after-restart.png、assets-rendered-after-restart.png、both-assets-cleared.png、final-app.png。

App清空临时素材后，停止App，只恢复本轮改变的外观键；事务前核对当前值属于本轮测试，其他localStorage条目不变。
重开后44个采集外观键恢复基线，两条素材记录仍不存在，临时PNG在摘要核对后删除；未写队列、音效或凭据。
这是测试收尾，不作为产品自动恢复证据。旧包不能显示version2素材，实际回退前需保留原素材。

## 辅助快照最终结论

用户追加一次许可后，第三次执行609d55仍报No installed entitlements；该许可已用完，prepare-candidate.py已弃用且未重跑。
只读诊断确认模拟器身份在Mach-O的__TEXT.__entitlements，外层adhoc签名没有对应权限输出；
安装包与保留包二进制／签名相同，身份正确。之后复用既有构建核对流程并精确读取内嵌plist，通过后才安装。
preflight-attempts.json与signature-diagnosis.json保留三次失败，不改写成PASS。
两段镜像各到600秒上限退出124，最后有效画面分别为导入成功及清空成功，App不受影响；没有重跑失败快照。
最终状态用原生截图和只读核对确认，镜像页关闭，进程清理见cleanup-final.json。

QQ偶发空搜索、完整特效／设置UI、网易云30分钟锁屏、蓝牙／网络切换、150ms歌词误差、长期性能及有岛真机仍待验收。

以下保留辅助脚本失败时的历史准备记录，待许可／未构建描述不覆盖上方最终结果。

## 构建前快照失败

先读取已安装独立App的身份、签名权限和资源摘要，目的是使之后的候选可核对、可原位回退。
没有读取Keychain、账号凭据或App数据目录，也没有连接真实平台。

1. 初次脚本按子串查找`xcodebuild`进程，误把既有`npm exec xcodebuildmcp@latest mcp`服务认作编译器。
   只读进程核对确认没有真正的xcodebuild／swift-frontend编译，已改为精确可执行文件名判断。
2. 该次修正后的重试退出于`plistlib.InvalidFileException`，发生在解析codesign权限输出时。
   本机`man codesign`明确说明默认输出为abstract representation；解析plist应使用
   `codesign --display --entitlements - --xml <app>`，而非假定默认输出为XML。

上述属于辅助脚本失败，不是App测试失败。没有留下baseline、权限或候选包文件，未停止既有工具服务。
按用户在本对话给定的`Retry a failed command at most once`规则，不执行第三次，先请求追加一次。

## 历史准备的动作（已弃用）

脚本：`.mobile-test-results/settings-candidate-20261015/prepare-candidate.py`。
仅读取已安装`app.folia.validation.App`、源码和dist摘要，在证据目录写快照；无安装、无远程请求、无内部重试。
显式请求XML、检查非空和原应用身份，所有读取与校验完成后才写输出；已存在快照则拒绝覆盖。

拟获准后执行一次：

```sh
"$HOME/.local/bin/codex-bounded" 60 -- python3 \
  .mobile-test-results/settings-candidate-20261015/prepare-candidate.py
```

本次已完成Python AST语法检查，**脚本执行NOT_RUN**。待快照通过后按既有授权继续独立候选的Capacitor复制、
限时Xcode编译、签名／资源核对及实际模拟器验收；个人iPhone保持mobile.28，实际iPad暂缓。
原已安装独立包仍由`.mobile-test-results/visual-reset/VerifiedValidation.app`及其安装回读记录识别。
