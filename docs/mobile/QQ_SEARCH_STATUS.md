<!-- QQ_SEARCH_STATUS.md — real empty-search evidence, nested-status validation, and deployment boundaries. -->
# QQ 搜索业务状态校验与真实复测

2026-10-14，`mobile-main` 工作区。延续 QQ／网易云核心功能优先，不扩展其他功能。

**结论：搜索正文状态校验曾通过真实复测；2026-10-15 当前独立 iPhone 模拟器再次出现空搜索，稳定性验收未通过，根因仍未确认。**

## 2026-10-15 中文真实曲名对照（未复现）

复用既有同版路由重放探针，将查询改为真实QQ歌曲《我怀念的》《我不难过》，最多4组／8请求。
每组原请求与一次原样重放的实际序列化请求体及请求头一致；8次均返回50首，HTTP200、外层／RPC／业务码0，
总数分别1001、1000，耗时358–535ms。会话文件、内存会话、容器均保持。
结果 **INCONCLUSIVE_NO_DIVERGENCE**：没有捕获相同请求出现不同结果，不能认定重放能修复空响应或搜索稳定性通过。
此前真实零总数失败保留，不继续重复同类成功批次；没有增加产品重试、接口回退或部署改动。

本批现场核对 `current=/opt/folia-player/releases/20261015-qq-search-metadata`；
QQ镜像 `sha256:167af42cf04c867b3aa6c882e6dd8f6179fe38ef3e8ef24986298e9498428c71`，
容器 `89bc40cb87d9365727000f1771a117f765a70afd2b5cb1e2c42ec0463a174710`，
路由摘要 `bdaef521471c0442283d6cca18a25fc57100e6374699bf15e913657269028067`。
backend／网易云容器运行且与部署记录相符。DNS当时只返回IPv4，未修改节点或协议；未取得逐请求远端IP，不作节点归因。

证据：`.mobile-test-results/qq-search-known-titles-20261015/` 的 `baseline.json`、`probe.cjs`、
`remote.py`、`payload.json`、`result.json`；结果只含脱敏标量，远端探针退出0。
此为服务器真实接口对照，未操作App、未验音频或真机；不以它代替真实界面的搜索验收。

## 2026-10-15 上游版本静态对照

追加[独立项目空结果报告核查](QQ_SEARCH_PUBLIC_REPORT.md)：公开issue有相似症状，但关闭时无评论／关联提交；
已有多入口回退不提供当前成功零总数的根因，Folia服务器的替代接口此前亦失败。未复制实现、连接SSH或请求QQ；稳定性FAIL保持。

[3.1.4／3.2.0／3.3.0 对照记录](QQ_SEARCH_UPSTREAM_REVIEW.md)：三份发布包完整性通过，
相关RPC构造除模块引用外相同，未找到当前登录态成功零结果的修复依据；新版登录模块重组也使当前补丁不能直接套用。
未升级依赖、部署或调用平台。本次单独获准的SSH只读检查因未取得控制终端而未提交密码、未读部署路径，未继续重试。
此前远端恢复记录仍是历史证据，本次没有刷新为当前已核验状态；真实空搜索失败结论保留。

## 2026-10-15 空响应原样重放实验（未触发）

临时观察器仅在首个真实上游空响应出现时，在内存中原样重放序列化请求体与实际请求头一次；
无论重放结果如何，App仍收到原响应。完整请求、凭据与原始响应均不落盘，不构成产品重试策略。
观察器6项逻辑检查PASS，覆盖原样重放、原响应保留、并发／全局一次上限、过期／取消、敏感信息排除和请求头变化检测。

正常独立iPhone按Power回车／按钮、Love回车／按钮顺序执行四组，共16次，全部50首；
第8次后仅重开同一App，第9、10次13位search_id也成功。达到16次／8分钟界限即停止。
**INCONCLUSIVE / EMPTY_REPLAY_NOT_TRIGGERED**：没有空响应，原样重放未执行，不能证明重放有效或搜索已修复。
前一批96ms零结果及搜索稳定性FAIL保留；不再重复这组未改变条件的成功批次。

证据目录`.mobile-test-results/qq-search-exact-empty/`含6项`unit.log`、16张实际搜索截图、
`stage-result.json`／`result.json`和`app-baseline.json`／`app-final.json`。
完整51首原生队列与音效JSON、二进制摘要均保持；恢复网易云曲库和QQ《我怀念的》122.68798185941043秒暂停画面。
个人mobile.28未更新，本批没有音频、真机、长播或完整UI新增验收。

QQ已恢复原镜像`sha256:167af42cf04c867b3aa6c882e6dd8f6179fe38ef3e8ef24986298e9498428c71`，
本批恢复后容器`89bc40cb87d9365727000f1771a117f765a70afd2b5cb1e2c42ec0463a174710`。
入口、正式env／current、会话和backend／网易云容器保持；临时镜像已移除。
服务器证据`/opt/folia-player/evidence/20261015-qq-search-exact-empty/`，本地恢复截图及`cleanup.json`已保存。

## 2026-10-15 同次失败的服务端上下文已捕获

本批取得了此前缺少的证据：正常独立 App 的第11次实际 `Love` 回车搜索显示“暂无结果”，
同一次服务端请求确实收到 QQ 上游成功码与零总数。随即停止，未执行预定上限中的第12次搜索。
没有改 App、搜索参数、响应语义、账号或重试策略。

| 观察 | 结果 |
| --- | --- |
| 请求1–10 | 各50首，上游耗时401–533ms（本批成功区间） |
| 请求11，Love，第1页／50首 | HTTP200、envelope0、RPC0、business0、meta.ret0，sum0、curpage1、nextpage-1、count0，96ms |
| 失败请求参数 | Axios实际序列化参数与服务入参一致；query为Love；search_id为14位，未与上一请求重复 |
| 失败请求会话 | 运行中凭据／设备与持久化会话相同 |
| 失败与成功请求公共上下文 | comm及Cookie／User-Agent／Content-Type／Accept固定请求头相同 |
| socket | 全部报告reusedSocket=false；没有取得远端IP，不判断节点差异 |

这次确认零结果由QQ上游返回，排除本次前端归一化丢歌曲、已比对的会话／设备／固定头变化和13位ID解释。
没有证明所有请求字段都完全相同（例如search_id值不同），不能据此认定风控、缓存、节点、ID具体值或其他原因。
前8次在原运行App中进行，第8次后仅终止／重开同一App，第9–11次继续；服务器观察器不中断。
失败不是重开后的第一条请求，不能将App启动本身视为原因。

此前先做8次单变量对照：四组13位／14位ID各4次，Power／Love与先后次序交错；
每组实际序列化请求除ID及必然变化的Content-Length外一致，全部50首。
该结果仅不支持“13位ID必然返回空”的假设，不是空搜索修复或所有ID范围验收。
证据为`.mobile-test-results/qq-search-id-range/result.json`，会话及容器保持。

实际捕获目录`.mobile-test-results/qq-search-context-capture/`：

- `live-context.cjs`／`live-context.test.cjs`：复用前序观察器，仅扩大为最多12次、8分钟；4项透传、敏感信息排除与上限检查通过。
- `stage-result.json`／`result.json`：临时镜像、11条服务器记录及恢复核对；同样的脱敏记录保存在服务器`/opt/folia-player/evidence/20261015-qq-search-context-capture/`。
- `11-love-enter-empty.png`：实际空结果画面；`ui-observations.json`保存操作顺序。第8次有工具画面观察，无单独PNG；不补造截图。
- `app-baseline.json`／`app-final.json`：完整51首队列／音效JSON保持，仍暂停于QQ《我怀念的》122.68798185941043秒；主二进制摘要未变。
- `netease-restored.png`／`final-paused-stage.png`／`cleanup.json`：原曲库、两平台登录可见、暂停舞台及无残留助手。

观察镜像已撤下，恢复原镜像`sha256:167af42cf04c867b3aa6c882e6dd8f6179fe38ef3e8ef24986298e9498428c71`，
该批恢复后的QQ容器为`7c506a3586ceb93464360113edba589892d267c1230438903c0734283dded0d7`。
正式env、current、会话文件及backend／网易云容器保持；临时镜像已删除，无后台诊断进程。
第一次SSH尝试因有界包装启动新session后缺少控制终端，在密码输入前退出；本地验证`script`提供控制终端后单次重试成功。
后续部署观察／收尾连接均完成；没有因第一次失败改认证配置或重复请求密码。

**下一步**：在下一次空响应当场、仅在内存中原样重放完整上游请求一次，区分相同请求响应不稳定与未比较的请求值差异。
本批未保留完整请求／凭据，不能从这份标量记录重新构造那个失败请求，也不能宣称已经验证原样重放。
不要再以普通成功搜索批次代替这个实验；本批搜索稳定性仍FAIL，个人mobile.28不更新，音频／真机／长播／完整UI均未新增验收。

## 2026-10-15 请求与会话对照（未复现，不作为修复）

本批用两个有界实验区分请求构造、运行中会话与上游响应差异，没有修改搜索协议、排序、空结果语义或重试策略。

- **同版库原样重发**：在现有QQ容器的独立进程中只读恢复唯一有效会话，复用生产路由生成请求。
  Power／Love共8组、16次全部50首；每组Axios实际序列化请求体和请求头相同，comm／凭据上下文一致，
  会话文件及内存会话保持。结果为 **INCONCLUSIVE_NO_DIVERGENCE**，并未复现故障，不能认定重发可修复空结果。
  socket地址读取均不可用（null），不用于连接节点判断。
- **真实手机请求的服务器被动观察**：临时镜像仅观察Power／Love，最多4次、5分钟自动停用，不替换请求或响应。
  观察器4项逻辑检查通过：透传、错误透传、关键词限制、次数／时限及敏感内容排除。
  未更新的正常独立iPhone包实际执行Power回车／按钮、Love回车／按钮，均50首；上游耗时508／403／561／502ms。
  HTTP200、外层／RPC／正文code0、meta.ret0，Power总数996、Love总数1037，nextpage均2。

四次实际发出的参数与服务入参相等，运行中的凭据／设备信息与持久化会话相等；comm及Cookie、User-Agent等固定请求头跨次一致。
search_id均14位、相邻不同，均使用新socket。这些只说明本批**成功请求**的状态，不能外推到此前失败请求。
本批未运行或重跑失败的XCTest；此前0／50／50／50的真实失败继续保留，**搜索稳定性未通过**。
下一次需要取得同一次空响应对应的服务端上下文；不能继续用成功批次代替失败定位，不能按成功样本猜测ID位数规则。

观察结束已恢复原QQ镜像`sha256:167af42cf04c867b3aa6c882e6dd8f6179fe38ef3e8ef24986298e9498428c71`及原入口源码；
当前QQ容器ID为`cbff440e1913a7d0b36f960790b9f82a582c2ce83343d5c237b42e10e9d8d8c4`。
本次用临时Compose覆盖文件，正式env和current未改；backend／网易云容器ID及QQ会话文件保持。
临时镜像和容器内观察文件已清除，收尾记录在服务器`/opt/folia-player/evidence/20261015-qq-search-context/`。

本地证据仍在`.mobile-test-results/qq-search-metadata/`：`replay-result.json`、`context-unit.log`、
`context-stage-result.json`、`context-result.json`、四张`context-power-*`／`context-love-*`实际截图、
`context-restored-netease.jpg`、`context-app-state.json`及`context-cleanup.json`。
正常模拟器二进制仍为`b7b39a6c…d81dee`，两账号可见，队列／音效逐字段比较未发现变化，恢复网易云曲库选择和原歌曲暂停画面。
收尾检查先遇到历史容器路径失效，改用当前路径后检查器又漏解析plist的bytes JSON；随后只读解析比较无字段差异，
失败检查没有写成自动测试PASS。进程清理检查先遇到ps输出非UTF8字节，修正解码后一次重试完成，无残留SSH／诊断进程。
本批未更新App或个人mobile.28、未播放音频；真机、长播及完整UI仍NOT_RUN。

## 2026-10-15 数值诊断上线与实际失败

本次沿用已授权的两平台服务修复范围，先读取当前容器／源码基线，再建立独立候选并验证；
此前仅限 `readlink` 的额外检查已在上一批完成，不将它表述为部署授权。
线上旧 QQ 路由 SHA256 为 `bed7ddf47e1fb8ec3afad424fc0139c63337767f198cb4f59c0b01286646cd1c`，与本地补丁基线一致。

仅保留既有上游数值元数据的路由已经上线，搜索协议、排序、空页语义、登录和播放均未改动。
独立候选、正式 HTTPS 各进行 Power／Love 两页真实搜索，8 次全部返回50首，认证缺失／失效检查和会话保留通过。
候选会话使用副本，生产会话文件哈希不变；临时容器、网络及私有副本已经清理。

随后在已登录独立 iPhone 的真实界面执行4次搜索，原生被动观察器取得了**失败同次响应**：

| 操作 | HTTP / 封装 / 搜索正文 / meta.ret | sum / curpage / nextpage | 歌曲数 | 时间 |
| --- | --- | --- | --- | --- |
| Power，键盘回车 | 200 / 200 / 0 / 0 | 0 / 1 / -1 | **0，FAIL** | 138ms |
| Power，搜索按钮 | 200 / 200 / 0 / 0 | 996 / 1 / 2 | 50 | 535ms |
| Love，键盘回车 | 200 / 200 / 0 / 0 | 1037 / 1 / 2 | 50 | 681ms |
| Love，搜索按钮 | 200 / 200 / 0 / 0 | 1037 / 1 / 2 | 50 | 596ms |

每次提交对应一次请求。XCTest **1用例 / 1断言失败，150.141秒**：准确捕获第一条零结果，不是等待超时。
已停止于4次预定操作，没有再次执行此测试；保留失败，不将后三次成功当作搜索稳定性通过。

这次数据排除了「原生响应有歌曲而前端丢失列表」及「总数非零但本页为空」两种解释。
现有部署路由直接保留上游的数值字段：失败时搜索上游给出成功业务码和零总数，具体原因仍未知。
不能凭较短耗时或输入方式直接认定风控、缓存、搜索ID或键盘错误；Love回车仍可成功。
原生 GatewayClient 使用 ephemeral URLSession 并禁用 URLCache，当前没有支持原生缓存致因的证据。
下一步应对照同版库的上游请求构造和会话／设备上下文，寻找可复现差异；不为合法空搜索添加猜测性的重试或错误。

本批证据目录 `.mobile-test-results/qq-search-metadata/`：

- `production-baseline.json`、`deployment-metadata.json`、`candidate-metadata.json`、`production-search-metadata.json`、`final-metadata.json`：实际部署、8次服务搜索和清理。
- `observer.test.cjs`、`observer-result.json`：对实际 Swift 内嵌观察脚本的5项检查通过；仅数值白名单、空结果保留、请求／错误透传、未批准关键词不采集、清理恢复。它们不是平台验收。
- `native-build.log`、`qa-manifest.json`：原生测试编译及独立身份／130资源一致；QA只改变测试观察代码，没有替换请求或歌曲。
- `live.xcresult`、`live.log`、`command.json`：实际失败用例与执行命令；脱敏响应在 `attachments/AF05FB3D-579A-4A49-9D3C-D925FFC1A87B.json`。
- `power-enter-empty.jpg`：首次真实空结果；最后搜索界面由 XCTest 截图附件保存，`after-test-home.jpg` 仅为测试结束回到桌面，不是搜索结果证据。
- `restored-state.json`、`restored-qq.jpg`、`restored-netease.jpg`、`restored-player.jpg`、`cleanup.json`：恢复正常模拟器包和状态核对。

正式 release：`/opt/folia-player/releases/20261015-qq-search-metadata`。
仅 QQ 镜像改为 `sha256:167af42cf04c867b3aa6c882e6dd8f6179fe38ef3e8ef24986298e9498428c71`，
路由 SHA256 为 `bdaef521471c0442283d6cca18a25fc57100e6374699bf15e913657269028067`。
backend／网易云容器ID保持，backend健康。前版 `20261014-online-likes`、旧QQ镜像和本release的
`rollback-metadata/mobile.env`（0600）保留；回退时恢复原配置并仅重建QQ容器，再恢复current指针，不覆盖会话卷。
部署脚本在正式HTTPS检查失败时自动恢复原配置和QQ镜像。

独立iPhone已原位恢复正常包 `b7b39a6c…d81dee`，签名与130资源核对通过。
两平台账号仍显示；原生用例确认凭据和队列保持，结束后完整原生队列／音效JSON与基线相同：
51首、index 4、122.68798185941043秒暂停，深色／绘光保留。临时镜像和观察器已退出。
个人mobile.28未更新，本批没有播放音频。物理设备、长播、完整UI／动效和搜索稳定性仍未验收。

## 前序连接与本地准备记录

2026-10-15 后续定位：用户额外批准的一次60秒SSH只读检查到达密码提示，但在输入提交前超时退出124。
未完成密码验证、未获取当前部署路径、未修改服务器；没有自动重试，也不据此判断密码或服务器状态。
记录见 `.mobile-test-results/netease-session-body/ssh-readonly-result.json`。
同日QQ／网易云登录响应体竞态修复是独立缺陷，不作为本空搜索问题的根因或修复证据。

2026-10-15 追加结果：用户通过 `call_adcdefc1cf624abab76fb3ba8ead97f4` 允许再执行一次最多60秒的只读检查。
本次及时提交密码，SSH退出0，`readlink /opt/folia-player/current` 返回 `/opt/folia-player/releases/20261014-online-likes`。
只确认部署路径，没有检查容器／镜像、没有部署诊断补丁或继续搜索；此前超时证据保留。
记录见 `.mobile-test-results/qq-search-metadata/ssh-readonly-approved.json`，其中不含凭据。

### 诊断补丁的本地准备（现已上线，见上方）

2026-10-15，本地 `qqSearchRoute.cjs` 已准备一个仅保留响应证据的补丁：成功返回时，
将原本丢弃的 `data.code` 及 `data.meta.ret/sum/curpage/nextpage` 交给现有客户端。
这四个 meta 字段仅接受安全整数，不做字符串转换、不转发任意 meta 或 feedbackURL。
字段来源为固定 QQ API 3.1.4 的真实成功记录 `live-search-trace/nested.jsonl`；
没有假设它们在异常空响应中是什么值，也未按总数推测错误或自动重试。

普通歌曲字段、排序、搜索协议、错误分类、合法空页和 provider 解析保持原样，无新依赖、日志或账号写入。
这是为了下一次失败能区分零总数、非零总数与分页异常，**不是空搜索修复；准备阶段尚未上线**。

本地证据 `.mobile-test-results/qq-search-metadata/`：

- `unit-fixed.log`：路由／真实固定版本库扩展／QQ provider／transport 共 3 文件 **164 PASS**。
  覆盖空和非空列表兼容、数值字段保留、任意文本不外传及现有认证／取消行为。
- `unit.log`：首轮 162 PASS／2 FAIL；新增参数化测试把数组当测试行，被 Vitest 展开成参数。
  改为对象行后仅重跑一次，保留首轮证据。这不是 QQ 平台调用结果。
- `candidate/qqSearchRoute.cjs` 通过 `node --check`；`route.patch`、`route-before.cjs` 和 `manifest.json`
  保存最小补丁与哈希。改动前路由 SHA256 与上一部署记录 `bed7ddf…46cd1c` 一致，
  但这不替代服务器当前版本核对。候选 SHA256 为 `bdaef521471c0442283d6cca18a25fc57100e6374699bf15e913657269028067`。
- 当时部署、真实新字段及失败原因均为 **NOT_RUN**；后续上线与实际失败证据见上方，不覆盖原始准备记录。

再次 SSH 检查已按用户重试限制请求单独许可；许可仅涵盖60秒内只读 `current` 路径，
不包含本次直接部署。连通后先核对运行版本和回滚条件，后续再按已授权的服务修复范围准备独立候选。

## 2026-10-15 当前包再次复现

沿用音频设置／浅色控制器修正后的独立模拟器包，没有重新构建、安装或改产品代码。
主二进制 SHA256 `5b16d5f670bf205e873d96293d395ee0045f2c38fe05c4c180a0cbc39d907311`，
安装包 128 个应用资源及 2 个空 Cordova 文件与该批清单一致。

使用用户已登录的 QQ 账号，通过真实界面进行以下有限检查；没有注入歌曲或替换响应。
以下是**界面观察**，本批没有运行被动原生请求观察器，也没有采集 HTTP／业务码或上游原始响应。

| 次序 | 操作 | 实际界面 | 证据 |
| --- | --- | --- | --- |
| 1 | Power，原生键盘回车 | 显示 50 首，包含 G-DRAGON／Little Mix 等真实结果 | `qq-power-enter.jpg` |
| 2 | Power，搜索按钮 | 显示 50 首 | `qq-power-button.jpg` |
| 3 | Love，原生键盘回车 | **FAIL**，显示“暂无结果”，没有平台错误提示 | `qq-love-enter.jpg` |
| 4 | Love，仅改用按钮提交一次 | 显示 50 首，包含 Slot Machine 等真实结果 | `qq-love-button.jpg` |

这证明之前的状态校验没有消除实际空搜索现象，不证明具体上游错误码或当前失败发生在哪一层。
`MobileApp.tsx` 的回车与按钮共用 `form.onSubmit`，`catalogSession.ts` 再通过 Omni 调用搜索；
且本批 Power 回车成功，因此不能仅凭这次对照把问题归因于键盘，也不加入猜测性的重试。
进一步定位需要在同一次失败中取得归一化前的请求结果与服务端脱敏标量状态；本批未取得该证据。

证据目录 `.mobile-test-results/search-current-ui/`：安装身份／资源核对 `identity.json`，
开始状态 `baseline.json`，结束比对 `final-state.json`，恢复画面及清理 `cleanup.json`。
镜像文字输入未传入 App，改用 Simulator 原生输入后确认搜索词再提交；未输入成功的操作不计搜索。
镜像启动脚本第一次因 shell 引号解析失败未启动，改为正确引用后仅重试一次成功；不涉及 SSH。

两平台账号仍可见，完整原生队列与音频设置按 JSON 比较保持；恢复网易云曲库选择、深色绘光和
QQ《我怀念的》122.688 秒暂停画面。个人 mobile.28、服务器和 iPad 未变更；本批没有音频／长播／真机验收。
搜索停止于上述一次同词对照，不继续循环；仍按两平台核心、特效动画、设置 UI 的既定范围推进。

## 原始失败与诊断

在已登录的独立 iPhone 模拟器中，通过实际界面依次执行 `Power` 回车、`Power` 按钮、`Love` 回车、`Power` 回车。
只被动观察 Capacitor 请求和 DOM，不替换请求、平台响应或歌曲数据。

| 次序 | HTTP／业务封装码 | 返回歌曲 | 耗时 |
| --- | --- | --- | --- |
| Power 回车 | 200／200 | 50 | 565ms |
| Power 按钮 | 200／200 | 50 | 490ms |
| Love 回车 | 200／200 | 50 | 711ms |
| Power 回车 | 200／200 | 0 | 125ms |

最后一次原生桥返回的列表已经为空，页面挂载行数为 0、空状态出现。每次提交对应一次请求，未发现重复提交。
此证据将故障收窄到 provider 归一化之前，但不能进一步区分 QQ 上游与服务链路。
没有获取这次空响应的原始内层业务状态，未猜测它的具体错误码。

服务器上的有界只读诊断共 32 次搜索均返回 50 首，其中 4 次走正在运行的 QQ HTTP 路由，28 次走独立进程中的同版库。
独立进程的前 12 次直接注入现有会话，后 16 次使用库自己的会话解析器和内存仓库；均不替换生产会话文件。
只发现一个有效 QQ 会话；实际部署路由文件哈希与本地修改前一致。
成功响应的 `req_0.data.code=0`、`meta.ret=0`；这些短时成功不能推翻实际 UI 中的失败。

原诊断中的 `rowCount` 错用了未转发给行组件的 `aria-setsize`，不作为证据，已改用 `mountedRows`。
`busy` 只是 DOM 状态节点是否存在，不等于网络忙碌，不用于判断搜索是否结束；以请求完成时间、显示行与空状态为准。

## 确定的代码修正

`deploy/mobile/qqSearchRoute.cjs` 原先只依赖库对外层 RPC 状态的校验，随后看到 `item_song` 数组就返回成功。
现在要求搜索正文 `code` 与 `meta.ret` 都是明确的数字 0，否则返回脱敏的 502／`unavailable`。
只有原有凭据拒绝规则能产生 401；搜索业务失败不清除登录。显式成功的空结果仍可返回空页。
不添加自动重试，不修改查询规则、结果排序、歌曲标识、Omni／provider、音频算法或 UI。

复用固定 QQ API 3.1.4 与现有错误显示，不新增依赖。严格状态校验基于该固定版本的实际响应，后续升级库需重新验证。
这项修正关闭了一个可由代码与逻辑测试确定的错误分类缺口；它与原始偶发空响应之间的因果关系仍未证实。

## 本批验证

证据根目录：`.mobile-test-results/live-search-trace/`。私有凭据、请求头、签名地址与完整平台响应均不写入诊断记录。

| 层级 | 结果与边界 |
| --- | --- |
| 逻辑 | 3 文件 **160 PASS**，覆盖正文失败／缺失状态、合法空页、认证、取消、错误脱敏及原 provider／transport；`unit.log` |
| 服务器独立候选 | **PASS**；真实中文两页各 5 首，英文两页各 50 首，页间不同，认证检查与会话保留；`candidate-status.jsonl` |
| 正式 HTTPS | **PASS**；同样 4 次真实分页搜索，耗时 309–432ms；会话恢复／保留、认证检查通过；`production-status.jsonl` |
| 原生构建 | **PASS**；`build-corrected.log`，128 个应用资源保持，另含 Capacitor 自动生成的 2 个空 Cordova 文件；`manifest-corrected.json` |
| 独立 iPhone 实际 UI | **1 个 XCTest PASS**，0 失败／跳过；相同四次 CUA 操作返回 50／50／50／50 首，最终 9 个虚拟列表挂载行、无空状态；`live-status.xcresult` |
| 状态保持 | 原生断言确认网关配置、QQ／网易云会话、原队列字节保持、播放暂停；正常重开显示网易云登录与原 51 首队列 |
| 真机／长期搜索稳定性 | **NOT_RUN**；没有新的物理设备、PCM、锁屏／长播或长期性能证据；iPad 按用户要求暂缓 |

模拟器：iPhone 17 Pro / iOS 26.5，`9213032A-657A-40CD-BD2A-A3065ACCC8EC`，`app.folia.validation.App`。
最终主二进制 SHA256：`2012b1eb2946d591e17488bc24b1f07bf086a7f3054dca1a2d7ba0820d89095c`。
`LiveSearchAcceptanceTests.swift` 本批执行源码 SHA256：`bf3927f39292a072c26a0d68f42cb0018cb7e746ac26e6dda0973d30c2e140bb`。
该用例仅在显式 `FOLIA_LIVE_SEARCH_QA=1`、独立模拟器身份及已有 QQ 登录下运行；默认跳过，结束恢复临时观察钩子。

首轮失败保留在 `live.xcresult`：一个用例、三个断言失败，其中返回 0 首和空页面是有效失败，旧 `rowCount` 是诊断缺陷。
修正诊断并更新服务后只复验一次，使用独立 `live-status.xcresult`，没有覆盖失败结果。
最终真实搜索截图为 `attachments-status/31486D08-94D0-423C-9A13-A0A27EE13987.png`，完整脱敏记录为同目录 JSON 附件。

## 部署与回滚

正式 release：`/opt/folia-player/releases/20261014-qq-search-status`。
仅替换 QQ 镜像为 `sha256:f068a2bb48b80d1526eab2d4a4c28e496a8fc4bce5af7d17e47a8903f70094f2`。
backend 与网易云容器 ID 保持原值；网关健康。实际容器路由 SHA256 为
`bed7ddf47e1fb8ec3afad424fc0139c63337767f198cb4f59c0b01286646cd1c`，与本批源码相符。

首轮镜像构建 20 秒超时；改用已核对 ID 的本地镜像标签后唯一一次重试成功，候选通过之前未切换生产。
本地首次资源校验因漏计 2 个空 Cordova 文件失败；确认 128 个应用资源逐项不变，并检查额外文件确实为空后，一次修正复核通过。

上一版 release `20261014-qq-auth-search`、原镜像及 `rollback-status/mobile.env`（0600）保留。
回滚恢复旧 `MOBILE_QQ_IMAGE` 并只重建 `qq-api`，将 current 指回上一版；不覆盖当前 QQ 会话 volume。
部署脚本在正式 HTTPS 检查失败时自动恢复原配置／QQ 镜像。
候选容器、独立网络、临时私有配置和会话副本均已清理；`final-status.jsonl` 保存最终身份核对。

个人 iPhone 安装包仍为 mobile.28，本批未安装真机包。新版独立模拟器保持原界面和设置。
后续仍按两平台核心问题、特效动画、整套移动 UI／设置的顺序推进；完整移植不标记完成。
