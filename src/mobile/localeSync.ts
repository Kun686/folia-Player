// localeSync.ts — optional original sync controls; separate from music-gateway and AI credentials.
export const syncEn = {
  hint: 'Optional: sync appearance settings and song themes with your own sync service. Playback works without it.',
  tokenSaved: 'Sync token saved securely', tokenMissing: 'No sync token saved', tokenHint: 'Leave blank to retain the saved token',
  clearToken: 'Remove saved sync token', addressHint: 'Changing the address clears its old token. Enter a replacement for the new server.',
  saved: 'Sync settings saved', failed: 'Sync failed. Check the saved address, token, network and available storage, then retry.',
  saveFailed: 'Could not save sync settings. Use an HTTPS address and valid token. Your draft has been retained.',
  dirty: 'Save your changes before connecting.', cancelled: 'Cancelled. Completed uploads may already be on your server.',
  cancel: 'Cancel sync', reload: 'Reload saved settings', confirmImport: 'Import this backup and replace local appearance settings and theme cache? No upload will be performed.',
  imported: 'Backup imported locally', shared: 'Backup shared', shareCancelled: 'Sharing cancelled',
  backupHint: 'ZIP backups contain appearance settings and themes, without credentials or music. Up to 16 MB compressed and expanded.',
  localChanged: 'Appearance settings changed during sync. Your edits were kept; retry when you are finished editing.',
};
export const syncZh: typeof syncEn = {
  hint: '可选：通过你自己的同步服务同步外观设置与歌曲主题。不配置也能使用播放器。',
  tokenSaved: '同步凭据已安全保存', tokenMissing: '尚未保存同步凭据', tokenHint: '留空保留已保存的凭据',
  clearToken: '清除已保存的同步凭据', addressHint: '更换地址会清除旧凭据，请同时填写新服务器的凭据。',
  saved: '同步设置已保存', failed: '同步失败。请检查已保存的地址、凭据、网络和可用存储后重试。',
  saveFailed: '同步设置保存失败。请使用 HTTPS 地址和有效凭据；已保留你的输入。',
  dirty: '请先保存修改，再连接服务。', cancelled: '已取消。已完成的上传可能已保存在服务器上。',
  cancel: '取消同步', reload: '重新读取已保存设置', confirmImport: '导入此备份并替换本地外观设置和主题缓存？此次不会上传到服务器。',
  imported: '备份已导入本地', shared: '备份已分享', shareCancelled: '已取消分享',
  backupHint: 'ZIP 备份包含外观设置与主题，不包含凭据或音乐。压缩文件与解压内容均限 16 MB。',
  localChanged: '同步期间外观设置发生了变化，已保留你的修改。请完成编辑后重试。',
};
