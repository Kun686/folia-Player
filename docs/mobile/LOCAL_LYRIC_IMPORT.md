# 移动端本地歌词文件解码兼容

2026-10-11，开发源码 `f270ceb2279836f7eb5be9910bbfff07cb96877b`。
修复系统文件选择器导入 GBK 文本与加密 KRC 失败的问题。个人 iPhone 未更新，仍为
[mobile.11](VALIDATION.md)；本阶段不改变 `BUILD_RECORD.json` 或已交付 IPA 的身份。

## 实现与复用

- 原生旧导入只尝试 UTF-8／UTF-16，无法等价处理原桌面支持的 GBK、加密 KRC。
  现在选择器先返回受限的原始字节，前端复用原 `decodeLyricFileBytes`、
  `LocalFileLyricAdapter` 和格式提示；原生复用 `NativeLyricParser` 再校验并原子保存。
  没有新增依赖、另写解密／解析算法或修改界面与动效参数。
- 文件与解码后文本最多 2,000,000 字节，文件名最多 1024 UTF-8 字节。KRC 流式解压时
  立即检查输出上限，超限取消读取，不把已解压的部分文本当成功。移动在线导入复用同一上限；
  原桌面调用的默认行为不变。
- `lyrics.json` 继续保存正文及原文件名，前台逐字解析和后台衔接使用一致格式提示。
  成功保存才通知原生重新规划尚未开始的衔接；不重建播放队列或改变播放位置。
- 前端检查当前歌曲／弹窗生命周期，原生校验每首歌的编辑令牌；解析 actor 返回后再次检查
  歌曲存在性、取消和令牌。两个并发保存只有一个成功，删除、旧接口写入及成功保存均撤销旧令牌。
  取消选择、空内容、解析失败、超限或写盘失败不覆盖旧记录。
- 复用系统 security-scoped access 与文件协调；新记录使用首次解锁后可访问的本机文件保护。
  旧 `lyrics.txt` 和既有 `lyrics.json` 保持兼容。

## 验证

本地证据：`.mobile-test-results/local-import-final-evidence.json`，包括日志与截图 SHA256。
各层测试范围独立，测试平台响应不能替代真实账号验收。

| 检查 | 结果 | 范围与证据 |
|---|---|---|
| TypeScript、逻辑测试 | PASS | `local-import-sync.log`：128 项／23 文件；原 GBK、UTF-16、KRC 解码及格式解析，解压上限、取消、切歌和保存失败 |
| 资源构建与 Capacitor 同步 | PASS | 同上；没有在原生构建／测试期间修改源码或打包资源 |
| WebKit UI | PASS（分两次运行） | `local-import-ui-fixed.log` 初次为 31 PASS／1 FAIL／1 NOT_RUN；补充等待初始歌词加载后，`local-import-ui-pending.log` 两组迟到匹配用例×三视口共 6 PASS。合计覆盖所选 33 个不同用例，未声称首次整组通过 |
| 新增本地导入 UI | PASS | 三视口共 6 项：GBK→KRC、原 Worker、歌词工具保存失败重试、切歌丢弃和取消；播放位置及命令不变。原 YRC→LRC、校准、在线匹配与动效注册表也在回归范围 |
| Release 原生 XCTest | PASS | `local-import-native.{log,xcresult}`：215 项，89.738 秒；新增 3 项覆盖原始字节保留、真实持久化／重开、原生时间轴、边界、旧写入／删除撤销和并发保存 |
| iPad 实际容器 | PASS（导入与恢复） | iPad Pro 11-inch (M5)／iOS26.5 Simulator；合成「Folia 验收音 2」经真实系统选择器导入 97 字节加密 KRC，逐字核对保存正文及文件名。终止 App 后重启，歌词恢复，仍为暂停 |
| GitHub Mobile checks | PASS | [run 38113676108](https://github.com/Kun686/folia-Player/actions/runs/38113676108)，对应本文源码提交；供应源码校验、锁文件安装、类型检查、移动逻辑及构建 |

原生测试沿用既有范围，以下三项需要另起 HTTP 样本服务器，本轮 **NOT_RUN**：
`testIndependentHTTPPreloadIsSilentAndCancellable`、
`testHTTPMonoStreamingHasAudibleStereoEffectsAndSeek`、
`testHTTPNativeQueueCancelsBufferedSongAndAdvancesWithoutWebView`。
215 项通过不能写成全部原生测试已执行。

失败记录保留：`local-import-ui.log` 的初次新增断言把 Classic 逐字节点误认为单个完整文本节点，
改用原 Still 模式核对全文；没有改变产品渲染。后续旧在线匹配用例在加载中点击后未打开工具，
其快照显示正常播放器；为该“已加载后取消迟到匹配”用例增加显式加载等待后通过。
过早打开工具的真实行为另由 `lyric-timing.spec.ts` 覆盖，不把等待条件调整说成新的产品修复。
运行仍有原 QQ 解压容错警告和动效注册表用例的 `useInsertionEffect` 警告，未声称控制台零警告。

模拟器截图为 `local-import-native-{picker,rendered,restored}.png`；实际 KRC 样本把整句作为单词，
当前 Partita 模式显示该长词时两端裁切。导入／重启恢复通过，长词布局仍需单独对照原版检查，
不能据此认定全部动效布局合格。测试后恢复合成歌曲原先无歌词的状态，移除本轮样本，
停止 App 并关闭本轮启动的模拟器；没有接触个人手机曲库。

## 尚未完成与回退

**NOT_RUN**：本阶段 iPhone 安装、物理 iPhone／iPad 文件选择器、云盘权限矩阵、真实平台 App 联机、
30 分钟锁屏、耳机／蓝牙、≤150ms 歌词显示误差、温升和持续内存验证。

本地完整来源管理仍待移植，包括内嵌／导入／在线来源选择及原匹配弹窗的元数据／封面语义。
不能用较窄的在线匹配弹窗替代它并宣称完成。完整 Automix 和剩余桌面编辑工具也仍待完成。
整体移植保持进行中；本阶段只补齐本地导入的必要兼容性。

回退上述源码提交即可撤销新导入路径；保存格式没有迁移，原 `lyrics.json` 仍可读取。
本次模拟器为可测试 Release 开发产物，不是新的个人签名候选，不能与原 build 11 IPA 混淆。
