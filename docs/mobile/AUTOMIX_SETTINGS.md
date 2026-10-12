# Automix 表现模式设置接线

2026-10-13。继续不依赖真机的工作，仅构建独立 `app.folia.validation.App`。
个人 App、物理设备、真实账户及服务器未操作，播放器布局、动画、原混音算法和依赖不变。

## 问题与修正

原 `NativeCrossfade` 已支持 `performance`，但移动桥、设置同步及原生存储只有
`enabled`、`mode`、`crossfadeMaxSec`。原版设置 store 的「表现模式」值没有到达播放器，
已有分轨 QA 通过直接调用 `configure` 绕过了这条用户设置链路。

- 复用原 `useAutomixSettingsStore`、`TransitionSettingsSection`、串行 `connectNativeSettings`
  和 `NativeCrossfade.configure`，只补齐桥字段、保存、恢复与失败回退，不另写混音逻辑。
- 新原生快照返回 `performance`；旧配置缺失该字段时默认关闭，保留原模式、开关及过渡时长。
  显式字符串、数字或 null 均拒绝，拒绝后存储和正在使用的设置保持原值。
- Web 恢复缺字段的旧快照时也默认关闭，避免复活只有 localStorage 保存的旧偏好；恢复不反向写入。
- `stems/full` 公开能力仍为 false，未通过真机资源验收前不开放「表现模式」按钮。
  中英文说明改为“验证中、暂未开放”，纠正“尚未接入”这一历史描述。
  UI 按原能力判断禁用；本次没有新增命令或开关，继续使用移动播放器原有过渡设置入口。
- 原生真实混音回归改走 `setTransitionSettings`，不再直接向混音器传入测试开关。

## 验证与证据

本地证据：`.mobile-test-results/transition-preference/`。临时产物不提交。

| 验证 | 结果 | 范围 |
|---|---|---|
| 修正前逻辑回归 | 4 FAIL / 3 PASS | `unit-red-isolated.log`：恢复、保存、旧快照与回退缺口 |
| 修正前原生回归 | 2 FAIL | `native-red.xcresult`：字段被忽略、错误值未拒绝及旧快照无返回字段 |
| 修正后逻辑 | 40 PASS | `unit-green.log`：设置同步、原过渡规划及原表现模式算法 |
| WebKit | 12 个不同用例 PASS | 3 个既有模型管理场景；9 个设置场景覆盖 phone、ipad、ipad-narrow |
| 原生模拟器 | 8 PASS / 0 FAIL / 0 SKIP | `native-green.xcresult`：存储恢复、旧配置、真实 Capacitor 桥、能力关闭及实际音频队列 |
| 静态与构建 | PASS | TypeScript、移动前端、Capacitor copy、Release `build-for-testing`、diff 检查 |

原生环境为 iPad Pro 11-inch M5 / iPadOS 26.5 模拟器。音频队列用例复用生成音频和受控分轨，
确实执行生产解码／渲染／转场：表现模式开、关各覆盖 seek、完成交接、时钟重置，最终保留当前歌曲、
释放旧节点。六种情况属于一个 XCTest，不计作六项测试。
这些证据不包含新一轮原模型推理、真实音源听感或真机性能；前阶段原模型证据仍见
[AUTOMIX_THREAD_MEMORY.md](AUTOMIX_THREAD_MEMORY.md)。

WebKit 能力开启场景仅由测试桥提供，用于验证原组件和设置传递，不是生产开放分轨能力的证明。
另有明确用例验证“模型文件已安装”仍不能打开尚未开放的按钮。

初次逻辑红测因旧测试断言失败后未清理订阅，造成后续用例互相影响；增加统一 afterEach 清理后，
上述独立红测保留为 4 FAIL / 3 PASS。首次 WebKit 的 6 个新场景失败于测试使用“表演模式”定位，
真实原版按钮名称为“表现模式”；仅改定位后 6 项及 3 项原有设置回归通过，未更改产品名称或断言门槛。

## 包身份、边界与回退

`source.json` 记录基线 `2fc1f4d…` 上 12 个修改／新增源码与测试文件的摘要；
`native-inputs.json` 记录 283 个原生目录受版本控制输入；`package.json` 记录二进制和测试插件摘要。
125 项前端资源在 dist-mobile、Capacitor 同步目录及独立 QA 包中一致，后两者另有两个相同的 Cordova shim。
内嵌版本标签仍为构建时的 `2fc1f4d…/mobile.28`，**不是个人 mobile.28 已更新**，
实际本轮源码由上述修改文件摘要标识。完整构建／测试命令及日志在证据目录中。

个人 `BUILD_RECORD.json` SHA256 保持
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。
真实账号、在线 Automix、物理 iPhone／iPad、联合温升／长期内存与人工听感均为 **NOT_RUN**。

回退只需撤销桥接、同步和原生设置字段；旧版本解码会忽略新增键。
不迁移凭据或曲库，不删除模型，不需要更新服务器。
