// localeQueueSearch.ts — touch wording for the original queue search and batch actions.
export const queueSearchEn = {
  input: 'Search queue', scope: 'Search in', all: 'Song, artist or album', clear: 'Clear filter', batch: 'Matching queue actions',
  count: '{{count}} matching tracks', skipCurrent: 'Batch actions keep the current song',
  next: 'Play matches next', end: 'Move matches to end', remove: 'Remove matches',
  confirmRemove: 'Remove {{count}} matching tracks from the queue? The current song will keep playing.',
};
export const queueSearchZh: typeof queueSearchEn = {
  input: '搜索播放队列', scope: '搜索范围', all: '歌曲、歌手或专辑', clear: '清除筛选', batch: '队列匹配项操作',
  count: '找到 {{count}} 首歌曲', skipCurrent: '批量操作保留当前播放歌曲',
  next: '匹配项下一首播放', end: '匹配项移到队尾', remove: '移除匹配项',
  confirmRemove: '从队列移除 {{count}} 首匹配歌曲？当前歌曲会继续播放。',
};
export const queueSearchId: typeof queueSearchEn = {
  input: 'Cari antrean', scope: 'Cari di', all: 'Lagu, artis, atau album', clear: 'Hapus filter', batch: 'Tindakan hasil antrean',
  count: '{{count}} lagu cocok', skipCurrent: 'Tindakan massal mempertahankan lagu saat ini',
  next: 'Putar hasil berikutnya', end: 'Pindahkan hasil ke akhir', remove: 'Hapus hasil',
  confirmRemove: 'Hapus {{count}} lagu yang cocok dari antrean? Lagu saat ini akan tetap diputar.',
};
