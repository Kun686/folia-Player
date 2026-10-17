<!-- QQ_SEARCH_UPSTREAM_REVIEW.md — static upstream comparison; no dependency upgrade or live search acceptance. -->
# QQ 搜索上游版本对照

2026-10-15：保留固定版本 `@yakult-green-tea/qq-music-api@3.1.4`。
本次没有找到新版修复当前登录态搜索偶发零结果的依据；这不是对所有新版行为的否定，也不是空搜索已解决。
没有安装或执行下载的 npm 包，没有更新 App、锁文件、服务器或平台会话，没有调用真实音乐搜索。

## 来源与校验

读取 npm registry 元数据，并下载 3.1.4、3.2.0、3.3.0 的公开发布归档作静态阅读。
三份归档均通过对应 registry `dist.integrity` 的 SHA-512 校验；未执行安装脚本。
3.3.0 发布时间为 2026-10-14T14:38:51.875Z，registry 的 latest 为 3.3.0。
更新记录取自该包 `gitHead` 对应的固定提交，未使用搜索引擎缓存作为当前源码证据：

- [npm registry](https://registry.npmjs.org/@yakult-green-tea%2fqq-music-api)
- [3.3.0 固定提交更新记录](https://github.com/yakult-green-tea/qq-music-api/blob/128c954fa79bcb3b735261b9b6ca9829f557159a/CHANGELOG.md)

本地证据位于 `.mobile-test-results/qq-upstream-review/`：
`registry-full.json`、`source-manifest.json`、三份原始归档及提取源码、`CHANGELOG-3.3.0.md`、`comparison.json`。

## 与当前故障直接相关的差异

| 检查 | 静态结果 | 含义 |
| --- | --- | --- |
| 当前 `DoSearchForQQMusicLite` RPC | 三版本发布的 `dist/src` 均无此调用 | 这是 Folia 移动扩展注入的调用，不能把旧搜索接口的更新当作它的修复 |
| 上游旧 `getSearchByKey` | 仍使用 `/soso/fcgi-bin/client_search_cp`；3.1.4 与 3.3.0 请求参数块相同 | 3.2/3.3 的错误脱敏变化没有提供此成功零结果的解释 |
| 登录态 `callMusicu` | 3.1.4 与 3.3.0 函数体仅有 Cookie helper／URL 常量的导出引用差异；归一化后相同 | 请求体、请求头及响应状态判断未出现可归因的修复 |
| `buildAndroidComm` | 两版本函数字节相同 | 该公共字段构造没有变化 |
| 当前补丁注入位置 | `qrLogin.js` 的 `getUserDetail` 标记在 3.1.4 出现一次，新版为零次 | 新版实现移到 `qrService.js`，当前源码版本／哈希保护会阻止直接套用 |
| 新版共用请求核心 | 新增限流、只读重试等独立模块；其注释明确旧路由不使用 | 不能声称升级会自动给当前搜索带来重试或稳定性改善 |

3.3.0 还包含会话续期、播放地址及其他接口行为变化。即使以后有明确升级必要，仍须单独验证现有登录、歌单和播放兼容性，不能作为本轮搜索修复顺带安装。
本轮复用现有版本和诊断证据，不新增生产依赖，不复制平台协议，不修改空结果语义或添加猜测性重试。
静态提取脚本首轮因对象表达式结束符不匹配失败，明确修正结束符后一次重试完成；不涉及产品运行结果。

## 本次获准的 SSH 只读检查

仅尝试 `readlink /opt/folia-player/current` 一次，外层上限 60 秒。
命令约 0.16 秒退出，exit 255，返回 `Permission denied (publickey,password)`；没有出现密码提示，未提交密码，也未读到部署路径。
没有部署、修改认证设置或再次连接。该结果不证明用户密码错误，也不刷新之前记录的远端发布状态。

随后的纯本地检查确认：直接置于有界包装下的进程没有 `/dev/tty`，通过系统 `script` 创建的子进程具有控制终端。
本次未复用之前已验证的 `script` 包装是执行失误；本地检查未使用网络，不能代替 SSH 成功。
结果保存于 `ssh-readonly-check.json`，不含密码或凭据。

## 验收边界

- **PASS（静态）**：三份来源完整性与上述源码差异核对。
- **FAIL／未解决**：此前真实 QQ 偶发零结果的稳定性验收；保留 [原失败证据](QQ_SEARCH_STATUS.md)。
- **未完成**：本次读取远端部署路径；未更新该路径的当前状态结论。
- **NOT_RUN**：新版运行时、真实搜索、音频、真机和长播；本次无需为文档变更重跑构建。
- [曲库遮挡候选](LIBRARY_PLAYER_OCCLUSION.md)的额外定向回归仍待原许可问题回复；本次 SSH 授权不包括该回归，候选未安装。
