<!-- COLLECTION_QUEUE.md — original displayed collection scope enqueue on mobile. -->
# 集合范围加入播放队列

本批补齐原版集合页和歌手热门歌曲的批量入队入口，复用原 `derivePlayableTracks`、`applyQueueAddBehavior`
和播放身份规则。使用已有原生 `getState`／`editQueue` 与队列版本校验，不新增依赖、桥接协议、存储或服务器接口。

## 行为

- 本地全部歌曲、文件夹／专辑／歌手／歌单中的歌曲范围，以及在线歌单、专辑、歌手热门歌曲、每日／历史推荐、
  Navidrome 集合增加“当前范围 N 首”和“加入播放队列”。筛选／排序采用当前显示的数据；分页只加入当前已加载范围。
  入队操作不会为了凑全歌单请求剩余页面。目录资源原有的渐进加载行为保持。
- 仅显示单曲搜索结果的页面保留原单曲操作。空集合无批量入口；全部不可播放时显示 0 首并禁用；在途操作禁用按钮。
- 按原队列偏好插到下一首或队尾，保留来源与显示顺序；排除不可用歌曲、当前播放身份及重复输入。
  已在队列中的歌曲按原规则移动到指定位置；提示数量沿用原版 `affectedSongs`，即使它们已在正确位置，也报告被接受的数量。
  “当前范围”是可播放行数，所以包含重复身份时可能大于实际接受数量。
- 原生当前歌曲、进度、播放／暂停和循环状态不因入队改变；不发 `setQueue`／播放／暂停／定位命令。
  超过原生 1,000 首上限时整批拒绝，不截断或部分添加。版本冲突仅重新读取一次；位置型队列操作仍不重试。
- 操作开始就捕获所有在线来源的会话版本，在凭据持久化和原生状态读取后再次检查；等待中退出或更换账号取消旧操作。
  Navidrome 继续使用现有账号／连接作用域检查。该保护同时覆盖单曲加入入口。
- 等待中修改默认入队位置不影响已发起操作。切换集合或关闭页面后不展示旧完成提示；失败由既有宿主错误入口显示。

原版依据：`src/library/core/bindings/useCollectionActions.ts`、`useCollectionView.ts`、`useArtistView.ts`，
`src/hooks/usePlaybackQueueController.ts`、`src/utils/artistTopSongsQueue.ts`、`queueAddBehavior.ts`。
移动实现：`src/mobile/CollectionQueueActions.tsx`、`queueActions.ts`，各集合宿主只负责传入当前歌曲范围。

## 测试与交付

证据保存在 `.mobile-test-results/collection-queue/`；最终命令、结果、提交和资源散列见 `delivery.json`。
逻辑测试覆盖来源身份、重复项、接受计数、会话取消、持久化失败、队列版本重读和容量限制。
WebKit 使用现有原生／网络 fixture，运行真实 Omni、provider adapter、Library Core 和移动界面，
覆盖手机、平板和窄窗口；这些结果不代表真实平台、WKWebView 或原生后台行为验收。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| TypeScript | PASS | `typecheck-final.log` |
| 逻辑回归 | 83 文件／775 PASS | `logical.log`；移动测试及原队列、歌手热门歌曲、集合模型 |
| WebKit | 111 PASS／0 skip | `ui.log`；37 场景 × phone／ipad／ipad-narrow，含原搜索、目录、歌单、推荐、Navidrome 和偏好回归 |
| 完整本地快照复测 | 3 PASS | `ui-local-snapshot.log`；三窗口筛选／排序／旋转／触摸，不重复计为新增独立场景 |
| 移动网页构建 | PASS | `build.log`；提交后构建身份与资源存档见 `build-committed.log`、`delivery.json` |

首轮手机窗口 9 PASS，保存在 `ui-initial/`。截图发现新本地样本的 `id` 与 `sourceRef.mediaId` 不一致，
不满足原曲库 UUID 合同，触发了既有降级读取；修正样本为一致 UUID 并补断言“没有曲库错误”后，
同一本地场景在三个窗口复测通过。没有修改生产校验器或放宽断言，旧截图保留。
故意注入的接口失败日志、既有 npm 配置与受控歌词解压、Vite 大 chunk／同时静态与动态导入警告保留。

```sh
npm run typecheck
npm run test:unit -- test/unit/mobile test/unit/utils/queueAddBehavior.test.ts test/unit/artistTopSongsQueue.test.ts test/unit/library/core/collectionView.test.ts
npm run test:mobile:ui -- test/mobile-ui/collection-queue.spec.ts test/mobile-ui/collection-queue-catalogs.spec.ts test/mobile-ui/queue-preference.spec.ts test/mobile-ui/online-catalog.spec.ts test/mobile-ui/local-playlists.spec.ts test/mobile-ui/daily-recommendations.spec.ts test/mobile-ui/navidrome-library.spec.ts test/mobile-ui/search-playback.spec.ts
npm run test:mobile:ui -- test/mobile-ui/collection-queue.spec.ts --grep "local filtering"
npm run build:mobile
```

本批不改 Swift／Xcode 工程；原生 XCTest、物理设备、真实平台／服务器、系统挂起、长期功耗与完整 Automix 验收均 NOT_RUN。
个人 mobile.28、服务器、凭据、依赖锁文件和 `BUILD_RECORD.json` 不变。
回退到 `361570de2a68d277b22a9ed09c5e37a2a8c1bc2a` 后重建即可恢复前版，无数据迁移。
完整移植状态见 [PORT_STATUS.md](PORT_STATUS.md)。
