<!-- QQ_SEARCH_PUBLIC_REPORT.md — independent symptom evidence, not a runtime repair or acceptance result. -->
# QQ Lite 空结果：公开报告核查

2026-10-15：找到独立项目的相似症状，但没有可据此采用的已验证修复。本批没有改产品代码、安装依赖、连接服务器或请求QQ接口。
此前真实搜索稳定性FAIL保持；不会因为公开issue已关闭而改成PASS。

## 新证据

[Lyrico-Plugins #12](https://github.com/Replica0110/Lyrico-Plugins/issues/12)报告Android插件0.4.2使用同一Lite搜索方法时，
同一短关键词先返回10条、后返回0条；报告未采集上游原始HTTP和业务状态，因此无法证明与Folia同一根因。
本次GitHub REST读取确认：2026-10-10创建，10-14关闭，0条评论；timeline仅有closed事件，commit_id为null。
“completed”只是issue状态，不是平台稳定性证据。

固定提交对照：

- [bfea908](https://github.com/Replica0110/Lyrico-Plugins/commit/bfea908014d52fc724b8cae5c6e22ff37c0fe661)，10-08：
  对空列表／异常依次改走Lite、Desktop、旧网页搜索。它没有给出本项目当前成功业务码／零总数的根因，且提交早于此报告。
- [1270281](https://github.com/Replica0110/Lyrico-Plugins/commit/1270281251eef42b43451a177e1631e68fcb61ae)，10-09：
  增加搜索分组版本展开，处理同名歌曲版本缺失，不是整个首屏随机为空。
- 获取时main最新提交为`56d9c94a45488d8cbbacc0d7efd58a08ddbdb16c`，10-09；没有从关闭事件找到新修复。

对方源码使用的搜索ID生成范围与Folia不同，仍有相似报告。这只能提示不要把ID位数当成已知原因；
不能据此推断任何ID格式均正确。对方仓库API的license字段为null，本批只做公开源码核对，没有复制实现。

## 对当前方案的影响

Folia已经取得同次失败的成功业务码与零总数，并排除该次前端丢列表；见[真实诊断](QQ_SEARCH_STATUS.md)。
此前[Desktop／旧CGI服务器检查](QQ_SEARCH_DESKTOP_ADAPTER.md)分别出现2001和HTTP500，
旧CGI补齐参数与Referer后仍失败。因此不引入未经本环境验证的三级回退，也不继续重复原样成功批次。

下一步仍需服务器实际环境的证据；这份报告提供独立症状佐证，不能代替当前环境复现及修复验证。
公开查询只读，未联系报告者或维护者。结构化来源记录：`.mobile-test-results/qq-upstream-review/public-issue-evidence.json`。

## 待执行检查已准备

`.mobile-test-results/qq-upstream-review/approved-readlink.sh`把系统`script`控制终端和60秒上限固定在同一入口，
远端命令仅为`readlink /opt/folia-player/current`；一次连接、一次密码提示，主机密钥严格检查，无密码文件及自动重试。
`--probe`只执行本地控制终端检查，本次exit0／`CONTROLLING_TERMINAL_OK`；**未执行`--run`，没有SSH成功证据**。
此前获准检查失败因未复用控制终端包装，执行失误及失败记录保留。

用户AGENTS.md的“Retry a failed command at most once”限制仍有效。已把本项与[曲库最终定向回归](LIBRARY_PLAYER_OCCLUSION.md)
一并请求各追加一次，等待用户明确选择；自动goal续行不视为批准。
没有生产代码变化，本批不重跑构建或把离线单测冒充搜索验收。
