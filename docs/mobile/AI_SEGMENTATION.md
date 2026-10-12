# 原版 AI 歌词分词移植

2026-10-12。沿用原歌词分词编辑器，补齐 App 内主动调用 AI 的路径。无新增依赖，无真实模型调用，个人 App 未更新。

## 行为与复用

- 「歌词 → 歌词分词调整」使用原「AI 分词」按钮。沿用已保存的 Gemini／OpenAI Compatible 配置，并可进入已有 AI 服务设置；手工粘贴、复制、恢复默认继续可用。
- 复用 `shared/lyricSegmentationPrompt.mjs` 的提示词、schema、Gemini 零思考预算、OpenAI 兼容策略及文本边界校验；没有另写分词算法，不改变正文、逐字时间或播放位置。
- 原 `segmentLyricsWithAi` 的 100 行顺序批处理接受可注入传输。普通网络／解析失败只影响对应批次；合法行保留，模型改写文本的行不采用；全失败不保存。间奏行仍按桌面当前非空行规则处理。
- 原 8192 token 预算、最终思考兼容档四倍预算、DeepSeek 关闭 thinking、JSON／SSE 解析及请求字段协商保留。兼容档在同次多批操作中复用。
- `mobileAICompletion.ts` 提取原移动主题传输，两个功能共用原生网络、取消和错误分类。主题专属提示词、截断及默认值仍由 `mobileAITheme.ts` 保留。
- 桌面 `lyric-segmentation`／`--ai` 入口保持，移动端使用触摸按钮；结果沿用 `lyricSeg_` 存储及现有歌词导出应用路径，没有新增视觉配置字段。

## 凭据、取消和失败

- 同次操作只捕获一次原生配置 revision；JS 不取得密钥、不指定实际 URL 或认证头，音乐会话不参与请求。
- 无密钥、认证失败、限流、配置变化、取消、超时及请求／响应超限停止后续批次；没有网络重试计时器。字段重试仅限原协议参数拒绝或空回答被思考占满预算。
- 每批 120 秒期限、256 KiB 请求／1 MiB 响应限额；JS 先检查请求字节数，原生再次执行边界。
- 关闭编辑器、打开配置、切歌、配置变化或进入后台取消请求。歌曲世代保护先于 React 重绘；Dexie 事务前后再检查取消和身份，迟到结果回滚，保留已有记录。
- 仅显示固定错误，收敛可能包含歌词／模型文本的解析异常，不打印。部分成功明确显示失败批次／行数。
- 点击前说明歌词发送目标及可能费用。分词只在用户主动点击后执行，本轮没有读取或发送用户密钥。

## 验证

日志在 `.mobile-test-results/segmentation-ai/`；生成歌词、AI 响应和原生桥 fixture 不代表真实模型或设备验收。

- 逻辑：136 项／7 文件 PASS，`unit.log`；涵盖原 prompt／locale／批处理、主题回归、SSE、部分失败、限额、最终批次取消、配置隔离及真实 IndexedDB 回滚。
- 最后主题取消检查另跑原 11 项 PASS，`theme-final.log`；与上项重叠，不累加。
- 类型检查：`typecheck-complete.log` PASS。
- WebKit：73 项 PASS、2 项按项目设计跳过，`ui-final.log`；27 项新 AI 分词、27 项原主题生成、19 项原手工分词，覆盖手机、宽／窄 iPad；短屏专项只在手机项目执行。
- 原桌面组件：6 项 PASS，`desktop-chrome.log`；默认 Playwright 浏览器未安装，改用本机已有 Chrome 后通过，无新安装。
- Swift 网络无变更，历史 Keychain／URLSession fixture 证据见 [AI_THEMES.md](AI_THEMES.md) 和 [SYNC.md](SYNC.md)，不算本次重跑。
- 真实 Gemini／OpenAI／兼容服务、个人 iPhone 与物理 iPad：NOT_RUN。

首轮界面定位误用“运行 AI”，改为原按钮“AI 分词”。第二次样本漏回原 LRC 解析器生成的间奏行，校验正确拒绝；改为按实际请求生成完整响应。失败日志保留，没有修改生产校验迁就样本。

### 独立原生 QA 与包核验

- 准确源码：`fbb62fc3bb65e36954916d32c90fa965aef38056`；对应 [CI 38192061789](https://github.com/Kun686/folia-Player/actions/runs/38192061789) 为 `completed / success`。
- `npm run ios:sync` 与签名 Release 模拟器构建 PASS，日志为 `build.log`、`native-build.log`。包内 `build-identity.json` 指向上述源码；包内与同步目录的 125 个资源逐文件 SHA256 一致，`codesign --verify --deep --strict` PASS。证据为 `package.json`。
- 独立 Bundle ID 为 `app.folia.validation.App`，最低系统 17.0；测试目标为 iPad Pro 11-inch (M5)／iPadOS 26.5 模拟器。版本字符串沿用 `0.7.16-mobile.28`，不能据此视为个人已安装包。
- 使用已有生成样本 `First`、真实原生桥进入分词编辑器，再打开 AI 服务设置。页面显示未配置密钥；未输入密钥或保存配置，未发出真实推理请求。返回后点击「AI 分词」，显示固定的缺少密钥提示，原歌词预览仍保留。
- 观察了竖屏页面与旋转后的横屏页面，编辑器、AI 设置／执行入口、错误提示及歌词预览可见。本次没有完成全部方向往返、原生 AI 成功保存或取消场景验收。
- 截图：`native-settings-no-key.png`、`native-no-key-error.png`、`native-landscape.png`。成功推理及取消／持久化结论仍来自自动化 fixture，不来自这次原生短测。
- 个人 `BUILD_RECORD.json` SHA256 仍为 `ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`；本轮没有更新或卸载个人 App，也没有修改服务器或发起真实同步。
- 结束后停止独立 QA App、关闭该模拟器；清理命令与进程／监听端口复核分别记录在 `cleanup.json`、`cleanup-check.json`。

## 回退与交付边界

回退本批源码恢复移动手工分词路径，不删除记录或歌词，不上传分词到同步服务。个人 `BUILD_RECORD.json` 不以 QA 证据覆盖。完整 Automix、真实服务与长期设备验收仍未完成。
