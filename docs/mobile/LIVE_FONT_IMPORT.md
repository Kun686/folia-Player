<!-- LIVE_FONT_IMPORT.md — native font file selection, persistence and cleanup evidence. -->
# 自定义字体实际导入与恢复

2026-10-15，在已登录 QQ／网易云的独立 iPhone 17 Pro / iOS 26.5 模拟器补验此前未完成的实际字体文件流程。
本批没有生产代码修改、新增依赖、构建、安装或服务器改动；个人 iPhone mobile.28 保持。

## 复用与测试材料

使用原有 `FontControls`、`useTypographySettingsStore` 与 `customLyricsFont`，通过 App 的原生文件选择器操作。
测试字体来自本机已安装的 `/System/Library/Fonts/Supplemental/Arial Black.ttf`，仅临时复制到独立 App 的 Documents。
文件名 `Folia-QA-Arial-Black.ttf`，122556 字节，SHA256：
`7d7db3ad96a31373c1437c6ab14266f6605495544c8e663558b047521174c42e`。
不将字体提交仓库、打包进 App 或作为可分发样本；收尾已删除此临时副本。

目标 UUID `9213032A-657A-40CD-BD2A-A3065ACCC8EC`，Bundle ID `app.folia.validation.App`。
现有主二进制 SHA256 在前后相同：
`b7b39a6cf9d0efe5eb437558faf1cb31879816e1cc5c0fc5af9eebc0c4d81dee`。

## 结果与证据

证据目录：`.mobile-test-results/live-font-import/`。

| 检查 | 结果 | 证据与边界 |
| --- | --- | --- |
| 原生文件选择并导入 TTF | PASS | 上传自定义字体 → Choose File → 浏览 → Folia；文件可选择，返回后显示 `Folia-QA-Arial-Black` 与恢复按钮；`imported.png` |
| 终止并重开同一 App | PASS | 无卸载／重装，重开后仍选中同一字体；`restored.png`、`restored-state.json` |
| 完整字体字节持久化 | PASS | 只读检查指定字体记录，122972 字节记录包含与源文件完全一致的 122556 字节；`font-record-before-clear.json` |
| 恢复内置字体 | PASS | App 内点击恢复，显示无衬线；指定字体 IndexedDB 记录为 0，字号／字体／主题／模式等本次白名单设置与基线相同；`cleared.png`、`final-state.json` |
| 队列及音效保持 | PASS | 完整原生队列 JSON 和音效 JSON 与基线相同；51 首、索引 4、QQ《我怀念的》122.68798185941043 秒暂停 |
| 两平台登录界面恢复 | 已观察 | 重开后两账号与歌单入口可见；`qq-after.png`、`netease-after.png`。不等同于重新扫码或所有接口验收 |
| 字形视觉一致性／其他格式 | NOT_RUN | 本次 TTF 为拉丁字体，中文歌词会回退；未将中文舞台截图当作该字体字形证明，未测 WOFF／WOFF2／OTF 全格式 |
| 本批音频、真机、iPad、长播、完整 UI | NOT_RUN | 全程暂停，未新增播放或长期性能证据 |

`baseline.json` 保存本轮前的限定设置、原生队列／音效和包摘要；未读取或输出平台凭据。
源码中导入成功须等待 `FontFace.load()` 和 IndexedDB 写入；本批实际观测是 UI 选择状态和持久化字节，
没有额外注入代码读取运行中 `document.fonts`，不将源码流程本身算作独立渲染测量。

## 工具与清理

原生滚动未生效时复用既有本机模拟器镜像转发触摸，仍操作实际 App。
首段镜像的 600 秒限时结束，重开恢复／清理另开一段 600 秒限时镜像并提前停止；没有持续采集日志。
Xcode 工具启动附带的两个日志助手已终止；随后使用有界 `simctl launch` 无日志启动同一包。
字体、账号、队列检查未发生产品用例失败；基线脚本首次使用不匹配的存储文件名失败，改为实际 SQLite 路径后单次重试成功。

最终通过 App 清除字体记录、移除指定临时文件、关闭镜像标签并按 UUID 停止服务。
`cleanup.json` 确认本轮镜像和日志助手均无残留；App 有意留在 `final-paused-stage.png` 所示暂停画面。
无需代码回滚；保留此前其他工作区变更。

## 尚未完成

此记录补齐原 [主题与字体设置检查](LIVE_VISUAL_SETTINGS.md) 中的实际 TTF 导入缺口，
没有改变历史三个 WebKit 用例的 SKIP 状态，也不证明全部设置／动效已经验收。
QQ 偶发空搜索仍按 [搜索记录](QQ_SEARCH_STATUS.md) 保持未解决；真机、网易云 30 分钟锁屏、
耳机／蓝牙／网络切换、URL 过期、歌词误差与长期内存／温升仍需独立证据。
