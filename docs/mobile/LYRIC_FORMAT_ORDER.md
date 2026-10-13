# 本地歌词文件格式优先级

2026-10-13。移动端恢复原版格式排序设置，并接入已有的文件夹批量重扫流程。
仅修改源码和受控测试；未操作个人 App、物理设备、真实账户或服务器。

## 实现与复用

`useLocalFolders` 已在导入和重扫时读取原 `localLyricFormatOrder`，但移动界面没有设置入口。
现在可从「服务器与外观 → 本地歌词文件格式优先级」调整六种格式的顺序、恢复默认和重新扫描。

- 直接复用 `LocalLyricFormatOrderSetting`、原 store、`local_lyric_format_order` 存储键及
  `normalizeLocalLyricFormatOrder`，不新增解析、排序算法或依赖。
  移动端通过 44px 上移／下移按钮调整；桌面仍默认使用原拖动手柄。
- 原组件支持注入重扫动作，移动端使用已有 `useLocalFolders.rescanAll`，显示既有进度、
  取消、部分完成和失效目录提示。hook 返回真实批次结果，只有全部完成才清除待应用提示。
  未导入目录时可保存顺序，重扫按钮禁用，并显示原版说明。
- 修改只影响后续扫描，不会立即改写歌词。批次使用启动时的顺序；扫描期间再次修改，
  已完成的旧批次不会把新顺序标为已应用。取消／部分失败保留待应用提示和之前完成的目录。
- 保存失败保留原 store 值并恢复排序草稿，显示错误，允许重试。补齐中／英／印尼语按钮与错误文案。
- 保持 `.fia` 始终最优先、手动上传歌词不受格式排序影响的原规则。
  没有改动 Swift 扫描事务、上传歌词保护条件或原生桥协议。

这是功能设置，无视觉配置协议变更；桌面 `settings-local-lyric-format-order` 命令已存在，
移动端提供现有设置面板内的触摸入口。

## 验证

本地证据：`.mobile-test-results/lyric-format-order/`；`source.json` 保存基线
`8e63e68b989e4cd85f47a297f0b5cb265299f274` 上 13 个源码／测试文件摘要。

| 项目 | 结果 | 范围 |
|---|---|---|
| TypeScript | PASS | `typecheck.log` |
| 逻辑 | 28 PASS / 4 文件 | 格式规范化、FIA 优先级、翻译文件选择、导入协议、目录批次及取消边界 |
| WebKit | 27 个不同场景 PASS | 9 项新设置场景、12 项原批量重扫、6 项原导入／目录浏览，覆盖 phone、ipad、ipad-narrow |
| 原生容器／实际目录／真实平台／真机 | NOT_RUN | 本批没有改原生代码或重新安装 QA／个人 App |

新设置测试包含重载恢复、默认顺序、触摸尺寸、旋转、扫描中的新修改、存储失败、取消和空目录库。
首次 27 项通过后，截图发现拍摄发生在排序动画中途，补充行位置不重叠断言，单独复测 9 项通过；
不重复累计。最终截图在 `playwright-final/`，相应日志为 `ui-final.log`。
已有批量重扫用例与新设置用例共用提取后的受控原生 fixture。

```sh
npm run test:unit -- test/unit/lyrics/localLyricFormatOrder.test.ts test/unit/mobile/nativeFolderRuntime.test.ts test/unit/mobile/localFolderImport.test.ts test/unit/mobile/localFolderRescan.test.ts
npm run test:mobile:ui -- lyric-format-order.spec.ts local-folder-rescan.spec.ts local-folders.spec.ts
```

本轮证明原规则与前端传给桥的扫描顺序一致；受控桥不等于实际文件系统、系统目录授权或真机验收。
桌面拖动交互未重新执行，默认接线保留。最终提交的 CI 执行类型检查、移动逻辑回归和移动前端构建，
结果存于本地 `ci.json`。

## 回退与待验收

撤销本轮改动即可恢复此前入口；原格式顺序存储键及目录数据兼容，无需迁移或服务器修改。
个人 `BUILD_RECORD.json` SHA256 保持
`ec176ad6a9b5d72435ada9d0fa3a8e399e7c7ed0047045b7991423d1adb2de73`。
实际多格式目录导入／重扫与手动上传保护仍需对应设备验收；完整 Automix 的真机联合负载、
长期温升／内存和人工听感也仍未完成。
