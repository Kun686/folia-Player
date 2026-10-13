<!-- QUEUE_SEARCH.md — original indexed queue search exposed through mobile touch controls. -->
# 移动播放队列搜索与批量操作

本批补齐原版命令面板已有的队列搜索、匹配项下一首播放／移到队尾／移除。复用 `buildQueueSearchIndex`、
`evaluateQueueSearch`、`formatQueueQuery` 和 `applyQueueBatchOperation`，没有新增生产依赖或更改桌面搜索算法。
范围仅为移动队列入口；个人 mobile.28 未更新，未操作物理设备、真实账户或服务器。

## 行为

- 队列页搜索留在队列内，按原索引匹配歌曲、歌手、专辑、别名等字段，保留原排名；歌手／专辑下拉范围复用原 facet 语法，自动处理空格和引号。
  “全部”范围仍接受原搜索语法；输入 `--remove` 等标志或按回车不执行写入，实际操作由可触摸按钮发起。
- 匹配列表继续使用原虚拟歌曲列表和歌曲操作菜单；播放、下一首、移到队尾和单行移除都映射回原队列位置。
  从播放器返回音乐库后保留本次队列筛选；离开队列页后重新进入会重置筛选。歌词、动画、全屏播放器与控制器样式不变。
- 有实际筛选时显示匹配数量与批量入口。批量跳过正在播放的那一次出现，其他重复歌曲保留；移动顺序取原队列顺序，不取搜索排名。
  移除匹配项需确认，取消不写入；没有可操作项时禁用按钮。原单行移除仍可使当前歌曲脱离队列继续播放。
- 批量更改使用既有 `editQueue` 与 `queueRevision` 条件提交；原生队列或当前播放项已变化时拒绝旧操作，不按新队列自动重试。
  仅时间快照不会清空查询或关闭歌曲菜单；队列更换时关闭旧菜单，避免继续使用过时的行位置。
- 已脱离队列的播放保持 `index = -1`，即使队列内有相同歌曲对象／身份，批量移动也不会重新绑定当前歌曲。
  不额外发播放、暂停、定位或替换整个播放队列的命令。

## 验证与边界

证据目录：`.mobile-test-results/queue-search/`；`delivery.json` 记录源码／资源散列、提交、CI、命令和范围。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| TypeScript | PASS | `typecheck-final.log` |
| 逻辑回归 | 83 文件／769 PASS | `logical.log`；全部移动单测及原队列查询、索引、批量和加入规则 |
| WebKit 界面 | 72 PASS／0 skip | `ui.log`、`ui/`；phone、ipad、ipad-narrow 各 24 项 |
| 队列新增场景 | 上述 72 项中的 21 项 | 7 项 × 3 窗口，含排名／原位置映射、重复项、引号 facet、确认取消、过期队列拒绝、脱离队列与旋转 |
| 既有界面回归 | 上述 72 项中的 51 项 | 搜索播放、队列加入偏好、本地歌单、Navidrome 编辑与收藏 |
| 移动网页资源构建 | PASS | `build.log`；Safari 17 目标，原生 JS 资源同时生成 |
| 新原生构建／XCTest | 本批 NOT_RUN | 未更改 Swift、原生桥接协议或 Xcode 工程；既有队列原生测试证据见前批记录，不能算本批执行 |
| 真机／系统键盘／真实平台／长时后台 | NOT_RUN | WebKit 使用受控原生桥接与 API 回复，不代表安装、声音输出、iOS 键盘或系统挂起验收 |

旋转覆盖 320×568、390×844、844×390、834×1194、1194×834、390×600、600×834。
检查控件至少 44px 高、列表可达、无容器横向溢出，并在旋转后实际轻触批量按钮；保留截图。
首轮手机界面为 6 PASS／1 FAIL：WebKit 原生下拉框未遵守通用 `min-height`，实测仅 23px。
局部取消该下拉框的原生外观、保留原生选择语义并加现有图标后，相同场景及全部相关回归通过；失败截图保存在 `ui-initial-failure/`。
初次新增单测有 3 项参数表形状错误（Vitest 展开数组），改为命名参数对象后通过；未放宽断言。
既有 npm 配置、Vite 大 chunk 和受控歌词解压警告保留，未通过隐藏日志获得 PASS。

```sh
npm run typecheck
npm run test:unit -- test/unit/mobile test/unit/command-palette/queueSearch.test.ts test/unit/command-palette/queueQuery.test.ts test/unit/utils/queueBatchOperations.test.ts test/unit/utils/queueAddBehavior.test.ts
npm run test:mobile:ui -- test/mobile-ui/queue-search.spec.ts test/mobile-ui/queue-preference.spec.ts test/mobile-ui/search-playback.spec.ts test/mobile-ui/local-playlists.spec.ts test/mobile-ui/navidrome-edits.spec.ts --output=.mobile-test-results/queue-search/ui
npm run build:mobile
```

## 交付与回退

这是开发源码和网页构建验证，不是个人安装包更新。`BUILD_RECORD.json`、原生版本、锁文件和依赖不变。
回退本批提交后重建网页资源，即恢复前一批 `12e0fda360b1fa8ccdd06587a0acd1402d375c8b` 的队列入口；无持久化结构迁移。
完整移植仍未验收完成；完整 Automix 的真机热保护、后台与长期稳定性继续等待设备条件恢复。
