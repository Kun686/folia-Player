<!-- PLAYLIST_RESPONSE.md — distinguish malformed QQ playlist pages from confirmed empty results. -->
# 歌单读取失败与空列表

2026-10-14，源码基线 `4103c0c688d3726f01542e40b30b929ddcba2d32`。
按 [CURRENT_SCOPE.md](CURRENT_SCOPE.md) 核对 QQ／网易云核心歌单读取和错误重试。

## 问题与最小修复

QQ 原有个人歌单、自建歌单曲目、公开歌单曲目入口在列表字段缺失、为 null 或非数组时回落到 `[]`。
这使响应异常变成成功空页：首屏可能显示为空，加载下一页时则会结束分页且不给重试入口。
`unit-red.log` 记录三入口共 12 项失败；`ui-red.json` 用实际移动页面及 provider 复现了个人歌单后续页不出现重试按钮。

`src/services/onlineMusic/qqProvider.ts` 只补充这三个字段的数组校验：

- `user_playlist.playlist`：缺失／格式错误抛出已有 `unavailable`。
- `user_playlist_detail.songs`：缺失／格式错误抛出 `unavailable`；不误判为旧后端缺路由，不切换匿名接口。
- `song_list_detail.response.cdlist[0].songlist`：已有歌单身份校验后，缺失／格式错误抛出 `invalid-response`。

真正的空数组仍成功返回空页，原 QQ 本地分页、已知缺路由时的回退、非公开歌单提示、曲序和来源身份保持原规则。
网易云两个入口已有校验，本批不改其实现，加入同场景界面回归。
移动 `catalogSession` 原本会保留已经成功加载的页、显示重试；本批复用该能力，没有新状态机或新的错误界面。

无新增依赖、请求路由或日志字段。共享 QQ provider 的桌面／Web 调用同样受益于错误响应校验，
不能声称共享层完全没有行为变化；有效响应和调用签名保持兼容。
部署锁文件继续固定 `@yakult-green-tea/qq-music-api` 3.1.4；本批没有更新服务或核验真实账号响应。
移动 CI 增加现有 QQ／网易云 provider 与 QQ transport 单测入口，让这次共享层回归也在后续提交时执行；不新增测试运行库。

## 验证

证据目录：`.mobile-test-results/playlist-response/`。

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| 修复前解析复现 | 12 FAIL，73 PASS | `unit-red.log`；每个入口覆盖 undefined／null／对象／字符串 |
| 修复前页面复现 | 1 FAIL | `ui-red.json`；QQ 后续个人歌单页没有重试入口 |
| 两平台 provider、QQ transport、移动会话逻辑 | PASS，267 项，4 文件 | `unit.log`；包括真实空数组、原分页／路由回退和会话行为 |
| 类型检查 | PASS | `typecheck.log` |
| 移动资源构建 | PASS | `build.log`；未安装 |
| 最终三视口界面回归 | PASS，138 项 | `final.json`；手机、iPad、窄窗口；其中新增 30 项，既有回归 108 项 |

新增界面场景经过实际 Omni/provider/会话逻辑，原生桥与上游响应受控：两平台个人歌单翻页失败保留前 100 项、
重试后读到第 101 项；QQ 自建／公开及网易云曲目后续页失败保留前 50 首，重试后读到并播放第 51 首；
确认空库／空歌单不显示错误、不退出账号、不继续翻页。QQ 公开歌单仍按原接口整表读取再本地分页，
不能把其网络 offset=0 误写为服务端分页。其他曲目页保持失败 offset=50 重试。

保留测试修正记录：`targeted.json` 误用 DOM 行数检查虚拟列表（4 PASS、1 FAIL、5 未执行）；
`corrected.json` 到达 QQ 公开歌单后发现夹具未匹配 `/getSongListDetail/:id`（6 PASS、1 FAIL、3 未执行）。
修正测试计数与路径后，`public-corrected.json` 的 4 项定向测试通过；没有改生产协议或放宽错误校验。
重复运行不累加覆盖，准确提交、资源归档、报告摘要与 CI 单独保存在本地 `delivery.json`。

## 仍待验收与回退

真实平台、真实账号、物理 iPhone／iPad、原生容器与后台播放本批 `NOT_RUN`。
个人安装包仍为 mobile.28，服务器、签名记录、音频算法、原动效与设置布局未更新。
回退本次源码提交即可，无数据迁移；两平台完整真机矩阵与网易云 30 分钟锁屏仍未完成。
