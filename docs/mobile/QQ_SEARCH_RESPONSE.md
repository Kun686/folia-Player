<!-- QQ_SEARCH_RESPONSE.md — malformed search data, controlled UI proof, and anonymous upstream limitation. -->
# QQ 搜索异常响应与重试

2026-10-14，源码基线 `d7ee3e5106334bf5c83244ddf9b34771751fd743`。
按 [CURRENT_SCOPE.md](CURRENT_SCOPE.md) 继续 QQ／网易云核心搜索链路；本批不扩展功能。

## 问题与修复

QQ 搜索响应外层成功、但缺少 `request.data.body.item_song` 时，
原共享归一化器的 `|| []` 将其当成成功空列表。移动首屏显示“暂无结果”，分页则结束且没有重试入口。
首屏问题已通过实际 MobileApp、Omni/provider 和原生请求桥夹具复现。

`qqLyricSearch.ts` 现在只接受数组，缺失／null／非数组一律抛出不含响应内容的固定错误。
显式空数组继续成功返回空结果，歌曲映射、请求参数、匿名请求头、分页与队列语义保持原实现。
移动端沿用既有错误提示和重试：保留前一页，失败页重试不前进游标；没有新增界面、状态机或网络入口。

复用已有 QQ 解析器、Omni 路由、catalogSession、Vitest 和 WebKit 夹具，无新增生产依赖。
该解析器也用于原生歌词匹配；共享逻辑回归覆盖原 QRC 解码和匹配结果。
桌面／Web 的 `searchQQLyrics` 原有 catch 空数组回退仍保留，新拒绝路径会经过其已有错误日志。
因此不能声称共享层完全没有行为变化；本批没有修改桌面回退规则、原歌词算法或动画。
CI 在现有两平台 provider 检查中加入 QQ 搜索解析用例，避免其被 provider mock 隔离后漏测。

## 验证

证据目录：`.mobile-test-results/qq-search-response/`。

| 检查 | 结果与范围 |
| --- | --- |
| 修复前解析测试 | `unit-red.log`：11 FAIL、5 PASS；9 个异常结构被当作空结果，2 个非数组原本抛出不明确的 map 类型错误 |
| 修复前页面 | `ui-red.json`：首屏缺失数据确实没有重试；另一个用例错用了仅歌单显示的“当前范围”计数，未进入目标断言，不能算第二个产品复现 |
| 修复后逻辑 | `unit.log`：311 PASS／8 文件；QQ 搜索、两平台 provider、原歌词匹配、原生匹配 runtime、catalogSession、队列及共享元数据调用回归 |
| WebKit | `ui.json`：30 PASS、0 失败／跳过／重试；12 个新增窗口实例加 18 个既有搜索点播回归 |
| 类型检查、移动资源构建 | PASS；`typecheck.log`、`build.log` |
| 当前 Mac 匿名 QQ 上游查询 | 两次 HTTP 200，但业务 `request.code=2001`；真实成功搜索与真实空结果验证 `BLOCKED_UPSTREAM` |
| 本批原生容器、物理设备、真实账号、服务器部署、个人包更新 | `NOT_RUN` |

WebKit 使用现有 Playwright 配置，地址 `http://127.0.0.1:4179/mobile.html`；
手机 390×844、iPad 1194×834、窄窗口 600×834。会话未提供 Browser skill，按前端测试技能使用仓库 Playwright。
新用例覆盖首屏失败重试、已加载 50 首后的失败保留／第 2 页重试、恢复后点播第 51 首只追加一首、
显式空数组停止分页且不退出账号，以及业务码 2001 仍显示错误。
分页测试改为检查虚拟列表两端与实际选曲，没有为通过测试修改生产页面或伪造计数。

实际页面有内容、无 Vite 错误覆盖层；新增首屏故障／恢复流程无 pageerror。
手机失败状态及 iPad 保留前页的截图已检查，见 `ui/*/qq-search-error.png` 和 `qq-search-page-error.png`。
既有搜索播放回归仍输出 QRC/KRC 的 `DecompressionStream warning (ignored)`；
本批未修改该解压路径，不将用例通过写成这些诊断已解决。

匿名查询使用当前源码的请求参数构造器，直接请求 QQ 公共接口，未使用真实账号或服务器凭据，
未连接或更改个人服务器。只保存响应形状／业务码摘要：`known-song.json`、`no-match.json`。
两次均为业务失败，不能据其中的空数组宣称真实空搜索格式已经通过，也不能据 Mac 的结果认定 iPhone 服务端搜索同样失败。
初次临时检查脚本错误引用了未安装的 esbuild，未发出请求；改为项目已安装的 Vite 后完成两次查询，没有安装包。

关键命令均由 `codex-bounded` 限时：

```sh
npm run test:unit -- test/unit/lyrics/qqLyricProvider.test.ts test/unit/lyrics/autoMatchBestLyric.test.ts test/unit/mobile/nativeLyricMatch.test.ts test/unit/mobile/catalogSession.test.ts test/unit/mobile/queueActions.test.ts test/unit/onlineMusic/qqProvider.test.ts test/unit/onlineMusic/neteaseProvider.test.ts test/unit/localLibrary/onlineMetadataSearchService.test.ts
npm run test:mobile:ui -- qq-search-response.spec.ts search-playback.spec.ts
npm run typecheck
npm run build:mobile
```

## 交付边界

个人 App 仍为 mobile.28，服务器、签名配置、依赖锁文件和根 README 未更新。
最新源码真实账号搜索／登录／播放回归、网易云长时间锁屏、耳机／蓝牙／网络切换与真机动效性能仍待验收。
不因本批受控测试通过而扩大真实平台验收结论。
回退本次源码提交即可，无数据迁移。准确提交、构建资源摘要、截图与 CI 见本地 `delivery.json`；
提交前资源内嵌 SHA 仍为上述基线，不表示个人安装包已经更新。
