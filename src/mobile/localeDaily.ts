// localeDaily.ts — daily collection controls and safe, actionable failure messages.
export const dailyEn = {
  dailyTitle: 'Daily recommendations', dailyToday: 'Today', dailyDate: 'Recommendation date', dailyRefresh: 'Refresh today',
  dailyDislike: 'Dislike and replace', dailyDislikeConfirm: 'Tell the music service you dislike {{song}} and request a replacement?',
  dailyLimit: 'The daily replacement limit has been reached.', dailyReload: 'Reload recommendations',
  dailyError: 'Could not confirm the result. Check your sign-in and reload before trying again.',
  dailyHistoryError: 'History is unavailable. Your account may not have access; today’s songs remain usable.',
  dailyUnavailable: 'Daily recommendations require an updated music server.', dailySignIn: 'Sign in to view your daily recommendations.',
};
export const dailyZh: typeof dailyEn = {
  dailyTitle: '每日推荐', dailyToday: '今天', dailyDate: '推荐日期', dailyRefresh: '刷新今日推荐',
  dailyDislike: '不喜欢，换一首', dailyDislikeConfirm: '向音乐平台提交不喜欢「{{song}}」，并换一首推荐歌曲？',
  dailyLimit: '今天的换歌次数已达上限。', dailyReload: '重新读取推荐',
  dailyError: '未能确认结果，请检查登录并重新读取后再操作。',
  dailyHistoryError: '历史推荐暂不可用，可能受账号权限限制；今日推荐仍可使用。',
  dailyUnavailable: '每日推荐需要更新音乐服务器后使用。', dailySignIn: '请先登录，再查看每日推荐。',
};
export const dailyIn: typeof dailyEn = {
  dailyTitle: 'Rekomendasi harian', dailyToday: 'Hari ini', dailyDate: 'Tanggal rekomendasi', dailyRefresh: 'Segarkan hari ini',
  dailyDislike: 'Tidak suka dan ganti', dailyDislikeConfirm: 'Kirim tidak suka untuk {{song}} dan minta lagu pengganti?',
  dailyLimit: 'Batas penggantian harian telah tercapai.', dailyReload: 'Muat ulang rekomendasi',
  dailyError: 'Hasil belum dapat dipastikan. Periksa akun dan muat ulang sebelum mencoba lagi.',
  dailyHistoryError: 'Riwayat tidak tersedia. Akses akun mungkin terbatas; lagu hari ini tetap tersedia.',
  dailyUnavailable: 'Rekomendasi harian memerlukan server musik yang diperbarui.', dailySignIn: 'Masuk untuk melihat rekomendasi harian.',
};
