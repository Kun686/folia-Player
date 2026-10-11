# 本地专辑与歌手浏览

2026-10-12，移动曲库补齐「全部歌曲／专辑／艺术家」浏览。专辑或歌手内支持搜索、播放、加入队列与原有歌曲操作。
播放采用当前显示的歌曲及顺序，返回时保留分类；切换分类或打开集合时清空旧搜索。

## 复用与边界

- `src/mobile/localLibraryGroups.ts` 将原生曲库的当前显示信息临时投影到原版
  `buildLocalHomeGroups`，复用 `localLibraryNames` 的 Unicode 归一化、名称清理与联合歌手拆分，
  以及原版专辑自然排序。分组后返回原 `SongResult` 对象，原生 `mediaId` 不变。
- 原生文件、匹配记录仍是数据源；投影不持久化，不复制文件存储、匹配或播放逻辑。
  浏览 ID 按归一化名称生成，只适合只读导航，不冒充可编辑的稳定曲库实体。
- `useLocalBrowser` 每次按新曲库解析已选分组；歌曲改名、修改专辑或移除后立即更新。
  分组消失会清除选择；后来出现同名分组不会自行打开。
- `LocalCollections` 复用已安装的 `react-window`、`lucide-react`、i18n 和 `useMobileCover`，
  仅为可见行加载封面。播放器沿用已接受的全屏样式；没有新增生产依赖、Swift 或服务端改动。
- 当前原生歌曲不提供 track/disc 序号，专辑按原排序函数的标题／文件名后备规则排列。
  稳定实体编辑、合并／拆分、本地歌单及 M3U 尚未实现，不能称为完整本地曲库对齐。

## 同批修复：切歌时取消旧歌词导入

既有 `local-import.spec.ts` 回归复现：文件选择器返回前收到原生切歌事件，React 尚未提交新渲染，
旧的渲染时 guard 仍为真，导入次数从预期 1 变为 2。

`usePlayback` 在接收有效原生歌曲变化时立即递增操作代数，导入在打开选择器时捕获 guard；
选择、解码和解析后沿用原导入函数的检查。工具栏与歌词面板均接入，切走再切回也取消旧操作。
预期的 `AbortError` 不显示为保存失败；真实存储错误仍可见、可重试。
原生文件编辑 token 保留；本修复没有新增“当前歌曲检查与磁盘保存”之间的原生原子事务。

## 验证与回退

- 逻辑：`npm run test:unit -- test/unit/mobile/localLibraryGroups.test.ts test/unit/library/core/localHomeModel.test.ts`；
  7 项新分组加 10 项原版模型测试通过。
- WebKit：专辑与联合歌手、分组队列顺序、搜索、实时元数据更新／移除、同名分组再出现、400 个长名称分组虚拟化，
  phone／ipad／ipad-narrow 共 9 项通过；与本地匹配、歌词导入、队列、播放和原界面合跑 78 项通过。
- 加强取消测试将切歌、可选切回、文件选择完成放在同一个 JS task，覆盖工具栏和歌词面板两个入口。
  首次发现切回同一首时取消被误报为保存错误，修正后 3 视口共 15 项专项与 TypeScript 通过。
  15 项包含此前导入回归，不与 78 项简单相加。
- 自动界面测试使用受控 bridge 数据，不代表真实平台或物理 iPad 验收。
- 证据位于 `.mobile-test-results/local-collections-*` 与 `local-import-same-task-*`；
  最终安装包、准确源码、实际容器和设备回读见 [VALIDATION.md](VALIDATION.md)。
- 没有存储格式迁移。回退使用保留的 mobile.23 原位覆盖，不能卸载个人 App。

物理 iPhone／iPad 新分类入口、真实大曲库耗时与内存仍为 NOT_RUN。
