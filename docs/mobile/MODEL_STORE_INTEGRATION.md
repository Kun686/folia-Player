# 原模型按需存储：独立 Folia QA

2026-10-12。沿用已批准的 ORT1.30.0、原模型和独立 QA 范围；个人 App 保持 mobile.28。
状态 **PASS_MODEL_STORE_QA**。这一阶段实现原生模型生命周期服务，尚未连接移动设置页与歌曲队列。

## 实现与复用

- `NativeModelManifest` 与 `NativeORTInference` 共用 `shared/modelManifest.json`，只读取两个原模型。
  校验文件名、大小、摘要、许可和 HTTPS 镜像；不下载桌面的 Python，不修改模型或运行库。
- 下载复用 `NativeMediaDownload`、`NativeMediaTransport`；只增加可选的节流进度回调，原媒体调用默认行为不变。
  顺序尝试原镜像，保留域名及错误码；不回显完整 URL、路径、平台 Cookie 或服务器令牌。
  原有 HTTPS 重定向检查、凭据隔离、600秒传输期限、完整响应和大小上限继续生效。
- 导入和下载共用 `NativeStemSnapshot` 的单描述符复制与 SHA256 校验。先核对精确大小，拒绝目录与符号链接；
  安装到 Application Support 下的 `FoliaModels`，按摘要命名，使用同卷 rename 原子替换。
  文件保持只读、首次解锁后可访问，目录排除备份；校验失败保留原来有效的文件。
- `NativeModelStore` 是 actor。相同模型的重复请求共享任务；不同操作并发时返回 `model-busy`，
  避免未登记的导入在删除后重新开始。取消／删除先废止任务身份，再等待清理；旧进度和旧结果不能写回。
  两个模型的文件传输可以独立进行，取消一个不等待另一个；推理仍由既有全局串行 ORT worker 执行。
- 启动恢复重新核验磁盘摘要；未核验时不报告已安装。文件存在与完整 Automix 可用是不同状态，
  本阶段不修改 `modelAvailability.ts`、`NativeTrackProfiles` 或表现模式开关。
  推理层仍会再次校验固定模型快照，不因存储层已安装而降低检查。

没有新增 npm／SPM／运行库依赖，没有改变桌面下载行为、移动播放器界面或已接受的动画。

## 验证与已发现问题

证据目录 `.mobile-test-results/model-store-integration/`，所有原生测试使用 `app.folia.validation.App`。

- 首次测试命令写错 target 名称，Xcode 未执行测试；修正为工程实际的 `FoliaNativeTests`。
- 首轮执行为11通过／2失败：取消时同一字典的嵌套读写触发 Swift 独占访问崩溃；已将读取和写入拆开。
  另一个失败是模拟器没有返回文件保护属性。仅改变强转类型仍不能取得该属性，第二轮为12通过／1失败；
  保护等级断言改由物理设备执行，模拟器不据此声称已验证设备数据保护。
- 受控 HTTPS 响应验证下载去重、进度、大小及摘要拒绝、镜像回退、错误状态、凭据隔离、取消／删除／重试。
  这些是实际 URLSession 委托测试，响应来自测试协议，**不是公网镜像下载验收**。
- 固定原始模型由已批准的本地资产导入独立 QA；检查恢复状态、独立删除，使用恢复后的 Beat This! 文件
  进行实际推理。测试数据与模型哈希记录在 staging 中。
- `native-platform.xcresult`：iPad Pro11-inch(M5)／iOS26.5模拟器，13通过、0失败、0跳过。
  包含7项模型清单／生命周期测试和6项现有传输／推理回归。拍点与单段分轨的既有参考仍逐字节一致。
- `device.xcresult`：iPhone XS Max／iOS18.7.10，11通过／1失败／0跳过；存储和保护属性均通过，
  失败是手机拍点输出与Mac Node参考的逐字节比较。没有把这项失败解释成已通过，也没有改变模型。
  为区分存储与跨设备计算，补充同一手机直接从原文件推理，要求与安装后文件输出逐字节一致；
  与Mac的数值差继续按已有`NativeORTTests`的最大绝对误差1e-4检查，模拟器仍保留逐字节要求。
- `device-comparison.xcresult`：同一手机12通过／0失败／0跳过，20.739秒。
  两组拍点输出在同机原文件／安装文件之间均逐字节一致；与Mac参考最大绝对误差分别为
  **1.8119812e-5、2.336502e-5**，通过既有数值标准，但仍不是跨设备位级一致。
  手机实测文件属性为`NSFileProtectionCompleteUntilFirstUserAuthentication`；这不替代锁屏读取测试。
  本轮手机未运行完整分轨窗口或播放／动画联合压力测试。
- `native-comparison.xcresult`：追加同机对照后，模拟器重跑这一项通过、0跳过；与Node参考最大误差仍为0。
  此项属于前述13项中的重跑，不重复累计成14项。
- `device-package-final.json`：独立手机QA可执行文件41,659,312字节，含测试插件的App132,135,777字节，
  Bundle中0个模型；191,722,428字节模型另存QA数据容器。这不是个人App或IPA的净增量。
  `source.json`／`source-final.json`记录前后输入摘要，最终改动只有测试对照方式；产品代码不变。
- 完成后已卸载手机与模拟器中的独立QA、关闭本轮模拟器，清理QA模型；无本轮构建或测试进程残留。
  手机个人App的前后安装元数据一致，仍为`app.folia.personal`／build28；`BUILD_RECORD.json`摘要不变。

复现使用已批准固定资产、`transition-validation.xcconfig`与`xcodebuild build-for-testing`，
目标为`FoliaNativeTests/NativeTests`；具体参数保存在`test-*-command.json`。
手机使用独立派生目录，禁止用其构建产物替换个人App。模型缺失时原模型测试会明确跳过，
验收必须核对最终`.xcresult`的0跳过，不能只看命令退出码。

## 待接入与边界

移动设置页的下载／导入／删除交互、模型能力改变后的队列升级与取消、分轨预备和完整过渡接线仍待完成。
公网镜像下载、锁屏文件访问、真实 QQ／网易云模型分析、播放／动画争用、总内存、温升及物理 iPad
均不能由本阶段存储或模拟器证据替代。

回退本阶段提交恢复此前无模型存储服务的工程；个人 App 与其数据未迁移。
独立 QA 的模型目录随 QA 卸载清理，模型原文件与原版清单保持不变。
