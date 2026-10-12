import { test, expect, clickPlayerTool } from './fixtures';
import { BASE_DUAL_THEME } from '../../src/services/baseThemes';
import { buildThemeBucketSummaries } from '../../src/services/sync/syncMerkle';
import { unzipSync, strFromU8 } from 'fflate';

// sync.spec.ts — original coordinator, IndexedDB and settings UI with an explicit native-bridge fixture, never a live server.
const remote = { fingerprint: 'netease:id:42', theme: BASE_DUAL_THEME, source: 'manual', updatedAt: '2026-10-10T00:00:00.000Z' };
test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ remote, buckets }) => {
    const win = window as any;
    win.fixtureNoServer = true;
    const config = { revision: 0, enabled: false, baseURL: '', hasToken: false, scope: 'first' };
    win.fixtureSyncConfig = config; win.fixtureSyncRequests = []; win.fixtureSyncEdits = [];
    win.fixtureSyncBridge = async (method: string, options: any) => {
      if (method === 'getSyncSettings') return structuredClone(config);
      if (method === 'setSyncSettings') {
        if (win.fixtureSyncSaveFailure) throw Error('secure-storage');
        const edit = options.settings; win.fixtureSyncEdits.push(edit);
        if (edit.baseURL !== config.baseURL || (edit.token !== undefined && !!edit.token !== config.hasToken)) config.scope += '-next';
        if (edit.baseURL !== config.baseURL) config.hasToken = false;
        if (edit.token !== undefined) config.hasToken = !!edit.token;
        Object.assign(config, { enabled: edit.enabled, baseURL: edit.baseURL, revision: config.revision + 1 });
        return structuredClone(config);
      }
      if (method === 'cancelSyncRequest') { win.fixtureSyncCancelled = options.id; return; }
      win.fixtureSyncRequests.push(options);
      if (win.fixtureSyncDelay) await new Promise(resolve => { win.fixtureSyncRelease = resolve; });
      let body: unknown;
      switch (options.operation) {
        case 'health': body = { ok: true, schemaVersion: 1 }; break;
        case 'state': body = { schemaVersion: 1, settingsUpdatedAt: remote.updatedAt, themesUpdatedAt: remote.updatedAt, themeCount: 1 }; break;
        case 'themeManifest': body = { schemaVersion: 1, bucketCount: 256, buckets }; break;
        case 'themeBuckets': case 'themeGet': body = { themes: [remote] }; break;
        case 'themeList': body = { themes: [remote], cursor: null }; break;
        case 'settingsRead': body = { schemaVersion: 1, updatedAt: remote.updatedAt, data: { lyricsFontScale: 1.4 } }; break;
        case 'settingsWrite': body = { ok: true }; win.fixtureSyncedSettings = JSON.parse(options.body); break;
        case 'themePut': body = { ok: true }; break;
        default: throw Error('unexpected-operation');
      }
      return { status: win.fixtureSyncHTTPError ? 401 : 200, body: JSON.stringify(body), contentType: 'application/json' };
    };
  }, { remote, buckets: buildThemeBucketSummaries([remote]) });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '服务器与外观', exact: true }).click();
  await page.getByRole('button', { name: '同步服务', exact: true }).click();
  await expect(page.getByLabel('Sync Server 地址')).toBeEnabled();
});
async function configure(page: import('@playwright/test').Page) {
  await page.getByLabel('Sync Server 地址').fill('https://sync.example');
  await page.getByLabel('Bearer Token', { exact: true }).fill('fixture-token');
  await page.getByLabel('启用同步服务', { exact: true }).check();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('同步设置已保存');
}
test('saves write-only credentials, retains failed draft and removes credentials explicitly', async ({ page }) => {
  await configure(page);
  await expect(page.getByLabel('Bearer Token', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '测试', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).fixtureSyncRequests.length)).toBe(2);
  await page.getByLabel('Sync Server 地址').fill('https://new.example');
  await expect(page.getByRole('button', { name: '测试', exact: true })).toBeDisabled();
  await page.evaluate(() => { (window as any).fixtureSyncSaveFailure = true; });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('已保留你的输入');
  await expect(page.getByLabel('Sync Server 地址')).toHaveValue('https://new.example');
  await page.evaluate(() => { (window as any).fixtureSyncSaveFailure = false; });
  await page.getByLabel('清除已保存的同步凭据').check();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('尚未保存同步凭据', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('fixture-token');
  const layout = await page.locator('.mobile-sync-settings').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
  expect(layout.scroll).toBeLessThanOrEqual(layout.width);
});
test('syncs themes and visual settings with original schema and round-trips a credential-free ZIP', async ({ page }) => {
  await configure(page);
  await page.getByRole('button', { name: '同步 AI 主题', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('1');
  const theme = await page.evaluate(async () => {
    const { readCacheEntry } = await import(new URL('/src/services/repositories/cacheRepository.ts', location.href).href);
    return readCacheEntry('dual_theme_42');
  });
  expect(theme).toMatchObject({ dark: { name: BASE_DUAL_THEME.dark.name } });
  await page.getByRole('button', { name: '同步视觉设置', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).fixtureSyncedSettings?.data.lyricsFontScale)).toBe(1.4);
  await page.getByRole('button', { name: '导出 zip', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('备份已分享');
  const archive = await page.evaluate(() => (window as any).fixtureSharedArchives.at(-1));
  const files = unzipSync(Buffer.from(archive.data, 'base64'));
  expect(strFromU8(files['themes/themes.json'])).toContain('netease:id:42');
  for (const data of Object.values(files)) expect(strFromU8(data)).not.toContain('fixture-token');
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('导入 zip', { exact: true }).setInputFiles({ name: 'folia-sync.zip', mimeType: 'application/zip', buffer: Buffer.from(archive.data, 'base64') });
  await expect(page.getByRole('status')).toHaveText('备份已导入本地');
});
test('cancels an in-flight sync, discards late results and reports failed authentication', async ({ page }) => {
  await configure(page);
  await page.evaluate(() => { (window as any).fixtureSyncDelay = true; });
  await page.getByRole('button', { name: '同步 AI 主题', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).fixtureSyncRelease)).toBe('function');
  await page.getByRole('button', { name: '取消同步', exact: true }).click();
  await page.evaluate(() => { (window as any).fixtureSyncDelay = false; (window as any).fixtureSyncRelease(); });
  await expect(page.getByRole('alert')).toContainText('已取消');
  expect(await page.evaluate(() => (window as any).fixtureSyncRequests.length)).toBe(1);
  await page.evaluate(() => { (window as any).fixtureSyncHTTPError = true; });
  await page.getByRole('button', { name: '测试', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('同步失败');
});

async function openSongThemes(page: import('@playwright/test').Page) {
  await configure(page);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  await clickPlayerTool(page, '歌词与动效');
  await expect(page.locator('.mobile-theme-generation').getByRole('button', { name: '为本曲生成主题' })).toBeEnabled();
}
async function editSongName(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name: 'Theme Park · 主题编辑', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Theme Park · 主题编辑', exact: true });
  await dialog.getByRole('button', { name: 'AI 主题', exact: true }).click();
  await dialog.getByRole('button', { name: '信息', exact: true }).click();
  await dialog.getByRole('textbox').nth(2).fill(name);
  await dialog.getByRole('button', { name: '保存并应用', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
test('uploads edits only after local commit and keeps the local editor successful when the sync server fails', async ({ page }) => {
  await openSongThemes(page);
  await page.evaluate(() => { (window as any).fixtureSyncHTTPError = true; });
  await editSongName(page, 'Saved despite network error');
  await expect(page.getByText('已保存的歌曲主题：Saved despite network error', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).fixtureSyncRequests.filter((r: any) => r.operation === 'themePut').length)).toBe(1);
  const put = await page.evaluate(() => JSON.parse((window as any).fixtureSyncRequests.find((r: any) => r.operation === 'themePut').body));
  expect(put.themes).toHaveLength(1); expect(put.themes[0]).toMatchObject({ source: 'edited', theme: { dark: { name: 'Saved despite network error' } } });
  expect(await page.evaluate(() => (window as any).fixtureSyncRequests.some((r: any) => r.operation === 'themeGet'))).toBe(false);
  await page.evaluate(() => {
    (window as any).themeWriteFailure = true;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      if ((window as any).themeWriteFailure && this.name === 'api_cache' && String(value.key).startsWith('dual_theme_')) throw new DOMException('Full', 'QuotaExceededError');
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await page.getByRole('button', { name: 'Theme Park · 主题编辑', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Theme Park · 主题编辑', exact: true });
  await dialog.getByRole('button', { name: 'AI 主题', exact: true }).click();
  await dialog.getByRole('button', { name: '保存并应用', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixtureSyncRequests.filter((r: any) => r.operation === 'themePut').length)).toBe(1);
});
test('coalesces pending same-song edits without waiting for the network before closing the editor', async ({ page }) => {
  await openSongThemes(page);
  await page.evaluate(() => { (window as any).fixtureSyncDelay = true; });
  await editSongName(page, 'First saved');
  await expect.poll(() => page.evaluate(() => typeof (window as any).fixtureSyncRelease)).toBe('function');
  await editSongName(page, 'Second saved');
  await editSongName(page, 'Last saved');
  expect(await page.evaluate(() => (window as any).fixtureSyncRequests.filter((r: any) => r.operation === 'themePut').length)).toBe(1);
  await page.evaluate(() => { (window as any).fixtureSyncDelay = false; (window as any).fixtureSyncRelease(); });
  await expect.poll(() => page.evaluate(() => (window as any).fixtureSyncRequests.filter((r: any) => r.operation === 'themePut').length)).toBe(2);
  const names = await page.evaluate(() => (window as any).fixtureSyncRequests.filter((r: any) => r.operation === 'themePut')
    .map((r: any) => JSON.parse(r.body).themes[0].theme.dark.name));
  expect(names).toEqual(['First saved', 'Last saved']);
});
test('uploads a cover-generated theme with original fallback provenance', async ({ page }) => {
  await openSongThemes(page);
  await page.getByLabel('主题生成来源').selectOption('cover');
  await page.locator('.mobile-theme-generation').getByRole('button', { name: '为本曲生成主题' }).click();
  await expect(page.locator('.mobile-theme-generation').getByRole('status')).toContainText('主题已保存并应用');
  await expect.poll(() => page.evaluate(() => (window as any).fixtureSyncRequests.filter((r: any) => r.operation === 'themePut').length)).toBe(1);
  const put = await page.evaluate(() => JSON.parse((window as any).fixtureSyncRequests.find((r: any) => r.operation === 'themePut').body));
  expect(put.themes[0]).toMatchObject({ source: 'fallback', theme: { dark: { provider: 'Built-in' } } });
});
