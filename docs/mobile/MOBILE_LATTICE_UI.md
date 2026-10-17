<!-- MOBILE_LATTICE_UI.md — reference-image playback view, mobile UI wording, and bounded acceptance evidence. -->
# 队列拼贴与移动界面

2026-10-16后续：[全屏、自动隐藏、队列抽屉与圆形转场](PLAYER_QUEUE_TRANSITIONS.md)已安装独立模拟器；以下为最初拼贴候选记录。

2026-10-15：已将参考图对应的原版 Lattice「队列拼贴」接入移动播放器，并安装独立 iPhone 模拟器。
本轮使用 apple-design 的触摸尺寸、浮层材质和旋转布局原则；保持原项目的视觉和播放业务。
个人 iPhone mobile.28、服务器、实际 iPad 没有更新，没有新增生产依赖。

## 实现与入口

- 曲库顶部、播放器更多选项均可进入「队列拼贴」；「服务器与外观」及「歌词与动效」可选择播放后进入的视图。
- 复用原 `Lattice`、海报墙、歌词渲染、Motion 动画及 `playback_entry_view` 持久化字段。
  移动装配集中在 `MobileLattice.tsx`，共享组件的桌面默认行为保留。
- 海报切歌使用原生 `selectQueue` 和 `queueRevision`；播放、暂停、拖动、上下首、循环、打乱使用现有接口。
  不因点击海报重建真实队列；拒绝过期选择时保留当前歌曲并显示错误。
- 按实际视口缩放展开海报；旋转时停止旧相机动画并重新计算视野。交互控件反向补偿缩放，保持至少44px。
  工具栏使用半透明磨砂圆角材质，设置卡片、入口箭头和间距统一。歌词底部为控制器保留空间。
- 前后台和弹窗仍使用现有视觉层生命周期；没有新增音频时钟、歌词解析或动画库。

主要文件：`src/mobile/MobileLattice.tsx`、`PlaybackViewPreference.tsx`、`mobile-lattice.css`、
`PlayerPanel.tsx`、`MobileApp.tsx`、`SettingsSheet.tsx`、`VisualSettings.tsx`，以及 `src/components/app/lattice/`。

## 文字与缓存

移动端曲库、播放器空状态、设置说明、外观导入导出、同步和歌词格式说明中的 Folia 品牌文字已改为中性文案。
共享翻译通过 `interfaceCopy.ts` 在移动入口覆盖，支持现有三种语言；桌面翻译不整体替换。
App 显示名称和页面标题改为「音乐」，系统媒体卡片缺少歌名时也不再使用 Folia 兜底。
Bundle ID、Keychain、缓存标识、文件格式和许可证／作者信息保持，不迁移账号数据。

真实模拟器观察到直接加载 CDN 封面延迟，而本机已有缓存正常；部分 CDN 图片后来能够加载，不能称为永久失败。
现复用原生封面缓存，传递原本已有的 `allowNetwork` 能力：

- 每面墙独立管理可见海报资源，同歌共享引用；先读取本机缓存，命中不排在慢网络下载后。
- 缓存未命中才进入最多两项并发的网络队列；离屏且尚未开始的任务不发送。
- 释放最后引用时回收资源，迟到结果不写入已卸载卡片；原平台会话世代校验继续生效。
- 原生图片不进入桌面全局 CDN 解码缓存，避免长期保留 base64。

涉及 `latticeArtworkSource.ts`、`LatticeArtworkContext.tsx`、`useLatticePosterArtwork.ts`、
移动 bridge/runtime、`resourceCache.ts` 和 `FoliaNativePlugin.swift`；无另建缓存或本地曲库功能。

## 验证证据

证据根目录：`.mobile-test-results/lattice-ui-20261015/`。

| 检查 | 结果与边界 |
| --- | --- |
| 原拼贴逻辑 | **62 PASS**，`unit.log` |
| 最终资源生命周期／缓存优先 | **9 PASS**，`cache-first-unit.log`；4项资源测试及5项缓存测试 |
| 拼贴 WebKit | **9 PASS／41.7秒**，`artwork-ui.log`、`artwork/`；手机、宽平板、窄窗口，旋转、触摸尺寸、播放命令、选择拒绝、队列顺序、视图保存及文字 |
| 莫奈位置回归 | **6 PASS／36.6秒**，见 [莫奈位置保存](MONET_PORTRAIT_POSITION.md)；2px精度和字号要求未放宽 |
| 最终前端类型／构建 | **PASS**，`typecheck-cache-first.log`、`build-cache-first.log` |
| 最终原生构建 | **PASS**，`branding-final/build-native.log`；最后只移除了系统媒体歌名的品牌兜底，Web资源未改 |
| 签名、内嵌身份、安装资源 | **PASS**，`branding-final/manifest.json`、`installed-manifest.json`；146个Web资源及2个空Cordova文件 |
| 真实模拟器界面 | 真实QQ队列封面、歌词、竖横屏、控制器展开可见；两平台账号／个人歌单入口在更新后保留 |
| 真实QQ短播放 | 观察《我不难过》进度由276.451秒推进至295.064秒、歌词推进，随后暂停；未采样音频或验收听感 |
| 莫奈原生拖动 | **INCONCLUSIVE**：两次自动拖动未产生位移，退出编辑；尚不能区分输入注入问题与App手势问题，不能视为原生通过 |
| 本轮网易云音频、长播、性能、真机及实际iPad | **NOT_RUN**；WebKit平板视口不是原生iPad验收 |

WebKit使用真实歌曲身份和元数据的受控桥接样本，不能替代平台服务或音频验收。
最后9项WebKit执行在缓存优先两阶段调整之前；该调整由最终9项逻辑测试及真实模拟器封面观察覆盖，未再次运行整组WebKit。
早期选择器／CSS箭头导致的失败日志保留，`first.log`、`final-ui.log`；后续通过日志不抹去失败历史。

## 安装与保留状态

- 目标：iPhone 17 Pro／iOS 26.5，`9213032A-657A-40CD-BD2A-A3065ACCC8EC`。
- 独立 Bundle：`app.folia.validation.App`；内嵌身份：`33GAKXJHL3.app.folia.validation.App`。
- 版本／build：`0.7.16 / 28`。候选以包摘要区分，不能仅凭版本号判断。
- 最终包：`branding-final/VerifiedValidation.app`。
- 可执行文件 SHA-256：`d878e0313a6b51e89650fe60015b125a6ff8b621229bd1798b7a8af43b75b8e9`。
- 前一缓存候选保留于 `cache-first/VerifiedValidation.app`，摘要 `12a91564ec09617ee19d4e4588777793bf9c3b58bc22d43dfde5c61f45c80247`；本轮没有删除旧包。

收尾读取 `baseline.json` 与最终安装状态，只比较45项已知外观、队列和音效，不读取Keychain。
完整50首队列身份、顺序、索引、循环及音效保持；位置因本轮短播放推进，不能宣称与原暂停位置逐值一致。
原镜台模式已恢复；保留拼贴作为查看入口。莫奈操作留下已保存的默认对象（offset=0、fontScale=1.2），
因此45项外观中43项与基线逐值相同，另外2项明确记录在 `branding-final/final-state.json`，不称全部外观完全未变。

本轮交付不是全部UI、全部特效或两平台完整验收。后续仍按QQ／网易云核心、特效、设置UI推进；
QQ偶发空搜索、莫奈真实手指拖动、真机播放和性能的既有缺口不由此次结果关闭。
