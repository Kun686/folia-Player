// localeNavidrome.ts — connection and browse feedback in the existing mobile language bundle.
export const navidromeZh = {
  settings: 'Navidrome 音乐库', hint: '直接连接你的 Navidrome／Subsonic 音乐服务器。音乐网关和数据同步服务不参与此连接。',
  enabled: '启用 Navidrome', address: '服务器地址', username: '用户名', password: '密码',
  passwordHint: '留空保留已存密码', passwordSaved: '密码已保存在此设备', passwordMissing: '尚未保存密码',
  addressHint: '使用 HTTPS 地址，可包含服务器子路径。更换地址或用户名时，请重新填写密码。',
  clearPassword: '清除密码并停用', saved: '连接设置已保存', test: '测试连接', success: '连接成功',
  dirty: '请先保存更改，再测试或浏览音乐库。', configure: '配置 Navidrome', unconfigured: '配置并启用 Navidrome 后，可浏览自己的音乐库。',
  failed: 'Navidrome 请求失败，请检查连接后重试。', auth: '认证失败，请检查用户名和密码。',
  changed: '连接已变更，请重新加载。', https: '请输入有效的 HTTPS 服务器地址。',
  invalid: '连接信息不完整或格式不正确。', searchResults: '搜索结果', searchHint: '搜索歌曲、专辑或艺术家',
};
export const navidromeEn = {
  settings: 'Navidrome library', hint: 'Connect directly to your Navidrome or Subsonic music server. This connection is independent of the music gateway and data sync service.',
  enabled: 'Enable Navidrome', address: 'Server address', username: 'Username', password: 'Password',
  passwordHint: 'Leave blank to keep the saved password', passwordSaved: 'Password saved on this device', passwordMissing: 'No saved password',
  addressHint: 'Use an HTTPS address, optionally with a server path. Enter the password again when changing the address or username.',
  clearPassword: 'Clear password and disable', saved: 'Connection settings saved', test: 'Test connection', success: 'Connected',
  dirty: 'Save changes before testing or browsing the library.', configure: 'Configure Navidrome', unconfigured: 'Configure and enable Navidrome to browse your library.',
  failed: 'Navidrome request failed. Check your connection and try again.', auth: 'Authentication failed. Check the username and password.',
  changed: 'The connection changed. Reload to continue.', https: 'Enter a valid HTTPS server address.',
  invalid: 'Connection details are incomplete or invalid.', searchResults: 'Search results', searchHint: 'Search songs, albums or artists',
};
export function navidromeErrorKey(code: string) {
  return 'mobile.navidrome.' + (code === 'navidrome-auth-required' ? 'auth' : code === 'navidrome-https-endpoint-required' ? 'https'
    : code === 'invalid-navidrome-settings' ? 'invalid' : ['navidrome-settings-changed', 'navidrome-disabled', 'navidrome-cancelled'].includes(code) ? 'changed' : 'failed');
}
