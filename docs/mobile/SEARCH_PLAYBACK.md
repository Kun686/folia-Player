# 在线搜索与原版点播行为对齐

## 修复内容与复用

原版 `usePlaybackQueueController.handleSearchResultPlay` 经 `handleQueueAddAndPlay` 点播：
按平台与歌曲身份查找现有队列，已有则选择，新歌只追加一首，再开始播放。
此前移动入口把搜索列表与歌单共用 `setQueue`，点播任一搜索结果会用整页结果覆盖用户队列。
当前开发源码恢复原版行为；歌单／专辑／推荐列表仍按其集合播放。

`catalogSession.searchQuery` 记录实际提交的搜索来源，不由尚未提交的输入框文字判断。
分页保留搜索来源，打开歌单或退出登录后清除。QQ 与网易云相同数字 ID 仍是不同歌曲。
队列工具复用 `getPlaybackSongKey`、既有 `commit` 和原生 `getState`／`editQueue`／`selectQueue`，
保留现有队列顺序及重复项，点播已有身份选择首次出现的位置，不将它挪到队尾。
现有添加偏好 helper 会移动已有歌曲、跳过脱离队列的当前歌曲，语义不同，因此这里只作原版所需的追加。

原生桥每次编辑／选择都校验队列版本。选曲不自动重试；期间远程操作改变队列时提示重新选择。
如果追加已完成而选择遭遇版本变化，新歌保留在队尾，但不会强行切走后来选择的歌曲。
账号或平台变化使已捕获的会话失效，在读取状态、追加后停止后续选择。
仍遵守原生 1,000 首上限；满队列可点播已有歌曲，不能继续追加。

搜索结果使用原 `isSongUnavailable`／`getSongUnavailableLabel`：保留平台不可播放说明，
禁用歌曲行和触摸菜单的播放／入队操作，详情入口保留。
没有改变播放器、动画、主题、歌单整队播放或队列编辑的现有规则。

## 搜索失败与空结果

网易云 adapter 复用已有 `requireCatalogResponse` 检查业务状态。
鉴权失败、服务错误、无效列表和总数不再被当作成功空列表；没有合法响应码也不能算成功。
真实空数组，或明确 `songCount: 0` 且省略歌曲数组的成功结果，仍可正常显示为空。
没有总数的有效页面采用本次 offset 加实际条数，保留既有停止分页行为。

原 `cloudSearch` 只对数组执行歌曲／权限归一化，保留无效数据形状供 adapter 拒绝。
权限合并、歌曲来源与查询编码沿用原实现。分页失败保留已读取结果及原游标，重试不跳页。
移动界面在失败／加载时不同时显示空列表提示；已完成的空搜索显示「暂无结果」。

没有新生产依赖、新原生 API、新后端路由、存储迁移或服务器部署。
个人 App 仍未更新；回退本批源码及 Web 资源即可，无需清理队列或凭据。

## 验证记录

证据目录 `.mobile-test-results/search-playback/`，源码基线 `6c5c5fe0e9c730b372746b16ed3ddf99a892b486`。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 类型检查 | PASS，最终源码 | `typecheck-final.log` |
| 搜索／队列／provider 专项 | 255 PASS | `unit-final.log` |
| 移动、provider、原搜索、歌词匹配、元数据回归 | 1,615 PASS，1 SKIPPED；包含上述专项 | `unit-regression-final.log` |
| 手机／iPad／窄窗口搜索 WebKit | 18 PASS | `ui.log`、`ui/` |
| 原目录／基础播放器／推荐歌单 WebKit | 96 PASS；与本批新增用例合计 114 项 | `ui-regression.log` |
| 生产 Web 构建 | PASS，退出码 0 | `build.log`、`build-exit.txt` |
| 本批真实 QQ／网易云、原生容器、真机、部署、个人包更新 | NOT_RUN | 不以受控样本和旧版本用户反馈替代 |

逻辑专项最初两项失败来自测试样本：原生快照错误复用页面歌曲对象引用，以及一次性 Response
被匿名预登录和搜索重复读取。改为独立快照、明确的测试会话与每次独立响应后，255 项通过；
原失败保留在 `unit.log`。

扩展回归最初 9 项失败：8 项原成功样本没有响应状态码，补为 `code: 200` 后保留原断言；
另 1 项旧架构断言仍要求弹窗直接请求歌词，但它已委托 `useLocalLyricMatch`。
对比基线确认弹窗、hook 与该旧测试均未被本批修改后，测试改为同时检查弹窗委托和 hook 使用共同入口。
源码摘要与判断见 `architecture-baseline.json`；没有为了通过检查修改歌词业务或放宽失败判定。
原失败日志为 `unit-regression.log`。唯一跳过的是环境开关控制的真实三平台歌词偏移审计，未计为通过。

界面验证覆盖跨平台同 ID、仅追加一首、重复点播不重排、搜索分页、输入框未提交文字、
恢复歌单整队播放、首屏与下一页失败重试、真实空结构、不可播放触摸入口、原生版本冲突和退出时取消。
WebKit 运行真实 Omni／provider／状态逻辑，但网络与原生桥为受控响应，不证明物理设备输出。
基础 visualizer 注册表回归同时打印了 Pixi 滤镜、THREE.Clock 弃用及
`useInsertionEffect must not schedule updates` 诊断；本批没有修改这些渲染路径，
用例通过不能当作这些动画诊断已经解决。故障注入用例的请求失败输出也保留在原日志中。

生产 Web 资源 123 个、12,679,173 字节，比基线增加 1,122 字节，不能等同于 IPA 或安装体积。
构建保留 chunk-size、静态／动态混合导入与 npm 配置警告，无构建错误。
`web-resources.json` 保存全部产物摘要，`source-final.json` 保存本批变更源码及文档摘要；
提交前构建的 `build-identity.json` 记录的是基线 SHA，最终源码以摘要与提交内容比对为准。
沿用 `mobile.28` 配置不表示个人安装包已经更新。准确提交的 CI 与完整性检查见后续
`ci.json`、`completion.json`；这些记录不替代真实平台或原生容器验收。

```sh
npm run typecheck
npm run build:mobile
npm run test:unit -- test/unit/mobile test/unit/onlineMusic test/unit/search test/unit/lyrics test/unit/localLibrary/onlineMetadataSearchService.test.ts test/unit/services/neteaseSearchResponse.test.ts
npm run test:mobile:ui -- test/mobile-ui/search-playback.spec.ts --max-failures=1 --output .mobile-test-results/search-playback/ui
npm run test:mobile:ui -- test/mobile-ui/catalog.spec.ts test/mobile-ui/mobile.spec.ts test/mobile-ui/online-catalog.spec.ts test/mobile-ui/recommended-playlists.spec.ts --max-failures=1 --output .mobile-test-results/search-playback/ui-regression
```

本轮不操作物理设备。完整移植、Automix 联合负载与长期真机验收仍未完成。
