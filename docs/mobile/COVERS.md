# 移动端封面与锁屏共用缓存

2026-10-11，接续 [REPLAYGAIN.md](REPLAYGAIN.md)。这是完整移植中的封面阶段；歌词持久缓存、完整
Automix 和真实账号／长时间真机验收仍未完成。个人包尚未更新，测试使用独立 QA 宿主。

## 复用与边界

- 复用原 `resourceCache` 入口和 `db` 的 `cover` 分类。仅在注入移动运行时后交给原生存储；Web／Electron
  仍使用原资源键、旧键迁移与 OPFS／IndexedDB。没有同时在 IndexedDB 保存第二份移动封面。
- 原生复用 `NativeProfileIdentity`，包含平台、歌曲标识、云盘 variant 和保留的来源字段；不以 URL
  作歌曲身份，也不把来源 URL、Cookie 或网关凭据存进封面文件。
- 复用 `NativeMediaDownload`／`NativeMediaTransport` 的取消、完整响应校验、最多五次 HTTPS 重定向和
  凭据隔离。新增可选资源超时参数，音频默认仍为 600 秒，封面为 30 秒、最大下载 8 MB、最多四个并发任务。
- Foundation／ImageIO／UIKit 完成图片检查与缩放，无新增依赖。只解码首帧，限制源像素 4000 万、边长
  16384；产物为最长边 1024 的 JPEG，最大 2 MB。图片处理不在主线程和音频回调执行。
- `Caches/FoliaCovers/<provider>/<identity hash>.jpg` 原子写入，首次解锁后可访问。默认总量上限
  64 MiB，按最近读取时间淘汰。系统可能回收 Caches；写入失败时仍展示已下载图片，不能承诺永久离线保存。
- 本地封面继续读现有导入目录 `cover.jpg`，不复制到在线缓存。清除封面缓存不删除导入音乐、嵌入封面或音频缓存。
- 前台 renderer／取色／过渡效果继续接收原 coverUrl 属性；只替换其数据来源。原歌词解析、主题和动画算法未改动。

## 生命周期

原生 `PlaybackArtwork` 按歌曲身份发起请求，解码完成后写入系统 Now Playing。之后每次时间快照复用
同一个 `MPMediaItemArtwork`；快速切歌或清空当前歌曲会取消旧显示任务，旧图不能覆盖新歌。
无 WebView 时原生仍能获取封面。原生暂停恢复仅查缓存，开始播放后才允许补网络图片。

同一歌曲前台与锁屏请求合并下载。清除／退出按 generation 失效正在执行的工作，取消下载并禁止迟到写盘；
JavaScript 桥接再检查账户和清理 generation，防止已经跨过原生桥的旧结果重新显示。
封面失败不影响音频或歌词加载，保留原有无封面表现。

设置页增加原有封面分类的占用与清理入口；沿用原 `settings-storage` 设置定位与分类操作，不建立新设置 store、
新外观配置或重复命令。清理失败必须显示错误。当前屏幕和锁屏已经持有的图片可继续显示，下一次读取重新获取。

## 验证

本机证据保存在 `.mobile-test-results/covers-*`，平台/CDN 输入为受控 fixture，不代表真实服务验收。

- 类型检查：PASS，`covers-final-web.log`；该日志还包含最终移动资源构建与 Capacitor 同步。
- 逻辑：PASS，126 项，`covers-final-web.log`。包括移动运行时、缓存分类、原键迁移及 Dexie 兼容回归。
- WebKit UI：PASS，9 项，`covers-ui.log`。iPhone 尺寸、宽 iPad、窄 iPad；清理失败／重试、音频继续播放、
  原 14 种歌词 renderer 和原过渡动画回归。原 renderer 的 `useInsertionEffect` 诊断及无 QQ 歌词 fixture
  的错误仍出现在日志中，没有通过删除动画或静音日志绕过检查。
- UI 最终清理异常处理复验：PASS，3 项，`covers-final-ui.log`，覆盖三种窗口宽度。
- iPad Pro 11 (M5)／iOS 26.5 模拟器：PASS，207 项，`covers-native.log`／`.xcresult`，86.315 秒；
  排除三项需要单独 HTTP fixture 服务的测试。随后补充“封面清理失败仍清理音频”处理，最终相关复验
  PASS，10 项，2.459 秒，`covers-native-final.log`／`.xcresult`。
- iPhone XS Max／iOS 18.7.10：PASS，最终同一组 10 项，2.798 秒，`covers-device.log`／`.xcresult`。
  测试走真实 URLSession、ImageIO 与系统 Now Playing API，网络内容为受控 fixture。
  `covers-device-identity.json` 核对 QA 宿主／插件 Bundle ID、签名 team、宿主 entitlement 与 xctestrun hash；
  只用 `test-without-building` 运行该独立宿主。测试结束已卸载 QA App、关闭本轮启动的模拟器。
- **NOT_RUN**：真实平台封面/CDN 兼容矩阵、真实锁屏视觉截图、30 分钟后台跨曲、实体 iPad、温升和内存增长。

回退移除此阶段提交即可恢复原显示入口，原缓存及本地导入不迁移；新增 `FoliaCovers` 目录可安全清除。
根 README、依赖锁、在线接口、服务器配置均未修改。
