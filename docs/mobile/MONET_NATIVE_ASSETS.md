<!-- MONET_NATIVE_ASSETS.md — native image import, persistence, shared deletion, and cleanup evidence. -->
# 莫奈肖像与莫奈／漫游背景原生补验

2026-10-15：三条现有素材入口的原生导入、重启恢复与清空 **PASS（独立 iPhone 模拟器）**。
沿用[凝彩窗口修复后的候选](TEMPERA_MOBILE_DIALOG.md)，本批没有产品代码、构建、安装或服务器部署改动。
个人 iPhone mobile.28 保持，实际 iPad 暂缓；本批没有播放音频。

## 对象与方法

- iPhone 17 Pro／iOS 26.5，`9213032A-657A-40CD-BD2A-A3065ACCC8EC`。
- Bundle `app.folia.validation.App`，主二进制 SHA256：
  `9f52f7e19bb1e4bc8cd8bc196affa1accfa94a0e4df705d9fd80daf553d14268`，收尾核对未变。
- 复用现有素材服务和系统 Choose File，原生触摸操作配合只读 SQLite／IndexedDB 检查，无新依赖。
- 素材是仓库 AppIcon PNG 的临时副本 `Folia-QA-Monet.png`，不是新默认设计或歌曲封面。
- 画面沿用真实 QQ《我不难过》／孙燕姿，50首队列，全程暂停在276.4506575963719秒；没有虚构歌曲。
- 界面名称为“漫游”，源码标识为 `nomand`；早期文档称“流浪”。莫奈与漫游共用背景图片记录，来源选择分别保存。

## 结果

| 检查 | 证据与边界 |
| --- | --- |
| 莫奈肖像导入／恢复 | **PASS**：原生文件选择后显示文件名并选择自定义；终止重开后设置恢复，横屏歌词画面显示测试图标 |
| 莫奈肖像清空 | **PASS**：文件名消失、清空禁用；IndexedDB 肖像记录不存在 |
| 莫奈背景导入／恢复 | **PASS**：导入后自动选择自定义，重启后恢复；只读确认记录包含完整原 PNG 字节。背景有模糊和主题叠色，截图不单独作为像素一致性证明 |
| 漫游读取／清空共用背景 | **PASS**：漫游面板读到莫奈导入的文件名，清空后共用记录删除 |
| 漫游自身导入／恢复 | **PASS**：从漫游入口导入，提示成功并选择自定义；重开后歌词背景可见图标纹理，存储包含原 PNG 字节 |
| 莫奈读取／清空共用背景 | **PASS**：切回莫奈可见漫游导入的文件名；清空后文件名消失、按钮禁用，共用记录删除，最终重启仍不存在 |
| 原版窄屏肖像行为 | `VisualizerMonet.tsx` 原实现使用 `hidden ... md:flex`，窄屏不显示右侧肖像；宽屏已观察渲染。本批保持原行为 |
| QQ／网易云账号 | **PASS（界面观察）**：重启后两平台账号、退出按钮、个人歌单入口仍在，不替代播放或全部接口验收 |
| 原生存储故障注入 | **NOT_RUN**：错误保留／回滚证据仍来自前批12项WebKit，未在已登录原生App中注入故障 |
| 音频、动态效果性能、长播、实际iPad、真机 | **NOT_RUN（本批）**；暂停歌词画面和图片持久化不构成这些验收 |

证据目录：`.mobile-test-results/monet-native-20261015/`。
图片包括 `portrait-imported.png`、`portrait-restored-landscape.png`、`portrait-restored-settings.png`、
`background-imported.png`、`background-restored-player.png`、`nomand-imported.png`、
`nomand-restored-player.png`、`final-cleared.png`、`qq-account-retained.png` 和 `final-library.png`。
持久化证据为 `portrait-restored-records.json`、`background-restored.json`、
`shared-background-cleared.json`、`nomand-restored.json`、`final-cleared.json` 及 `final-restored.json`。

## 状态恢复与证据限制

App 内清空临时素材后停止 App，只恢复本批改变的5个外观键：`visualizer_mode`、
`visualizer_background_mode`、`monet_tuning`、`monet_background_tuning`、`nomand_background_tuning`。
事务前核对其余39键未变；重开后44个采集外观键与本批基线一致，肖像及共用背景记录仍不存在。
没有写队列、音效或凭据。临时 PNG 核对摘要后删除，仓库原图保留。正向竖屏恢复网易云曲库，QQ歌曲暂停。

本批初始仅保存原生队列／音效 JSON 的原始字节摘要。队列字节摘要后来不同，音效相同；
将 JSON 解码后与上一批已核验完整快照逐值比较，两项均完全相等，50首、当前索引及暂停位置保持。
这与重新序列化顺序差异相容，但本批初始原字节未保存，不能声称逐值对照的是本批完整快照。
`native-comparison.json` 明确区分两种比较；早期记录中的 `nativeStateMatchesBaseline:false` 保留，不改写成PASS。

`appearance-restoration.json`、`final-restored.json`、`cleanup-final.json` 保存恢复结果。
`inspect.py` 读取临时 PNG，所以清理后不能原样重跑；既有检查结果保留，不为重跑重新植入素材。
本批无镜像服务或测试服务器；进程核查只见工具宿主的 XcodeBuildMCP 服务，没有本批 SSH、探针、构建或日志采集残留。

QQ偶发空搜索、完整特效与设置UI、网易云30分钟真机锁屏、蓝牙／网络切换、150ms歌词误差、长期性能及有岛真机仍未完成。
