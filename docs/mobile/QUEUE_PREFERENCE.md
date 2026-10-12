# 加入队列的默认位置

2026-10-13。移动端恢复原版的加入队列偏好：可选择追加到末尾或当前歌曲之后。
保留原播放器、动画、原生队列算法和搜索点播规则；个人 App、真机、真实账户与服务器未操作。

## 实现

此前普通加入和明确「移到队尾」共用省略参数，最终都硬编码为 `append`。
现在普通加入在点击时读取原 `useAudioSettingsStore.queueAddBehavior`，明确操作分别传
`next`／`append`。推荐、歌单、目录及曲库共用的 `SongList` 透传原 `QueueAddBehavior` 类型，
不再用布尔值混淆默认行为与明确位置。保存默认偏好不会重排现有队列。

复用原 `applyQueueAddBehavior`、`addMobileSongs` 的身份去重和原生队列版本检查，
已有歌曲移动到目标位置，不插入重复条目；添加操作不改变当前播放或暂停状态。
偏好在会话同步／队列读取之前捕获，等待时修改设置仅影响后续操作。

设置位于已有「服务器与外观」，沿用原文案、setter 和 `queue_add_behavior` 存储键，
默认 `append`。它只参与前台点击，原生层接收最终队列，无需新原生接口或背景设置同步。
存储失败显示错误并保留原值；不涉及凭据或视觉配置导入导出。
桌面原命令 `settings-queue-behavior` 已存在，移动端沿用触摸入口。

WebKit 实测仅设 `min-height` 时下拉框仍只有 23px；为队列及相邻歌词优先级选择器显式设置
44px 高度、16px 字号。调整仅限这两个设置控件。

## 验证与边界

证据：`.mobile-test-results/queue-preference/`；`source.json` 保存基线
`32333afb0de4ab913df635cf1fb90100dcb0f374` 上 12 个源码／测试文件摘要。

| 项目 | 结果 | 范围 |
|---|---|---|
| TypeScript | PASS | `typecheck.log` |
| 队列逻辑 | 27 PASS / 4 文件 | `unit.log`：原去重、批量移动、当前歌曲身份、版本冲突和搜索点播 |
| WebKit 新偏好 | 6 PASS | 三种窗口尺寸；重载、明确位置、跨 QQ／网易云／本地身份、存储失败和等待中的选择 |
| WebKit 原有回归 | 27 PASS | 6 项歌词优先级、18 项搜索点播、3 项队列编辑 |
| 真机／原生容器／真实平台 | NOT_RUN | 本轮无 Swift 或桥协议改动，没有重建或安装 QA／个人 App |

最初新偏好测试 3 FAIL / 3 PASS，失败均为实际高度 23px 小于 44px；修正后
`ui-green.log` 30 PASS、`ui-regression.log` 3 PASS，不重复累计首次通过项。
截图保存在 `playwright-green/`。WebKit 使用受控 provider 响应与原生桥，不代表真实账号或听感验收。
本提交 CI 负责再次检查类型、移动逻辑回归和移动前端构建，结果保存于本地 `ci.json`。

```sh
npm run test:unit -- test/unit/mobile/queueActions.test.ts test/unit/mobile/searchPlayback.test.ts test/unit/utils/queueAddBehavior.test.ts test/unit/utils/queueBatchOperations.test.ts
npm run test:mobile:ui -- queue-preference.spec.ts lyric-priority.spec.ts search-playback.spec.ts
npm run test:mobile:ui -- mobile.spec.ts --grep 'touch queue editing preserves current song and rejects stale actions'
```

没有新增依赖或数据迁移。回退本轮提交即可恢复移动端此前固定追加到末尾的行为，
原存储键可保留；不用改服务器。个人 `BUILD_RECORD.json` SHA256 保持
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。
完整 Automix 的真机联合负载、长期温升／内存和人工听感仍未完成。
