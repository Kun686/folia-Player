# 不可播放歌曲的原版替代版本确认

2026-10-13。移动端手动点播歌单、专辑、歌手曲目或每日推荐中的已标记不可播放歌曲时，
经过原 Omni / provider 查询平台提供的其他版本，展示原确认弹窗；用户确认后才改队列和点播。
本批仅本地源码与受控测试。个人 mobile.28、物理设备、真实账号和生产服务器未操作。

## 复用与范围

- 复用 `omni.getSongReplacement`、网易云原 songId/detail 优先与 copyright recommendation 后备路径、
  原响应规范化和 `UnavailableReplacementDialog`。没有新的匹配算法、解码器或依赖。
- 将桌面原队列替换逻辑提取为 `buildReplacementQueue`，两端共用：按完整来源身份替换原曲的所有出现，
  移除其他已标记不可用的在线歌曲，保留本地／Navidrome 项；原曲不在队列时补入替代曲。
  重复歌曲、跨平台相同 ID 以及空队列保持原语义。
- 当前原 provider 只有网易云实现替代版本查询；QQ 不猜接口、不自动跨平台替换。
  搜索结果中不可用歌曲仍按原版禁用播放／入队。本功能不处理全部原生播放失败，也不在后台弹窗。
- 前端以网关 `replacementProviders` 能力字段判断支持范围。旧网关缺字段时给出明确提示，
  不向旧服务尝试新接口。已配置网易云的新网关才声明支持。
- 网关只增加 `/song/copyright/rcmd` 的受认证 GET 转发；固定内部网易云服务，校验单一正整数歌曲 ID，
  只允许 songid、cookie、timestamp。拒绝任意目标、额外参数、其他平台和 POST；不转发网关认证头。
  平台 Cookie 继续使用原会话与原请求链，不新增日志或持久化位置。

## 并发、交互与失败

查询前先等待原会话持久化，再记录原生队列版本。查询和取消均不改变播放、进度或队列。
查询期间退出登录、切换来源、关闭目录／每日推荐或更新浏览上下文后，旧结果不再打开弹窗。
旧网关、没有可用替代曲、网络失败与队列已变化分别走对应错误提示。

确认先核对会话与队列版本，再用已有 `editQueue` 与 `selectQueue` 两次版本校验执行；
在弹窗等待期间发生原生切歌／队列修改，或者编辑和选择之间发生冲突时，不重试覆盖新状态。
原来播放的歌曲不在新队列时，先按已有协议将其保留为脱离队列的当前音频，再选择替代曲。
队列最多1000首。确认后已经提交给原生的编辑不会因后来导航而撤销；迟到的回执不能重新打开已离开的播放器。

原弹窗放入 HTML dialog 顶层，覆盖已有专辑／每日推荐弹窗，长元数据可换行和滚动，操作区域至少44px。
取消后仍可操作原列表；每日推荐仅在实际开始播放后关闭。沿用原确认文案与卡片，
保留全屏播放器、歌词动画、背景及玻璃控制器。

## 验证与证据

证据目录：`.mobile-test-results/song-replacement/`；基线 `8fca27b009fc728658f21aa8659489ab82329761`。
确切命令在 `*-command.json`，使用有界 runner，60秒无输出终止进程组。
测试覆盖队列身份／重复项、取消／会话变化、版本冲突、上限、只读网关与原 provider 解析，
以及 phone、ipad、ipad-narrow 的原弹窗、长文字旋转、嵌套目录、每日推荐和搜索回归。

首次单测发现三处测试样本／断言错误：参数矩阵的数组被当成多参数、缺少桌面来源标记、
任意外部地址预期400而原网关实际正确拒绝为403。仅修正测试，保留 `unit.log`，修正结果见 `unit-corrected.log`。
首轮界面结果在 `ui.log`，每日推荐关闭时机与迟到选择回执修正后的结果在 `ui-final.log`。
最终界面运行的84项直接通过；另3项迟到选择回执场景错误地等待空搜索框的搜索按钮启用。
改为检查队列行已解除忙碌、音乐库仍可操作，三种窗口复测全部通过（`ui-corrected.log`）；生产代码无需为此调整。
失败截图与上下文保存在 `ui-final-artifacts/`。既有 QQ 受控歌词样本的 DecompressionStream 警告及故障注入日志不代表真实平台请求。

| 项目 | 结果 | 证据边界 |
|---|---|---|
| TypeScript | PASS | `typecheck-final.log` |
| 逻辑与原 provider 回归 | 140 PASS，5文件 | `unit-corrected.log`；包含31项新增流程测试和77项网关测试 |
| WebKit最终场景 | 87个不同场景 PASS | 84项 `ui-final.log` + 3项 `ui-corrected.log`；33项替代版本、54项原搜索／目录／每日推荐 |
| 初始 WebKit 回归 | 60 PASS | `ui.log`；与最终场景重叠，不重复计入87项 |
| 原生桥／真机／真实平台／部署 | NOT_RUN | 本批没有运行原生包或访问音乐平台 |

已查看手机及iPad原弹窗截图，长元数据、横竖屏、滚动、44px触摸和底层目录恢复均通过受控测试。
`source.json` 固定源码与个人包记录，`ci.json`、`completion.json`、`cleanup.json` 记录最终提交检查及进程清理。

```sh
npm run typecheck
npm run test:unit -- test/unit/mobile/songReplacement.test.ts test/unit/mobile/queueActions.test.ts test/unit/mobile/searchPlayback.test.ts test/unit/mobile/gateway.test.ts test/unit/services/neteaseReplacement.test.ts
npm run test:mobile:ui -- song-replacement.spec.ts search-playback.spec.ts online-catalog.spec.ts daily-recommendations.spec.ts
npm run test:mobile:ui -- song-replacement.spec.ts --grep "a late selection receipt"
```

## 交付与回退

个人 `BUILD_RECORD.json` SHA256 保持
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。
无新依赖、数据迁移或原生接口变更；前端与网关提交可整体撤销。旧客户端忽略新增健康字段，
新客户端连接旧网关时此能力不可用，常规播放保持原行为。
实际网易云替代版本、系统原生队列桥、真机与服务器部署均为 **NOT_RUN**。
独立模拟器完整 Automix 的已有证据不因本批前端测试扩展；真机联合负载／温升仍待验，公开完整能力继续关闭。
