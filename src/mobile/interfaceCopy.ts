import i18n from '../i18n/config';

// interfaceCopy.ts — explicit mobile wording for shared settings; identifiers, user content and desktop copy stay intact.
export function installMobileInterfaceCopy() {
  const mobile = {
    'zh-CN': { settings: '设置', account: '账户', livePreview: '调整即时生效', playbackView: '播放画面', animationPlayback: '动画播放', queueActions: '队列操作', browseCache: '浏览缓存歌曲' },
    en: { settings: 'Settings', account: 'Account', livePreview: 'Changes appear immediately', playbackView: 'Player view', animationPlayback: 'Animation playback', queueActions: 'Queue actions', browseCache: 'Browse cached songs' },
    in: { settings: 'Pengaturan', account: 'Akun', livePreview: 'Perubahan langsung terlihat', playbackView: 'Tampilan pemutar', animationPlayback: 'Pemutaran animasi', queueActions: 'Tindakan antrean', browseCache: 'Lihat lagu tersimpan' },
  };
  for (const [language, copy] of Object.entries(mobile)) i18n.addResourceBundle(language, 'translation', { mobile: copy }, true, true);
  const queueSheet = {
    'zh-CN': { resize: '调整队列高度' },
    en: { resize: 'Resize queue' },
    in: { resize: 'Ubah tinggi antrean' },
  };
  for (const [language, copy] of Object.entries(queueSheet)) i18n.addResourceBundle(language, 'translation', { mobile: { queueSheet: copy } }, true, true);
  const options = {
    'zh-CN': {
      transitionSettings: '智能过渡', transitionCrossfade: '交叉淡化', transitionAutomix: '自动混音',
      modelReminderDesc: '完整智能过渡需要下载神经网络模型，共约 249MB。',
      queueDefaultBehavior: '加入队列的位置',
      appLanguageDesc: '选择界面语言，或跟随系统设置。',
      playbackFadeDesc: '播放和暂停时平滑调整音量，减少突兀感。',
      reduceMotionSectionDesc: '默认播放完整动画，可分别降低各部分动效，也可选择跟随系统设置。',
      importExportDesc: '通过 JSON 或外观短码导入、导出配色主题与歌词动画设置。',
    },
    en: {
      transitionSettings: 'Transitions', transitionCrossfade: 'Crossfade', transitionAutomix: 'Automix',
      modelReminderDesc: 'Full transitions require neural network models, about 249MB together.',
      queueDefaultBehavior: 'Queue insertion',
      appLanguageDesc: 'Choose the interface language or follow the system.',
      playbackFadeDesc: 'Fade volume when playing or pausing for a smoother transition.',
      reduceMotionSectionDesc: 'Animations play in full by default. Reduce individual effects or follow the system setting.',
      importExportDesc: 'Import or export themes and visual settings using JSON or appearance codes.',
    },
    in: {
      transitionSettings: 'Transisi', transitionCrossfade: 'Crossfade', transitionAutomix: 'Automix',
      modelReminderDesc: 'Transisi lengkap memerlukan model jaringan saraf, sekitar 249MB seluruhnya.',
      queueDefaultBehavior: 'Posisi antrean',
      appLanguageDesc: 'Pilih bahasa antarmuka atau ikuti sistem.',
      playbackFadeDesc: 'Ubah volume secara halus saat memutar atau menjeda.',
      reduceMotionSectionDesc: 'Animasi penuh secara bawaan. Kurangi efek tertentu atau ikuti pengaturan sistem.',
      importExportDesc: 'Impor atau ekspor tema dan pengaturan visual melalui JSON atau kode tampilan.',
    },
  };
  for (const [language, copy] of Object.entries(options)) i18n.addResourceBundle(language, 'translation', { options: copy }, true, true);
  const lyrics = {
    'zh-CN': {
      lyricExport: { formatFia: '.fia（无损歌词）', formatFiaDesc: '完整保留逐字时间轴、翻译、背景和声和已保存的分词，可再次导入。',
        formatLrcDesc: '其他播放器也能读；背景和声、分词等扩展信息会丢失。' },
      lyricFile: { importFormats: 'lrc、vtt、ttml、qrc、yrc、krc、txt，或导出的 .fia 文件' },
    },
    en: {
      lyricExport: { formatFia: '.fia (lossless lyrics)', formatFiaDesc: 'Preserves word timing, translations, backing vocals and saved segmentation for reimport.',
        formatLrcDesc: 'Readable by other players; extended backing vocal and segmentation information is lost.' },
      lyricFile: { importFormats: 'lrc, vtt, ttml, qrc, yrc, krc, txt, or an exported .fia file' },
    },
    in: {
      lyricExport: { formatFia: '.fia (lirik lossless)', formatFiaDesc: 'Menyimpan waktu per kata, terjemahan, vokal latar dan segmentasi untuk diimpor kembali.',
        formatLrcDesc: 'Dapat dibaca pemutar lain; informasi vokal latar dan segmentasi tambahan akan hilang.' },
      lyricFile: { importFormats: 'lrc, vtt, ttml, qrc, yrc, krc, txt, atau berkas .fia yang diekspor' },
    },
  };
  for (const [language, copy] of Object.entries(lyrics)) i18n.addResourceBundle(language, 'translation', copy, true, true);
}
