# 全部文件夹重扫移植

2026-10-12，开发源码 `d2b66284a39bcfd39012b148c3b02077e086179d`。
本功能已在独立 QA 包验证，个人 iPhone 保持 mobile.28，未更新个人安装包。

## 原版语义与实现

原入口 `src/services/localMusicService.ts` 的 `resyncAllFolders` 汇总已导入根目录，逐个重扫；
一个根目录失败后不会继续扫描后续目录，此前已完成的目录不会整体回滚。
移动端沿用这个顺序，以原生根目录 ID 代替桌面 FileSystemDirectoryHandle／目录名。
复用已有 `importLocalFolder`、文件解码、原生目录权限、逐首暂存和原子提交；不新增生产依赖。

- 「本地音乐 → 文件夹」增加“重新扫描全部文件夹”。开始时读取原生权威目录，包含空目录和已忽略目录。
  同一根 ID 只扫描一次，操作期间阻止重复重扫、文件夹导入和移除。
- 每个目录独立使用批次 token；全部目录串行执行，不并发扫描或暂存。
  歌词格式偏好在开始时固定，原来的忽略状态继续由原生索引读取。
- 显示当前目录及歌曲进度；失败／取消时显示已完成的目录数量，保留先前提交，后续目录不启动。
  权限失效明确显示目录名，并可重新选择该目录；批量操作不会自动弹出多个文件选择器。
- 最后一个目录的原子提交若先于取消完成，显示全部成功；若还有未处理目录，则显示部分完成后停止。
  目录读取失败不会误报“0 个目录全部完成”。前后台切换和组件退出会取消正在进行的批次。
- 多目录提示汇总显示总数，正文最多展示 100 项，附带根目录名。原单目录导入提示仍保留。

入口：`src/mobile/localFolderRescan.ts`、`useLocalFolders.ts`、`FolderImportStatus.tsx`、`LocalFolderTools.tsx`。
没有更改原生 Swift、播放器、动画、依赖或存储格式。

## 验证

| 层次 | 结果 | 范围 |
| --- | --- | --- |
| TypeScript | PASS | 最终实现类型检查 |
| 逻辑 | PASS，23 项 | 7 项新批量用例及原单目录／扫描回归：空目录、去重、串行、权限错误、取消、提交竞争、目录读取失败 |
| WebKit | PASS，18 项 | phone／ipad／ipad-narrow；15 项批量及单目录交互，另 3 项页面隐藏事件取消。此事件测试不替代 iOS 系统后台验收 |
| QA 构建／资源 | PASS | iPadOS26.5 Release，确认独立 Bundle ID 和准确源码身份；最终 public 资源与同步目录摘要一致 |
| 实际模拟器操作 | PASS，生成样本 | 系统选择第二个 QA 目录；修改第一个目录的生成歌词、在第二个目录添加生成 WAV；全目录重扫显示 2/2，歌词与新增歌曲均持久化 |
| 稳定身份及恢复 | PASS，模拟器文件断言 | 旧歌曲 ID 保持；变更歌词换代，其他歌曲复用原 generation；重启再重扫仍显示 2/2，全部根／曲目／generation 保持，源文件摘要不变 |
| 准确源码 CI | PASS | [Mobile checks](https://github.com/Kun686/folia-Player/actions/runs/38179825132) |
| 真实曲库、手机新入口、iCloud／NAS、大曲库 | NOT_RUN | 目前无用户本地歌曲样本；没有将生成样本当成实际音乐或文件提供器验收 |

164 项原生输入与此前每端 57 项原生测试的输入比较，仅构建号由 27 改为 28；
本次没有重新运行这些原生用例，也没有把它们计入新测试数。共享目录脚本摘要一致。

本地证据 `.mobile-test-results/folder-rescan-*`：typecheck.log、unit.log、ui.log、lifecycle-ui.log、
sim-build.log、catalog-before.json、catalog-after.json、source-expected.json、content-check.json、
restart-check.json、complete.jpg、ci.json、cleanup-check.json。报告不包含书签或私人音乐。

个人 mobile.28 安装记录与操作前一致；独立 QA 模拟器已关闭，测试与构建进程已退出。
完整移植继续进行，自动监听、真实提供器授权恢复和完整 Automix 不因本次完成而视为交付。
