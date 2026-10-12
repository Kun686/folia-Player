# 服务器设置与账号保留

2026-10-13；源码基线 `4dcc078a6b8d821ddc3d516165c3e3565f3943d8`。
按「继续不依赖真机的工作」修复移动移植的账号保存问题。复用现有 SecureStore、HTTPS URL 校验、
请求取消与 Omni 会话适配，没有新增依赖、修改平台协议或调整播放器界面／动画。

## 问题与修复

旧流程在保存新服务器前先退出三个平台；Keychain 写入失败时，服务器仍是原地址，账号却已清除。
受控 WebKit 已复现：令 configure 抛出 secure-storage，仍收到 netease、qq、kugou 三次 clearSession。
原生旧流程还会在保存成功前停止在线播放和取消原生任务。

- `NativeGatewayStore` 将服务器、访问令牌和按 provider 分开的会话保存为一个 Keychain 文档。
  单次 SecureStore.write 是提交点；写入失败不更改持久状态，也不触发原生播放／账号清理。
  只更换令牌保留平台会话；更换 HTTPS origin 在同一写入中清空旧平台会话，避免把旧 Cookie 或 QQ 密封令牌发给新服务。
- 每次配置变化产生 scope。前端请求、排队的会话写入与退出携带原 scope；原生在发送前、响应后核对。
  后台解析音源、私人 FM、听歌打卡使用同一配置快照；原生歌词跨解析器等待保留 scope，缓存返回也需复核。
- 前端配置期间阻止新请求／凭据写入，取消旧请求并等待已排队的持久化。
  配置与退出操作互斥，持久化退出失败保留会话，退出已提交但缓存清理失败则重读原生会话并保留错误提示；成功配置后从原生返回值恢复会话并重载 WebView，清掉旧服务的账号缓存。
- HTTPS 地址沿用现有严格校验并规范化大小写、默认端口与末尾斜杠；禁止用户信息、路径、查询和片段。
  令牌限制 32–4096 字符并拒绝控制字符。访问令牌不返回前端，凭据和签名地址不写日志。

## 凭据迁移与回滚边界

首次读取会将原 `gateway` 与 `session.netease/qq/kugou` 合并写入 `gateway.credentials`，
成功后才删除旧条目。读取或写入失败时不删除旧记录；清理中断时新文档为权威副本，
重试只继续清理，绝不从部分遗留条目覆盖它。清理失败报告 secure-storage，后续启动可以重试。
保护等级仍为 `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`，三个平台在文档内分别存储，退出只清对应平台。

迁移为单向格式变更。本批仅在独立 QA 和带随机前缀的测试 Keychain 条目验证，个人 App 未迁移。
尚未迁移的个人 mobile.28 可继续使用。将来安装此版后，回退代码应保留新存储读取与 scope 桥接；
直接安装不识别新格式的旧二进制不会恢复账号，需重新配置和登录，不能承诺无损降级。
不得为回退把凭据导出到日志或明文文件。上线前仍需个人设备升级保留登录验收。

## 验证

证据目录 `.mobile-test-results/gateway-settings/`，所有账号与网络响应均为合成测试值。

| 层次 | 状态 | 范围 |
| --- | --- | --- |
| 原问题复现 | CONFIRMED | red-confirmed.log：写入失败仍先清掉三平台 |
| 逻辑 | PASS，82 项／3 文件 | 会话顺序、取消、失败恢复、原二维码状态机、账号目录 |
| TypeScript | PASS | npm run typecheck |
| WebKit | PASS，18 项 | 手机、平板、窄窗口：失败保留账号；成功重载、令牌更新、换 origin；目录分页／退出回归 |
| 移动资源构建 | PASS | npm run build:mobile；Capacitor copy ios |
| 原生 QA 构建与模拟器 | PASS，19 项，无失败／跳过 | 独立 app.folia.validation.App；Keychain 迁移／故障、配置 scope、平台会话归属、歌词、FM、打卡和请求头隔离 |
| 真实账号、个人升级、物理设备 | NOT_RUN | 按本轮范围未执行 |
| 服务器部署、个人安装 | NOT_RUN | 个人 mobile.28 与服务器未更新 |

首次 WebKit 定位使用了错误的按钮名，该次不作为缺陷复现；修正为实际「服务器与外观／保存连接」后确认原问题。
首次原生构建因工程将新文件登记进 Products 组失败，修正为 App 源码组后继续验证；保留失败日志。
逻辑命令最初带了一个不存在的二维码测试路径，只运行到 26 项／2 文件；随后单独运行正确路径
`test/unit/library/core/providerLoginSession.test.ts`，55 项通过，不把不存在的路径算作通过。

最终 283 项原生构建输入与测试时一致；125 个前端资源在 dist-mobile、Capacitor 副本和 QA 包中逐项匹配。
QA Web 标签仍为 mobile.28／构建前基线 4dcc078，并非个人安装或最终提交身份；二进制、测试包和源码哈希另存。
个人 BUILD_RECORD.json SHA256 保持
ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73。

完整移动移植及 Automix 真机温升、长期内存、系统挂起验收仍未完成；本修复不改变这些验收状态。
