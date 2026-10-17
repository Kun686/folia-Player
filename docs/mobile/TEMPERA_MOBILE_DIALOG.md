<!-- TEMPERA_MOBILE_DIALOG.md — native-discovered safe-area overflow, fix, and acceptance boundaries. -->
# 凝彩图片窗口安全区与原生补验

2026-10-15：凝彩图片窗口的手机安全区溢出已修复，**3项WebKit、类型检查、移动／原生构建及独立iPhone模拟器补验通过**。
已合入上一批[图片删除事务修复](VISUALIZER_SINGLE_ASSETS.md)，个人 iPhone mobile.28、服务器及实际 iPad 未更新。

## 原生发现的问题与最简修复

首个候选通过系统 Choose Files 导入仓库图标后，图片卡片使窗口标题顶到状态栏／灵动岛区域。
原因是桌面弹窗的62vh列表再叠加标题、说明、底部按钮后，整体超过了手机可用高度；桌面外壳没有读取安全区。
复现截图：`.mobile-test-results/single-assets-native-20261015/native-import-header-overlap.jpg`。

复用原 ThemedDialog 和移动端安全区规则，无新依赖：

- 共享弹窗增加可选外壳类名和标题／内容／底部的样式定位属性，默认桌面行为不变。
- 仅移动CSS约束凝彩弹窗：读取四边安全区，窗口高度不超过可用区域，标题和底部操作固定，内容单独滚动。
- 图片列表取消移动端内层62vh限制，避免内外两层滚动；按钮触摸区域至少44点。
- 保留原图层设置、图片预览、草稿提交语义、动画渲染及主题颜色，没有重设计播放器。

修改入口：`src/components/shared/ThemedDialog.tsx`、`src/components/visualizer/tempera/TemperaImageLayerDialog.tsx`、
`src/mobile/mobile-settings.css`。测试为 `test/mobile-ui/tempera-dialog-viewport.spec.ts`。

## 候选身份与证据

目录：`.mobile-test-results/single-assets-native-20261015/`。

- 设备：iPhone 17 Pro／iOS 26.5 Simulator，`9213032A-657A-40CD-BD2A-A3065ACCC8EC`。
- Bundle：`app.folia.validation.App`；内嵌身份：`33GAKXJHL3.app.folia.validation.App`。
- 最终包：`layout-final/VerifiedValidation.app`，版本字段仍0.7.16／28，以资源和二进制摘要区分候选。
- 最终主二进制SHA256：`9f52f7e19bb1e4bc8cd8bc196affa1accfa94a0e4df705d9fd80daf553d14268`。
- 首个原生候选和上一批设置候选均保留，不卸载App、不清Keychain；继续使用既有validation xcconfig和锁定依赖。

| 检查 | 结果与边界 |
| --- | --- |
| 原布局手机WebKit复现 | **1 FAIL**，标题／保存超出指定安全区；`viewport-red.log`，不是存储失败 |
| 修复后安全区／旋转 | **3 PASS，16.4秒**；手机、平板及窄窗口各一项，显式模拟安全区，含图片导入和旋转后的触摸保存 |
| 最终类型／移动构建 | **PASS**；`typecheck-layout.log`、`mobile-layout-build.log` |
| 原生构建与安装 | **PASS**；最终包原位安装独立模拟器，严格签名、Mach-O内嵌身份、xcent与128个前端资源逐个核对 |
| 原生文件导入与保存 | **PASS（首个候选）**；Choose Files选取仓库AppIcon，显示预览，实际保存1张。首个候选布局FAIL，保留证据 |
| 重启／原位更新后素材恢复 | **PASS（最终候选）**；图片池预览存在，真实QQ《我不难过》的凝彩画面显示图标。全程暂停，不作为音频验收 |
| 原生竖屏安全区 | **PASS（最终候选，观察）**；标题在状态栏下方，保存按钮在窗口内；`portrait-fixed.jpg` |
| 原生横屏滚动／清空／保存 | **PASS（最终候选，触摸观察）**；列表滚动时标题与底部固定，清空后保存返回设置；`landscape-scrolled-fixed.jpg` |
| 删除持久化 | **PASS（只读核对）**；设置中的layerImages为空，IndexedDB中凝彩图片记录删除；重开App后仍不存在 |
| QQ／网易云账号保留 | **PASS（界面观察）**；账号、退出按钮和个人歌单入口仍在。不是完整接口或播放回归 |
| 原生存储失败注入 | **NOT_RUN**；回滚与重试证据来自上一批12项WebKit，不在个人或已登录原生App中注入故障 |
| 莫奈／流浪原生素材、实际iPad、真机、音频、性能 | **NOT_RUN（本批）** |

前批12项图片设置WebKit、45项存储、6项群唱等既有通过结果未重复执行。
本批新的布局测试覆盖实际发现的缺口，不把指定宽度的WebKit当作原生iPad证据。

## 状态恢复与清理

初始基线与每次安装后的队列、音效和外观值均做比对。首个安装因数据容器路径改变使辅助脚本断言失败，
随后改为比较容器实际内容，获准范围内仅重试一次通过。依赖该脚本的首次镜像启动因文件未生成而失败，
准备文件后启动成功；两次镜像均主动结束并退出0，没有留到超时。

完成App内清空后，只恢复本轮改变的 `visualizer_mode` 与 `tempera_tuning`，其余localStorage条目保持；
这是有校验的测试收尾，不作为产品自动恢复证据。重新启动后44个采集外观键匹配基线，完整50首队列、
index及276.4506575963719秒暂停位置、音效逐值保持。临时PNG在摘要核对后删除，原素材文件保留。
最终恢复正向竖屏，App保持打开；镜像页、镜像助手及测试服务已清理。
证据：`native-validation.json`、`restoration.json`、`after-relaunch.json`、`cleanup-final.json`。

QQ偶发空搜索、完整特效／设置UI、网易云30分钟真机锁屏、蓝牙／网络切换、歌词误差、长期性能及有岛真机仍待验收。
