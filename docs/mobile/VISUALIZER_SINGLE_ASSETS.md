<!-- VISUALIZER_SINGLE_ASSETS.md — shared image settings coverage and transactional pool deletion. -->
# 莫奈、流浪与凝彩素材设置补验

2026-10-15后续：[莫奈肖像／莫奈与漫游背景原生补验](MONET_NATIVE_ASSETS.md)已完成导入、重启恢复、共用素材清空及状态恢复。
下文原生NOT_RUN是最初WebKit批次的边界；实际iPad、真机、音频和性能未新增验收。

后续进展：[凝彩原生补验与安全区修复](TEMPERA_MOBILE_DIALOG.md)已完成并安装独立iPhone模拟器，
含素材恢复／渲染、横竖屏、滚动及清空。下文“未安装”描述本文件最初12项自动检查完成时的状态，保留其证据边界。

2026-10-15：**12项 WebKit、类型检查和移动构建 PASS**。本次没有原生构建或安装，
独立 iPhone 模拟器仍为[上一批设置候选](SETTINGS_CANDIDATE_PREPARATION.md)，个人 mobile.28、服务器及实际 iPad 未更新。

## 已确认与修复

上一批共享图片存储补丁也影响莫奈肖像、莫奈／流浪背景和凝彩图片池，因此补查这些现有入口。
复用原文件选择控件、素材服务、严格 cache repository 和已安装的 Dexie／Playwright；没有新依赖。

凝彩的原 `commit` 先关闭窗口并提交设置，再并发删除图片，逐项忽略删除错误。
手机 WebKit 复现了清空失败后没有失败提示；其余三条单图路径通过。
原失败用例停在提示断言，后续缓存和设置断言未执行，不能把它们记为原实现已测结果。

修复范围：

- `temperaLayerImages.ts` 的批量清除复用 `removeCacheEntries`，在现有数据库事务中删除，任一失败全部回滚。
- `TemperaImageLayerControls.tsx` 等待清除成功后才提交草稿及关闭窗口；失败保留原设置、素材及待保存草稿，允许重试。
- 保存期间阻止重复提交及编辑，窗口内显示明确错误；增加三语言“正在保存”状态。
- 沿用原来“关闭窗口一次提交草稿”的语义，不增加滑块每帧持久化，不改动动画、数据库版本或通用缓存容错策略。

## 验证证据

目录：`.mobile-test-results/visualizer-single-assets/`。

| 检查 | 结果与边界 |
| --- | --- |
| 原实现手机定向回归 | **3 PASS / 1 FAIL，24.9秒**；`red.log`，凝彩缺少删除失败提示 |
| 修复后 WebKit | **12 PASS，53.5秒**；`green.log`，手机390×844、平板1194×834、窄窗口600×834各4项 |
| 莫奈肖像、莫奈背景、流浪背景 | 真实 IndexedDB 字节保存；写入／删除故障命中各1次，显示错误并保留原记录；刷新恢复、旋转后清空、再次刷新保持 |
| 凝彩图片池 | 通过控件导入两张图片、保存并刷新恢复；第二次底层删除故障命中，核对两条记录及原设置均保留；窗口报错，重试后记录及设置清空，刷新保持 |
| 类型检查 | **PASS**：`npm run typecheck`，`typecheck.log` |
| 移动构建 | **PASS**：`npm run build:mobile`，`mobile-build.log` |
| 视觉复核 | 查看手机横屏肖像设置和竖屏凝彩错误状态截图；按钮、保存及错误提示可见。不是全部设置 UI 验收 |
| 原生安装／文件选择器／实际iPad／真机 | **NOT_RUN（本补丁）** |
| 真实平台、音频、动画性能、后台长播 | **NOT_RUN（本补丁）**；测试使用空队列，未用虚构歌曲替代平台验收 |

测试文件：`test/mobile-ui/visualizer-single-assets.spec.ts`。
故障直接注入 `IDBObjectStore.prototype.put/delete`，并核对实际命中次数；持久化及读取没有使用 mock。
导入素材为仓库现有 AppIcon PNG 的内存字节。WebKit“刷新恢复”不等于原生进程重启验收。
此前已通过的45项存储、六项群唱和27项字体／短码回归没有重复运行。

## 交付边界

本补丁已生成 `dist-mobile`，没有复制到 Capacitor、没有覆盖已安装候选。
后续合并安装时需继续核对应用身份、签名及前端资源，再补原生凝彩导入／保存／重启／清空。
QQ偶发空搜索、完整特效／设置UI、网易云30分钟真机锁屏、蓝牙／网络切换、歌词误差及性能验收仍未完成。
